<!-- src/components/TransactionHistoryPanel.vue (Updated) -->
<template>
  <el-card class="transaction-history-panel">
    <template #header>
      <div class="card-header">
        <span>{{ t('history.title') }}</span>
        <el-button @click="refreshHistory" :loading="isLoading" text>
          {{ t('history.refresh') }}
        </el-button>
      </div>
    </template>

    <el-scrollbar height="503px">
      <el-skeleton :loading="isLoading" animated>
        <template #template>
          <el-skeleton-item variant="p" style="width: 50%; margin: 16px" />
          <el-skeleton-item variant="p" style="width: 80%; margin: 16px" />
          <el-skeleton-item variant="p" style="width: 70%; margin: 16px" />
        </template>
        <template #default>
          <el-empty v-if="!uniqueTransactions || uniqueTransactions.length === 0" :description="t('history.empty')"></el-empty>
          <el-timeline v-else style="padding: 0 10px 0 0;">
            <el-timeline-item
              v-for="(tx, index) in uniqueTransactions"
              :key="tx.hash || index"
              :timestamp="getRelativeTime(tx.timestamp)"
              :type="getTxType(tx)"
              :hollow="getTxHollow(tx)"
              placement="top"
            >
              <el-card>
                <p class="status-line">
                  <span v-if="tx.direction" class="direction">{{ t('history.direction') }}: {{ tx.direction.replace('To', ' → ').replace('From', ' ← ') }}</span>
                  <span>
                    {{ t('history.status') }}:
                    <el-tag :type="getTxType(tx)" size="small" effect="light">{{ getStatusText(tx) }}</el-tag>
                  </span>
                </p>
                <p v-if="tx.amount">{{ t('history.amount') }}: <strong>{{ tx.amount }} AI3</strong></p>
                <p v-if="tx.hash">
                  {{ t('history.hash') }}:
                  <el-link v-if="isC2E(tx)" :href="getSubscanUrl(tx.hash)" type="primary" target="_blank">{{ formatHash(tx.hash) }}</el-link>
                  <span v-else>{{ formatHash(tx.hash) }}</span>
                </p>
                <p v-if="tx.destination || tx.to">
                  {{ t('history.to') }}:
                  <el-link v-if="isC2E(tx)" :href="getAutoEvmUrl(tx.destination || tx.to)" type="primary" target="_blank">{{ formatAddress(tx.destination || tx.to) }}</el-link>
                  <span v-else>{{ formatAddress(tx.destination || tx.to) }}</span>
                </p>
                <p v-if="tx.blockNumber">{{ t('history.block') }}: {{ tx.blockNumber }}</p>
                <el-alert v-if="showCountdown(tx)" :title="t('history.estimatedArrival', [formatRemainingTime(getRemainingTime(tx))])" type="info" :closable="false" show-icon />
              </el-card>
            </el-timeline-item>
          </el-timeline>
        </template>
      </el-skeleton>
    </el-scrollbar>
  </el-card>
</template>

<script setup>
import { useTransferStore } from '@/stores/transferStore';
import { useI18n } from 'vue-i18n';
import { ref, computed, onMounted, onUnmounted } from 'vue';

const store = useTransferStore();
const isLoading = ref(false);
const { t } = useI18n();
const now = ref(Date.now());

const allFetchedTransactions = computed(() => store.allFetchedTransactions || []);

const uniqueTransactions = computed(() => {
  const txs = [...(allFetchedTransactions.value || [])];
  // Use a map to create a unique list based on hash, giving priority to newer items in the array.
  // This ensures that a fetched transaction update will replace a local pending one.
  const map = new Map();
  for (const tx of txs) {
    // Use a composite key for transactions that might not have a hash yet
    const key = tx.hash || tx.id; 
    if (key && !map.has(key)) {
      map.set(key, tx);
    }
  }
  // Sort the unique transactions by timestamp descending
  return Array.from(map.values()).sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
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

const getTxType = (tx) => {
  if (tx.success === true) return 'success';
  if (tx.success === false) return 'danger';
  if (isC2E(tx)) return 'warning';
  return 'info';
};

const getTxHollow = (tx) => {
  // Use a hollow icon for pending transactions
  if (tx.success === undefined && isC2E(tx)) {
    return true;
  }
  return false;
};

const getStatusText = (tx) => {
  if (tx.success === true) return t('history.statusValues.Success');
  if (tx.success === false) return t('history.statusValues.Failed');
  if (tx.status) {
    // Capitalize first letter for display
    return tx.status.charAt(0).toUpperCase() + tx.status.slice(1);
  }
  if (isC2E(tx)) {
    return t('history.statusValues.Pending');
  }
  return t('history.statusValues.Unknown');
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
.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.transaction-history-panel :deep(.el-card__body) {
  padding: 0;
}

.status-line {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.el-timeline-item__content p {
  margin: 4px 0;
  font-size: 14px;
}
.direction {
  text-transform: capitalize;
  font-weight: 500;
  color: #3498db;
}
</style>