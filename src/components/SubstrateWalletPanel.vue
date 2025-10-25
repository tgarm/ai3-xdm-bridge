<!-- src/components/SubstrateWalletPanel.vue -->
<template>
  <el-card class="wallet-panel">
    <template #header>
      <div class="card-header">
        <span>{{ t('wallet.consensusChain') }}</span>
        <el-button
          v-if="store.consensusConnected"
          @click="store.disconnectConsensus"
          type="danger"
          :icon="CircleClose"
          circle text
        />
      </div>
    </template>
    <el-button @click="handleButtonClick" :loading="isConnecting" :type="store.consensusConnected ? 'success' : 'primary'" style="width: 100%; justify-content: flex-start;">
      <span class="button-text">{{ buttonText }}</span>
      <el-tag v-if="hasAddressButNotConnected" type="warning" size="small" effect="light" style="margin-left: auto;">
        {{ t('wallet.reconnect') }}
      </el-tag>
    </el-button>
    <div v-if="store.consensusAddress" class="balances-wrapper">
      <div class="balance-container">
        <el-skeleton :loading="store.consensusBalanceLoading" animated>
          <template #template>
            <el-skeleton-item variant="p" style="width: 50%" />
          </template>
          <template #default>
            <p class="balance">{{ store.consensusBalance }} AI3</p>
          </template>
        </el-skeleton>
      </div>
      <div v-if="store.substrateLinkedEvmAddress" class="linked-evm-container">
        <el-divider class="mobile-only-divider" />
        <div class="linked-evm-row">
          <div class="linked-evm-header">{{ t('wallet.linkedEvmAddress') }}:</div>
          <p class="linked-address" @click="handleCopyLinkedEvmAddress" :title="t('wallet.copyAddressTooltip')">{{ truncatedLinkedEvmAddress }}</p>
          <el-skeleton :loading="store.substrateLinkedEvmBalanceLoading" animated class="linked-balance-skeleton">
            <template #template>
              <el-skeleton-item variant="p" style="width: 60px;" />
            </template>
            <template #default>
              <p class="linked-balance">{{ store.substrateLinkedEvmBalance }} AI3</p>
            </template>
          </el-skeleton>
        </div>
      </div>
    </div>
  </el-card>
</template>

<script setup>
import { useTransferStore } from '@/stores/transferStore';
import { useI18n } from 'vue-i18n';
import { computed, ref, watch, onMounted, onBeforeUnmount } from 'vue';
import { ElNotification } from 'element-plus';
import { CircleClose } from '@element-plus/icons-vue';

const store = useTransferStore();
const isConnecting = ref(false);
const { t } = useI18n();

const truncatedAddress = computed(() => {
  if (!store.consensusAddress) return '';
  return `${store.consensusAddress.slice(0, 6)}...${store.consensusAddress.slice(-4)}`;
});

const truncatedLinkedEvmAddress = computed(() => {
  if (!store.substrateLinkedEvmAddress) return '';
  return `${store.substrateLinkedEvmAddress.slice(0, 6)}...${store.substrateLinkedEvmAddress.slice(-4)}`;
});

const hasAddressButNotConnected = computed(() =>
  !!store.consensusAddress && !store.consensusConnected
);

const isWideScreen = ref(window.innerWidth >= 992);

const buttonText = computed(() => {
  if (!store.consensusAddress) return t('wallet.connectSubwallet');
  return isWideScreen.value ? store.consensusAddress : truncatedAddress.value;
});

const handleResize = () => {
  isWideScreen.value = window.innerWidth >= 992;
};

onMounted(() => {
  window.addEventListener('resize', handleResize);
});

onBeforeUnmount(() => {
  window.removeEventListener('resize', handleResize);
});

const handleButtonClick = async () => {
  // If we have an address but are not fully connected, the primary action is to reconnect.
  if (hasAddressButNotConnected.value) {
    isConnecting.value = true;
    try {
      await store.connectConsensus();
    } finally {
      isConnecting.value = false;
    }
  } else if (store.consensusAddress) { // If connected, the action is to copy the address.
    try {
      await navigator.clipboard.writeText(store.consensusAddress);
      ElNotification({ title: t('notifications.success'), message: t('notifications.addressCopied'), type: 'success', duration: 2000 });
    } catch (err) {
      console.error('Failed to copy address:', err);
      ElNotification({ title: t('notifications.error'), message: t('notifications.addressCopyFailed'), type: 'error' });
    }
  } else { // If no address, the action is to connect for the first time.
    isConnecting.value = true;
    try {
      await store.connectConsensus();
    } finally {
      isConnecting.value = false;
    }
  }
};

const handleCopyLinkedEvmAddress = async () => {
  if (!store.substrateLinkedEvmAddress) return;
  try {
    await navigator.clipboard.writeText(store.substrateLinkedEvmAddress);
    ElNotification({ title: t('notifications.success'), message: t('notifications.addressCopied'), type: 'success', duration: 2000 });
  } catch (err) {
    console.error('Failed to copy linked EVM address:', err);
    ElNotification({ title: t('notifications.error'), message: t('notifications.addressCopyFailed'), type: 'error' });
  }
};

</script>

<style scoped>
.wallet-panel {
  display: flex;
  flex-direction: column;
  height: 100%; /* Allow card to fill parent's height */
}
.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.button-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.balance-container {
  margin-top: 15px;
}
.balance {
  font-weight: bold;
  color: #27ae60;
  margin: 0;
}
.balances-wrapper {
  margin-top: 15px;
}
.linked-evm-container {
  text-align: right;
}
.mobile-only-divider {
  margin: 15px 0;
}

/* Responsive layout for balances */
@media (min-width: 992px) {
  .balances-wrapper {
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
  }
  .mobile-only-divider {
    display: none;
  }
  .linked-evm-row {
    display: flex;
    align-items: baseline;
    gap: 8px;
  }
  .linked-evm-header {
    margin-bottom: 0;
  }
  .linked-balance {
    margin: 0;
  }
  .linked-balance-skeleton {
    width: 60px; /* Give skeleton a fixed width in flex layout */
  }
}
.linked-evm-header {
  font-size: 12px;
  color: #888;
  margin-bottom: 4px;
}
.linked-evm-row { /* Default stacking for mobile */
}
.linked-address {
  font-family: monospace;
  font-size: 13px;
  color: #555;
  margin: 0;
  cursor: pointer;
  transition: color 0.2s;
}
.linked-address:hover {
  color: #2c3e50;
}
.linked-balance {
  font-weight: 500;
  font-size: 14px;
  color: #27ae60;
  margin: 4px 0 0;
}
.linked-balance-skeleton {
  width: 40%;
}

/* Make card body fill available space */
:deep(.el-card__body) {
  flex-grow: 1;
}
</style>