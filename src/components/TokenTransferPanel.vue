<!-- src/components/TokenTransferPanel.vue -->
<template>
  <div class="panel">
    <h2>Consensus → Auto-EVM</h2>
    <div class="amount-section">
      <input v-model.number="store.amount" type="number" step="0.000000000000000001" placeholder="Amount in AI3" :min="store.minTransferAmount">
      <div class="percent-buttons">
        <button @click="store.setAmount(0)">0%</button>
        <button @click="store.setAmount(25)">25%</button>
        <button @click="store.setAmount(50)">50%</button>
        <button @click="store.setAmount(75)">75%</button>
        <button @click="store.setAmount(100)">100%</button>
      </div>
      <p class="min-note">Minimum transfer: {{ store.minTransferAmount }} AI3</p>
    </div>
    <button @click="store.performTransfer" :disabled="!store.canTransfer">
      {{ store.isTransferring ? (store.currentStatus ? `Transferring... ${store.currentStatus}` : 'Transferring...') : 'Transfer AI3' }}
    </button>
  </div>
</template>

<script setup>
import { useTransferStore } from '@/stores/transferStore';

const store = useTransferStore();
</script>

<style scoped>
.panel {
  background: white;
  border-radius: 8px;
  padding: 20px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
}
input[type="number"] {
  padding: 10px;
  margin: 5px 0;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 16px;
  width: 100%;
  box-sizing: border-box;
}
.amount-section {
  display: flex;
  flex-direction: column;
  align-items: center;
}
.percent-buttons {
  display: flex;
  gap: 5px;
  margin-top: 10px;
  flex-wrap: wrap;
}
.percent-buttons button {
  padding: 5px 10px;
  font-size: 14px;
  width: auto;
  min-width: 50px;
  background-color: #3498db;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}
.percent-buttons button:hover {
  background-color: #2980b9;
}
.min-note {
  font-size: 14px;
  color: #7f8c8d;
  margin: 5px 0 0 0;
  text-align: center;
}
button {
  background-color: #3498db;
  color: white;
  border: none;
  padding: 12px 20px;
  margin: 5px 0;
  border-radius: 6px;
  cursor: pointer;
  font-size: 16px;
  transition: background-color 0.3s;
  width: 100%;
}
button:hover:not(:disabled) {
  background-color: #2980b9;
}
button:disabled {
  background-color: #bdc3c7;
  cursor: not-allowed;
}
</style>