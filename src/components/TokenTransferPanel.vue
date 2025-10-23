<!-- src/components/TokenTransferPanel.vue -->
<template>
  <el-card>
    <template #header>
      <div class="card-header">
        <span>Consensus → Auto-EVM</span>
      </div>
    </template>
    <el-input-number
      v-model="store.amount"
      :precision="18"
      :step="0.001"
      placeholder="Amount in AI3"
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
    <el-text type="info" size="small" tag="p">Minimum transfer: {{ store.minTransferAmount }} AI3</el-text>
    <el-button
      type="primary"
      @click="store.performTransfer"
      :disabled="!store.canTransfer"
      :loading="store.isTransferring"
      style="width: 100%; margin-top: 15px;"
    >
      {{ store.isTransferring ? (store.currentStatus || 'Transferring...') : 'Transfer AI3' }}
    </el-button>
  </el-card>
</template>

<script setup>
import { useTransferStore } from '@/stores/transferStore';

const store = useTransferStore();
</script>