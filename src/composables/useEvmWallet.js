import { ref, markRaw } from 'vue';
import { ethers } from 'ethers';
import { EVM_CHAIN_ID, EVM_CHAIN_NAME, EVM_RPC_URLS, EVM_NATIVE_CURRENCY, EVM_EXPLORER_URLS } from '@/constants';

export function useEvmWallet(addLog) {
  // EVM State
  const metamaskProvider = ref(null);
  const metamaskAddress = ref(null);
  const evmBalance = ref(0);
  const evmBalanceLoading = ref(false);
  const evmAddress = ref('');
  const fetchedTransactions = ref([]); // EVM transactions

  // Create provider if address set
  const initProvider = async () => {
    if (evmAddress.value && !metamaskProvider.value && typeof window.ethereum !== 'undefined') {
      try {
        const rawProvider = new ethers.BrowserProvider(window.ethereum);
        metamaskProvider.value = markRaw(rawProvider);
        addLog('EVM provider initialized');
        await updateBalance();
      } catch (error) {
        addLog(`Error initializing EVM provider: ${error.message}`);
      }
    }
  };

  // Update balance
  const updateBalance = async () => {
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

  // Fetch transactions
  const fetchTransactions = async () => {
    if (!metamaskProvider.value || !evmAddress.value) return;

    try {
      addLog('Fetching recent EVM transactions...');
      const numBlocks = 1000;
      const blockNumber = await metamaskProvider.value.getBlockNumber();
      addLog(`Current EVM block number: ${blockNumber}`);
      const startBlock = Math.max(0, blockNumber - numBlocks);
      addLog(`Scanning EVM blocks ${startBlock} to ${blockNumber}`);
      let evmCount = 0;
      for (let i = blockNumber; i >= startBlock && evmCount < 50; i--) {
        try {
          const block = await metamaskProvider.value.getBlock(i, true);
          if (block?.transactions) {
            for (const tx of block.transactions) {
              const from = tx.from?.toLowerCase();
              const to = tx.to?.toLowerCase();
              const addr = evmAddress.value.toLowerCase();
              if ((from === addr || to === addr) && evmCount < 50) {
                fetchedTransactions.value.push({
                  type: 'evm',
                  blockNumber: i,
                  hash: tx.hash,
                  from: tx.from,
                  to: tx.to || null,
                  amount: parseFloat(ethers.formatEther(tx.value)),
                  gas: tx.gasLimit.toString(),
                  nonce: tx.nonce,
                  timestamp: block.timestamp ? new Date(block.timestamp * 1000).toISOString() : new Date().toISOString(),
                  direction: from === addr ? 'EVM Out' : 'EVM In',
                  success: true, // Assume success for polling matcher
                });
                evmCount++;
                addLog(`Found EVM tx: ${tx.hash} value ${ethers.formatEther(tx.value)} AI3`);
              }
            }
          }
        } catch (blockError) {
          if (i % 100 === 0) addLog(`Skipped EVM block ${i}: ${blockError.message}`);
        }
      }
      fetchedTransactions.value.sort((a, b) => (b.timestamp ? new Date(b.timestamp) : b.blockNumber) - (a.timestamp ? new Date(a.timestamp) : a.blockNumber));
      addLog(`Fetched ${fetchedTransactions.value.length} recent EVM transactions`);
    } catch (error) {
      addLog(`Error fetching EVM transactions: ${error.message}`);
    }
  };

  // Connect EVM wallet
  const connect = async () => {
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
            await rawProvider.send('wallet_switchEthereumChain', [{ chainId: targetChainIdHex }]);
            addLog('Switched to Autonomys network');
          } catch (switchError) {
            if (switchError.code === 4902) {
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

        await rawProvider.send('eth_requestAccounts', []);
        const signer = await rawProvider.getSigner();
        metamaskAddress.value = await signer.getAddress();
        evmAddress.value = metamaskAddress.value;
        addLog(`EVM address set: ${evmAddress.value}`);
        await updateBalance();
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

  return {
    // State
    metamaskProvider,
    metamaskAddress,
    evmBalance,
    evmBalanceLoading,
    evmAddress,
    fetchedTransactions,
    // Actions
    connect,
    updateBalance,
    fetchTransactions,
    initProvider,
  };
}