import { defineStore } from 'pinia';
import { ref, computed, markRaw } from 'vue';
import { web3Accounts, web3Enable, web3FromAddress } from '@polkadot/extension-dapp';
import { ApiPromise, WsProvider } from '@polkadot/api';
import { transferToDomainAccount20Type } from '@autonomys/auto-xdm';
import { ethers } from 'ethers';
import { decodeAddress, encodeAddress } from '@polkadot/util-crypto';

const CONSENSUS_RPC = 'wss://rpc.mainnet.autonomys.xyz/ws';
const EVM_WS_RPC = 'wss://auto-evm.mainnet.autonomys.xyz';
const DOMAIN_ID = 0;
const DECIMALS = 18n;
const AUTONOMYS_PREFIX = 6094;
const MIN_TRANSFER_AMOUNT = 1; // Minimum transfer amount in AI3
const LOCAL_STORAGE_KEY_CONSENSUS = 'ai3_consensus_address';
const LOCAL_STORAGE_KEY_EVM = 'ai3_evm_address';
const EVM_CHAIN_ID = 870;
const EVM_CHAIN_NAME = 'Autonomys';
const EVM_RPC_URLS = ['https://auto-evm.mainnet.autonomys.xyz'];
const EVM_NATIVE_CURRENCY = { name: 'AI3', symbol: 'AI3', decimals: 18 };
const EVM_EXPLORER_URLS = ['https://explorer.autonomys.xyz'];

export const useTransferStore = defineStore('transfer', () => {
  // State
  const consensusApi = ref(null); // Signed API for Consensus transactions/queries
  const readOnlyConsensusApi = ref(null); // Read-only for Consensus queries
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
  const fetchedTransactions = ref([]); // For fetched from chain (filtered to transporter transfers)
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
    const validAmount = amount.value >= MIN_TRANSFER_AMOUNT;
    if (direction.value === 'consensusToEVM') {
      return consensusConnected.value && evmConnected.value && validAmount && !isTransferring.value;
    } else {
      return evmConnected.value && consensusConnected.value && validAmount;
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
  const initFromStorage = () => {
    const storedConsensus = localStorage.getItem(LOCAL_STORAGE_KEY_CONSENSUS);
    if (storedConsensus) {
      consensusAddress.value = storedConsensus;
      addLog(`Loaded consensus address from localStorage: ${consensusAddress.value}`);
    }
    const storedEVM = localStorage.getItem(LOCAL_STORAGE_KEY_EVM);
    if (storedEVM) {
      evmAddress.value = storedEVM;
      metamaskAddress.value = evmAddress.value;
      addLog(`Loaded EVM address from localStorage: ${evmAddress.value}`);
    }
  };

  initFromStorage();

  // Create read-only APIs if addresses are set
  const initReadOnlyApis = async () => {
    if (consensusAddress.value && !readOnlyConsensusApi.value) {
      try {
        const provider = new WsProvider(CONSENSUS_RPC);
        const apiInstance = await ApiPromise.create({ provider });
        readOnlyConsensusApi.value = markRaw(apiInstance);
        await readOnlyConsensusApi.value.isReady;
        addLog('Read-only Consensus API initialized');
      } catch (error) {
        addLog(`Error initializing read-only Consensus API: ${error.message}`);
      }
    }
    if (evmAddress.value && !metamaskProvider.value && typeof window.ethereum !== 'undefined') {
      try {
        const rawProvider = new ethers.BrowserProvider(window.ethereum);
        metamaskProvider.value = markRaw(rawProvider);
        addLog('EVM provider initialized from stored address');
      } catch (error) {
        addLog(`Error initializing EVM provider: ${error.message}`);
      }
    }
    await updateBalances();
    await fetchTransactions();
  };

  initReadOnlyApis();

  // Actions
  const updateBalances = async () => {
    // Consensus balance
    const consensusApiToUse = readOnlyConsensusApi.value || consensusApi.value;
    if (consensusApiToUse && consensusAddress.value) {
      consensusBalanceLoading.value = true;
      try {
        const { data: { free } } = await consensusApiToUse.query.system.account(consensusAddress.value);
        consensusBalance.value = (Number(free) / Number(10n ** DECIMALS)).toFixed(4);
        addLog(`Consensus balance updated: ${consensusBalance.value} AI3`);
      } catch (error) {
        addLog(`Error updating consensus balance: ${error.message}`);
      } finally {
        consensusBalanceLoading.value = false;
      }
    }
    // EVM balance
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

  const fetchTransactions = async () => {
    // Consensus transporter transfers via Subscan V2
    let consensusTxs = [];
    if (consensusAddress.value) {
      try {
        addLog('Fetching Consensus transporter transfers via Subscan API V2...');
        const baseUrl = 'https://autonomys.api.subscan.io';
        const row = 100; // Max per page
        let page = 0;
        let hasMore = true;
        const allTxs = [];

        while (hasMore) {
          const response = await fetch(`${baseUrl}/api/v2/scan/extrinsics`, {
            method: 'POST',
            headers: { 
              'Content-Type': 'application/json',
              // Optional: 'x-api-key': 'your-key-here' for pro tier
            },
            body: JSON.stringify({
              address: consensusAddress.value,
              row,
              page,
            }),
          });

          if (!response.ok) {
            throw new Error(`Subscan API V2 error: ${response.status}`);
          }

          const data = await response.json();
          console.log('Subscan Extrinsics Response (page ' + page + '):', JSON.stringify(data, null, 2)); // Full output logging
          addLog(`Subscan extrinsics page ${page} fetched: ${data.data?.extrinsics?.length || 0} items`);

          if (data.code !== 0) {
            throw new Error(`Subscan V2 error: ${data.message}`);
          }

          const txs = data.data.extrinsics || [];
          allTxs.push(...txs);
          hasMore = txs.length === row;
          page++;
          if (page > 50) break; // Safety limit for ~5k txs; adjust as needed
        }

        // Filter and map only transporter.transfer extrinsics
        consensusTxs = allTxs
          .filter(tx => tx.call_module === 'transporter' && tx.call_module_function === 'transfer')
          .map(tx => {
            // Extract args if available
            let transferAmount = 0;
            let destination = '';
            let domainId = '';
            if (tx.call_args && Array.isArray(tx.call_args)) {
              const amountArg = tx.call_args.find(arg => arg.name === 'amount');
              if (amountArg && amountArg.value) {
                transferAmount = Number(amountArg.value) / 10**12; // Convert from planck to AI3
              }
              const accountArg = tx.call_args.find(arg => arg.name === 'account');
              if (accountArg && accountArg.value) {
                destination = accountArg.value;
              }
              const domainArg = tx.call_args.find(arg => arg.name === 'domainId');
              if (domainArg && domainArg.value) {
                domainId = domainArg.value;
              }
            }

            return {
              type: 'consensus',
              blockNumber: parseInt(tx.block_num),
              extrinsicIndex: tx.extrinsic_index,
              hash: tx.extrinsic_hash,
              method: `${tx.call_module}.${tx.call_module_function}`,
              amount: transferAmount,
              destination: destination,
              domainId: domainId,
              direction: destination.startsWith('0x') ? 'consensusToEVM' : 'unknown',
              tip: tx.tip || '0',
              nonce: tx.nonce,
              success: tx.success,
              fee: (Number(tx.fee || 0) / 10**12).toFixed(6), // In AI3
              timestamp: new Date(tx.block_timestamp * 1000).toISOString(),
              finalized: tx.finalized,
            };
          })
          .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)); // Newest first by time

        addLog(`Fetched ${consensusTxs.length} Consensus transporter transfers via Subscan V2`);
      } catch (error) {
        addLog(`Error fetching Consensus transactions via Subscan V2: ${error.message}`);
        // Fallback: Use block-scanning method for small ranges
        consensusTxs = []; // Or implement fallback here
      }
    }

    // EVM transactions (increased scan range for better coverage)
    let evmTxs = [];
    if (metamaskProvider.value && evmAddress.value) {
      try {
        addLog('Fetching recent EVM transactions...');
        const numBlocks = 500; // Increased for more coverage
        const blockNumber = await metamaskProvider.value.getBlockNumber();
        addLog(`Current EVM block number: ${blockNumber}`);
        const startBlock = Math.max(0, blockNumber - numBlocks);
        addLog(`Scanning EVM blocks ${startBlock} to ${blockNumber}`);
        for (let i = blockNumber; i >= startBlock; i--) {
          try {
            const block = await metamaskProvider.value.getBlock(i, true); // With transactions
            if (block?.transactions) {
              for (const tx of block.transactions) {
                const from = tx.from?.toLowerCase();
                const to = tx.to?.toLowerCase();
                const addr = evmAddress.value.toLowerCase();
                if (from === addr || to === addr) {
                  evmTxs.push({
                    type: 'evm',
                    blockNumber: i,
                    hash: tx.hash,
                    from: tx.from,
                    to: tx.to || null,
                    value: ethers.formatEther(tx.value),
                    gas: tx.gasLimit.toString(),
                    nonce: tx.nonce,
                    timestamp: block.timestamp ? new Date(block.timestamp * 1000).toISOString() : new Date().toISOString(),
                    direction: from === addr ? 'evmToConsensus' : 'consensusToEVM', // Approximate
                  });
                  addLog(`Found EVM tx: ${tx.hash} from/to ${from}/${to} value ${ethers.formatEther(tx.value)}`);
                }
              }
            }
          } catch (blockError) {
            // Skip if block fetch fails (e.g., old blocks)
            if (i % 100 === 0) addLog(`Skipped EVM block ${i} due to error: ${blockError.message}`);
          }
        }
        addLog(`Fetched ${evmTxs.length} recent EVM transactions`);
      } catch (error) {
        addLog(`Error fetching EVM transactions: ${error.message}`);
      }
    }

    fetchedTransactions.value = [...consensusTxs, ...evmTxs].sort((a, b) => (b.timestamp ? new Date(b.timestamp) : b.blockNumber) - (a.timestamp ? new Date(a.timestamp) : a.blockNumber));
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
      consensusApi.value = markRaw(apiInstance);
      await consensusApi.value.isReady;
      const injector = await web3FromAddress(consensusAccount.value.address);
      if (!injector) {
        throw new Error('No injector found for address');
      }
      consensusApi.value.setSigner(injector.signer);
      addLog('Consensus API ready and signer set');
      await updateBalances();
      await fetchTransactions();
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

        // Check and switch/add network
        let currentChainId;
        try {
          const chainIdHex = await rawProvider.send('eth_chainId', []);
          currentChainId = parseInt(chainIdHex, 16);
        } catch (e) {
          currentChainId = null;
        }

        const targetChainIdHex = `0x${EVM_CHAIN_ID.toString(16)}`;
        if (currentChainId !== EVM_CHAIN_ID) {
          try {
            // Try to switch
            await rawProvider.send('wallet_switchEthereumChain', [{ chainId: targetChainIdHex }]);
            addLog('Switched to Autonomys network');
          } catch (switchError) {
            if (switchError.code === 4902) {
              // Chain not added, add it
              try {
                await rawProvider.send('wallet_addEthereumChain', [{
                  chainId: targetChainIdHex,
                  chainName: EVM_CHAIN_NAME,
                  rpcUrls: EVM_RPC_URLS,
                  nativeCurrency: EVM_NATIVE_CURRENCY,
                  blockExplorerUrls: EVM_EXPLORER_URLS
                }]);
                addLog('Added and switched to Autonomys network');
              } catch (addError) {
                addLog(`Failed to add Autonomys network: ${addError.message}`);
                alert(`Failed to add Autonomys network automatically. Please add manually via https://chainlist.org/chain/${EVM_CHAIN_ID}.`);
                return;
              }
            } else {
              throw switchError;
            }
          }
        }

        // Request accounts
        await rawProvider.send('eth_requestAccounts', []);
        const signer = await rawProvider.getSigner();
        metamaskAddress.value = await signer.getAddress();
        evmAddress.value = metamaskAddress.value;
        localStorage.setItem(LOCAL_STORAGE_KEY_EVM, evmAddress.value);
        addLog(`EVM address set: ${evmAddress.value}`);
        await updateBalances();
        await fetchTransactions();
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
    const newAmount = sourceBalance.value * (percent / 100);
    amount.value = newAmount >= MIN_TRANSFER_AMOUNT ? newAmount : 0;
    if (newAmount < MIN_TRANSFER_AMOUNT) {
      addLog(`Amount set to 0 (below minimum ${MIN_TRANSFER_AMOUNT} AI3)`);
    } else {
      addLog(`Amount set to ${amount.value} AI3 (${percent}%)`);
    }
  };

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
        if (!consensusApi.value || !metamaskAddress.value) {
          addLog('Missing Consensus API or EVM address for transfer');
          alert('Connect both wallets first.');
          newTx.status = 'failed';
          return;
        }
        addLog('Creating Consensus to EVM transfer...');
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
        alert('EVM → Consensus transfers require signing a Substrate extrinsic on Auto-EVM.\n\nSteps:\n1. Go to https://polkadot.js.org/apps/?rpc=' + EVM_WS_RPC + '#/extrinsics\n2. Select your EVM-derived account (import 0x private key as "substrate" type if needed).\n3. Choose transporter.transfer()\n4. Set dstLocation.chainId = Consensus\n5. Enter consensus address (e.g., your connected one: ' + consensusAddress.value + ')\n6. Amount: ' + amount.value + ' AI3 (in Shannons: ' + amountWei.toString() + ')\n7. Submit & wait ~1 day.\n\nOr use SubWallet connected to Auto-EVM.');
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
    minTransferAmount: MIN_TRANSFER_AMOUNT,
    updateBalances, fetchTransactions,
    connectConsensus, connectEVM, setAmount, performTransfer, addLog
  };
});