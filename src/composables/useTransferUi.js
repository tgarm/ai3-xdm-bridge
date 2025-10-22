// src/composables/useTransferUi.js (Updated: Added unique ID for logs)
import { ref } from 'vue';

export function useTransferUi() {
  // UI State
  const logs = ref([]);
  const logId = ref(0);

  const addLog = (message) => {
    const timestamp = new Date().toLocaleTimeString();
    logs.value.push({ 
      id: logId.value++, 
      timestamp, 
      message 
    });
    console.log(`[${timestamp}] ${message}`);
    if (logs.value.length > 50) { // Keep only last 50 logs
      logs.value.shift();
    }
  };

  const amount = ref(null);
  const direction = ref('consensusToEVM');
  const isTransferring = ref(false);
  const transactions = ref([]); // For pending/manual tracked txs

  return {
    // State
    logs,
    amount,
    direction,
    isTransferring,
    transactions,
    // Actions
    addLog,
  };
}