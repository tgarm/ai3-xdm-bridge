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
    // Actions
    connect,
    updateBalance,
    initProvider,
  };
}