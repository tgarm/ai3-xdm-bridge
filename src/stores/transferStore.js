// src/stores/transferStore.js
import { defineStore } from 'pinia';
import { computed } from 'vue';
import { transferToDomainAccount20Type } from '@autonomys/auto-xdm';
import { MIN_TRANSFER_AMOUNT, DOMAIN_ID, EVM_WS_RPC, DECIMALS } from '@/constants';  // Ensure DECIMALS is imported
import { useTransferUi } from '@/composables/useTransferUi';
import { useSubstrateWallet } from '@/composables/useSubstrateWallet';
import { useEvmWallet } from '@/composables/useEvmWallet';

export const useTransferStore = defineStore('transfer', () => {
  // Compose UI (exclude setAmount to avoid conflict)
  const { logs, amount, direction, isTransferring, transactions, addLog } = useTransferUi();

  // Compose Substrate (primary for now)
  const substrate = useSubstrateWallet(addLog);

  // Compose EVM (retained but simplified)
  const evm = useEvmWallet(addLog);

  // Computed (cross-wallet, but simplified to Substrate focus)
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

  // Update balances (Substrate only for now)
  const updateBalances = async () => {
    await substrate.updateBalance();
    // await evm.updateBalance();  // Re-enable when EVM fetches are fixed
  };

  // Fetch transactions (Substrate only for now)
  const fetchTransactions = async () => {
    await substrate.fetchTransactions();
    // await evm.fetchTransactions();  // Re-enable when ready
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

  // Perform transfer (orchestrates both)
  const performTransfer = async () => {
    if (!amount.value || amount.value < MIN_TRANSFER_AMOUNT) {
      addLog('Amount below minimum transfer amount');
      alert(`Minimum transfer amount is ${MIN_TRANSFER_AMOUNT} AI3`);
      return;
    }
    const amountWei = BigInt(Math.floor(amount.value * Number(10n ** DECIMALS)));
    const estimatedTime = direction.value === 'consensusToEVM' ? '~10 min' : '~1 day';
    const newTx = {
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
        if (!substrate.consensusApi || !evm.metamaskAddress) {
          addLog('Missing Consensus API or EVM address for transfer');
          alert('Connect both wallets first.');
          newTx.status = 'failed';
          return;
        }
        addLog('Creating Consensus to EVM transfer...');
        isTransferring.value = true;
        const tx = await transferToDomainAccount20Type(substrate.consensusApi, DOMAIN_ID, evm.metamaskAddress, amountWei.toString());
        addLog('Transfer extrinsic prepared');
        addLog('Signing and sending transaction... (check extension for signature prompt)');
        const unsubscribe = await tx.signAndSend(substrate.consensusAccount.address, ({ status }) => {
          addLog(`Transaction status: ${status.type}`);
          if (status.isInBlock) {
            newTx.status = 'in block';
            addLog('Transaction in block');
          }
          if (status.isFinalized) {
            newTx.status = 'completed';
            addLog('Transaction finalized');
            isTransferring.value = false;
            updateBalances();
            fetchTransactions();
            alert('Transfer to Auto-EVM finalized!');
          }
          if (status.isRetracted) {
            newTx.status = 'retracted';
            addLog('Transaction retracted');
            isTransferring.value = false;
          }
          if (status.isFinalityTimeout) {
            newTx.status = 'finality timeout';
            addLog('Transaction finality timeout - may finalize later');
            isTransferring.value = false;
          }
        });
        addLog('signAndSend initiated (unsubscribe ready)');
      } else {
        newTx.status = 'manual instructions provided';
        addLog('Manual instructions for EVM to Consensus provided');
        alert('EVM → Consensus transfers require signing a Substrate extrinsic on Auto-EVM.\n\nSteps:\n1. Go to https://polkadot.js.org/apps/?rpc=' + EVM_WS_RPC + '#/extrinsics\n2. Select your EVM-derived account (import 0x private key as "substrate" type if needed).\n3. Choose transporter.transfer()\n4. Set dstLocation.chainId = Consensus\n5. Enter consensus address (e.g., your connected one: ' + substrate.consensusAddress + ')\n6. Amount: ' + amount.value + ' AI3 (in Shannons: ' + amountWei.toString() + ')\n7. Submit & wait ~1 day.\n\nOr use SubWallet connected to Auto-EVM.');
      }
    } catch (error) {
      newTx.status = 'failed';
      isTransferring.value = false;
      addLog(`Transfer failed: ${error.message}`);
      console.error('Transfer failed:', error);
      alert('Transfer failed: ' + error.message);
    }
  };

  // Expose unified transactions (Substrate only for now)
  const allFetchedTransactions = computed(() => 
    [...substrate.fetchedTransactions.value]  // .value fixes iterable error; EVM omitted for simplicity
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
  );

  // Init APIs (fetches now handled inside composables after ready)
  substrate.initReadOnlyApi();
  evm.initProvider();

  // No initial if-check for fetches here—handled in composables

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
    minTransferAmount: MIN_TRANSFER_AMOUNT,
    consensusAddress: substrate.consensusAddress,
    evmAddress: evm.evmAddress,
    consensusBalance: substrate.consensusBalance,
    evmBalance: evm.evmBalance,
  };
});