// src/state/evmWallet.js
//
// Port of useEvmWallet (Vue) to the plain singleton store. Logic unchanged:
// network switch/add flow, localStorage persistence, plain EVM transfer for
// the "prepare funds" step of E2C.

import { ethers } from 'ethers';
import { DECIMALS, EVM_CHAIN_ID, EVM_CHAIN_NAME, EVM_NATIVE_CURRENCY, EVM_RPC_HTTPS, EVM_EXPLORER_URLS } from '@/constants';
import { state, commit, addLog } from './engine';
import { toast } from '@/ui/dialogs';
import { t } from '@/i18n';

// Initialize provider (read-only)
export const initProvider = () => {
  if (window.ethereum) {
    state.evmProvider = new ethers.BrowserProvider(window.ethereum);
    commit();
    addLog('EVM provider initialized');
  } else {
    addLog('No EVM wallet (like MetaMask) detected.');
  }
};

// Update EVM balance
export const updateBalance = async () => {
  if (state.evmProvider && state.evmAddress) {
    state.evmBalanceLoading = true;
    commit();
    try {
      const balanceWei = await state.evmProvider.getBalance(state.evmAddress);
      const balanceEther = ethers.formatUnits(balanceWei, DECIMALS);
      state.evmBalance = parseFloat(balanceEther).toFixed(4);
      localStorage.setItem('evmBalance', state.evmBalance);
      commit();
      addLog(`EVM balance updated: ${state.evmBalance} AI3`);
    } catch (error) {
      addLog(`Error updating EVM balance: ${error.message}`);
      console.error('EVM balance update failed:', error);
    } finally {
      state.evmBalanceLoading = false;
      commit();
    }
  }
};

// One raw eth_getBalance against the public EVM RPC — returns a number in
// AI3, or null on any failure. Arrival detection uses this so it is scoped
// to the actual destination address and works with no wallet connected.
export const fetchEvmBalanceRaw = async (address) => {
  if (!address) return null;
  try {
    const response = await fetch(EVM_RPC_HTTPS, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getBalance', params: [address, 'latest'] }),
    });
    if (!response.ok) return null;
    const msg = await response.json();
    if (msg.error || msg.result == null) return null;
    return Number(BigInt(msg.result)) / Number(10n ** DECIMALS);
  } catch {
    return null;
  }
};

// Helper to ensure correct network is selected
export const ensureCorrectNetwork = async () => {
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
export const connect = async () => {
  if (!window.ethereum) {
    addLog('MetaMask not detected during connect attempt.');
    toast({
      type: 'warn',
      title: t('notifications.evmWalletNotFound.title'),
      message: t('notifications.evmWalletNotFound.message'),
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
      state.evmAddress = accounts[0];
      localStorage.setItem('evmAddress', state.evmAddress);
      commit();
      addLog(`EVM wallet connected: ${state.evmAddress}`);
      await updateBalance();
    }
  } catch (error) {
    addLog(`EVM connection failed: ${error.message}`);
    console.error('EVM connection failed:', error);
    toast({
      type: 'danger',
      title: t('notifications.evmConnectFailed.title'),
      message: t('notifications.evmConnectFailed.message', [error.message]),
      duration: 0,
    });
  }
};

export const disconnect = () => {
  state.evmProvider = null; // The provider itself can be re-initialized later
  state.evmAddress = '';
  state.evmBalance = null;
  localStorage.removeItem('evmAddress');
  localStorage.removeItem('evmBalance');
  commit();
  addLog('EVM wallet disconnected and state cleared.');
  initProvider(); // Re-initialize read-only provider
};

// Perform a standard EVM transfer
export const performEvmTransfer = async (recipient, amountWei, onStatusUpdate) => {
  if (!state.evmProvider || !state.evmAddress) {
    throw new Error('EVM wallet not connected or provider not initialized.');
  }

  try {
    const signer = await state.evmProvider.getSigner(state.evmAddress);
    addLog(`Sending ${ethers.formatUnits(amountWei, DECIMALS)} AI3 from ${state.evmAddress} to ${recipient}...`);

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
