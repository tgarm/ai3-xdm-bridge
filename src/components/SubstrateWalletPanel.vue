<!-- src/components/SubstrateWalletPanel.vue -->
<template>
  <el-card>
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
      <span ref="buttonTextRef" class="button-text">{{ buttonText }}</span>
      <el-tag v-if="hasAddressButNotConnected" type="warning" size="small" effect="light" style="margin-left: auto;">
        {{ t('wallet.reconnect') }}
      </el-tag>
    </el-button>
    <div v-if="store.consensusAddress" class="balance-container">
      <el-skeleton :loading="store.consensusBalanceLoading" animated>
        <template #template>
          <el-skeleton-item variant="p" style="width: 50%" />
        </template>
        <template #default>
          <p class="balance">{{ store.consensusBalance }} AI3</p>
        </template>
      </el-skeleton>
    </div>
  </el-card>
</template>

<script setup>
import { useTransferStore } from '@/stores/transferStore';
import { useI18n } from 'vue-i18n';
import { computed, ref, watch, onMounted, onBeforeUnmount } from 'vue';
import { CircleClose } from '@element-plus/icons-vue';

const store = useTransferStore();
const isConnecting = ref(false);
const { t } = useI18n();

const truncatedAddress = computed(() => {
  if (!store.consensusAddress) return '';
  return `${store.consensusAddress.slice(0, 6)}...${store.consensusAddress.slice(-4)}`;
});

const hasAddressButNotConnected = computed(() =>
  !!store.consensusAddress && !store.consensusConnected
);

const buttonTextRef = ref(null);
const useTruncated = ref(false);
let resizeObserver = null;

const checkWidth = () => {
  if (!buttonTextRef.value || !store.consensusAddress) {
    useTruncated.value = false;
    return;
  }
  // Temporarily set text to full address to measure its potential width
  buttonTextRef.value.textContent = store.consensusAddress;
  // Compare the text's scroll width to the element's client width
  useTruncated.value = buttonTextRef.value.scrollWidth > buttonTextRef.value.clientWidth;
  // The buttonText computed property will now correctly display the right version
};

const buttonText = computed(() => {
  if (!store.consensusAddress) return t('wallet.connectSubwallet');
  return useTruncated.value ? truncatedAddress.value : store.consensusAddress;
});

watch(() => store.consensusAddress, () => {
  // When the address changes, re-run the width check
  checkWidth();
});

onMounted(() => {
  if (buttonTextRef.value) {
    // Watch for the button's size changing (e.g., window resize)
    resizeObserver = new ResizeObserver(checkWidth);
    resizeObserver.observe(buttonTextRef.value);
  }
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

onBeforeUnmount(() => {
  if (resizeObserver && buttonTextRef.value) {
    resizeObserver.unobserve(buttonTextRef.value);
  }
});

</script>

<style scoped>
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
</style>