// src/state/evmWallet.js
//
// Injected EVM wallet session, connected PER WALLET (the chosen EIP-6963 /
// legacy provider, not whichever window.ethereum wins the injection race).
// The network switch/add flow follows the PermaDrive injected-wallet
// pattern: authorize accounts first, then switch, and recognize the
// "chain missing" error in every shape wallets report it. Injected
// connections are session-scoped: nothing is restored from localStorage —
// the address must never outlive its wallet (a stale address with a
// different wallet's provider would sign from the wrong account).

import { ethers } from 'ethers';
import { DECIMALS, EVM_CHAIN_ID, EVM_CHAIN_NAME, EVM_NATIVE_CURRENCY, EVM_RPC_HTTPS, EVM_EXPLORER_URLS } from '@/constants';
import { isChainMissingSwitchError, isUserRejectedError } from '@/lib/evmErrors';
import { state, commit, addLog } from './engine';
import { toast } from '@/ui/dialogs';
import { t } from '@/i18n';

// Event unbind for the connected provider (see attachWalletEvents).
let unbindEvmEvents = null;

// Initialize provider (read-only, pre-connect convenience only)
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

// Helper to ensure the given (or connected) provider is on Auto EVM. Order
// matters: the site must be authorized (eth_requestAccounts) before
// wallet_switch/add — some wallets refuse wallet_* pre-authorization — and
// "chain missing" must be detected in every shape wallets report it: 4902
// at the top level (classic MetaMask) or wrapped as -32603 with the real
// code in data.originalError.code (newer / substitute wallets).
export const ensureCorrectNetwork = async (eth = state.evmRaw || window.ethereum) => {
  if (!eth) return false;

  const expectedChainIdHex = '0x' + EVM_CHAIN_ID.toString(16);

  let currentChainId;
  try {
    currentChainId = await eth.request({ method: 'eth_chainId' });
  } catch (error) {
    addLog(`Failed to read the current EVM network: ${error.message}`);
    throw new Error(`Failed to read the current EVM network: ${error.message}`);
  }

  if (currentChainId === expectedChainIdHex) {
    addLog(`Correct EVM network detected (Chain ID: ${EVM_CHAIN_ID})`);
    return true;
  }

  addLog(`Incorrect network detected. Attempting to switch to ${EVM_CHAIN_NAME}...`);
  try {
    await eth.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: expectedChainIdHex }],
    });
    addLog(`Successfully switched to ${EVM_CHAIN_NAME}.`);
    return true;
  } catch (switchError) {
    // A deliberate "no" in the wallet — surface it as-is, never fire the
    // add-chain dialog on top of it.
    if (isUserRejectedError(switchError)) {
      addLog('Network switch rejected in the wallet.');
      throw switchError;
    }

    if (!isChainMissingSwitchError(switchError)) {
      addLog(`Network switch failed: ${switchError.message}`);
      console.error('Network switch failed:', switchError);
      throw new Error(`Failed to switch to the ${EVM_CHAIN_NAME} network: ${switchError.message}`);
    }

    addLog(`${EVM_CHAIN_NAME} not found in wallet. Attempting to add it...`);
    try {
      await eth.request({
        method: 'wallet_addEthereumChain',
        params: [{
          chainId: expectedChainIdHex,
          chainName: EVM_CHAIN_NAME,
          nativeCurrency: EVM_NATIVE_CURRENCY,
          rpcUrls: [EVM_RPC_HTTPS], // Use the dedicated HTTPS RPC URL
          blockExplorerUrls: EVM_EXPLORER_URLS,
        }],
      });
      // EIP-3085 says the wallet should switch to the chain it just added,
      // but a few wallets only add it — switch explicitly if needed.
      const afterAdd = await eth.request({ method: 'eth_chainId' });
      if (afterAdd !== expectedChainIdHex) {
        await eth.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: expectedChainIdHex }],
        });
      }
      addLog(`Successfully added and switched to ${EVM_CHAIN_NAME}.`);
      return true;
    } catch (addError) {
      if (isUserRejectedError(addError)) {
        // Rejection of the add dialog is a plain "no" as well.
        addLog('Adding the network was rejected in the wallet.');
      } else {
        addLog(`Adding the network failed: ${addError.message}`);
        console.error('Adding the network failed:', addError);
      }
      throw addError;
    }
  }
};

// Follow the injected wallet while connected (C01-style): account switch in
// the wallet → update in place; lock/disconnect (empty list) → drop the
// session; network switch → remember chain (UI hints, sends re-check).
// Listeners are defensive (on/removeListener may be missing on legacy
// providers) — without events the flow degrades to the old static behavior.
const attachWalletEvents = (eth) => {
  const onAccounts = (accounts) => {
    const list = accounts ?? [];
    if (list.length === 0) {
      addLog('EVM wallet disconnected or locked — clearing the session.');
      void disconnect();
      return;
    }
    if (state.evmAddress && list[0].toLowerCase() !== state.evmAddress.toLowerCase()) {
      state.evmAddress = list[0];
      commit();
      addLog(`EVM account switched in wallet: ${state.evmAddress}`);
      void updateBalance();
    }
  };
  const onChain = (chainIdHex) => {
    const chainId = Number.parseInt(String(chainIdHex), 16);
    if (Number.isNaN(chainId) || state.evmChainId === chainId) return;
    state.evmChainId = chainId;
    commit();
    addLog(`EVM network changed: chain ${chainId}`);
  };
  eth.on?.('accountsChanged', onAccounts);
  eth.on?.('chainChanged', onChain);
  return () => {
    eth.removeListener?.('accountsChanged', onAccounts);
    eth.removeListener?.('chainChanged', onChain);
  };
};

// Connect one specific discovered wallet ({name, label, provider}).
export const connect = async (wallet) => {
  const eth = wallet?.provider;
  if (!eth) {
    addLog('No EVM wallet available during connect attempt.');
    toast({
      type: 'warn',
      title: t('notifications.evmWalletNotFound.title'),
      message: t('notifications.evmWalletNotFound.message'),
      duration: 0,
    });
    return;
  }

  try {
    addLog(`Attempting to connect EVM wallet (${wallet.name})...`);
    // Authorize the site first: some wallets refuse wallet_switch/add
    // before eth_requestAccounts has been granted.
    const accounts = await eth.request({ method: 'eth_requestAccounts' });
    if (!accounts?.length) {
      addLog('Wallet returned no accounts.');
      return;
    }
    // Then make sure the Auto-EVM network is active (switched or added).
    await ensureCorrectNetwork(eth);

    unbindEvmEvents?.();
    unbindEvmEvents = null;
    state.evmRaw = eth;
    state.evmWalletLabel = wallet.label || wallet.name;
    state.evmProvider = new ethers.BrowserProvider(eth);
    state.evmAddress = accounts[0];
    commit();
    addLog(`EVM wallet connected: ${state.evmAddress}`);

    const chainIdHex = await eth.request({ method: 'eth_chainId' });
    const chainId = Number.parseInt(chainIdHex, 16);
    if (!Number.isNaN(chainId)) {
      state.evmChainId = chainId;
      commit();
    }

    unbindEvmEvents = attachWalletEvents(eth);
    await updateBalance();
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
  unbindEvmEvents?.();
  unbindEvmEvents = null;
  state.evmProvider = null;
  state.evmRaw = null;
  state.evmWalletLabel = '';
  state.evmChainId = null;
  state.evmAddress = '';
  state.evmBalance = null;
  commit();
  addLog('EVM wallet disconnected and state cleared.');
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
