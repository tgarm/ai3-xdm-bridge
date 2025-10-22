<!-- src/components/TransactionHistoryPanel.vue (Updated) -->
<template>
  <div class="panel">
    <h2>Transaction History</h2>
    <button @click="refreshHistory" class="refresh-btn">Refresh</button>
    <div v-if="isLoading">Loading transactions...</div>
    <div v-else-if="!allFetchedTransactions || allFetchedTransactions.length === 0">No transactions yet.</div>
    <div v-else>
      <div v-for="(tx, index) in allFetchedTransactions" :key="tx.hash || index" class="tx-item">
        <p v-if="tx.hash">Hash: {{ tx.hash.substring(0, 10) }}...</p>
        <p v-if="tx.amount">Amount: {{ tx.amount }} AI3</p>
        <p v-if="tx.destination || tx.to">To: {{ tx.destination || tx.to }}</p>
        <p v-if="tx.success !== undefined">Status: {{ tx.success ? 'Success' : 'Failed' }}</p>
        <p v-if="tx.blockNumber">Block: {{ tx.blockNumber }}</p>
        <p v-if="tx.timestamp">Time: {{ new Date(tx.timestamp).toLocaleString() }}</p>
        <p v-if="tx.direction">Direction: {{ tx.direction }}</p>
        <div v-if="isPendingC2E(tx)" class="countdown-container">
          <p>Estimated EVM arrival:</p>
          <span class="countdown">{{ formatRemainingTime(remainingTime(tx)) }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { useTransferStore } from '@/stores/transferStore';
import { ref, computed, onMounted, onUnmounted } from 'vue';

const store = useTransferStore();
const isLoading = ref(false);
const now = ref(Date.now());

const allFetchedTransactions = computed(() => store.allFetchedTransactions || []);

const refreshHistory = async () => {
  isLoading.value = true;
  try {
    await store.fetchTransactions();
  } finally {
    isLoading.value = false;
  }
};

const isPendingC2E = (tx) => {
  if (tx.direction !== 'consensusToEVM' || !tx.expectedArrival) return false;
  return remainingTime(tx) > 0;
};

const remainingTime = (tx) => {
  const expected = new Date(tx.expectedArrival).getTime();
  return expected - now.value;
};

const formatRemainingTime = (ms) => {
  if (ms <= 0) return 'Arrived';
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};

onMounted(() => {
  const interval = setInterval(() => {
    now.value = Date.now();
  }, 1000);
  onUnmounted(() => clearInterval(interval));
});
</script>

<style scoped>
.panel {
  background: white;
  border-radius: 8px;
  padding: 20px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
}
.refresh-btn {
  padding: 5px 10px;
  background: #3498db;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  margin-bottom: 10px;
}
.refresh-btn:hover {
  background: #2980b9;
}
.tx-item {
  border: 1px solid #ddd;
  padding: 10px;
  margin: 10px 0;
  border-radius: 4px;
  background: #f9f9f9;
}
.tx-item p {
  margin: 5px 0;
}
.countdown-container {
  margin-top: 5px;
  padding: 5px;
  background: #e8f5e8;
  border-radius: 4px;
}
.countdown {
  font-weight: bold;
  color: #27ae60;
  font-size: 1.1em;
}
</style>