// src/state/transfer.js
//
// Port of the pinia transferStore: transfer orchestration, C2E arrival
// watch (poll destination balance), inclusion watch (block-scan fallback),
// E2C precompile flow (any EVM source). Semantics preserved
// from the 2026-10-26 field-tested rework.

import { MIN_TRANSFER_AMOUNT, C2E_ARRIVAL_MS, E2C_CHALLENGE_MS } from '@/constants';
import { parseAmountToWei } from '@/lib/amount';
import { state, commit, addLog, clearLogs } from './engine';
import { toast, alert } from '@/ui/dialogs';
import { t } from '@/i18n';
import * as substrate from './substrateWallet';
import * as evm from './evmWallet';

export { C2E_ARRIVAL_MS, E2C_CHALLENGE_MS, clearLogs };

// Timer handles. Arrival watches are keyed by tx id: persisted transfers
// resumed at boot can be several at once. (One transfer at a time is still
// gated by isTransferring for NEW transfers.)
const arrivalTimers = new Map(); // tx.id → timer handle
let inclusionTimer = null;
let currentPendingHash = null;

// ---- derived state (pure selectors over the snapshot) -------------------

export const consensusConnected = (s) => !!s.consensusAccount;
export const evmConnected = (s) => !!s.evmAddress;

// null = not loaded yet — callers must not treat it as 0.
export const sourceBalance = (s) => {
  if (s.direction === 'consensusToEVM') {
    return s.consensusBalance == null ? null : parseFloat(s.consensusBalance);
  }
  const src = e2cSource(s);
  if (!src) return null;
  return src.balance == null ? null : parseFloat(src.balance);
};

// E2C source: the transporter precompile lets ANY EVM address send to any
// consensus address, so funds that landed on a non-linked address (e.g. a
// plain MetaMask account) can bridge straight back. Prefer the injected
// browser wallet, fall back to the Substrate-linked EVM account.
export const e2cSource = (s) => {
  const injected = evmConnected(s)
    ? { kind: 'injected', from: s.evmAddress, balance: s.evmBalance }
    : null;
  const linked = s.substrateLinkedEvmAddress
    ? { kind: 'linked', from: s.substrateLinkedEvmAddress, balance: s.substrateLinkedEvmBalance }
    : null;
  // Prefer whichever source actually holds funds; otherwise surface the
  // injected one (or the linked one) so the UI can show it + why it's short.
  const funded = (c) => c && c.balance != null && parseFloat(c.balance) > 0;
  if (funded(injected)) return injected;
  if (funded(linked)) return linked;
  return injected || linked;
};

export const canTransfer = (s) => {
  const amountNum = parseFloat(s.amount);
  if (amountNum < MIN_TRANSFER_AMOUNT) return false;
  const bal = sourceBalance(s);
  if (bal == null || amountNum > bal) return false;
  if (s.direction === 'consensusToEVM') {
    return consensusConnected(s) && evmConnected(s) && !s.isTransferring;
  }
  // E2C: a consensus destination is required, plus any EVM source.
  return consensusConnected(s) && e2cSource(s) != null && !s.isTransferring;
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

// Chain-native progress check (Subscan is an external link in the UI, not a
// data source). Two jobs:
// - upgrade 'in block' C2E transfers to 'finalized on consensus' by
//   comparing the inclusion height against the finalized head (canonicality
//   verified via the stored block hash when present; height-only otherwise);
// - detect E2C arrivals during the challenge period from the destination
//   Consensus balance. Always leaves a log line, so "Refresh" visibly does
//   something even when nothing changed.
export const checkFinality = async () => {
  const api = state.readOnlyConsensusApi || state.consensusApi;
  if (!api) return;
  let changed = false;

  const candidates = state.transactions.filter(tx =>
    tx.status === 'in block' && tx.direction === 'consensusToEVM' && tx.blockNumber);
  if (candidates.length > 0) {
    try {
      const finalizedHead = await api.rpc.chain.getFinalizedHead();
      const { number } = await api.rpc.chain.getHeader(finalizedHead);
      const finalizedHeight = number.toNumber();
      for (const tx of candidates) {
        if (tx.blockHash) {
          const canonical = await api.rpc.chain.getBlockHash(tx.blockNumber);
          if (canonical.toHex() !== tx.blockHash) {
            addLog(`Transfer ${tx.hash?.slice(0, 10)}… block #${tx.blockNumber} is not canonical — status left unchanged`);
            continue;
          }
        }
        if (tx.blockNumber <= finalizedHeight) {
          tx.status = 'finalized on consensus';
          changed = true;
          addLog(`Transfer ${tx.hash?.slice(0, 10)}… finalized on consensus (#${tx.blockNumber} ≤ finalized #${finalizedHeight})`);
        }
      }
    } catch (error) {
      addLog(`Finality check failed: ${error.message}`);
    }
  }

  // C2E arrival: one linked-EVM balance read covers all in-flight C2E txs.
  // This is what lets "Refresh" resolve a stuck "Bridging" entry on the
  // spot, and it revives watches that died with an old tab.
  const c2ePending = state.transactions.filter(tx =>
    tx.direction === 'consensusToEVM' && ['in block', 'bridging'].includes(tx.status));
  if (c2ePending.length > 0 && state.substrateLinkedEvmAddress) {
    await substrate.getLinkedEvmBalance(state.substrateLinkedEvmAddress);
    const current = parseFloat(state.substrateLinkedEvmBalance);
    if (!Number.isNaN(current)) {
      for (const tx of c2ePending) {
        if (tx.arrivalBaseline == null) continue; // pre-baseline tx: manual mark only
        const target = tx.arrivalBaseline + parseFloat(tx.amount) * 0.98;
        if (current >= target) {
          clearWatch(tx);
          tx.status = 'arrived';
          changed = true;
          addLog(`Funds arrived on Auto-EVM: ${current} AI3 (transfer ${tx.hash?.slice(0, 10)}…)`);
          toast({
            type: 'ok',
            title: t('notifications.fundsArrived.title'),
            message: t('notifications.fundsArrived.message', [current]),
            duration: 0,
          });
        }
      }
    }
    // Re-arm watches that quit under the old give-up-at-horizon rule — the
    // watch now keeps polling past the horizon instead of abandoning.
    for (const tx of c2ePending) {
      if (!['in block', 'bridging'].includes(tx.status)) continue; // arrived above
      if (!arrivalTimers.has(tx.id)) {
        startArrivalWatch(tx, parseFloat(tx.amount), { quiet: true });
      }
    }
  }

  const e2cPending = state.transactions.filter(tx =>
    tx.direction === 'evmToConsensus' && tx.status === 'bridging' && tx.arrivalBaseline != null);
  if (e2cPending.length > 0) {
    await substrate.updateBalance(); // one fresh read covers all pending E2C txs
    const current = parseFloat(state.consensusBalance);
    if (!Number.isNaN(current)) {
      for (const tx of e2cPending) {
        if (confirmE2cArrival(tx, current)) changed = true;
      }
    }
  }
  armE2cWatches();

  if (changed) commit();
  const tracked = state.transactions.filter(tx =>
    ['pending', 'in block', 'bridging'].includes(tx.status)).length;
  if (tracked > 0) {
    addLog(changed
      ? 'Progress checked — status updated.'
      : `Progress checked — ${tracked} transfer(s) tracked, nothing new yet.`);
  }
};
export const connectConsensus = async () => {
  await substrate.connect();
  await checkFinality();
};
export const connectEVM = () => evm.connect();
export const disconnectConsensus = () => substrate.disconnect();
export const disconnectEVM = () => evm.disconnect();
export const disconnectApis = () => substrate.disconnectApis();

// Switch active Consensus account (account selector)
export const switchConsensusAccount = async (address) => {
  const account = state.substrateAccounts.find(acc => acc.address === address);
  if (!account) return;
  await substrate.switchAccount(account);
  await checkFinality();
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
  const bal = sourceBalance(state);
  if (bal == null) {
    addLog(`Cannot set ${percent}% — source balance not loaded yet`);
    return;
  }
  const newAmount = bal * (percent / 100);
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
const ARRIVAL_POLL_LATE_MS = 5 * 60 * 1000; // past the horizon: keep watching
const ARRIVAL_WATCH_MAX_MS = 24 * 60 * 60 * 1000; // retire the watch after a day
// Fallback inclusion watch: if the WS subscription dies (public nodes drop
// with 1006 routinely), scan the best chain for our extrinsic instead.
const INCLUSION_WATCH_MS = 12 * 1000;
const INCLUSION_WATCH_TIMEOUT_MS = 8 * 60 * 1000;

const stopArrivalWatch = (tx) => {
  if (tx) {
    const t = arrivalTimers.get(tx.id);
    if (t) clearTimeout(t);
    arrivalTimers.delete(tx.id);
    return;
  }
  for (const t of arrivalTimers.values()) clearTimeout(t);
  arrivalTimers.clear();
};

const stopInclusionWatch = () => {
  if (inclusionTimer) {
    clearTimeout(inclusionTimer);
    inclusionTimer = null;
  }
};

const startArrivalWatch = (pendingTx, amountNum, { quiet = false } = {}) => {
  stopArrivalWatch(pendingTx);
  // Baseline and start time are persisted with the tx so a resumed watch
  // compares against the ORIGINAL pre-transfer balance and keeps the
  // original 30 min horizon (funds that landed while the tab was closed
  // are detected as arrived on the first tick).
  if (pendingTx.arrivalBaseline == null) {
    pendingTx.arrivalBaseline = parseFloat(state.substrateLinkedEvmBalance) || 0;
  }
  if (pendingTx.arrivalWatchStart == null) {
    pendingTx.arrivalWatchStart = Date.now();
  }
  const baseline = pendingTx.arrivalBaseline;
  const startedAt = pendingTx.arrivalWatchStart;
  // XDM takes ~0.01% fee (1 AI3 → 0.9999); tolerate it in the comparison
  const target = baseline + amountNum * 0.98;
  addLog(`Watching linked EVM balance for arrival (baseline ${baseline} AI3, horizon 30 min)`);

  const tick = async () => {
    arrivalTimers.delete(pendingTx.id);
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
      stopArrivalWatch(pendingTx);
      return;
    }
    const elapsed = Date.now() - startedAt;
    if (elapsed >= C2E_ARRIVAL_MS) {
      // Past the typical horizon — demote to "bridging" (history shows the
      // longer-than-usual hint) but KEEP watching at a slower pace: XDM
      // regularly lands minutes late, and a watch that quits is how
      // transfers got stuck on "Bridging" forever.
      if (pendingTx.status !== 'bridging') {
        pendingTx.status = 'bridging';
        commit();
        addLog('Arrival horizon (30 min) reached without a detected change — XDM can take longer. The watch continues at a slower pace; "Refresh" checks immediately.');
        if (!quiet) {
          toast({
            type: 'info',
            title: t('notifications.stillBridging.title'),
            message: t('notifications.stillBridging.message'),
            duration: 0,
          });
        }
      }
      if (elapsed >= ARRIVAL_WATCH_MAX_MS) {
        addLog(`Arrival watch for ${pendingTx.hash ? `${pendingTx.hash.slice(0, 10)}… ` : ''}retired after 24 h — use "Refresh" or mark it received manually once the funds show up.`);
        stopArrivalWatch(pendingTx);
        return;
      }
      arrivalTimers.set(pendingTx.id, setTimeout(tick, ARRIVAL_POLL_LATE_MS));
      return;
    }
    const interval = elapsed < ARRIVAL_FAST_WINDOW_MS ? ARRIVAL_POLL_FAST_MS : ARRIVAL_POLL_SLOW_MS;
    arrivalTimers.set(pendingTx.id, setTimeout(tick, interval));
  };
  arrivalTimers.set(pendingTx.id, setTimeout(tick, ARRIVAL_POLL_FAST_MS));
};

// ---- E2C arrival watch --------------------------------------------------
// The ~24h challenge period ends with the transporter delivering the funds
// to the destination Consensus address — visible as a balance rise. The
// pre-transfer balance is recorded as the tx baseline at submit time; while
// a bridging E2C transfer exists, poll the Consensus balance every 5 min
// (plus on every manual refresh / reconnect) and auto-complete the tx once
// the balance clears baseline + amount. Transfers recorded before baselines
// existed fall back to the manual "mark received" button.
const E2C_POLL_MS = 5 * 60 * 1000;
const E2C_FIRST_MS = 5 * 1000;
const E2C_GRACE_MS = 2 * 60 * 60 * 1000; // keep polling 2h past the ETA

const clearWatch = (tx) => {
  const handle = arrivalTimers.get(tx.id);
  if (handle) clearTimeout(handle);
  arrivalTimers.delete(tx.id);
};

const confirmE2cArrival = (tx, current) => {
  const target = tx.arrivalBaseline + parseFloat(tx.amount) * 0.98;
  if (!(current >= target)) return false;
  clearWatch(tx);
  tx.status = 'completed';
  commit();
  addLog(`E2C funds detected on Consensus: balance ${current} ≥ target ${target.toFixed(4)} AI3`);
  toast({
    type: 'ok',
    title: t('notifications.e2cArrived.title'),
    message: t('notifications.e2cArrived.message', [tx.amount]),
    duration: 0,
  });
  return true;
};

const armE2cWatches = () => {
  for (const tx of state.transactions) {
    if (tx.direction !== 'evmToConsensus' || tx.status !== 'bridging') continue;
    if (tx.arrivalBaseline == null) continue; // no baseline → manual mark only
    if (arrivalTimers.has(tx.id)) continue;
    if (Date.now() > Date.parse(tx.expectedArrival) + E2C_GRACE_MS) continue;
    addLog(`Watching Consensus balance for E2C arrival (baseline ${tx.arrivalBaseline} AI3, poll every 5 min)`);
    const tick = async () => {
      arrivalTimers.delete(tx.id);
      if (tx.status !== 'bridging') return; // resolved elsewhere meanwhile
      await substrate.updateBalance();
      const current = parseFloat(state.consensusBalance);
      if (!Number.isNaN(current) && confirmE2cArrival(tx, current)) return;
      if (Date.now() > Date.parse(tx.expectedArrival) + E2C_GRACE_MS) {
        addLog(`E2C transfer ${tx.hash ? `${tx.hash.slice(0, 10)}… ` : ''}not detected within the challenge window — use the history entry to verify or mark manually.`);
        return; // no re-arm; the manual mark button stays available
      }
      arrivalTimers.set(tx.id, setTimeout(tick, E2C_POLL_MS));
    };
    arrivalTimers.set(tx.id, setTimeout(tick, E2C_FIRST_MS));
  }
};

// --- C2E inclusion watch (WS-status fallback) ---------------------------
// If no WS status event ever arrives (subscription silently lost on WS
// disconnect), scan the best chain for the submitted extrinsic hash. Found
// inclusion feeds the same pipeline as the WS inBlock event. fromHeight
// (persisted submit block) lets a resumed watch catch up after a reload;
// the 8 min deadline bounds the scan either way.
const startInclusionWatch = (initialHash, pendingTx, fromHeight = null) => {
  stopInclusionWatch();
  const api = state.consensusApi;
  if (!api) return;
  const deadline = Date.now() + INCLUSION_WATCH_TIMEOUT_MS;
  let lastScanned = fromHeight;
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
//
// status.type values (polkadot SubstrateEvent): Broadcast, InBlock,
// Finalized, Retracted, FinalityTimeout, Dropped, Invalid, Usurped…
// Store a camelCase KEY here; TransferPanel translates it via
// transfer.status.<key> — raw English strings must never reach the button.
const statusKey = (type) =>
  type.charAt(0).toLowerCase() + type.slice(1);

const handleTransferStatus = async ({ status }) => {
  if (status.type) {
    state.currentStatus = statusKey(status.type);
    commit();
  }
  if (status.isInBlock) {
    stopInclusionWatch(); // WS delivered — fallback no longer needed
    addLog(`Transaction ${currentPendingHash} in block`);
    const pendingTx = state.transactions.find(tx => tx.hash === currentPendingHash);
    let finalHash = currentPendingHash;

    // For C2E, the extrinsic hash can change when it's included in a block.
    // Locate our extrinsic inside the block to learn the final hash. The WS
    // connection may drop between the status event and this call (public
    // nodes do this routinely) — degrade to the submitted hash instead of
    // crashing the callback; the arrival watch does not need the block.
    try {
      const { block } = await state.consensusApi.rpc.chain.getBlock(status.asInBlock);
      const ours = block?.block?.extrinsics.find(ex =>
        (ex.hash.toHex() === currentPendingHash) ||
        (ex.isSigned && ex.signer.toString() === state.consensusAddress));
      if (ours) {
        finalHash = ours.hash.toHex();
        if (pendingTx) {
          pendingTx.blockNumber = block.block.header.number.toNumber();
        }
      }
    } catch (error) {
      addLog(`In-block lookup failed (continuing with submitted hash): ${error.message}`);
    }

    addLog(`Transaction in block. Final hash: ${finalHash}`);

    if (pendingTx) {
      pendingTx.status = 'in block';
      pendingTx.hash = finalHash; // Update the hash on our tracked transaction
      pendingTx.blockHash = status.asInBlock;
      currentPendingHash = finalHash; // Update the hash for subsequent tracking
    }
    // Submission phase is over the moment the tx is included — free the
    // transfer button (it used to stay "in block" until reload) and let the
    // Progress panel carry the rest of the journey. currentPendingHash stays
    // set: later WS events (Finalized) still need it to find the tx.
    state.isTransferring = false;
    state.currentStatus = '';
    commit();
    // Bridging starts at inclusion, not finality — start watching now
    if (pendingTx) {
      startArrivalWatch(pendingTx, parseFloat(pendingTx.amount));
    }
  }
  if (status.isFinalized) {
    addLog('Substrate transaction finalized');
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

      // Record the submit height so a reloaded app can resume the inclusion
      // scan from here (one paced RPC call, worth it for cross-session
      // progress tracking).
      try {
        const header = await state.consensusApi.rpc.chain.getHeader();
        newTx.submitBlock = header.number.toNumber();
        commit();
      } catch (e) {
        addLog(`Could not read submit height (resume scan will start from head): ${e.message}`);
      }

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
    } else { // evmToConsensus via transporter precompile — any EVM address may send
      const src = e2cSource(state);
      if (!src || !state.consensusAddress) {
        addLog('No usable EVM source for E2C transfer');
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
      // Destination's pre-transfer balance: the baseline the E2C arrival
      // watch compares against during the challenge period. If the balance
      // was never loaded, no baseline — the manual mark button covers it.
      if (state.consensusBalance != null) {
        newTx.arrivalBaseline = parseFloat(state.consensusBalance) || 0;
      }
      addLog(`Creating EVM to Consensus transfer (transporter precompile, ${src.kind} source ${src.from})...`);
      state.isTransferring = true;
      state.currentStatus = 'sending';
      commit();

      const { hash } = await substrate.performE2CTransfer(
        src,
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
      // Start watching the destination balance for the post-challenge arrival.
      armE2cWatches();
    }
  } catch (error) {
    newTx.status = 'failed';
    state.isTransferring = false;
    state.currentStatus = '';
    currentPendingHash = null;
    commit();
    stopInclusionWatch();
    stopArrivalWatch(newTx);
    if (newTx.unsubscribe) {
      newTx.unsubscribe();  // Cleanup if initiated
    }
    addLog(`Transfer failed: ${error.message}`);
    console.error('Transfer failed:', error);
    // Distinguish "user said no in the wallet" (common, not an error worth
    // a red toast) from genuine failures.
    const cancelled = error?.code === 'ACTION_REJECTED' || /denied|rejected/i.test(error?.message || '');
    toast({
      type: cancelled ? 'info' : 'danger',
      title: t(cancelled ? 'notifications.txCancelled.title' : 'notifications.transferInitFailed.title'),
      message: cancelled
        ? t('notifications.txCancelled.message')
        : `${error.message}. ${t('notifications.transferInitFailed.hint')}`,
      duration: cancelled ? 4000 : 0,
    });
  }
};

// Resume tracking for transfers persisted from a previous session: progress
// follows the chain (block scan + destination balance polling), never Subscan.
const resumeTracking = () => {
  for (const tx of state.transactions) {
    if (!['pending', 'in block', 'bridging'].includes(tx.status)) continue;
    if (tx.status === 'pending' && tx.hash && tx.direction === 'consensusToEVM') {
      // Inclusion scanning needs a consensus API, which only exists after
      // the wallet connects; fresh loads don't have one. The tx stays
      // 'pending' in history for inspection — never auto-resubmit (Subspace
      // bans duplicate nonces).
      const api = state.consensusApi || state.readOnlyConsensusApi;
      if (api) {
        addLog(`Resuming inclusion watch for transfer ${tx.hash.slice(0, 10)}…`);
        startInclusionWatch(tx.hash, tx, tx.submitBlock ?? null);
      } else {
        addLog(`Transfer ${tx.hash.slice(0, 10)}… still awaiting inclusion — connect the Consensus wallet to rescan blocks for it.`);
      }
    } else if (tx.direction === 'consensusToEVM' && ['in block', 'bridging'].includes(tx.status)) {
      // Arrival polling is a plain eth_getBalance against the public EVM
      // RPC — works without any connected wallet.
      addLog(`Resuming arrival watch for transfer ${tx.hash ? tx.hash.slice(0, 10) + '…' : tx.id}`);
      startArrivalWatch(tx, parseFloat(tx.amount), { quiet: true });
    } else if (tx.direction === 'evmToConsensus' && tx.status === 'bridging') {
      // ~24h challenge period. Arrival is auto-detected by polling the
      // destination Consensus balance — the watch is armed by checkFinality
      // once a consensus API exists (wallet connect or auto-reconnect).
      if (!(state.consensusApi || state.readOnlyConsensusApi)) {
        addLog(`Transfer ${tx.hash ? `${tx.hash.slice(0, 10)}… ` : ''}is in the E2C challenge period — connect the Consensus wallet to auto-detect arrival.`);
      }
    }
  }
  // Upgrades 'in block' → 'finalized on consensus' where possible; no-ops
  // without a consensus API (fresh boot, wallet not connected).
  checkFinality();
};

// A rebuilt consensus API (auto-reconnect) leaves watchers holding the dead
// instance — re-arm everything against the new one.
substrate.onApiRestored(() => resumeTracking());

// Init APIs & initial fetches if addresses loaded (call once at startup)
export const initEngine = () => {
  substrate.initReadOnlyApi();
  evm.initProvider();
  resumeTracking();
  if (state.consensusAddress || state.evmAddress) {
    updateBalances();
  }
};

export const stopPolling = () => {
  stopArrivalWatch(); // no arg → every resumed watch
  stopInclusionWatch();
};
