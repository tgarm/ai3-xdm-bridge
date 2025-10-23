<!-- src/components/EVMWalletPanel.vue -->
<template>
  <el-card>
    <template #header>
      <div class="card-header">
        <span>EVM Chain</span>
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
      <span ref="buttonTextRef" class="button-text">{{ buttonText }}</span>
      <el-tag v-if="hasAddressButNotConnected" type="warning" size="small" effect="light" style="margin-left: auto;">
        Reconnect
      </el-tag>
    </el-button>
    <div v-if="store.evmAddress" class="balance-container">
      <el-skeleton :loading="store.evmBalanceLoading" animated>
        <template #template>
          <el-skeleton-item variant="p" style="width: 50%" />
        </template>
        <template #default>
          <p class="balance">{{ store.evmBalance }} AI3</p>
        </template>
      </el-skeleton>
    </div>
  </el-card>
</template>

<script setup>
import { useTransferStore } from '@/stores/transferStore';
import { computed, ref, watch, onMounted, onBeforeUnmount } from 'vue';
import { ElNotification } from 'element-plus';
import { CircleClose } from '@element-plus/icons-vue';

const store = useTransferStore();
const isConnecting = ref(false);

const truncatedAddress = computed(() => {
  if (!store.evmAddress) return '';
  return `${store.evmAddress.slice(0, 6)}...${store.evmAddress.slice(-4)}`;
});

const hasAddressButNotConnected = computed(() =>
  !!store.evmAddress && !store.evmConnected
);

const buttonTextRef = ref(null);
const useTruncated = ref(false);
let resizeObserver = null;

const checkWidth = () => {
  if (!buttonTextRef.value || !store.evmAddress) {
    useTruncated.value = false;
    return;
  }
  buttonTextRef.value.textContent = store.evmAddress;
  useTruncated.value = buttonTextRef.value.scrollWidth > buttonTextRef.value.clientWidth;
};

const buttonText = computed(() => {
  if (!store.evmAddress) return 'Connect MetaMask';
  return useTruncated.value ? truncatedAddress.value : store.evmAddress;
});

watch(() => store.evmAddress, () => {
  checkWidth();
});

onMounted(() => {
  if (buttonTextRef.value) {
    resizeObserver = new ResizeObserver(checkWidth);
    resizeObserver.observe(buttonTextRef.value);
  }
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
      ElNotification({ title: 'Success', message: 'Address copied to clipboard!', type: 'success', duration: 2000 });
    } catch (err) {
      console.error('Failed to copy address:', err);
      ElNotification({ title: 'Error', message: 'Failed to copy address.', type: 'error' });
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

onBeforeUnmount(() => {
  if (resizeObserver && buttonTextRef.value) {
    resizeObserver.unobserve(buttonTextRef.value);
  }
});
</script>

<style scoped>
/* Styles are identical to SubstrateWalletPanel.vue */
.card-header { display: flex; justify-content: space-between; align-items: center; }
.button-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.balance-container { margin-top: 15px; }
.balance { font-weight: bold; color: #27ae60; margin: 0; }
</style>