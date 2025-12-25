// src/stores/transferStore.js (Updated)
import { defineStore } from 'pinia';
import { ElNotification, ElMessageBox } from 'element-plus';
import { computed, ref } from 'vue';  // Added ref for pollInterval
import { MIN_TRANSFER_AMOUNT, EVM_RPC, DECIMALS } from '@/constants';
import { useTransferUi } from '@/composables/useTransferUi';
import { useSubstrateWallet } from '@/composables/useSubstrateWallet';
import { useEvmWallet } from '@/composables/useEvmWallet';
import { i18n } from '@/i18n';

export const useTransferStore = defineStore('transfer', () => {
  const { t } = i18n.global;
  // Poll interval ref (for transfer completion)
  const pollInterval = ref(null);

  // Tx polling interval ref
  const pollTxInterval = ref(null);

  // Balance update timeout ref
  const balanceUpdateTimeout = ref(null);

  // Current status for button (new)
  const currentStatus = ref('');

  // Current pending hash for polling
  const currentPendingHash = ref(null);

  // Compose UI (exclude setAmount to avoid conflict)
  const { logs, amount, direction, isTransferring, transactions, addLog } = useTransferUi();

  // Compose Substrate (primary)
  const substrate = useSubstrateWallet(addLog);

  // Compose EVM (restored)
  const evm = useEvmWallet(addLog);

  // SDK fetched transactions (domain-to-consensus)
  const sdkFetchedTransactions = ref([]);

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

  // Update balances (both wallets restored)
  const updateBalances = async () => {
    await Promise.all([substrate.updateBalance(), evm.updateBalance()]);
    // Also update linked EVM balance if available
    if (substrate.substrateLinkedEvmAddress.value) {
      await substrate.getLinkedEvmBalance(substrate.substrateLinkedEvmAddress.value);
    }
  };

  // Fetch transactions using SDK (for domain-to-consensus transfers)
  const fetchSdkTransactions = async () => {
    const api = substrate.consensusApi?.value || substrate.readOnlyConsensusApi?.value;
    if (!api) {
      addLog('No consensus API available for SDK transaction fetching');
      return;
    }

    try {
      addLog('Fetching transfers using SDK (domain-to-consensus)...');
      const { unconfirmedTransfers: fetchUnconfirmed, cancelledTransfers: fetchCancelled } = await import('@autonomys/auto-xdm');

      const sdkTransactions = [];

      // Fetch unconfirmed transfers from domain to consensus
      const unconfirmed = await fetchUnconfirmed(api, { domainId: 0 }); // From domain 0 (Auto-EVM)
      if (unconfirmed && unconfirmed.length > 0) {
        addLog(`Found ${unconfirmed.length} unconfirmed domain-to-consensus transfers`);
        unconfirmed.forEach((transfer, index) => {
          addLog(`Unconfirmed transfer #${index}: from EVM to consensus`);

          // Convert SDK transfer format to our transaction format
          const tx = {
            type: 'domain-to-consensus',
            direction: 'evmToConsensus',
            status: 'unconfirmed',
            timestamp: new Date().toISOString(), // SDK doesn't provide timestamp
            domainId: transfer.from?.domainId || 0,
            // Note: amount is not reliable from SDK, so we don't include it
          };
          sdkTransactions.push(tx);
        });
      } else {
        addLog('No unconfirmed domain-to-consensus transfers found (SDK query)');
      }

      // Fetch cancelled transfers from domain to consensus
      const cancelled = await fetchCancelled(api, { domainId: 0 }); // From domain 0 (Auto-EVM)
      if (cancelled && cancelled.length > 0) {
        addLog(`Found ${cancelled.length} cancelled domain-to-consensus transfers`);
        cancelled.forEach((transfer, index) => {
          addLog(`Cancelled transfer #${index}: from EVM to consensus`);

          // Convert SDK transfer format to our transaction format
          const tx = {
            type: 'domain-to-consensus',
            direction: 'evmToConsensus',
            status: 'cancelled',
            timestamp: new Date().toISOString(), // SDK doesn't provide timestamp
            domainId: transfer.from?.domainId || 0,
            // Note: amount is not reliable from SDK, so we don't include it
          };
          sdkTransactions.push(tx);
        });
      } else {
        addLog('No cancelled domain-to-consensus transfers found (SDK query)');
      }

      // Update the SDK transactions ref
      sdkFetchedTransactions.value = sdkTransactions;

      // Note: Domain-to-consensus transfers that are completed would appear as regular transfers
      // in the consensus chain and should be picked up by the Subscan API in fetchTransactions

    } catch (error) {
      addLog(`Error fetching SDK transactions: ${error.message}`);
      console.error('SDK transaction fetch error:', error);
    }
  };

  // Fetch transactions (unified, both restored)
  const fetchTransactions = async () => {
    await substrate.fetchTransactions();
    // Also try to fetch domain-to-consensus transfers using SDK
    await fetchSdkTransactions();
  };

  // Connect Consensus
  const connectConsensus = async () => {
    await substrate.connect();
    // Fetch both consensus and SDK transactions after connection
    await fetchTransactions();
  };

  // Connect EVM
  const connectEVM = () => evm.connect();

  // Disconnect Consensus
  const disconnectConsensus = () => substrate.disconnect();

  // Disconnect EVM
  const disconnectEVM = () => evm.disconnect();

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

  // Polling function for submitted tx after inBlock
  const startPollingForTx = (expectedHash) => {
    if (pollTxInterval.value) {
      clearInterval(pollTxInterval.value);
      pollTxInterval.value = null;
    }
    let pollCount = 0;
    const maxPolls = 12; // ~2 min at 10s intervals
    pollTxInterval.value = setInterval(async () => {
      await fetchTransactions();
      addLog(`Polling for transaction (${pollCount}/${maxPolls})...expect hash: ${expectedHash}`);
      const foundTx = substrate.fetchedTransactions.value.find(t => t.hash === expectedHash);
      if (foundTx) {
        addLog('Submitted transaction found in history');
        const pendingTx = transactions.value.find(tx => tx.hash === expectedHash);
        if (pendingTx) {
          pendingTx.status = 'submitted';
          // Merge details from foundTx
          Object.assign(pendingTx, {
            blockNumber: foundTx.blockNumber,
            extrinsicIndex: foundTx.extrinsicIndex,
            success: foundTx.success,
            fee: foundTx.fee,
            finalized: foundTx.finalized
          });
        }
        clearInterval(pollTxInterval.value);
        pollTxInterval.value = null;
        currentPendingHash.value = null;
        isTransferring.value = false;
        currentStatus.value = '';
      } else {
        pollCount++;
        addLog(`Polling for transaction (${pollCount}/${maxPolls})...`);
        if (pollCount >= maxPolls) {
          clearInterval(pollTxInterval.value);
          pollTxInterval.value = null;
          addLog('Polling for transaction timed out');
          currentPendingHash.value = null;
          isTransferring.value = false;
          currentStatus.value = '';
        }
      }
    }, 10000);
    addLog('Started polling for submitted transaction (every 10s)');
  };

  // Status update callback for transfer (updated to start EVM polling on C2E finalization)
  const handleTransferStatus = async ({ status }) => {
    if (status.type) {
      currentStatus.value = status.type.toLowerCase().replace(/([A-Z])/g, ' $1').trim();
    }
    if (status.isInBlock) {
      addLog(`Transaction ${currentPendingHash.value} in block`);
      const pendingTx = transactions.value.find(tx => tx.hash === currentPendingHash.value);
      let finalHash = currentPendingHash.value;

      if (direction.value === 'consensusToEVM') {
        // For C2E, the extrinsic hash can change when it's included in a block.
        // We need to find the extrinsic in the block to get its final hash.
        const { block } = await substrate.consensusApi.value.rpc.chain.getBlock(status.asInBlock);
        const extrinsic = block.extrinsics.find(ex => ex.isSigned && ex.signer.toString() === substrate.consensusAddress.value);
        finalHash = extrinsic ? extrinsic.hash.toHex() : currentPendingHash.value; // Fallback to old hash

        addLog(`Transaction in block. Final hash: ${finalHash}`);

        if (pendingTx) {
          pendingTx.status = 'in block';
          pendingTx.hash = finalHash; // Update the hash on our tracked transaction
          currentPendingHash.value = finalHash; // Update the hash for subsequent polling
        }

        startPollingForTx(finalHash);
      } else if (direction.value === 'evmToConsensus') {
        // For E2C, 'in block' is the final state we can track from the source chain.
        addLog('EVM -> Consensus transaction in block. Transfer initiated on source chain.');
        ElMessageBox.alert(
          t('transfer.e2cInBlock.message'),
          t('transfer.e2cInBlock.title'),
          {
            confirmButtonText: t('transfer.e2cInBlock.confirmButton'),
            callback: () => {
              // Reset state after user confirms
              isTransferring.value = false;
              currentStatus.value = '';
              currentPendingHash.value = null;
              addLog('E2C UI reset. Ready for new transfer.');
            }
          }
        );
      }
    }
    if (status.isFinalized) {
      addLog('Substrate transaction finalized, reload transactions');
      fetchTransactions();
      if (direction.value === 'consensusToEVM') {
        // Update pending tx status if exists and log countdown info
        const pendingTx = transactions.value.find(tx => (tx.status === 'pending' || tx.status === 'in block' || tx.status === 'submitted') && tx.hash === currentPendingHash.value);
        if (pendingTx && pendingTx.expectedArrival) {
          pendingTx.status = 'finalized on consensus';
          const arrivalDate = new Date(pendingTx.expectedArrival);
          const timeLeftMs = arrivalDate.getTime() - Date.now();
          const timeLeftMin = Math.max(0, Math.ceil(timeLeftMs / 60000));
          addLog(`Consensus finalized! Funds expected on EVM in ~${timeLeftMin} minutes. Scheduling balance update...`);

          // Schedule balance update at expected arrival time
          if (balanceUpdateTimeout.value) {
            clearTimeout(balanceUpdateTimeout.value);
            balanceUpdateTimeout.value = null;
          }
          if (timeLeftMs > 0) {
            balanceUpdateTimeout.value = setTimeout(async () => {
              addLog('Estimated arrival time reached. Updating linked EVM balance...');
              if (substrate.substrateLinkedEvmAddress.value) {
                await substrate.getLinkedEvmBalance(substrate.substrateLinkedEvmAddress.value);
              }
              balanceUpdateTimeout.value = null;
            }, timeLeftMs);
          }
        }
        // Start polling linked EVM balance for ~10 min as backup
        if (pollInterval.value) {
          clearInterval(pollInterval.value);
          pollInterval.value = null;
        }
        let pollCount = 0;
        const maxPolls = 20; // ~10 min at 30s intervals
        pollInterval.value = setInterval(async () => {
          if (substrate.substrateLinkedEvmAddress.value) {
            await substrate.getLinkedEvmBalance(substrate.substrateLinkedEvmAddress.value);
          }
          addLog('Polling linked EVM balance for arrival...');
          pollCount++;
          if (pollCount >= maxPolls) {
            clearInterval(pollInterval.value);
            pollInterval.value = null;
            addLog('Linked EVM balance polling completed (timeout)');
          }
        }, 30000);
        addLog('Started linked EVM balance polling for C2E arrival');
      }
      // Stop tx polling if running
      if (pollTxInterval.value) {
        clearInterval(pollTxInterval.value);
        pollTxInterval.value = null;
      }
      currentPendingHash.value = null;
      isTransferring.value = false;
      currentStatus.value = '';
    }
    if (status.isRetracted) {
      addLog('Transaction retracted');
      isTransferring.value = false;
      currentStatus.value = '';
      currentPendingHash.value = null;
      if (pollTxInterval.value) {
        clearInterval(pollTxInterval.value);
        pollTxInterval.value = null;
      }
      if (pollInterval.value) {
        clearInterval(pollInterval.value);
        pollInterval.value = null;
      }
      if (balanceUpdateTimeout.value) {
        clearTimeout(balanceUpdateTimeout.value);
        balanceUpdateTimeout.value = null;
      }
      ElNotification({
        title: 'Transaction Retracted',
        message: 'The transaction was retracted by the network. Please check your wallet and try again.',
        type: 'warning',
        duration: 0
      });
    }
    if (status.isFinalityTimeout) {
      addLog('Transaction finality timeout - may finalize later');
      isTransferring.value = false;
      currentStatus.value = '';
      currentPendingHash.value = null;
      if (pollTxInterval.value) {
        clearInterval(pollTxInterval.value);
        pollTxInterval.value = null;
      }
      if (pollInterval.value) {
        clearInterval(pollInterval.value);
        pollInterval.value = null;
      }
      if (balanceUpdateTimeout.value) {
        clearTimeout(balanceUpdateTimeout.value);
        balanceUpdateTimeout.value = null;
      }
      ElNotification({
        title: 'Transaction Timeout',
        message: 'Finality timed out. It may still finalize, so please check your transaction history. If not, please retry.',
        type: 'warning',
        duration: 0
      });
    }
    if (status.isDropped || status.isInvalid) {
      const statusMsg = status.type.toLowerCase();
      addLog(`Transaction ${statusMsg}`);
      isTransferring.value = false;
      currentStatus.value = '';
      currentPendingHash.value = null;
      if (pollTxInterval.value) {
        clearInterval(pollTxInterval.value);
        pollTxInterval.value = null;
      }
      if (pollInterval.value) {
        clearInterval(pollInterval.value);
        pollInterval.value = null;
      }
      if (balanceUpdateTimeout.value) {
        clearTimeout(balanceUpdateTimeout.value);
        balanceUpdateTimeout.value = null;
      }
      ElNotification({
        title: 'Transfer Failed',
        message: `The transaction was ${statusMsg}. Please ensure you have sufficient balance and network connectivity, then try again.`,
        type: 'error',
        duration: 0
      });
    }
  };

  // Helper function to convert decimal string to BigInt with proper precision
  const parseAmountToWei = (amountStr) => {
    // Remove any commas or spaces
    const cleanAmount = amountStr.replace(/[,\s]/g, '');
    // Split by decimal point
    const parts = cleanAmount.split('.');
    if (parts.length > 2) {
      throw new Error('Invalid amount format');
    }
    const integerPart = parts[0] || '0';
    const decimalPart = parts[1] || '';

    // Pad or truncate decimal part to match DECIMALS
    const paddedDecimal = decimalPart.padEnd(Number(DECIMALS), '0').slice(0, Number(DECIMALS));

    // Combine integer and decimal parts
    const fullAmountStr = integerPart + paddedDecimal;

    // Remove leading zeros
    const trimmedAmountStr = fullAmountStr.replace(/^0+/, '') || '0';

    return BigInt(trimmedAmountStr);
  };

  // Perform transfer (orchestrates both, with polling) - substrate logic delegated (updated to set expectedArrival)
  const performTransfer = async () => {
    const amountNum = parseFloat(amount.value);
    if (!amount.value || amountNum < MIN_TRANSFER_AMOUNT) {
      addLog('Amount below minimum transfer amount');
      ElNotification({
        title: 'Invalid Amount',
        message: `The minimum transfer amount is ${MIN_TRANSFER_AMOUNT} AI3. Please enter a valid amount to proceed.`,
        type: 'warning',
        duration: 5000
      });
      return;
    }
    const amountWei = parseAmountToWei(amount.value);
    const transferTime = new Date();
    const estimatedTimeMs = direction.value === 'consensusToEVM' ? 10 * 60 * 1000 : 24 * 60 * 60 * 1000; // E2C is ~1 day
    const estimatedTime = direction.value === 'consensusToEVM' ? '~10 min' : '~1 day';
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
            title: 'Wallets Not Connected',
            message: 'Please connect both your Consensus and EVM wallets to proceed with the transfer.',
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
      } else { // evmToConsensus
        addLog('Creating EVM to Consensus transfer...');
        isTransferring.value = true;
        currentStatus.value = 'pending';
        currentPendingHash.value = null; // Reset

        const { unsubscribe, hash } = await substrate.performEvmToConsensusTransfer(
          substrate.consensusAddress.value,
          amountWei,
          handleTransferStatus
        );

        newTx.hash = hash;
        newTx.unsubscribe = unsubscribe;
        currentPendingHash.value = hash;
        addLog(`EVM to Consensus transfer delegated and initiated. direction: ${direction.value}`);
      }
    } catch (error) {
      newTx.status = 'failed';
      isTransferring.value = false;
      currentStatus.value = '';
      currentPendingHash.value = null;
      if (pollTxInterval.value) {
        clearInterval(pollTxInterval.value);
        pollTxInterval.value = null;
      }
      if (pollInterval.value) {
        clearInterval(pollInterval.value);
        pollInterval.value = null;
      }
      if (newTx.unsubscribe) {
        newTx.unsubscribe();  // Cleanup if initiated
      }
      addLog(`Transfer failed: ${error.message}`);
      console.error('Transfer failed:', error);
      ElNotification({
        title: 'Transfer Initiation Failed',
        message: `${error.message}. Please ensure both wallets are connected, you have sufficient balance, and try again.`,
        type: 'error',
        duration: 0
      });
    }
  };

  // Expose unified transactions (both wallets and SDK)
  const allFetchedTransactions = computed(() => [
    ...substrate.fetchedTransactions.value,
    ...sdkFetchedTransactions.value,
  ].sort((a, b) => new Date(b.timestamp || b.blockNumber) - new Date(a.timestamp || a.blockNumber)));

  // Count unconfirmed SDK transactions for notification
  const unconfirmedSdkTransactionCount = computed(() => {
    return sdkFetchedTransactions.value.filter(tx => tx.status === 'unconfirmed').length;
  });

  // Init APIs & initial fetches if addresses loaded
  const initApis = async () => {
    await substrate.initReadOnlyApi();
    evm.initProvider();

    // Initial fetches after inits (for loaded addresses)
    if (substrate.consensusAddress.value || evm.evmAddress.value) {
      await updateBalances();
      await fetchTransactions();
    }
  };
  initApis();

  // Cleanup on store destroy (optional, for dev)
  // You can call this in a global onUnmounted if needed
  const stopPolling = () => {
    if (pollInterval.value) {
      clearInterval(pollInterval.value);
      pollInterval.value = null;
    }
    if (pollTxInterval.value) {
      clearInterval(pollTxInterval.value);
      pollTxInterval.value = null;
    }
    if (balanceUpdateTimeout.value) {
      clearTimeout(balanceUpdateTimeout.value);
      balanceUpdateTimeout.value = null;
    }
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
    unconfirmedSdkTransactionCount,
    // Orchestrated Actions
    updateBalances,
    fetchTransactions,
    connectConsensus,
    connectEVM,
    disconnectConsensus,
    disconnectEVM,
    toggleDirection,
    performTransfer,
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
