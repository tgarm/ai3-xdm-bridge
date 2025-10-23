// src/composables/useTransferUi.js
import { ref } from 'vue';

const MAX_LOGS = 100;
let logCounter = 0;

export function useTransferUi() {
  // UI State
  const logs = ref([]);
  const amount = ref(0);
  const direction = ref('consensusToEVM');
  const isTransferring = ref(false);
  const transactions = ref([]); // For pending/manual tracked txs

  const addLog = (message) => {
    const now = new Date();
    const time = now.toTimeString().split(' ')[0];
    // Use a combination of timestamp and a counter for a guaranteed unique key
    const key = `${now.getTime()}-${logCounter++}`;

    // Cap the logs for performance
    if (logs.value.length >= MAX_LOGS) {
      logs.value.shift();
    }
    logs.value.push({ key, time, message });
  };

  const clearLogs = () => {
    logs.value = [];
    addLog('Logs cleared.');
  }

  return {
    logs,
    amount,
    direction,
    isTransferring,
    transactions,
    addLog,
    clearLogs,
  };
}