<!-- src/components/LoggingPanel.vue -->
<template>
  <el-card>
    <template #header>
      <div class="card-header">
        <span>Logs</span>
        <el-button type="danger" @click="store.clearLogs" text>Clear</el-button>
      </div>
    </template>
    <el-scrollbar height="180px" class="logs-container">
      <p v-for="log in store.logs" :key="log.timestamp" class="log-item">
        <el-text type="info" size="small" class="timestamp">{{ log.timestamp }}</el-text>
        <el-text class="message">{{ log.message }}</el-text>
      </p>
    </el-scrollbar>
  </el-card>
</template>

<script setup>
import { useTransferStore } from '@/stores/transferStore';

const store = useTransferStore();
</script>

<style scoped>
.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.logs-container {
  background: #f9f9f9;
  font-family: monospace;
  border-radius: 4px;
  padding: 10px;
}
.log-item {
  display: flex;
  margin: 0 0 5px;
}
.timestamp {
  margin-right: 10px;
}
</style>