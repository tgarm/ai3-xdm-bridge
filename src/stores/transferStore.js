// src/stores/transferStore.js (Updated)
import { defineStore } from 'pinia';
import { ElNotification } from 'element-plus';
import { computed, ref } from 'vue';  // Added ref for pollInterval
import { MIN_TRANSFER_AMOUNT, EVM_RPC, DECIMALS } from '@/constants';
import { useTransferUi } from '@/composables/useTransferUi';
import { useSubstrateWallet } from '@/composables/useSubstrateWallet';
import { useEvmWallet } from '@/composables/useEvmWallet';

export const useTransferStore = defineStore('transfer', () => {
  // Poll interval ref (for transfer completion)
  const pollInterval = ref(null);

  // Tx polling interval ref
  const pollTxInterval = ref(null);

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

  // Computed (cross-wallet)
  const consensusConnected = computed(() => !!substrate.consensusAccount?.value);
  const evmConnected = computed(() => !!evm.evmAddress.value);
  const sourceBalance = computed(() => {
    return direction.value === 'consensusToEVM' 
      ? (substrate.consensusBalance?.value ? parseFloat(substrate.consensusBalance.value) : 0)
      : (evm.evmBalance?.value ? parseFloat(evm.evmBalance.value) : 0);
  });
  const canTransfer = computed(() => {
    if(amount.value<MIN_TRANSFER_AMOUNT) return false;
    if(amount.value>=sourceBalance.value) return false;
    if (direction.value === 'consensusToEVM') {
      return consensusConnected.value && evmConnected.value && !isTransferring.value;
    } else {
      // TODO: the EVM amount is not actually the domain 0 amount, perhaps pre-transfer is needed
      return consensusConnected.value;
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

  // setAmount (defined here with access to sourceBalance)
  const setAmount = (percent) => {
    const newAmount = sourceBalance.value * (percent / 100);
    amount.value = newAmount >= MIN_TRANSFER_AMOUNT ? newAmount : 0;
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
  const handleTransferStatus = ({ status }) => {
    if (status.type) {
      currentStatus.value = status.type.toLowerCase().replace(/([A-Z])/g, ' $1').trim();
    }
    if (status.isInBlock) {
      addLog(`Transaction ${currentPendingHash.value} in block`);
      const pendingTx = transactions.value.find(tx => tx.hash === currentPendingHash.value);
      // The hash from signAndSend is the real one. Update our pending tx.
      const realHash = status.asInBlock.toHex();
      addLog(`Transaction in block with hash: ${realHash}`);

      if (pendingTx) {
        pendingTx.status = 'in block';
      }
      if (direction.value === 'consensusToEVM' && currentPendingHash.value) {
        startPollingForTx(currentPendingHash.value);
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
          addLog(`Consensus finalized! Funds expected on EVM in ~${timeLeftMin} minutes. Polling balance...`);
        }
        // Start polling EVM balance for ~10 min
        if (pollInterval.value) {
          clearInterval(pollInterval.value);
          pollInterval.value = null;
        }
        let pollCount = 0;
        const maxPolls = 20; // ~10 min at 30s intervals
        pollInterval.value = setInterval(async () => {
          await evm.updateBalance();
          addLog('Polling EVM balance for arrival...');
          pollCount++;
          if (pollCount >= maxPolls) {
            clearInterval(pollInterval.value);
            pollInterval.value = null;
            addLog('EVM polling completed (timeout)');
          }
        }, 30000);
        addLog('Started EVM balance polling for C2E arrival');
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
      ElNotification({
        title: 'Transfer Failed',
        message: `The transaction was ${statusMsg}. Please ensure you have sufficient balance and network connectivity, then try again.`,
        type: 'error',
        duration: 0
      });
    }
  };

  // Perform transfer (orchestrates both, with polling) - substrate logic delegated (updated to set expectedArrival)
  const performTransfer = async () => {
    if (!amount.value || amount.value < MIN_TRANSFER_AMOUNT) {
      addLog('Amount below minimum transfer amount');
      ElNotification({
        title: 'Invalid Amount',
        message: `The minimum transfer amount is ${MIN_TRANSFER_AMOUNT} AI3. Please enter a valid amount to proceed.`,
        type: 'warning',
        duration: 5000
      });
      return;
    }
    const amountWei = BigInt(Math.floor(amount.value * Number(10n ** DECIMALS)));
    const transferTime = new Date();
    const estimatedTimeMs = direction.value === 'consensusToEVM' ? 10 * 60 * 1000 : 24 * 60 * 60 * 1000;
    const estimatedTime = direction.value === 'consensusToEVM' ? '~10 min' : '~1 day';
    const newTx = {
      id: Date.now(),  // Simple ID for tracking
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
      } else {
        newTx.status = 'manual instructions provided';
        addLog('Manual instructions for EVM to Consensus provided');
        ElNotification({
          title: 'Manual Transfer Required for EVM → Consensus',
          dangerouslyUseHTMLString: true,
          message: 'This transfer requires signing a Substrate extrinsic on Auto-EVM.<br/><br/><strong>Steps:</strong><br/>1. Go to <a href="https://polkadot.js.org/apps/?rpc=' + EVM_RPC + '#/extrinsics" target="_blank" rel="noopener noreferrer">polkadot.js.org/apps/</a><br/>2. Select your EVM-derived account.<br/>3. Choose <strong>transporter.transfer()</strong><br/>4. Set <i>dstLocation.chainId</i> = <strong>Consensus</strong><br/>5. Enter consensus address: <strong>' + consensusAddressExposed.value + '</strong><br/>6. Amount: <strong>' + amountWei.toString() + '</strong> (Shannons)<br/>7. Submit & wait ~1 day.',
          type: 'info',
          duration: 0,
          position: 'top-left'
        });
        isTransferring.value = false;
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
    if (pollInterval.value) {
      clearInterval(pollInterval.value);
      pollInterval.value = null;
    }
    if (pollTxInterval.value) {
      clearInterval(pollTxInterval.value);
      pollTxInterval.value = null;
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
    canTransfer,
    allFetchedTransactions,
    currentStatus,  // New
    // Orchestrated Actions
    updateBalances,
    fetchTransactions,
    connectConsensus,
    connectEVM,
    disconnectConsensus,
    disconnectEVM,
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