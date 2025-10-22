<!-- src/App.vue -->
<template>
  <div class="app">
    <h1>AI3 Cross-Domain Transfer</h1>
    
    <div class="top-container">
      <SubstrateWalletPanel />
      <EVMWalletPanel />
    </div>
    
    <div class="bottom-container">
      <TokenTransferPanel />
      <div class="status-container">
        <TransactionHistoryPanel />
        <LoggingPanel />
      </div>
    </div>
    
    <div class="doc-container">
      <DocumentPanel />
    </div>
  </div>
</template>

<script setup>
import { onUnmounted } from 'vue';
import SubstrateWalletPanel from './components/SubstrateWalletPanel.vue';
import EVMWalletPanel from './components/EVMWalletPanel.vue';
import TokenTransferPanel from './components/TokenTransferPanel.vue';
import LoggingPanel from './components/LoggingPanel.vue';
import TransactionHistoryPanel from './components/TransactionHistoryPanel.vue';
import DocumentPanel from './components/DocumentPanel.vue';

onUnmounted(() => {
  store.disconnectApis?.();
});
</script>

<style>
body {
  font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
  max-width: 1440px;
  margin: 0 auto;
  padding: 20px;
  background-color: #f5f5f5;
  color: #333;
}
.app {
  display: flex;
  flex-direction: column;
}
h1 {
  text-align: center;
  color: #2c3e50;
}
.top-container {
  display: flex;
  gap: 20px;
  margin-bottom: 20px;
}
.top-container .panel {
  flex: 1;
}
.bottom-container {
  display: flex;
  gap: 20px;
  margin-bottom: 20px;
}
.status-container {
  display: flex;
  flex-direction: column;
  gap: 20px;
  flex: 1;
}
.doc-container {
  margin-top: 20px;
}
@media (max-width: 768px) {
  .top-container, .bottom-container {
    flex-direction: column;
  }
  .status-container {
    flex-direction: column;
  }
}
</style>