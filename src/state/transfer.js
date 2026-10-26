// src/state/transfer.js
//
// Port of the pinia transferStore: transfer orchestration, C2E arrival
// watch (poll destination balance), inclusion watch (block-scan fallback),
// E2C precompile flow with the "prepare funds" pre-step. Semantics preserved
// from the 2026-10-26 field-tested rework.

import { MIN_TRANSFER_AMOUNT, C2E_ARRIVAL_MS, E2C_CHALLENGE_MS } from '@/constants';
import { parseAmountToWei } from '@/lib/amount';
import { state, commit, addLog, clearLogs } from './engine';
import { toast, alert } from '@/ui/dialogs';
import { t } from '@/i18n';
import * as substrate from './substrateWallet';
import * as evm from './evmWallet';

export { C2E_ARRIVAL_MS, E2C_CHALLENGE_MS, clearLogs };

// Timer handles (one transfer at a time — isTransferring gates re-entry)
let arrivalTimer = null;
let inclusionTimer = null;
let currentPendingHash = null;

// ---- derived state (pure selectors over the snapshot) -------------------

export const consensusConnected = (s) => !!s.consensusAccount;
export const evmConnected = (s) => !!s.evmAddress;

export const sourceBalance = (s) => {
  if (s.direction === 'consensusToEVM') {
    return s.consensusBalance ? parseFloat(s.consensusBalance) : 0;
  } // evmToConsensus
  return s.substrateLinkedEvmBalance ? parseFloat(s.substrateLinkedEvmBalance) : 0;
};

export const canPrepareFunds = (s) => {
  if (s.direction !== 'evmToConsensus' || s.isTransferring) return false;
  const amountNum = parseFloat(s.amount);
  const hasAmount = amountNum >= MIN_TRANSFER_AMOUNT;
  const linkedHasInsufficient = amountNum > sourceBalance(s);
  const mainEvmHasSufficient = amountNum <= (s.evmBalance ? parseFloat(s.evmBalance) : 0);
  return hasAmount && linkedHasInsufficient && mainEvmHasSufficient && evmConnected(s) && !!s.substrateLinkedEvmAddress;
};

export const canTransfer = (s) => {
  const amountNum = parseFloat(s.amount);
  if (amountNum < MIN_TRANSFER_AMOUNT) return false;
  if (amountNum > sourceBalance(s)) return false;
  if (s.direction === 'consensusToEVM') {
    return consensusConnected(s) && evmConnected(s) && !s.isTransferring;
  }
  // For E2C, canTransfer is only true if the linked EVM has enough funds.
  // The canPrepareFunds selector handles the case where the main EVM wallet
  // needs to send funds first.
  return consensusConnected(s) && !!s.substrateLinkedEvmAddress && !s.isTransferring;
};

export function consensusAddressOf(address) {
  // Short display form; full 6094 encoding happens in the wallet module
  return address ? `${address.slice(0, 4)}…${address.slice(-4)}` : '';
}

export function substrateAccountOptions(s) {
  return (s.substrateAccounts || []).map(acc => ({
    address: acc.address,
    label: `${acc.meta?.name || 'Account'} · ${consensusAddressOf(acc.address)}`,
  }));
}

// ---- actions ------------------------------------------------------------

export const updateBalances = async () => {
  await Promise.all([substrate.updateBalance(), evm.updateBalance()]);
  // Also update linked EVM balance if available
  if (state.substrateLinkedEvmAddress) {
    await substrate.getLinkedEvmBalance(state.substrateLinkedEvmAddress);
  }
};

export const fetchTransactions = () => substrate.fetchTransactions();
export const connectConsensus = () => substrate.connect();
export const connectEVM = () => evm.connect();
export const disconnectConsensus = () => substrate.disconnect();
export const disconnectEVM = () => evm.disconnect();
export const disconnectApis = () => substrate.disconnectApis();

// Switch active Consensus account (account selector)
export const switchConsensusAccount = (address) => {
  const account = state.substrateAccounts.find(acc => acc.address === address);
  if (account) substrate.switchAccount(account);
};

export const setDirection = (next) => {
  if (state.direction === next) return;
  state.direction = next;
  commit();
  addLog(`Transfer direction switched to: ${next}`);
};

export const toggleDirection = () => {
  setDirection(state.direction === 'consensusToEVM' ? 'evmToConsensus' : 'consensusToEVM');
};

export const setAmount = (value) => {
  state.amount = value;
  commit();
};

export const setAmountPercent = (percent) => {
  const newAmount = sourceBalance(state) * (percent / 100);
  const newAmountStr = newAmount >= MIN_TRANSFER_AMOUNT ? newAmount.toString() : '0';
  state.amount = newAmountStr;
  commit();
  if (newAmount < MIN_TRANSFER_AMOUNT) {
    addLog(`Amount set to 0 (below minimum ${MIN_TRANSFER_AMOUNT} AI3)`);
  } else {
    addLog(`Amount set to ${state.amount} AI3 (${percent}%)`);
  }
};

// ---- C2E arrival watch --------------------------------------------------
// Polls the linked EVM balance until it rises by (roughly) the transferred
// amount, or the 30 min horizon passes. Never reports a fake failure: on
// horizon expiry the transfer stays visible as "bridging" for manual refresh.

const ARRIVAL_POLL_FAST_MS = 30 * 1000; // first 10 minutes
const ARRIVAL_POLL_SLOW_MS = 60 * 1000; // until the 30 min horizon
const ARRIVAL_FAST_WINDOW_MS = 10 * 60 * 1000;
// Fallback inclusion watch: if the WS subscription dies (public nodes drop
// with 1006 routinely), scan the best chain for our extrinsic instead.
const INCLUSION_WATCH_MS = 12 * 1000;
const INCLUSION_WATCH_TIMEOUT_MS = 8 * 60 * 1000;

const stopArrivalWatch = () => {
  if (arrivalTimer) {
    clearTimeout(arrivalTimer);
    arrivalTimer = null;
  }
};

const stopInclusionWatch = () => {
  if (inclusionTimer) {
    clearTimeout(inclusionTimer);
    inclusionTimer = null;
  }
};

const startArrivalWatch = (pendingTx, amountNum) => {
  stopArrivalWatch();
  const baseline = parseFloat(state.substrateLinkedEvmBalance) || 0;
  // XDM takes ~0.01% fee (1 AI3 → 0.9999); tolerate it in the comparison
  const target = baseline + amountNum * 0.98;
  const startedAt = Date.now();
  addLog(`Watching linked EVM balance for arrival (baseline ${baseline} AI3, horizon 30 min)`);

  const tick = async () => {
    arrivalTimer = null;
    if (state.substrateLinkedEvmAddress) {
      await substrate.getLinkedEvmBalance(state.substrateLinkedEvmAddress);
    }
    const current = parseFloat(state.substrateLinkedEvmBalance) || 0;
    if (current >= target) {
      pendingTx.status = 'arrived';
      commit();
      addLog(`Funds arrived on Auto-EVM: ${current} AI3`);
      toast({
        type: 'ok',
        title: t('notifications.fundsArrived.title'),
        message: t('notifications.fundsArrived.message', [current]),
        duration: 0,
      });
      stopArrivalWatch();
      return;
    }
    const elapsed = Date.now() - startedAt;
    if (elapsed >= C2E_ARRIVAL_MS) {
      pendingTx.status = 'bridging';
      commit();
      addLog('Arrival horizon (30 min) reached without a detected balance change — XDM transfers can take longer. Use "Refresh Balance" or history to check again.');
      toast({
        type: 'info',
        title: t('notifications.stillBridging.title'),
        message: t('notifications.stillBridging.message'),
        duration: 0,
      });
      stopArrivalWatch();
      return;
    }
    const interval = elapsed < ARRIVAL_FAST_WINDOW_MS ? ARRIVAL_POLL_FAST_MS : ARRIVAL_POLL_SLOW_MS;
    arrivalTimer = setTimeout(tick, interval);
  };
  arrivalTimer = setTimeout(tick, ARRIVAL_POLL_FAST_MS);
};

// --- C2E inclusion watch (WS-status fallback) ---------------------------
// If no WS status event ever arrives (subscription silently lost on WS
// disconnect), scan the best chain for the submitted extrinsic hash. Found
// inclusion feeds the same pipeline as the WS inBlock event.
const startInclusionWatch = (initialHash, pendingTx) => {
  stopInclusionWatch();
  const api = state.consensusApi;
  if (!api) return;
  const deadline = Date.now() + INCLUSION_WATCH_TIMEOUT_MS;
  let lastScanned = null;
  addLog('Inclusion watch armed (fallback if websocket status events are lost)');

  const tick = async () => {
    inclusionTimer = null;
    // WS already advanced the transfer — nothing to fall back for
    if (pendingTx.status !== 'pending') return;
    try {
      const header = await api.rpc.chain.getHeader();
      if (lastScanned === null) lastScanned = header.number.toNumber();
      for (let h = lastScanned; h <= header.number.toNumber(); h++) {
        const bh = await api.rpc.chain.getBlockHash(h);
        if (bh.toHex() === '0x' + '0'.repeat(64)) continue; // transient fork boundary
        const block = await api.rpc.chain.getBlock(bh.toHex());
        const hit = block.block.extrinsics.find(ex => ex.hash.toHex() === initialHash);
        if (hit) {
          addLog(`Inclusion watch found the transfer in block #${h}`);
          pendingTx.status = 'in block';
          pendingTx.hash = initialHash;
          pendingTx.blockNumber = h;
          currentPendingHash = initialHash;
          state.isTransferring = false;
          state.currentStatus = '';
          commit();
          startArrivalWatch(pendingTx, parseFloat(pendingTx.amount));
          return;
        }
      }
      lastScanned = header.number.toNumber() + 1;
    } catch (error) {
      addLog(`Inclusion watch: ${error.message}`);
    }
    if (Date.now() >= deadline) {
      addLog('Inclusion watch timed out — the transfer may still be in the tx pool. DO NOT resubmit with the same account/nonce (Subspace bans duplicates); check history later.');
      toast({
        type: 'warn',
        title: t('notifications.inclusionTimeout.title'),
        message: t('notifications.inclusionTimeout.message'),
        duration: 0,
      });
      state.isTransferring = false;
      state.currentStatus = '';
      currentPendingHash = null;
      commit();
      stopInclusionWatch();
      return;
    }
    inclusionTimer = setTimeout(tick, INCLUSION_WATCH_MS);
  };
  inclusionTimer = setTimeout(tick, INCLUSION_WATCH_MS);
};

// Status update callback for the C2E WS subscription
const handleTransferStatus = async ({ status }) => {
  if (status.type) {
    state.currentStatus = status.type.toLowerCase().replace(/([A-Z])/g, ' $1').trim();
    commit();
  }
  if (status.isInBlock) {
    stopInclusionWatch(); // WS delivered — fallback no longer needed
    addLog(`Transaction ${currentPendingHash} in block`);
    const pendingTx = state.transactions.find(tx => tx.hash === currentPendingHash);
    let finalHash = currentPendingHash;

    // For C2E, the extrinsic hash can change when it's included in a block.
    // Locate our extrinsic inside the block to learn the final hash.
    const { block } = await state.consensusApi.rpc.chain.getBlock(status.asInBlock);
    const ours = block.extrinsics.find(ex =>
      (ex.hash.toHex() === currentPendingHash) ||
      (ex.isSigned && ex.signer.toString() === state.consensusAddress));
    finalHash = ours ? ours.hash.toHex() : currentPendingHash; // Fallback to old hash

    addLog(`Transaction in block. Final hash: ${finalHash}`);

    if (pendingTx) {
      pendingTx.status = 'in block';
      pendingTx.hash = finalHash; // Update the hash on our tracked transaction
      pendingTx.blockNumber = block.block.header.number.toNumber();
      currentPendingHash = finalHash; // Update the hash for subsequent tracking
      commit();
      // Bridging starts at inclusion, not finality — start watching now
      startArrivalWatch(pendingTx, parseFloat(pendingTx.amount));
    }
  }
  if (status.isFinalized) {
    addLog('Substrate transaction finalized, reload transactions');
    fetchTransactions();
    if (state.direction === 'consensusToEVM') {
      const pendingTx = state.transactions.find(tx => ['pending', 'in block', 'bridging'].includes(tx.status) && tx.hash === currentPendingHash);
      if (pendingTx && ['pending', 'in block'].includes(pendingTx.status)) {
        pendingTx.status = 'finalized on consensus';
        commit();
      }
    }
  }
  if (status.isRetracted) {
    addLog('Transaction retracted');
    resetTransferState();
    toast({
      type: 'warn',
      title: t('notifications.retracted.title'),
      message: t('notifications.retracted.message'),
      duration: 0,
    });
  }
  if (status.isFinalityTimeout) {
    addLog('Transaction finality timeout - may finalize later');
    resetTransferState();
    toast({
      type: 'warn',
      title: t('notifications.finalityTimeout.title'),
      message: t('notifications.finalityTimeout.message'),
      duration: 0,
    });
  }
  if (status.isDropped || status.isInvalid) {
    const statusMsg = status.type.toLowerCase();
    addLog(`Transaction ${statusMsg}`);
    resetTransferState();
    toast({
      type: 'danger',
      title: t('notifications.transferFailed.title'),
      message: t('notifications.transferFailed.message', [statusMsg]),
      duration: 0,
    });
  }
};

const resetTransferState = () => {
  state.isTransferring = false;
  state.currentStatus = '';
  currentPendingHash = null;
  commit();
  stopInclusionWatch();
  // The arrival watch keeps running across non-final status resets: a
  // retracted/timeout notice refers to finality tracking, while the funds
  // may still bridge. It stops itself at the 30 min horizon.
};

// Mark an E2C transfer as received by hand (the 1-day challenge period is
// not tracked from chain data).
export const markTransferComplete = (id) => {
  const tx = state.transactions.find(tx => tx.id === id);
  if (tx) {
    tx.status = 'completed';
    commit();
    addLog(`Transfer ${tx.hash || tx.id} marked as received`);
  }
};

// Perform transfer (orchestrates both wallets, with polling)
export const performTransfer = async () => {
  const amountNum = parseFloat(state.amount);
  if (!state.amount || amountNum < MIN_TRANSFER_AMOUNT) {
    addLog('Amount below minimum transfer amount');
    toast({
      type: 'warn',
      title: t('notifications.invalidAmount.title'),
      message: t('notifications.invalidAmount.message', [MIN_TRANSFER_AMOUNT]),
      duration: 5000,
    });
    return;
  }
  let amountWei;
  try {
    amountWei = parseAmountToWei(state.amount);
  } catch (error) {
    addLog(`Invalid amount: ${error.message}`);
    toast({
      type: 'warn',
      title: t('notifications.invalidAmount.title'),
      message: t('transfer.amountPrecision'),
      duration: 5000,
    });
    return;
  }
  const transferTime = new Date();
  const estimatedTime = state.direction === 'consensusToEVM' ? '~10–30 min' : '~1 day (challenge period)';
  const estimatedTimeMs = state.direction === 'consensusToEVM' ? C2E_ARRIVAL_MS : E2C_CHALLENGE_MS;
  const newTx = {
    id: Date.now(),  // Simple ID for tracking
    hash: null, // Will be set later
    direction: state.direction,
    amount: state.amount,
    status: 'pending',
    estimatedTime,
    expectedArrival: new Date(transferTime.getTime() + estimatedTimeMs).toISOString(),
    timestamp: transferTime.toISOString(),
  };
  state.transactions.push(newTx);
  commit();
  addLog(`Initiating transfer: ${state.direction} ${state.amount} AI3`);

  try {
    // Handle the "Prepare Fund" case first
    if (canPrepareFunds(state)) {
      addLog('Preparing funds: transferring from main EVM wallet to linked EVM address...');
      state.isTransferring = true;
      state.currentStatus = 'preparing funds';
      commit();
      newTx.direction = 'evmToLinkedEvm'; // Special direction for UI
      newTx.estimatedTime = '~1 min';
      newTx.expectedArrival = new Date(transferTime.getTime() + 60 * 1000).toISOString();

      await evm.performEvmTransfer(
        state.substrateLinkedEvmAddress,
        amountWei,
        ({ type, hash }) => {
          if (hash) newTx.hash = hash;
          if (type === 'sent') {
            state.currentStatus = 'sending funds';
            commit();
          }
          if (type === 'confirmed') {
            addLog('Fund preparation complete. Updating linked EVM balance.');
            newTx.status = 'success';
            state.isTransferring = false;
            state.currentStatus = '';
            commit();
            // Refresh linked balance to reflect the new funds
            substrate.getLinkedEvmBalance(state.substrateLinkedEvmAddress);
          }
        }
      );
      return; // Stop here, the user can now perform the actual E2C transfer
    }

    if (state.direction === 'consensusToEVM') {
      if (!state.consensusApi || !state.evmAddress) {
        addLog('Missing Consensus API or EVM address for transfer');
        toast({
          type: 'danger',
          title: t('notifications.walletsNotConnected.title'),
          message: t('notifications.walletsNotConnected.message'),
          duration: 0,
        });
        newTx.status = 'failed';
        commit();
        return;
      }
      addLog('Creating Consensus to EVM transfer...');
      state.isTransferring = true;
      state.currentStatus = 'pending';
      currentPendingHash = null; // Reset
      commit();

      // Delegate to the substrate module (moved logic)
      const { unsubscribe, hash } = await substrate.performConsensusTransfer(
        state.evmAddress,
        amountWei,
        handleTransferStatus, // Pass callback for status handling
      );

      newTx.hash = hash;
      newTx.unsubscribe = unsubscribe; // Track for cleanup if needed
      currentPendingHash = hash;
      commit();
      addLog('Consensus transfer delegated and initiated');
      // Fallback: if WS status events are lost, find inclusion by scanning
      startInclusionWatch(hash, newTx);
    } else { // evmToConsensus via transporter precompile
      if (!state.linkedEvmProvider || !state.substrateLinkedEvmAddress) {
        addLog('Linked EVM provider not available for E2C transfer');
        toast({
          type: 'danger',
          title: t('notifications.walletsNotConnected.title'),
          message: t('notifications.e2cProviderMissing'),
          duration: 0,
        });
        newTx.status = 'failed';
        commit();
        return;
      }
      addLog('Creating EVM to Consensus transfer (transporter precompile)...');
      state.isTransferring = true;
      state.currentStatus = 'sending';
      commit();

      const { hash } = await substrate.performEvmToConsensusTransfer(
        state.consensusAddress,
        amountWei
      );

      newTx.hash = hash;
      newTx.status = 'bridging';
      state.isTransferring = false;
      state.currentStatus = '';
      commit();
      addLog(`EVM to Consensus transfer confirmed on Auto-EVM: ${hash}. Challenge period ~1 day before funds land on Consensus.`);
      alert({
        title: t('transfer.e2cConfirmed.title'),
        message: t('transfer.e2cConfirmed.message', [state.amount, state.consensusAddress]),
        confirmText: t('transfer.e2cConfirmed.confirmButton'),
      });
    }
  } catch (error) {
    newTx.status = 'failed';
    state.isTransferring = false;
    state.currentStatus = '';
    currentPendingHash = null;
    commit();
    stopInclusionWatch();
    stopArrivalWatch();
    if (newTx.unsubscribe) {
      newTx.unsubscribe();  // Cleanup if initiated
    }
    addLog(`Transfer failed: ${error.message}`);
    console.error('Transfer failed:', error);
    toast({
      type: 'danger',
      title: t('notifications.transferInitFailed.title'),
      message: `${error.message}. ${t('notifications.transferInitFailed.hint')}`,
      duration: 0,
    });
  }
};

// Init APIs & initial fetches if addresses loaded (call once at startup)
export const initEngine = () => {
  substrate.initReadOnlyApi();
  evm.initProvider();
  if (state.consensusAddress || state.evmAddress) {
    updateBalances();
    fetchTransactions();
  }
};

export const stopPolling = () => {
  stopArrivalWatch();
  stopInclusionWatch();
};
