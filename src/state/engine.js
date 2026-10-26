// src/state/engine.js
//
// Framework-agnostic singleton store for the whole app. Ported from the Vue
// composables + pinia store: the chain logic must not know about React, so
// state lives in one mutable object and components subscribe to snapshots
// via useSyncExternalStore. Mutate through the state modules, then commit().

import { useSyncExternalStore } from 'react';

const MAX_LOGS = 100;
let logCounter = 0;

export const state = {
  // Transfer UI
  logs: [],
  amount: '0', // string to avoid floating-point precision issues
  direction: 'consensusToEVM',
  isTransferring: false,
  currentStatus: '',
  transactions: [], // local tracked transfers (pending → bridging → arrived)
  // Substrate wallet
  consensusApi: null, // signed API
  readOnlyConsensusApi: null,
  consensusAccount: null,
  substrateAccounts: [],
  consensusBalance: 0,
  consensusBalanceLoading: false,
  consensusAddress: '',
  substrateLinkedEvmAddress: '',
  substrateLinkedEvmBalance: '0',
  substrateLinkedEvmBalanceLoading: false,
  linkedEvmProvider: null,
  fetchedTransactions: [],
  historyStatus: 'idle', // 'idle' | 'ok' | 'unavailable'
  // EVM wallet
  evmProvider: null,
  evmAddress: localStorage.getItem('evmAddress') || '',
  evmBalance: localStorage.getItem('evmBalance') || '0',
  evmBalanceLoading: false,
};

let snapshot = { ...state };
const listeners = new Set();

export function commit() {
  snapshot = { ...state };
  listeners.forEach((fn) => fn());
}

export function getState() {
  return snapshot;
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useEngine() {
  return useSyncExternalStore(subscribe, getState);
}

export function addLog(message) {
  const now = new Date();
  const time = now.toTimeString().split(' ')[0];
  const key = `${now.getTime()}-${logCounter++}`;
  if (state.logs.length >= MAX_LOGS) {
    state.logs.shift();
  }
  state.logs.push({ key, time, message });
  commit();
}

export function clearLogs() {
  state.logs = [];
  commit();
  addLog('Logs cleared.');
}
