// src/composables/useEvmWallet.js
import { ref, markRaw } from 'vue';
import { ethers } from 'ethers';
import { ElNotification } from 'element-plus';
import { DECIMALS } from '@/constants';

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

  return {
    evmProvider,
    evmAddress,
    evmBalance,
    evmBalanceLoading,
    initProvider,
    updateBalance,
    connect,
    disconnect,
  };
}