<!-- src/components/TransactionHistoryPanel.vue (Updated) -->
<template>
  <div class="panel">
    <div class="header">
      <h2>Transaction History</h2>
      <button @click="refreshHistory" class="refresh-btn" :disabled="isLoading">
        {{ isLoading ? 'Refreshing...' : 'Refresh' }}
      </button>
    </div>
    <div v-if="isLoading" class="loading">Loading transactions...</div>
    <div v-else-if="!uniqueTransactions || uniqueTransactions.length === 0" class="empty-state">
      <p>No transactions yet.</p>
      <p class="hint">Your activity will appear here once you make a transfer.</p>
    </div>
    <div v-else class="transactions-list">
      <div v-for="(tx, index) in uniqueTransactions" :key="tx.hash || index" class="tx-item">
        <div class="tx-header">
          <div class="tx-icon" :class="getTxIconClass(tx)"></div>
          <div class="tx-info">
            <p class="tx-hash">
              <span v-if="isC2E(tx)">Hash:</span>
              <a v-if="tx.hash && isC2E(tx)" :href="getSubscanUrl(tx.hash)" target="_blank" rel="noopener noreferrer">
                {{ formatHash(tx.hash) }}
              </a>
              <span v-else-if="tx.hash">{{ formatHash(tx.hash) }}</span>
            </p>
            <p v-if="tx.amount" class="tx-amount">Amount: <strong>{{ tx.amount }} AI3</strong></p>
            <p v-if="tx.success !== undefined" class="tx-status" :class="{ success: tx.success, failed: !tx.success }">
              Status: <span>{{ tx.success ? 'Success' : 'Failed' }}</span>
            </p>
          </div>
        </div>
        <div class="tx-details">
          <p v-if="tx.destination || tx.to" class="tx-address">
            <span v-if="isC2E(tx)">To (Auto-EVM):</span>
            <span v-else>To:</span>
            <a v-if="isC2E(tx) && (tx.destination || tx.to)" :href="getAutoEvmUrl(tx.destination || tx.to)" target="_blank" rel="noopener noreferrer">
              {{ formatAddress(tx.destination || tx.to) }}
            </a>
            <span v-else-if="tx.destination || tx.to">{{ formatAddress(tx.destination || tx.to) }}</span>
          </p>
          <p v-if="tx.blockNumber">Block: {{ tx.blockNumber }}</p>
          <p v-if="tx.timestamp">Time: <span class="relative-time">{{ getRelativeTime(tx.timestamp) }}</span></p>
          <p v-if="tx.direction">Direction: <span class="direction">{{ tx.direction.replace('To', ' → ').replace('From', ' ← ') }}</span></p>
          <div v-if="showCountdown(tx)" class="countdown-container">
            <p>Estimated EVM arrival:</p>
            <span class="countdown">{{ formatRemainingTime(getRemainingTime(tx)) }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { useTransferStore } from '@/stores/transferStore';
import { ref, computed, onMounted, onUnmounted } from 'vue';

const store = useTransferStore();
const isLoading = ref(false);
const now = ref(Date.now());

const allFetchedTransactions = computed(() => store.allFetchedTransactions || []);

const uniqueTransactions = computed(() => {
  const txs = [...(allFetchedTransactions.value || [])];
  const map = new Map();
  txs.forEach(tx => {
    if (tx.hash) {
      map.set(tx.hash, tx);
    }
  });
  return Array.from(map.values()).sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0));
});

const refreshHistory = async () => {
  isLoading.value = true;
  try {
    await store.fetchTransactions();
  } finally {
    isLoading.value = false;
  };
};

const isC2E = (tx) => tx.direction === 'consensusToEVM';

const getExpectedArrival = (tx) => {
  if (tx.expectedArrival) return tx.expectedArrival;
  if (isC2E(tx)) {
    const txTime = new Date(tx.timestamp).getTime();
    const currentTime = now.value;
    if (currentTime - txTime < 10 * 60 * 1000) { // Within 10 minutes
      return new Date(txTime + 10 * 60 * 1000).toISOString();
    }
  }
  return null;
};

const showCountdown = (tx) => {
  if (!isC2E(tx)) return false;
  const expected = getExpectedArrival(tx);
  if (!expected) return false;
  return getRemainingTime(tx) > 0;
};

const getRemainingTime = (tx) => {
  const expected = getExpectedArrival(tx);
  if (!expected) return 0;
  return new Date(expected).getTime() - now.value;
};

const formatRemainingTime = (ms) => {
  if (ms <= 0) return 'Arrived';
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};

const getRelativeTime = (timestamp) => {
  const date = new Date(timestamp);
  const diff = now.value - date.getTime();
  const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;

  if (diff >= TWENTY_FOUR_HOURS) {
    return date.toLocaleString();
  }

  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m ago`;
  }
  if (minutes > 0) {
    return `${minutes}m ago`;
  }
  return `${seconds}s ago`;
};

const formatHash = (hash) => `${hash.substring(0, 10)}...`;

const formatAddress = (address) => `${address.substring(0, 6)}...${address.substring(address.length - 4)}`;

const getSubscanUrl = (hash) => `https://autonomys.subscan.io/extrinsic/${hash}`;

const getAutoEvmUrl = (address) => `https://explorer.auto-evm.mainnet.autonomys.xyz/address/${address}`;

const getTxIconClass = (tx) => {
  if (tx.success !== undefined) {
    return tx.success ? 'icon-success' : 'icon-failed';
  }
  if (isC2E(tx)) {
    return 'icon-pending';
  }
  return 'icon-default';
};

onMounted(() => {
  refreshHistory(); // Auto-refresh on mount
  const interval = setInterval(() => {
    now.value = Date.now();
  }, 1000);
  onUnmounted(() => clearInterval(interval));
});
</script>

<style scoped>
.panel {
  background: white;
  border-radius: 8px;
  padding: 20px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
  max-width: 1200px;
  margin: 0 auto;
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

h2 {
  margin: 0;
  color: #333;
}

.refresh-btn {
  padding: 8px 16px;
  background: #3498db;
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
  transition: background 0.2s;
}

.refresh-btn:hover:not(:disabled) {
  background: #2980b9;
}

.refresh-btn:disabled {
  background: #bdc3c7;
  cursor: not-allowed;
}

.loading, .empty-state {
  text-align: center;
  padding: 40px 20px;
  color: #666;
}

.empty-state .hint {
  font-style: italic;
  margin-top: 5px;
}

.transactions-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-height: 600px;
  overflow-y: auto;
}

.tx-item {
  width: 100%;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  padding: 16px;
  background: #fafafa;
  transition: box-shadow 0.2s;
}

.tx-item:hover {
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.tx-header {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  margin-bottom: 12px;
}

.tx-icon {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  color: white;
  flex-shrink: 0;
}

.icon-success {
  background: #27ae60;
}

.icon-failed {
  background: #e74c3c;
}

.icon-pending {
  background: #f39c12;
}

.icon-default {
  background: #95a5a6;
}

.tx-info {
  flex: 1;
  min-width: 0; /* Allow text overflow handling */
}

.tx-hash a {
  color: #3498db;
  text-decoration: none;
  font-family: monospace;
  word-break: break-all;
}

.tx-hash a:hover {
  text-decoration: underline;
}

.tx-amount {
  color: #27ae60;
  font-size: 16px;
}

.tx-status {
  font-size: 14px;
}

.tx-status.success {
  color: #27ae60;
}

.tx-status.failed {
  color: #e74c3c;
}

.tx-address a {
  color: #3498db;
  text-decoration: none;
  font-family: monospace;
  word-break: break-all;
}

.tx-address a:hover {
  text-decoration: underline;
}

.tx-details p {
  margin: 6px 0;
  color: #555;
  font-size: 14px;
}

.relative-time {
  font-style: italic;
  color: #7f8c8d;
}

.direction {
  text-transform: capitalize;
  font-weight: 500;
  color: #3498db;
}

.countdown-container {
  margin-top: 8px;
  padding: 8px 12px;
  background: #e8f5e8;
  border-radius: 6px;
  border-left: 4px solid #27ae60;
}

.countdown {
  font-weight: bold;
  color: #27ae60;
  font-size: 1.1em;
  background: white;
  padding: 2px 6px;
  border-radius: 4px;
}

/* Wide and minimal height mode for high widths */
@media (min-width: 800px) {
  .tx-item {
    display: flex;
    flex-direction: row;
    align-items: center;
    justify-content: flex-start;
    padding: 8px 16px;
    min-height: 60px;
    gap: 16px;
  }

  .tx-header {
    flex: 0 0 auto;
    margin-bottom: 0;
    gap: 8px;
  }

  .tx-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .tx-info p {
    margin: 0;
    font-size: 12px;
  }

  .tx-amount {
    font-size: 14px;
  }

  .tx-details {
    flex: 1;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 20px;
    margin: 0;
  }

  .tx-details p {
    margin: 0;
    font-size: 12px;
    white-space: nowrap;
    flex: 1;
  }

  .countdown-container {
    margin: 0;
    padding: 4px 8px;
    white-space: nowrap;
    flex-shrink: 0;
  }

  .countdown-container p {
    margin: 0 0 2px 0;
    font-size: 11px;
  }

  .countdown {
    font-size: 12px;
  }
}
</style>