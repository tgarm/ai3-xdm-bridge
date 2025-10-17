<!-- src/components/TransactionHistoryPanel.vue -->
<template>
  <div class="panel">
    <h2>Transaction History</h2>
    <button @click="refreshHistory" class="refresh-btn">Refresh</button>
    <div v-if="isLoading">Loading transactions...</div>
    <div v-else-if="store.fetchedTransactions.length === 0">No transactions yet.</div>
    <div v-else>
      <div v-for="(tx, index) in store.fetchedTransactions" :key="index" class="tx-item">
        <p v-if="tx.id">ID: {{ tx.id }}</p>
        <p v-if="tx.amount">Amount: {{ tx.amount }}</p>
        <p v-if="tx.to">To: {{ tx.to }}</p>
        <p v-if="tx.status">Status: {{ tx.status }}</p>
        <p v-if="tx.blockNumber">Block: {{ tx.blockNumber }}</p>
        <p>Index: {{ index }}</p>
      </div>
    </div>
  </div>
</template>

<script setup>
import { useTransferStore } from '@/stores/transferStore';
import { ref } from 'vue';

const store = useTransferStore();
const isLoading = ref(false);

const refreshHistory = async () => {
  isLoading.value = true;
  try {
    await store.fetchChainTransfers();
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