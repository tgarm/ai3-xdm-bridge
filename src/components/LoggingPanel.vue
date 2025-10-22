<!-- src/components/LoggingPanel.vue -->
<template>
  <div class="panel">
    <h2>Logs</h2>
    <div class="logs-container">
      <div v-for="log in store.logs" :key="log.id" class="log-item">
        <span class="timestamp">{{ log.timestamp }}</span>
        <span class="message">{{ log.message }}</span>
      </div>
    </div>
    <button @click="clearLogs" class="clear-btn">Clear Logs</button>
  </div>
</template>

<script setup>
import { useTransferStore } from '@/stores/transferStore';

const store = useTransferStore();

const clearLogs = () => {
  store.logs.value = [];
};
</script>

<style scoped>
.panel {
  background: white;
  border-radius: 8px;
  padding: 20px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
}
.logs-container {
  max-height: 300px;
  overflow-y: auto;
  border: 1px solid #ddd;
  padding: 10px;
  background: #f9f9f9;
  font-family: monospace;
  font-size: 14px;
}
.log-item {
  display: flex;
  margin-bottom: 5px;
}
.timestamp {
  color: #7f8c8d;
  min-width: 80px;
}
.message {
  flex: 1;
}
.clear-btn {
  margin-top: 10px;
  padding: 5px 10px;
  background: #e74c3c;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}
.clear-btn:hover {
  background: #c0392b;
}
</style>