<!-- src/components/EVMWalletPanel.vue -->
<template>
  <el-card class="wallet-panel">
    <template #header>
      <div class="card-header">
        <span>{{ t('wallet.evmChain') }}</span>
        <el-button
          v-if="store.evmConnected"
          @click="store.disconnectEVM"
          type="danger"
          :icon="CircleClose"
          circle text
        />
      </div>
    </template>
    <el-button @click="handleButtonClick" :loading="isConnecting" :type="store.evmConnected ? 'success' : 'primary'" style="width: 100%; justify-content: flex-start;">
      <span class="button-text">{{ buttonText }}</span>
      <el-tag v-if="hasAddressButNotConnected" type="warning" size="small" effect="light" style="margin-left: auto;">
        {{ t('wallet.reconnect') }}
      </el-tag>
    </el-button>
    <div v-if="store.evmAddress" class="balances-wrapper">
      <div class="balance-container">
        <el-skeleton :loading="store.evmBalanceLoading" animated>
          <template #template>
            <el-skeleton-item variant="p" style="width: 50%" />
          </template>
          <template #default>
            <p class="balance">{{ store.evmBalance }} AI3</p>
          </template>
        </el-skeleton>
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
  if (!store.evmAddress) return '';
  return `${store.evmAddress.slice(0, 6)}...${store.evmAddress.slice(-4)}`;
});

const hasAddressButNotConnected = computed(() =>
  !!store.evmAddress && !store.evmConnected
);

const isWideScreen = ref(window.innerWidth >= 992);

const buttonText = computed(() => {
  if (!store.evmAddress) return t('wallet.connectMetamask');
  return isWideScreen.value ? store.evmAddress : truncatedAddress.value;
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
  if (hasAddressButNotConnected.value) {
    isConnecting.value = true;
    try {
      await store.connectEVM();
    } finally {
      isConnecting.value = false;
    }
  } else if (store.evmAddress) {
      try {
        await navigator.clipboard.writeText(store.evmAddress);
        ElNotification({ title: t('notifications.success'), message: t('notifications.addressCopied'), type: 'success', duration: 2000 });
      } catch (err) {
        console.error('Failed to copy address:', err);
        ElNotification({ title: t('notifications.error'), message: t('notifications.addressCopyFailed'), type: 'error' });
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
/* Styles are identical to SubstrateWalletPanel.vue */
.wallet-panel {
  display: flex;
  flex-direction: column;
  height: 100%; /* Allow card to fill parent's height */
}
.card-header { display: flex; justify-content: space-between; align-items: center; }
.button-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex-grow: 1; }
.balances-wrapper {
  margin-top: 15px;
}
.balance-container {
  /* No margin-top needed as wrapper provides it */
}
.balance { font-weight: bold; color: #27ae60; margin: 0; }

/* On wide screens, match the layout of the Substrate panel */
@media (min-width: 992px) {
  .balances-wrapper {
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
  }
}
:deep(.el-card__body) {
  flex-grow: 1;
}
</style>