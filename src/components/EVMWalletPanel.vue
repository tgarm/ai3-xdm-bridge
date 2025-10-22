<!-- src/components/EVMWalletPanel.vue -->
<template>
  <div class="panel">
    <h2>Auto-EVM Chain</h2>
    <button @click="handleButtonClick" :disabled="isConnecting">
      {{ buttonText }}
    </button>
    <div v-if="evmConnected">
      <p class="balance">
        {{ evmBalanceLoading ? 'Loading...' : evmBalance }} AI3
      </p>
    </div>
  </div>
</template>

<script setup>
import { useTransferStore } from '@/stores/transferStore';
import { computed, ref } from 'vue';

const store = useTransferStore();
const isConnecting = ref(false); // Local state for button disabled during connect

const evmConnected = computed(() => store.evmConnected);
const evmAddress = computed(() => store.evmAddress);
const evmBalance = computed(() => store.evmBalance);
const evmBalanceLoading = computed(() => store.evmBalanceLoading);

const truncatedAddress = computed(() => {
  const addr = evmAddress.value;
  if (!addr) return '';
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
});

const buttonText = computed(() => {
  return evmConnected.value ? truncatedAddress.value : 'Connect MetaMask';
});

const handleButtonClick = async () => {
  if (evmConnected.value) {
    try {
      await navigator.clipboard.writeText(evmAddress.value);
      alert('Address copied to clipboard!');
    } catch (err) {
      console.error('Failed to copy address:', err);
      alert('Failed to copy address. Please copy manually.');
    }
  } else {
    isConnecting.value = true;
    try {
      await store.connectEVM();
    } finally {
      isConnecting.value = false;
    }
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
  text-align: left;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
button:hover:not(:disabled) {
  background-color: #2980b9;
}
button:disabled {
  background-color: #bdc3c7;
  cursor: not-allowed;
}
.address {
  font-family: monospace;
  font-size: 14px;
  color: #333;
  margin: 10px 0 5px 0;
  word-break: break-all;
}
.balance {
  font-weight: bold;
  color: #27ae60;
  margin: 0;
}
</style>