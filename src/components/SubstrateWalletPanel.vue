<!-- src/components/SubstrateWalletPanel.vue -->
<template>
  <div class="panel">
    <h2>Consensus Chain</h2>
    <button @click="handleButtonClick" :disabled="isConnecting">
      {{ buttonText }}
      <span v-if="hasAddressButNotConnected" class="reconnect-hint">(Reconnect for signing)</span>
    </button>
    <div v-if="store.consensusAddress">
      <p class="balance">
        {{ store.consensusBalanceLoading ? 'Loading...' : store.consensusBalance }} AI3
      </p>
    </div>
  </div>
</template>

<script setup>
import { useTransferStore } from '@/stores/transferStore';
import { computed, ref } from 'vue';

const store = useTransferStore();
const isConnecting = ref(false);

const truncatedAddress = computed(() => {
  if (!store.consensusAddress) return '';
  return `${store.consensusAddress.slice(0, 6)}...${store.consensusAddress.slice(-4)}`;
});

const hasAddressButNotConnected = computed(() => 
  !!store.consensusAddress && !store.consensusConnected
);

const buttonText = computed(() => {
  if (store.consensusAddress) {
    return truncatedAddress.value;
  }
  return 'Connect SubWallet/Talisman';
});

const handleButtonClick = async () => {
  if (store.consensusAddress) {
    try {
      await navigator.clipboard.writeText(store.consensusAddress);
      alert('Address copied to clipboard!');
    } catch (err) {
      console.error('Failed to copy address:', err);
      alert('Failed to copy address. Please copy manually.');
    }
  } else {
    isConnecting.value = true;
    try {
      await store.connectConsensus();
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
  display: flex;
  justify-content: space-between;
  align-items: center;
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
  color: #7f8c8d;
  margin: 5px 0;
}
.balance {
  font-weight: bold;
  color: #27ae60;
  margin: 10px 0 0 0;
}
.reconnect-hint {
  font-size: 12px;
  color: #e67e22;
  margin-left: 10px;
}
</style>