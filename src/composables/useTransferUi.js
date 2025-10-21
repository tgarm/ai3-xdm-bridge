// src/composables/useTransferUi.js (Updated: Removed setAmount)
import { ref } from 'vue';
import { MIN_TRANSFER_AMOUNT } from '@/constants';

export function useTransferUi() {
  // UI State
  const logs = ref([]);

  const addLog = (message) => {
    const timestamp = new Date().toLocaleTimeString();
    logs.value.push({ timestamp, message });
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