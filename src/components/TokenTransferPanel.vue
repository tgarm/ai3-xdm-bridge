<!-- src/components/TokenTransferPanel.vue -->
<template>
  <el-card>
    <template #header>
      <div class="card-header">
        <el-button link type="primary" @click="store.toggleDirection" class="direction-button">
          <span>{{ store.direction === 'consensusToEVM' ? t('transfer.c2eTitle') : t('transfer.e2cTitle') }}</span>
          <el-icon class="el-icon--right"><Switch /></el-icon>
        </el-button>
      </div>
    </template>
    <el-input-number
      v-model="store.amount"
      :precision="18"
      :step="0.001"
      :placeholder="t('transfer.amountPlaceholder')"
      :min="store.minTransferAmount"
      controls-position="right"
      style="width: 100%; margin-bottom: 10px;"
    />
    <el-button-group style="margin-bottom: 10px;">
      <el-button @click="store.setAmount(0)">0%</el-button>
      <el-button @click="store.setAmount(25)">25%</el-button>
      <el-button @click="store.setAmount(50)">50%</el-button>
      <el-button @click="store.setAmount(75)">75%</el-button>
      <el-button @click="store.setAmount(100)">100%</el-button>
    </el-button-group>
    <el-text type="info" size="small" tag="p">{{ t('transfer.minTransfer', [store.minTransferAmount]) }}</el-text>
    <el-button
      type="primary"
      @click="store.performTransfer"
      :disabled="!store.canTransfer && !store.canPrepareFunds"
      :loading="store.isTransferring"
      style="width: 100%; margin-top: 15px;"
    >
      <template v-if="store.isTransferring">
        {{ store.currentStatus || t('transfer.buttonTransferring') }}
      </template>
      <template v-else>
        {{ store.canTransfer ? t('transfer.button') :store.canPrepareFunds ? t('transfer.prepareFundButton') : t('transfer.button') }}
      </template>
    </el-button>
  </el-card>
</template>

<script setup>
import { watch } from 'vue';
import { useTransferStore } from '@/stores/transferStore';
import { useI18n } from 'vue-i18n';
import { ElMessageBox } from 'element-plus';

import { Switch } from '@element-plus/icons-vue';
const store = useTransferStore();
const { t } = useI18n();

// Watch for direction changes to show a warning for E2C transfers
watch(() => store.direction, (newDirection) => {
  if (newDirection === 'evmToConsensus') {
    ElMessageBox.alert(
      t('transfer.e2cWarning.message'),
      t('transfer.e2cWarning.title'),
      { confirmButtonText: t('transfer.e2cWarning.confirmButton') }
    );
  }
});
</script>

<style scoped>
.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.direction-button {
  font-size: 16px;
  font-weight: 500;
}
</style>