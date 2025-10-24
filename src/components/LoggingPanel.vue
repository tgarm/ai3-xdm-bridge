<!-- src/components/LoggingPanel.vue -->
<template>
  <el-card>
    <template #header>
      <div class="card-header">
        <span>{{ t('logging.logs') }}</span>
        <el-button type="danger" @click="store.clearLogs" text bg>{{ t('logging.clear') }}</el-button>
      </div>
    </template>
    <el-scrollbar height="180px" class="logs-container">
      <p v-for="log in store.logs" :key="log.key" class="log-item">
        <span class="timestamp">{{ log.time }}</span>
        <span class="message">{{ log.message }}</span>
      </p>
    </el-scrollbar>
  </el-card>
</template>

<script setup>
import { useTransferStore } from '@/stores/transferStore';
import { useI18n } from 'vue-i18n';

const store = useTransferStore();
const { t } = useI18n();
</script>

<style scoped>
.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.logs-container {
  background: #f5f7fa;
  font-family: monospace;
  border-radius: 4px;
  padding: 10px;
  font-size: 13px;
}
.log-item {
  display: flex;
  align-items: flex-start;
  margin: 0 0 5px;
  line-height: 1.5;
}
.timestamp {
  flex-shrink: 0;
  margin-right: 10px;
  color: #909399;
  user-select: none;
}
.message {
  color: #303133;
  word-break: break-word;
  white-space: pre-wrap;
}
</style>