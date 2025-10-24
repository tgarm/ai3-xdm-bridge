<!-- src/App.vue -->
<template>
  <Analytics mode="auto" />
  <el-config-provider :locale="elLocale">
  <el-container class="app-container">
    <el-header class="header">
      <div class="header-content">
        <img src="/logo.svg" alt="AI3-XDM-Bridge Logo" class="logo" />
        <h1>{{ t('app.title') }}</h1>
        <LanguageSwitcher style="margin-left: auto;" />
      </div>
    </el-header>
    <el-main>
      <el-row :gutter="20">
        <el-col :md="12"><SubstrateWalletPanel /></el-col>
        <el-col :md="12"><EVMWalletPanel /></el-col>
      </el-row>
      <el-row :gutter="20">
        <el-col :md="12">
          <TokenTransferPanel />
          <LoggingPanel style="margin-top: 20px;" />
        </el-col>
        <el-col :md="12"><TransactionHistoryPanel /></el-col>
      </el-row>
      <el-row :gutter="20">
        <el-col :span="24"><DocumentPanel /></el-col>
      </el-row>
    </el-main>
  </el-container>
  </el-config-provider>
</template>

<script setup>
import { onUnmounted, computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useTransferStore } from '@/stores/transferStore';
import SubstrateWalletPanel from './components/SubstrateWalletPanel.vue';
import EVMWalletPanel from './components/EVMWalletPanel.vue';
import TokenTransferPanel from './components/TokenTransferPanel.vue';
import LoggingPanel from './components/LoggingPanel.vue';
import TransactionHistoryPanel from './components/TransactionHistoryPanel.vue';
import DocumentPanel from './components/DocumentPanel.vue';
import LanguageSwitcher from './components/LanguageSwitcher.vue';

// Element Plus i18n
import { ElConfigProvider } from 'element-plus';
import en from 'element-plus/dist/locale/en.mjs';
import zhCn from 'element-plus/dist/locale/zh-cn.mjs';
import es from 'element-plus/dist/locale/es.mjs';
import de from 'element-plus/dist/locale/de.mjs';

import { Analytics } from '@vercel/analytics/vue';

const { t, locale } = useI18n();
const store = useTransferStore();

const elLocale = computed(() => {
  if (locale.value === 'zh') return zhCn;
  if (locale.value === 'es') return es;
  if (locale.value === 'de') return de;
  return en;
});

onUnmounted(() => {
  store.disconnectApis?.();
});
</script>

<style>
.app-container {
  min-height: 100vh;
}
.header {
  --el-header-padding: 0 20px;
  --el-header-height: 60px;
  background-color: #ffffff;
  border-bottom: 1px solid var(--el-border-color-light);
}
.header-content {
  display: flex;
  align-items: center;
  height: 100%;
  gap: 15px;
}
.logo {
  width: 32px;
  height: 32px;
  flex-shrink: 0;
}
h1 {
  color: #2c3e50;
  margin: 0;
  font-size: 1.5rem;
}
.el-row {
  margin-bottom: 20px;
}
.el-row:last-child {
  margin-bottom: 0;
}
</style>