<!-- src/components/TokenTransferPanel.vue -->
<template>
  <el-card>
    <template #header>
      <div class="card-header">
        <span>{{ t('transfer.title') }}</span>
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
      :disabled="!canTransfer"
      :loading="store.isTransferring"
      style="width: 100%; margin-top: 15px;"
    >
      {{ store.isTransferring ? (store.currentStatus || t('transfer.buttonTransferring')) : t('transfer.button') }}
    </el-button>
  </el-card>
</template>

<script setup>
import { computed } from 'vue';
import { useTransferStore } from '@/stores/transferStore';
import { useI18n } from 'vue-i18n';

const store = useTransferStore();
const { t } = useI18n();

/**
 * Determines if a transfer can be performed.
 * NOTE: This logic is better placed inside the transferStore as a computed property.
 */
const canTransfer = computed(() => {
  if (!store.canTransfer) return false; // Respect original logic from the store
  if (store.amount === null || store.amount === undefined) return false;
  // The store's `setAmount` likely handles the balance check, but this makes it explicit.
  return store.amount >= store.minTransferAmount && store.amount <= store.balance;
});
</script>