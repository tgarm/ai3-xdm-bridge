// src/stores/transferStore.js
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';  // Added ref for pollInterval
import { MIN_TRANSFER_AMOUNT, DOMAIN_ID, EVM_WS_RPC, DECIMALS } from '@/constants';
import { useTransferUi } from '@/composables/useTransferUi';
import { useSubstrateWallet } from '@/composables/useSubstrateWallet';
import { useEvmWallet } from '@/composables/useEvmWallet';

export const useTransferStore = defineStore('transfer', () => {
  // Poll interval ref (for transfer completion)
  const pollInterval = ref(null);

  // Compose UI (exclude setAmount to avoid conflict)
  const { logs, amount, direction, isTransferring, transactions, addLog } = useTransferUi();

  // Compose Substrate (primary)
  const substrate = useSubstrateWallet(addLog);

  // Compose EVM (restored)
  const evm = useEvmWallet(addLog);

  // Computed (cross-wallet)
  const consensusConnected = computed(() => !!substrate.consensusAccount);
  const evmConnected = computed(() => !!evm.metamaskAddress);
  const sourceBalance = computed(() => {
    return direction.value === 'consensusToEVM' 
      ? (substrate.consensusBalance ? parseFloat(substrate.consensusBalance) : 0)
      : (evm.evmBalance ? parseFloat(evm.evmBalance) : 0);
  });
  const canTransfer = computed(() => {
    const validAmount = amount.value >= MIN_TRANSFER_AMOUNT;
    if (direction.value === 'consensusToEVM') {
      return consensusConnected.value && evmConnected.value && validAmount && !isTransferring.value;
    } else {
      return evmConnected.value && consensusConnected.value && validAmount;
    }
  });

  // Update balances (both wallets restored)
  const updateBalances = async () => {
    await Promise.all([substrate.updateBalance(), evm.updateBalance()]);
  };

  // Fetch transactions (unified, both restored)
  const fetchTransactions = async () => {
    await Promise.all([substrate.fetchTransactions(), evm.fetchTransactions()]);
  };

  // Connect Consensus
  const connectConsensus = () => substrate.connect();

  // Connect EVM
  const connectEVM = () => evm.connect();

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

  // Helper: Start polling for EVM bridge completion (for consensusToEVM)
  const startBridgePolling = (pendingTx) => {
    if (pollInterval.value) clearInterval(pollInterval.value);  // Clear any existing
    const startTime = Date.now();
    const pollDurationMs = 15 * 60 * 1000;  // 15 min max

    pollInterval.value = setInterval(async () => {
      if (Date.now() - startTime > pollDurationMs) {
        clearInterval(pollInterval.value);
        pollInterval.value = null;
        pendingTx.status = 'timed out';
        addLog('Bridge poll timed out after 15 min');
        return;
      }

      await fetchTransactions();

      // Scan EVM txs for match: amount (tolerance), to=evmAddress, recent, success
      const evmAddress = evm.metamaskAddress.value?.toLowerCase();
      if (!evmAddress) return;

      const matchingEvmTx = evm.fetchedTransactions.value.find(tx => 
        tx.type === 'evm' &&
        tx.success &&
        Math.abs(tx.amount - pendingTx.amount) < 0.01 &&  // Tolerance for dust/rounding
        (tx.to || '').toLowerCase() === evmAddress &&
        new Date(tx.timestamp) > new Date(pendingTx.timestamp)  // After initiation
      );

      if (matchingEvmTx) {
        pendingTx.status = 'success';
        pendingTx.evmTxHash = matchingEvmTx.hash;  // Optional: Link to EVM tx
        clearInterval(pollInterval.value);
        pollInterval.value = null;
        addLog(`Bridge transfer confirmed on EVM! Tx: ${matchingEvmTx.hash}`);
        updateBalances();
        alert('Transfer completed on EVM side!');
      }
    }, 6000);  // Poll every 6s (block time)
  };

  // Status update callback for transfer
  const handleTransferStatus = ({ status }) => {
    if (status.isInBlock) {
      addLog('Transaction in block');
    }
    if (status.isFinalized) {
      addLog('Substrate transaction finalized - polling EVM for bridge...');
      if (direction.value === 'consensusToEVM') {
        // Find the most recent pending transfer
        const pendingTxs = transactions.value.filter(tx => tx.status === 'pending' || tx.status === 'in block');
        if (pendingTxs.length > 0) {
          const pendingTx = pendingTxs[pendingTxs.length - 1];  // last one
          pendingTx.status = 'completed';  // substrate done
          startBridgePolling(pendingTx);
        }
      }
      isTransferring.value = false;
    }
    if (status.isRetracted) {
      addLog('Transaction retracted');
      isTransferring.value = false;
      if (pollInterval.value) {
        clearInterval(pollInterval.value);
        pollInterval.value = null;
      }
    }
    if (status.isFinalityTimeout) {
      addLog('Transaction finality timeout - may finalize later');
      isTransferring.value = false;
    }
  };

  // Perform transfer (orchestrates both, with polling) - substrate logic delegated
  const performTransfer = async () => {
    if (!amount.value || amount.value < MIN_TRANSFER_AMOUNT) {
      addLog('Amount below minimum transfer amount');
      alert(`Minimum transfer amount is ${MIN_TRANSFER_AMOUNT} AI3`);
      return;
    }
    const amountWei = BigInt(Math.floor(amount.value * Number(10n ** DECIMALS)));
    const estimatedTime = direction.value === 'consensusToEVM' ? '~10 min' : '~1 day';
    const newTx = {
      id: Date.now(),  // Simple ID for tracking
      direction: direction.value,
      amount: amount.value,
      status: 'pending',
      estimatedTime,
      timestamp: new Date()
    };
    transactions.value.push(newTx);
    addLog(`Initiating transfer: ${direction.value} ${amount.value} AI3`);

    try {
      if (direction.value === 'consensusToEVM') {
        if (!substrate.consensusApi || !evm.metamaskAddress.value) {
          addLog('Missing Consensus API or EVM address for transfer');
          alert('Connect both wallets first.');
          newTx.status = 'failed';
          return;
        }
        addLog('Creating Consensus to EVM transfer...');
        isTransferring.value = true;

        // Delegate to substrate composable (moved logic)
        const unsubscribe = await substrate.performConsensusTransfer(
          evm.metamaskAddress.value,
          amountWei,
          handleTransferStatus  // Pass callback for status handling
        );

        // On finalization (handled in callback, but start polling here if needed)
        // Note: Polling starts in handleTransferStatus on isFinalized
        newTx.unsubscribe = unsubscribe;  // Track for cleanup if needed
        addLog('Consensus transfer delegated and initiated');
      } else {
        newTx.status = 'manual instructions provided';
        addLog('Manual instructions for EVM to Consensus provided');
        alert('EVM → Consensus transfers require signing a Substrate extrinsic on Auto-EVM.\n\nSteps:\n1. Go to https://polkadot.js.org/apps/?rpc=' + EVM_WS_RPC + '#/extrinsics\n2. Select your EVM-derived account (import 0x private key as "substrate" type if needed).\n3. Choose transporter.transfer()\n4. Set dstLocation.chainId = Consensus\n5. Enter consensus address (e.g., your connected one: ' + substrate.consensusAddress.value + ')\n6. Amount: ' + amount.value + ' AI3 (in Shannons: ' + amountWei.toString() + ')\n7. Submit & wait ~1 day.\n\nOr use SubWallet connected to Auto-EVM.');
      }
    } catch (error) {
      newTx.status = 'failed';
      isTransferring.value = false;
      if (pollInterval.value) {
        clearInterval(pollInterval.value);
        pollInterval.value = null;
      }
      if (newTx.unsubscribe) {
        newTx.unsubscribe();  // Cleanup if initiated
      }
      addLog(`Transfer failed: ${error.message}`);
      console.error('Transfer failed:', error);
      alert('Transfer failed: ' + error.message);
    }
  };

  // Expose unified transactions (both wallets)
  const allFetchedTransactions = computed(() => [
    ...substrate.fetchedTransactions.value,
    ...evm.fetchedTransactions.value  // Restored
  ].sort((a, b) => new Date(b.timestamp || b.blockNumber) - new Date(a.timestamp || a.blockNumber)));

  // Init APIs & initial fetches if addresses loaded
  substrate.initReadOnlyApi();
  evm.initProvider();

  // Initial fetches after inits (for loaded addresses)
  const initIfLoaded = async () => {
    if (substrate.consensusAddress || evm.metamaskAddress) {
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
    // Orchestrated Actions
    updateBalances,
    fetchTransactions,
    connectConsensus,
    connectEVM,
    performTransfer,
    stopPolling,  // Expose for cleanup if needed
    minTransferAmount: MIN_TRANSFER_AMOUNT,
    // Wallet States (exposed for panels)
    consensusAddress: substrate.consensusAddress,
    consensusBalance: substrate.consensusBalance,
    consensusBalanceLoading: substrate.consensusBalanceLoading,
    evmAddress: evm.metamaskAddress,  // e.g., for EVM panel
    evmBalance: evm.evmBalance,
    evmBalanceLoading: evm.evmBalanceLoading,  // Assume this exists in useEvmWallet
    disconnectApis: substrate.disconnectApis
  };
});