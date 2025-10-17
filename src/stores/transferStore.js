// src/stores/transferStore.js
import { defineStore } from 'pinia';
import { ref, computed, markRaw } from 'vue';
import { web3Accounts, web3Enable, web3FromAddress } from '@polkadot/extension-dapp';
import { ApiPromise, WsProvider } from '@polkadot/api';
import { transferToDomainAccount20Type, chainTransfers, allUnconfirmedTransfers, allCancelledTransfers } from '@autonomys/auto-xdm';
import { ethers } from 'ethers';
import { decodeAddress, encodeAddress } from '@polkadot/util-crypto';

const CONSENSUS_RPC = 'wss://rpc.mainnet.autonomys.xyz/ws';
const EVM_RPC_HTTP = 'https://auto-evm.mainnet.autonomys.xyz';
const DOMAIN_ID = 0;
const DECIMALS = 18n;
const AUTONOMYS_PREFIX = 6094;
const LOCAL_STORAGE_KEY_CONSENSUS = 'ai3_consensus_address';
const LOCAL_STORAGE_KEY_EVM = 'ai3_evm_address';

export const useTransferStore = defineStore('transfer', () => {
  // State
  const consensusApi = ref(null); // Signed API for transactions
  const readOnlyConsensusApi = ref(null); // Read-only for queries
  const consensusAccount = ref(null);
  const metamaskProvider = ref(null);
  const metamaskAddress = ref(null);
  const consensusBalance = ref(0);
  const evmBalance = ref(0);
  const consensusBalanceLoading = ref(false);
  const evmBalanceLoading = ref(false);
  const consensusAddress = ref('');
  const evmAddress = ref('');
  const direction = ref('consensusToEVM');
  const amount = ref(null);
  const isTransferring = ref(false);
  const transactions = ref([]); // For pending/manual tracked txs
  const fetchedTransactions = ref([]); // For fetched from chain
  const logs = ref([]);

  // Computed
  const consensusConnected = computed(() => !!consensusAccount.value);
  const evmConnected = computed(() => !!metamaskAddress.value);
  const sourceBalance = computed(() => {
    return direction.value === 'consensusToEVM' 
      ? (consensusBalance.value ? parseFloat(consensusBalance.value) : 0)
      : (evmBalance.value ? parseFloat(evmBalance.value) : 0);
  });
  const canTransfer = computed(() => {
    const connected = consensusConnected.value && evmConnected.value;
    const validAmount = amount.value > 0;
    if (direction.value === 'consensusToEVM') {
      return connected && validAmount && !isTransferring.value;
    } else {
      return connected && validAmount;
    }
  });

  const addLog = (message) => {
    const timestamp = new Date().toLocaleTimeString();
    logs.value.push({ timestamp, message });
    console.log(`[${timestamp}] ${message}`);
    if (logs.value.length > 50) { // Keep only last 50 logs
      logs.value.shift();
    }
  };

  // Initialize from localStorage on store creation
  if (localStorage.getItem(LOCAL_STORAGE_KEY_CONSENSUS)) {
    consensusAddress.value = localStorage.getItem(LOCAL_STORAGE_KEY_CONSENSUS);
    addLog(`Loaded consensus address from localStorage: ${consensusAddress.value}`);
  }
  if (localStorage.getItem(LOCAL_STORAGE_KEY_EVM)) {
    evmAddress.value = localStorage.getItem(LOCAL_STORAGE_KEY_EVM);
    metamaskAddress.value = evmAddress.value;
    addLog(`Loaded EVM address from localStorage: ${evmAddress.value}`);
  }

  // Create read-only API if address is set
  const initReadOnlyApi = async () => {
    if (consensusAddress.value && !readOnlyConsensusApi.value) {
      try {
        const provider = new WsProvider(CONSENSUS_RPC);
        const apiInstance = await ApiPromise.create({ provider });
        readOnlyConsensusApi.value = markRaw(apiInstance);
        await readOnlyConsensusApi.value.isReady;
        addLog('Read-only Consensus API initialized');
        await updateBalances();
        await fetchChainTransfers();
      } catch (error) {
        addLog(`Error initializing read-only API: ${error.message}`);
      }
    }
    if (evmAddress.value && !metamaskProvider.value) {
      if (typeof window.ethereum !== 'undefined') {
        try {
          const rawProvider = new ethers.BrowserProvider(window.ethereum);
          metamaskProvider.value = markRaw(rawProvider);
          await updateBalances();
          addLog('EVM provider initialized from stored address');
        } catch (error) {
          addLog(`Error initializing EVM provider: ${error.message}`);
        }
      }
    }
  };

  initReadOnlyApi();

  // Actions
  const updateBalances = async () => {
    if (readOnlyConsensusApi.value && consensusAddress.value) {
      consensusBalanceLoading.value = true;
      try {
        const { data: { free } } = await readOnlyConsensusApi.value.query.system.account(consensusAddress.value);
        consensusBalance.value = (Number(free) / Number(10n ** DECIMALS)).toFixed(4);
        addLog(`Consensus balance updated: ${consensusBalance.value} AI3`);
      } catch (error) {
        addLog(`Error updating consensus balance: ${error.message}`);
      } finally {
        consensusBalanceLoading.value = false;
      }
    }
    if (metamaskProvider.value && evmAddress.value) {
      evmBalanceLoading.value = true;
      try {
        const balance = await metamaskProvider.value.getBalance(evmAddress.value);
        evmBalance.value = ethers.formatEther(balance);
        addLog(`EVM balance updated: ${evmBalance.value} AI3`);
      } catch (error) {
        addLog(`Error updating EVM balance: ${error.message}`);
      } finally {
        evmBalanceLoading.value = false;
      }
    }
  };

  const fetchChainTransfers = async () => {
    const apiToUse = readOnlyConsensusApi.value || consensusApi.value;
    if (!apiToUse || !consensusAddress.value) return;
    try {
      addLog('Fetching chain transfers...');
      const transfers = await chainTransfers(apiToUse);
      const humanTransfers = transfers.toHuman();
      // Handle object structure with keys: transfersIn, transfersOut, etc.
      if (humanTransfers && typeof humanTransfers === 'object') {
        const allTransfers = [
          ...(humanTransfers.transfersIn ? Object.values(humanTransfers.transfersIn) : []),
          ...(humanTransfers.transfersOut ? Object.values(humanTransfers.transfersOut) : []),
          ...(humanTransfers.rejectedTransfersClaimed ? Object.values(humanTransfers.rejectedTransfersClaimed) : []),
          ...(humanTransfers.transfersRejected ? Object.values(humanTransfers.transfersRejected) : [])
        ].filter(tx => tx); // Filter out undefined/null
        fetchedTransactions.value = allTransfers;
        addLog(`Fetched ${allTransfers.length} transfers from chain (transfersIn: ${Object.keys(humanTransfers.transfersIn || {}).length}, transfersOut: ${Object.keys(humanTransfers.transfersOut || {}).length}, rejectedClaimed: ${Object.keys(humanTransfers.rejectedTransfersClaimed || {}).length}, rejected: ${Object.keys(humanTransfers.transfersRejected || {}).length})`);
      } else {
        fetchedTransactions.value = [];
        addLog(`Fetched chain transfers but invalid structure: ${typeof humanTransfers}`);
      }
    } catch (error) {
      addLog(`Error fetching chain transfers: ${error.message}`);
      fetchedTransactions.value = [];
    }
  };

  const fetchUnconfirmedTransfers = async () => {
    const apiToUse = readOnlyConsensusApi.value || consensusApi.value;
    if (!apiToUse) return;
    try {
      addLog('Fetching unconfirmed transfers...');
      const unconfirmed = await allUnconfirmedTransfers(apiToUse);
      const humanUnconfirmed = unconfirmed.toHuman();
      // Similar handling; perhaps merge or log
      addLog(`Fetched unconfirmed transfers: ${Array.isArray(humanUnconfirmed) ? humanUnconfirmed.length : 'non-array'}`);
    } catch (error) {
      addLog(`Error fetching unconfirmed transfers: ${error.message}`);
    }
  };

  const connectConsensus = async () => {
    try {
      addLog('Attempting to connect Consensus wallet...');
      await web3Enable('ai3-transfer-app');
      const allAccounts = await web3Accounts();
      if (allAccounts.length === 0) {
        alert('No accounts found. Install/Unlock SubWallet or Talisman.');
        addLog('No accounts found in extension');
        return;
      }
      consensusAccount.value = allAccounts[0];
      
      const publicKey = decodeAddress(consensusAccount.value.address);
      consensusAddress.value = encodeAddress(publicKey, AUTONOMYS_PREFIX);
      localStorage.setItem(LOCAL_STORAGE_KEY_CONSENSUS, consensusAddress.value);
      addLog(`Consensus address set: ${consensusAddress.value}`);
      
      const provider = new WsProvider(CONSENSUS_RPC);
      const apiInstance = await ApiPromise.create({ provider });
      consensusApi.value = markRaw(apiInstance); // Mark as non-reactive to prevent proxy issues with private fields
      await consensusApi.value.isReady; // Wait for API to be ready
      const injector = await web3FromAddress(consensusAccount.value.address);
      if (!injector) {
        throw new Error('No injector found for address');
      }
      consensusApi.value.setSigner(injector.signer);
      addLog('Consensus API ready and signer set');
      await updateBalances();
      await fetchChainTransfers(); // Initial fetch
      addLog('Consensus connection successful');
    } catch (error) {
      console.error('Consensus connection failed:', error);
      addLog(`Consensus connection failed: ${error.message}`);
      alert('Connection failed: ' + error.message);
    }
  };

  const connectEVM = async () => {
    if (typeof window.ethereum !== 'undefined') {
      try {
        addLog('Attempting to connect EVM wallet...');
        const rawProvider = new ethers.BrowserProvider(window.ethereum);
        metamaskProvider.value = markRaw(rawProvider);
        await metamaskProvider.value.send('eth_requestAccounts', []);
        const signer = await metamaskProvider.value.getSigner();
        metamaskAddress.value = await signer.getAddress();
        evmAddress.value = metamaskAddress.value;
        localStorage.setItem(LOCAL_STORAGE_KEY_EVM, evmAddress.value);
        addLog(`EVM address set: ${evmAddress.value}`);
        await updateBalances();
        addLog('EVM connection successful');
      } catch (error) {
        console.error('MetaMask connection failed:', error);
        addLog(`EVM connection failed: ${error.message}`);
        alert('MetaMask connection failed: ' + error.message);
      }
    } else {
      addLog('MetaMask not detected');
      alert('MetaMask not detected. Install MetaMask and add Autonomys chain (ID 870 via https://chainlist.org/chain/870).');
    }
  };

  const setAmount = (percent) => {
    amount.value = sourceBalance.value * (percent / 100);
    addLog(`Amount set to ${amount.value} AI3 (${percent}%)`);
  };

  const performTransfer = async () => {
    if (!amount.value || amount.value <= 0) {
      addLog('Invalid amount provided');
      alert('Invalid amount');
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
        if (!consensusApi.value || !metamaskAddress.value) {
          addLog('Missing API or EVM address for transfer');
          alert('Connect both wallets first.');
          newTx.status = 'failed';
          return;
        }
        addLog('Creating transfer transaction...');
        isTransferring.value = true;
        const tx = await transferToDomainAccount20Type(consensusApi.value, DOMAIN_ID, metamaskAddress.value, amountWei.toString());
        addLog('Transfer extrinsic prepared');
        addLog('Signing and sending transaction... (check extension for signature prompt)');
        const unsubscribe = await tx.signAndSend(consensusAccount.value.address, ({ status }) => {
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
            fetchUnconfirmedTransfers(); // Refresh after completion
            fetchChainTransfers(); // Also refresh history
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
        alert('EVM → Consensus transfers require signing a Substrate extrinsic on Auto-EVM.\n\nSteps:\n1. Go to https://polkadot.js.org/apps/?rpc=wss://auto-evm.mainnet.autonomys.xyz/ws#/extrinsics\n2. Select your EVM-derived account (import 0x private key as "substrate" type if needed).\n3. Choose transporter.transfer()\n4. Set dstLocation.chainId = Consensus\n5. Enter consensus address (e.g., your connected one: ' + consensusAddress.value + ')\n6. Amount: ' + amount.value + ' AI3 (in Shannons: ' + amountWei.toString() + ')\n7. Submit & wait ~1 day.\n\nOr use SubWallet connected to Auto-EVM.');
      }
    } catch (error) {
      newTx.status = 'failed';
      isTransferring.value = false;
      addLog(`Transfer failed: ${error.message}`);
      console.error('Transfer failed:', error);
      alert('Transfer failed: ' + error.message);
    }
  };

  return {
    consensusApi, readOnlyConsensusApi, consensusAccount, metamaskProvider, metamaskAddress,
    consensusBalance, evmBalance, consensusBalanceLoading, evmBalanceLoading,
    consensusAddress, evmAddress,
    direction, amount, isTransferring, transactions, fetchedTransactions, logs,
    consensusConnected, evmConnected, sourceBalance, canTransfer,
    updateBalances, fetchChainTransfers, fetchUnconfirmedTransfers,
    connectConsensus, connectEVM, setAmount, performTransfer, addLog
  };
});