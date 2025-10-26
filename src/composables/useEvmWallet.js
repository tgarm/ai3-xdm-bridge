// src/composables/useEvmWallet.js
import { ref, markRaw } from 'vue';
import { ethers } from 'ethers';
import { ElNotification } from 'element-plus';
import { DECIMALS, EVM_CHAIN_ID, EVM_CHAIN_NAME, EVM_NATIVE_CURRENCY, EVM_RPC_HTTPS, EVM_EXPLORER_URLS } from '@/constants';

export function useEvmWallet(addLog) {
  // EVM State
  const evmProvider = ref(null);
  const evmAddress = ref(localStorage.getItem('evmAddress') || '');
  const evmBalance = ref(localStorage.getItem('evmBalance') || '0');
  const evmBalanceLoading = ref(false);

  // Initialize provider (read-only)
  const initProvider = () => {
    if (window.ethereum) {
      // Use markRaw to prevent Vue from making the provider reactive, which can cause issues with ethers.js v6
      evmProvider.value = markRaw(new ethers.BrowserProvider(window.ethereum));
      addLog('EVM provider initialized');
    } else {
      addLog('No EVM wallet (like MetaMask) detected.');
    }
  };

  // Update EVM balance
  const updateBalance = async () => {
    if (evmProvider.value && evmAddress.value) {
      evmBalanceLoading.value = true;
      try {
        const balanceWei = await evmProvider.value.getBalance(evmAddress.value);
        const balanceEther = ethers.formatUnits(balanceWei, DECIMALS);
        evmBalance.value = parseFloat(balanceEther).toFixed(4);
        localStorage.setItem('evmBalance', evmBalance.value);
        addLog(`EVM balance updated: ${evmBalance.value} AI3`);
      } catch (error) {
        addLog(`Error updating EVM balance: ${error.message}`);
        console.error('EVM balance update failed:', error);
      } finally {
        evmBalanceLoading.value = false;
      }
    }
  };

  // Helper to ensure correct network is selected
  const ensureCorrectNetwork = async () => {
    if (!window.ethereum) return false;

    try {
      const currentChainId = await window.ethereum.request({ method: 'eth_chainId' });
      const expectedChainIdHex = '0x' + EVM_CHAIN_ID.toString(16);

      if (currentChainId === expectedChainIdHex) {
        addLog(`Correct EVM network detected (Chain ID: ${EVM_CHAIN_ID})`);
        return true;
      }

      addLog(`Incorrect network detected. Attempting to switch to ${EVM_CHAIN_NAME}...`);
      try {
        await window.ethereum.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: expectedChainIdHex }],
        });
        addLog(`Successfully switched to ${EVM_CHAIN_NAME}.`);
        return true;
      } catch (switchError) {
        // This error code indicates that the chain has not been added to MetaMask.
        if (switchError.code === 4902) {
          addLog(`${EVM_CHAIN_NAME} not found in wallet. Attempting to add it...`);
          await window.ethereum.request({
            method: 'wallet_addEthereumChain',
            params: [{
              chainId: expectedChainIdHex,
              chainName: EVM_CHAIN_NAME,
              nativeCurrency: EVM_NATIVE_CURRENCY,
              rpcUrls: [EVM_RPC_HTTPS], // Use the dedicated HTTPS RPC URL
              blockExplorerUrls: EVM_EXPLORER_URLS,
            }],
          });
          addLog(`Successfully added and switched to ${EVM_CHAIN_NAME}.`);
          return true;
        }
        throw switchError; // Rethrow other errors
      }
    } catch (error) {
      addLog(`Network setup failed: ${error.message}`);
      console.error('Network setup failed:', error);
      throw new Error(`Failed to switch to or add the ${EVM_CHAIN_NAME} network.`);
    }
  };

  // Connect EVM wallet
  const connect = async () => {
    if (!window.ethereum) {
      addLog('MetaMask not detected during connect attempt.');
      ElNotification({
        title: 'EVM Wallet Not Found',
        message: 'Please install an EVM-compatible wallet like MetaMask to connect.',
        type: 'warning',
        duration: 0,
      });
      return;
    }

    try {
      addLog('Attempting to connect EVM wallet...');
      // First, ensure the correct network is active or added
      await ensureCorrectNetwork();

      // Then, request accounts
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
      if (accounts.length > 0) {
        evmAddress.value = accounts[0];
        localStorage.setItem('evmAddress', evmAddress.value);
        addLog(`EVM wallet connected: ${evmAddress.value}`);
        await updateBalance();
      }
    } catch (error) {
      addLog(`EVM connection failed: ${error.message}`);
      console.error('EVM connection failed:', error);
      ElNotification({
        title: 'EVM Wallet Connection Failed',
        message: `Could not connect to the wallet: ${error.message}`,
        type: 'error',
        duration: 0,
      });
    }
  };

  const disconnect = () => {
    evmProvider.value = null; // The provider itself can be re-initialized later
    evmAddress.value = '';
    evmBalance.value = '0';
    localStorage.removeItem('evmAddress');
    localStorage.removeItem('evmBalance');
    addLog('EVM wallet disconnected and state cleared.');
    initProvider(); // Re-initialize read-only provider
  };

  // Perform a standard EVM transfer
  const performEvmTransfer = async (recipient, amountWei, onStatusUpdate) => {
    if (!evmProvider.value || !evmAddress.value) {
      throw new Error('EVM wallet not connected or provider not initialized.');
    }

    try {
      const signer = await evmProvider.value.getSigner();
      addLog(`Sending ${ethers.formatUnits(amountWei, DECIMALS)} AI3 from ${evmAddress.value} to ${recipient}...`);

      const tx = await signer.sendTransaction({
        to: recipient,
        value: amountWei
      });

      addLog(`EVM transaction sent. Hash: ${tx.hash}`);
      onStatusUpdate?.({ type: 'sent', hash: tx.hash });

      await tx.wait(); // Wait for the transaction to be mined
      addLog(`EVM transaction confirmed: ${tx.hash}`);
      onStatusUpdate?.({ type: 'confirmed', hash: tx.hash });
    } catch (error) {
      throw new Error(`EVM transfer failed: ${error.message}`);
    }
  };
  return {
    evmProvider,
    evmAddress,
    evmBalance,
    evmBalanceLoading,
    initProvider,
    updateBalance,
    connect,
    disconnect,
    performEvmTransfer,
  };
}