// src/stores/transferStore.js
import { defineStore } from 'pinia';
import { ElNotification, ElMessageBox } from 'element-plus';
import { computed, ref } from 'vue';
import { MIN_TRANSFER_AMOUNT } from '@/constants';
import { parseAmountToWei } from '@/lib/amount';
import { useTransferUi } from '@/composables/useTransferUi';
import { useSubstrateWallet, C2E_ARRIVAL_MS, E2C_CHALLENGE_MS } from '@/composables/useSubstrateWallet';
import { useEvmWallet } from '@/composables/useEvmWallet';
import { i18n } from '@/i18n';

// C2E arrival watching: field test (2026-10-26) measured ~25 min; poll fast
// during the documented window, then back off until the 30 min horizon.
const ARRIVAL_POLL_FAST_MS = 30 * 1000; // first 10 minutes
const ARRIVAL_POLL_SLOW_MS = 60 * 1000; // until the 30 min horizon
const ARRIVAL_FAST_WINDOW_MS = 10 * 60 * 1000;
// Fallback inclusion watch: if the WS subscription dies (public nodes drop
// with 1006 routinely), scan the best chain for our extrinsic instead.
const INCLUSION_WATCH_MS = 12 * 1000;
const INCLUSION_WATCH_TIMEOUT_MS = 8 * 60 * 1000;

export const useTransferStore = defineStore('transfer', () => {
  const { t } = i18n.global;

  // Timer handles (one transfer at a time — isTransferring gates re-entry)
  const arrivalTimer = ref(null);
  const inclusionTimer = ref(null);

  // Current status for button
  const currentStatus = ref('');

  // Current pending hash for tracking
  const currentPendingHash = ref(null);

  // Compose UI (exclude setAmount to avoid conflict)
  const { logs, amount, direction, isTransferring, transactions, addLog } = useTransferUi();

  // Compose Substrate (primary)
  const substrate = useSubstrateWallet(addLog);

  // Compose EVM (restored)
  const evm = useEvmWallet(addLog);

  // Computed (cross-wallet)
  const consensusConnected = computed(() => !!substrate.consensusAccount?.value);
  const evmConnected = computed(() => !!evm.evmAddress.value);
  const sourceBalance = computed(() => {
    if (direction.value === 'consensusToEVM') {
      return substrate.consensusBalance?.value ? parseFloat(substrate.consensusBalance.value) : 0;
    } else { // evmToConsensus
      return substrate.substrateLinkedEvmBalance?.value ? parseFloat(substrate.substrateLinkedEvmBalance.value) : 0;
    }
  });

  const canPrepareFunds = computed(() => {
    if (direction.value !== 'evmToConsensus' || isTransferring.value) return false;
    const amountNum = parseFloat(amount.value);
    const hasAmount = amountNum >= MIN_TRANSFER_AMOUNT;
    const linkedHasInsufficient = amountNum > sourceBalance.value;
    const mainEvmHasSufficient = amountNum <= (evm.evmBalance.value ? parseFloat(evm.evmBalance.value) : 0);
    return hasAmount && linkedHasInsufficient && mainEvmHasSufficient && evmConnected.value && !!substrate.substrateLinkedEvmAddress.value;
  });

  const canTransfer = computed(() => {
    const amountNum = parseFloat(amount.value);
    if(amountNum < MIN_TRANSFER_AMOUNT) return false;
    if(amountNum > sourceBalance.value) return false;
    if (direction.value === 'consensusToEVM') {
      return consensusConnected.value && evmConnected.value && !isTransferring.value;
    } else {
      // For E2C, canTransfer is only true if the linked EVM has enough funds.
      // The canPrepareFunds computed handles the case where the main EVM wallet needs to send funds first.
      return consensusConnected.value && !!substrate.substrateLinkedEvmAddress.value && !isTransferring.value;
    }
  });

  // Exposed computed states for wallets (to avoid .value in components)
  const consensusAddressExposed = computed(() => substrate.consensusAddress.value || '');
  const consensusBalanceExposed = computed(() => substrate.consensusBalance.value || '0');
  const consensusBalanceLoadingExposed = computed(() => substrate.consensusBalanceLoading.value);
  const evmAddressExposed = computed(() => evm.evmAddress.value || '');
  const evmBalanceExposed = computed(() => evm.evmBalance.value || '0');
  const evmBalanceLoadingExposed = computed(() => evm.evmBalanceLoading.value);
  const substrateLinkedEvmAddressExposed = computed(() => substrate.substrateLinkedEvmAddress.value || '');
  const substrateLinkedEvmBalanceExposed = computed(() => substrate.substrateLinkedEvmBalance.value || '0');
  const substrateLinkedEvmBalanceLoadingExposed = computed(() => substrate.substrateLinkedEvmBalanceLoading.value);
  const substrateAccountsExposed = computed(() => (substrate.substrateAccounts.value || []).map(acc => ({
    address: acc.address,
    label: `${acc.meta?.name || 'Account'} · ${consensusAddressOf(acc.address)}`,
  })));
  const currentAccountAddressExposed = computed(() => substrate.consensusAccount.value?.address || '');

  function consensusAddressOf(address) {
    // Short display form; full 6094 encoding happens in the wallet composable
    return address ? `${address.slice(0, 4)}…${address.slice(-4)}` : '';
  }

  // Update balances (both wallets restored)
  const updateBalances = async () => {
    await Promise.all([substrate.updateBalance(), evm.updateBalance()]);
    // Also update linked EVM balance if available
    if (substrate.substrateLinkedEvmAddress.value) {
      await substrate.getLinkedEvmBalance(substrate.substrateLinkedEvmAddress.value);
    }
  };

  // Fetch transactions (unified, both restored)
  const fetchTransactions = async () => {
    await substrate.fetchTransactions();
  };

  // Connect Consensus
  const connectConsensus = () => substrate.connect();

  // Connect EVM
  const connectEVM = () => evm.connect();

  // Disconnect Consensus
  const disconnectConsensus = () => substrate.disconnect();

  // Disconnect EVM
  const disconnectEVM = () => evm.disconnect();

  // Switch active Consensus account (account selector)
  const switchConsensusAccount = (address) => {
    const account = substrate.substrateAccounts.value.find(acc => acc.address === address);
    if (account) substrate.switchAccount(account);
  };

  // Toggle transfer direction
  const toggleDirection = () => {
    direction.value = direction.value === 'consensusToEVM' ? 'evmToConsensus' : 'consensusToEVM';
    addLog(`Transfer direction switched to: ${direction.value}`);
  };
  // setAmount (defined here with access to sourceBalance)
  const setAmount = (percent) => {
    const newAmount = sourceBalance.value * (percent / 100);
    const newAmountStr = newAmount >= MIN_TRANSFER_AMOUNT ? newAmount.toString() : '0';
    amount.value = newAmountStr;
    if (newAmount < MIN_TRANSFER_AMOUNT) {
      addLog(`Amount set to 0 (below minimum ${MIN_TRANSFER_AMOUNT} AI3)`);
    } else {
      addLog(`Amount set to ${amount.value} AI3 (${percent}%)`);
    }
  };

  const stopArrivalWatch = () => {
    if (arrivalTimer.value) {
      clearTimeout(arrivalTimer.value);
      arrivalTimer.value = null;
    }
  };

  const stopInclusionWatch = () => {
    if (inclusionTimer.value) {
      clearTimeout(inclusionTimer.value);
      inclusionTimer.value = null;
    }
  };

  // --- C2E arrival watch -------------------------------------------------
  // Polls the linked EVM balance until it rises by (roughly) the transferred
  // amount, or the 30 min horizon passes. Never reports a fake failure: on
  // horizon expiry the transfer stays visible as "bridging" for manual refresh.
  const startArrivalWatch = (pendingTx, amountNum) => {
    stopArrivalWatch();
    const baseline = parseFloat(substrate.substrateLinkedEvmBalance.value) || 0;
    // XDM takes ~0.01% fee (1 AI3 → 0.9999); tolerate it in the comparison
    const target = baseline + amountNum * 0.98;
    const startedAt = Date.now();
    addLog(`Watching linked EVM balance for arrival (baseline ${baseline} AI3, horizon 30 min)`);

    const tick = async () => {
      arrivalTimer.value = null;
      if (substrate.substrateLinkedEvmAddress.value) {
        await substrate.getLinkedEvmBalance(substrate.substrateLinkedEvmAddress.value);
      }
      const current = parseFloat(substrate.substrateLinkedEvmBalance.value) || 0;
      if (current >= target) {
        pendingTx.status = 'arrived';
        addLog(`Funds arrived on Auto-EVM: ${current} AI3`);
        ElNotification({
          title: t('notifications.fundsArrived.title'),
          message: t('notifications.fundsArrived.message', [current]),
          type: 'success',
          duration: 0,
        });
        stopArrivalWatch();
        return;
      }
      const elapsed = Date.now() - startedAt;
      if (elapsed >= C2E_ARRIVAL_MS) {
        pendingTx.status = 'bridging';
        addLog('Arrival horizon (30 min) reached without a detected balance change — XDM transfers can take longer. Use "Refresh Balance" or history to check again.');
        ElNotification({
          title: t('notifications.stillBridging.title'),
          message: t('notifications.stillBridging.message'),
          type: 'info',
          duration: 0,
        });
        stopArrivalWatch();
        return;
      }
      const interval = elapsed < ARRIVAL_FAST_WINDOW_MS ? ARRIVAL_POLL_FAST_MS : ARRIVAL_POLL_SLOW_MS;
      arrivalTimer.value = setTimeout(tick, interval);
    };
    arrivalTimer.value = setTimeout(tick, ARRIVAL_POLL_FAST_MS);
  };

  // --- C2E inclusion watch (WS-status fallback) ---------------------------
  // If no WS status event ever arrives (subscription silently lost on WS
  // disconnect), scan the best chain for the submitted extrinsic hash. Found
  // inclusion feeds the same pipeline as the WS inBlock event.
  const startInclusionWatch = (initialHash, pendingTx) => {
    stopInclusionWatch();
    const api = substrate.consensusApi.value;
    if (!api) return;
    const deadline = Date.now() + INCLUSION_WATCH_TIMEOUT_MS;
    let lastScanned = null;
    addLog('Inclusion watch armed (fallback if websocket status events are lost)');

    const tick = async () => {
      inclusionTimer.value = null;
      // WS already advanced the transfer — nothing to fall back for
      if (pendingTx.status !== 'pending') return;
      try {
        const header = await api.rpc.chain.getHeader();
        if (lastScanned === null) lastScanned = header.number.toNumber();
        for (let h = lastScanned; h <= header.number.toNumber(); h++) {
          const bh = await api.rpc.chain.getBlockHash(h);
          if (bh.toHex() === '0x' + '0'.repeat(64)) continue; // transient fork boundary
          const block = await api.rpc.chain.getBlock(bh.toHex());
          const hit = block.block.extrinsics.find(ex => ex.hash.toHex() === initialHash);
          if (hit) {
            addLog(`Inclusion watch found the transfer in block #${h}`);
            pendingTx.status = 'in block';
            pendingTx.hash = initialHash;
            pendingTx.blockNumber = h;
            currentPendingHash.value = initialHash;
            isTransferring.value = false;
            currentStatus.value = '';
            startArrivalWatch(pendingTx, parseFloat(pendingTx.amount));
            return;
          }
        }
        lastScanned = header.number.toNumber() + 1;
      } catch (error) {
        addLog(`Inclusion watch: ${error.message}`);
      }
      if (Date.now() >= deadline) {
        addLog('Inclusion watch timed out — the transfer may still be in the tx pool. DO NOT resubmit with the same account/nonce (Subspace bans duplicates); check history later.');
        ElNotification({
          title: t('notifications.inclusionTimeout.title'),
          message: t('notifications.inclusionTimeout.message'),
          type: 'warning',
          duration: 0,
        });
        isTransferring.value = false;
        currentStatus.value = '';
        currentPendingHash.value = null;
        stopInclusionWatch();
        return;
      }
      inclusionTimer.value = setTimeout(tick, INCLUSION_WATCH_MS);
    };
    inclusionTimer.value = setTimeout(tick, INCLUSION_WATCH_MS);
  };

  // Status update callback for the C2E WS subscription
  const handleTransferStatus = async ({ status }) => {
    if (status.type) {
      currentStatus.value = status.type.toLowerCase().replace(/([A-Z])/g, ' $1').trim();
    }
    if (status.isInBlock) {
      stopInclusionWatch(); // WS delivered — fallback no longer needed
      addLog(`Transaction ${currentPendingHash.value} in block`);
      const pendingTx = transactions.value.find(tx => tx.hash === currentPendingHash.value);
      let finalHash = currentPendingHash.value;

      // For C2E, the extrinsic hash can change when it's included in a block.
      // Locate our extrinsic inside the block to learn the final hash.
      const { block } = await substrate.consensusApi.value.rpc.chain.getBlock(status.asInBlock);
      const ours = block.extrinsics.find(ex =>
        (ex.hash.toHex() === currentPendingHash.value) ||
        (ex.isSigned && ex.signer.toString() === substrate.consensusAddress.value));
      finalHash = ours ? ours.hash.toHex() : currentPendingHash.value; // Fallback to old hash

      addLog(`Transaction in block. Final hash: ${finalHash}`);

      if (pendingTx) {
        pendingTx.status = 'in block';
        pendingTx.hash = finalHash; // Update the hash on our tracked transaction
        pendingTx.blockNumber = block.block.header.number.toNumber();
        currentPendingHash.value = finalHash; // Update the hash for subsequent tracking
        // Bridging starts at inclusion, not finality — start watching now
        startArrivalWatch(pendingTx, parseFloat(pendingTx.amount));
      }
    }
    if (status.isFinalized) {
      addLog('Substrate transaction finalized, reload transactions');
      fetchTransactions();
      if (direction.value === 'consensusToEVM') {
        const pendingTx = transactions.value.find(tx => ['pending', 'in block', 'bridging'].includes(tx.status) && tx.hash === currentPendingHash.value);
        if (pendingTx && ['pending', 'in block'].includes(pendingTx.status)) {
          pendingTx.status = 'finalized on consensus';
        }
      }
    }
    if (status.isRetracted) {
      addLog('Transaction retracted');
      resetTransferState();
      ElNotification({
        title: t('notifications.retracted.title'),
        message: t('notifications.retracted.message'),
        type: 'warning',
        duration: 0
      });
    }
    if (status.isFinalityTimeout) {
      addLog('Transaction finality timeout - may finalize later');
      resetTransferState();
      ElNotification({
        title: t('notifications.finalityTimeout.title'),
        message: t('notifications.finalityTimeout.message'),
        type: 'warning',
        duration: 0
      });
    }
    if (status.isDropped || status.isInvalid) {
      const statusMsg = status.type.toLowerCase();
      addLog(`Transaction ${statusMsg}`);
      resetTransferState();
      ElNotification({
        title: t('notifications.transferFailed.title'),
        message: t('notifications.transferFailed.message', [statusMsg]),
        type: 'error',
        duration: 0
      });
    }
  };

  const resetTransferState = () => {
    isTransferring.value = false;
    currentStatus.value = '';
    currentPendingHash.value = null;
    stopInclusionWatch();
    // The arrival watch keeps running across non-final status resets: a
    // retracted/timeout notice refers to finality tracking, while the funds
    // may still bridge. It stops itself at the 30 min horizon.
  };

  // Helper function to convert decimal string to BigInt with proper precision
  // (implementation in @/lib/amount, unit-tested there)

  // Mark an E2C transfer as received by hand (the 1-day challenge period is
  // not tracked from chain data).
  const markTransferComplete = (id) => {
    const tx = transactions.value.find(tx => tx.id === id);
    if (tx) {
      tx.status = 'completed';
      addLog(`Transfer ${tx.hash || tx.id} marked as received`);
    }
  };

  // Perform transfer (orchestrates both, with polling) - substrate logic delegated
  const performTransfer = async () => {
    const amountNum = parseFloat(amount.value);
    if (!amount.value || amountNum < MIN_TRANSFER_AMOUNT) {
      addLog('Amount below minimum transfer amount');
      ElNotification({
        title: t('notifications.invalidAmount.title'),
        message: t('notifications.invalidAmount.message', [MIN_TRANSFER_AMOUNT]),
        type: 'warning',
        duration: 5000
      });
      return;
    }
    let amountWei;
    try {
      amountWei = parseAmountToWei(amount.value);
    } catch (error) {
      addLog(`Invalid amount: ${error.message}`);
      ElNotification({
        title: t('notifications.invalidAmount.title'),
        message: t('transfer.amountPrecision'),
        type: 'warning',
        duration: 5000
      });
      return;
    }
    const transferTime = new Date();
    const estimatedTime = direction.value === 'consensusToEVM' ? '~10–30 min' : '~1 day (challenge period)';
    const estimatedTimeMs = direction.value === 'consensusToEVM' ? C2E_ARRIVAL_MS : E2C_CHALLENGE_MS;
    const newTx = {
      id: Date.now(),  // Simple ID for tracking
      hash: null, // Will be set later
      direction: direction.value,
      amount: amount.value,
      status: 'pending',
      estimatedTime,
      expectedArrival: new Date(transferTime.getTime() + estimatedTimeMs).toISOString(),
      timestamp: transferTime
    };
    transactions.value.push(newTx);
    addLog(`Initiating transfer: ${direction.value} ${amount.value} AI3`);

    try {
      // Handle the "Prepare Fund" case first
      if (canPrepareFunds.value) {
        addLog('Preparing funds: transferring from main EVM wallet to linked EVM address...');
        isTransferring.value = true;
        currentStatus.value = 'preparing funds';
        newTx.direction = 'evmToLinkedEvm'; // Special direction for UI
        newTx.estimatedTime = '~1 min';
        newTx.expectedArrival = new Date(transferTime.getTime() + 60 * 1000).toISOString();

        await evm.performEvmTransfer(
          substrate.substrateLinkedEvmAddress.value,
          amountWei,
          ({ type, hash }) => {
            if (hash) newTx.hash = hash;
            if (type === 'sent') currentStatus.value = 'sending funds';
            if (type === 'confirmed') {
              addLog('Fund preparation complete. Updating linked EVM balance.');
              newTx.status = 'success';
              isTransferring.value = false;
              currentStatus.value = '';
              // Refresh linked balance to reflect the new funds
              substrate.getLinkedEvmBalance(substrate.substrateLinkedEvmAddress.value);
            }
          }
        );
        return; // Stop here, the user can now perform the actual E2C transfer
      }

      if (direction.value === 'consensusToEVM') {
        if (!substrate.consensusApi?.value || !evm.evmAddress.value) {
          addLog('Missing Consensus API or EVM address for transfer');
          ElNotification({
            title: t('notifications.walletsNotConnected.title'),
            message: t('notifications.walletsNotConnected.message'),
            type: 'error',
            duration: 0
          });
          newTx.status = 'failed';
          return;
        }
        addLog('Creating Consensus to EVM transfer...');
        isTransferring.value = true;
        currentStatus.value = 'pending';
        currentPendingHash.value = null; // Reset

        // Delegate to substrate composable (moved logic)
        const { unsubscribe, hash } = await substrate.performConsensusTransfer(
          evm.evmAddress.value,
          amountWei,
          handleTransferStatus  // Pass callback for status handling
        );

        newTx.hash = hash;
        newTx.unsubscribe = unsubscribe; // Track for cleanup if needed
        currentPendingHash.value = hash;
        addLog('Consensus transfer delegated and initiated');
        // Fallback: if WS status events are lost, find inclusion by scanning
        startInclusionWatch(hash, newTx);
      } else { // evmToConsensus via transporter precompile
        if (!substrate.linkedEvmProvider?.value || !substrate.substrateLinkedEvmAddress.value) {
          addLog('Linked EVM provider not available for E2C transfer');
          ElNotification({
            title: t('notifications.walletsNotConnected.title'),
            message: t('notifications.e2cProviderMissing'),
            type: 'error',
            duration: 0
          });
          newTx.status = 'failed';
          return;
        }
        addLog('Creating EVM to Consensus transfer (transporter precompile)...');
        isTransferring.value = true;
        currentStatus.value = 'sending';

        const { hash } = await substrate.performEvmToConsensusTransfer(
          substrate.consensusAddress.value,
          amountWei
        );

        newTx.hash = hash;
        newTx.status = 'bridging';
        isTransferring.value = false;
        currentStatus.value = '';
        addLog(`EVM to Consensus transfer confirmed on Auto-EVM: ${hash}. Challenge period ~1 day before funds land on Consensus.`);
        ElMessageBox.alert(
          t('transfer.e2cConfirmed.message', [amount.value, substrate.consensusAddress.value]),
          t('transfer.e2cConfirmed.title'),
          { confirmButtonText: t('transfer.e2cConfirmed.confirmButton') }
        );
      }
    } catch (error) {
      newTx.status = 'failed';
      isTransferring.value = false;
      currentStatus.value = '';
      currentPendingHash.value = null;
      stopInclusionWatch();
      stopArrivalWatch();
      if (newTx.unsubscribe) {
        newTx.unsubscribe();  // Cleanup if initiated
      }
      addLog(`Transfer failed: ${error.message}`);
      console.error('Transfer failed:', error);
      ElNotification({
        title: t('notifications.transferInitFailed.title'),
        message: `${error.message}. ${t('notifications.transferInitFailed.hint')}`,
        type: 'error',
        duration: 0
      });
    }
  };

  // Expose unified transactions (both wallets)
  const allFetchedTransactions = computed(() => [
    ...substrate.fetchedTransactions.value,
  ].sort((a, b) => new Date(b.timestamp || b.blockNumber) - new Date(a.timestamp || a.blockNumber)));

  // Init APIs & initial fetches if addresses loaded
  substrate.initReadOnlyApi();
  evm.initProvider();

  // Initial fetches after inits (for loaded addresses)
  const initIfLoaded = async () => {
    if (substrate.consensusAddress.value || evm.evmAddress.value) {
      await updateBalances();
      await fetchTransactions();
    }
  };
  initIfLoaded();

  // Cleanup on store destroy (optional, for dev)
  // You can call this in a global onUnmounted if needed
  const stopPolling = () => {
    stopArrivalWatch();
    stopInclusionWatch();
  };

  return {
    // UI State/Actions
    logs,
    amount,
    direction,
    isTransferring,
    transactions,
    addLog,
    setAmount,
    // Computed
    consensusConnected,
    evmConnected,
    sourceBalance,
    canTransfer, // The main transfer action
    canPrepareFunds, // The funding action
    allFetchedTransactions,
    currentStatus,  // New
    historyStatus: computed(() => substrate.historyStatus.value),
    substrateAccounts: substrateAccountsExposed,
    currentAccountAddress: currentAccountAddressExposed,
    // Orchestrated Actions
    updateBalances,
    fetchTransactions,
    connectConsensus,
    connectEVM,
    disconnectConsensus,
    disconnectEVM,
    switchConsensusAccount,
    toggleDirection,
    performTransfer,
    markTransferComplete,
    stopPolling,  // Expose for cleanup if needed
    minTransferAmount: MIN_TRANSFER_AMOUNT,
    // Wallet States (exposed as computed strings/booleans for easier use in components)
    consensusAddress: consensusAddressExposed,
    consensusBalance: consensusBalanceExposed,
    consensusBalanceLoading: consensusBalanceLoadingExposed,
    evmAddress: evmAddressExposed,
    evmBalance: evmBalanceExposed,
    evmBalanceLoading: evmBalanceLoadingExposed,
    disconnectApis: substrate.disconnectApis,
    substrateLinkedEvmAddress: substrateLinkedEvmAddressExposed,
    substrateLinkedEvmBalance: substrateLinkedEvmBalanceExposed,
    substrateLinkedEvmBalanceLoading: substrateLinkedEvmBalanceLoadingExposed,
  };
});
