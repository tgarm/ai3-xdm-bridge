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
      </div>
    </div>
  </div>
</template>

<script setup>
import { useTransferStore } from '@/stores/transferStore';
import { ref, computed } from 'vue';

const store = useTransferStore();
const isLoading = ref(false);

const allFetchedTransactions = computed(() => store.allFetchedTransactions || []);

const refreshHistory = async () => {
  isLoading.value = true;
  try {
    await store.fetchTransactions();
  } finally {
    isLoading.value = false;
  }
};
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
</style>