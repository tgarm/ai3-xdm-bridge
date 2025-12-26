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
    <el-footer class="footer">
      <div class="footer-content">
        <a href="https://autonomys.xyz" target="_blank" class="footer-link" title="AI3">Autonomys</a>
        <a href="https://github.com/tgarm/ai3-xdm-bridge" target="_blank" class="footer-link" title="Source Repository">
          <svg viewBox="0 0 16 16" class="github-icon"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>
        </a>
        <a href="https://github.com/tgarm/ai3-xdm-bridge/issues" target="_blank" class="footer-link" title="Issues">
          <el-icon><Message /></el-icon>
        </a>
      </div>
    </el-footer>
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

// Element Plus icons
import { Message } from '@element-plus/icons-vue';

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
.footer {
  --el-footer-padding: 10px 20px;
  background-color: #ffffff;
  border-top: 1px solid var(--el-border-color-light);
}
.footer-content {
  display: flex;
  justify-content: center;
  gap: 20px;
}
.footer-link {
  color: #007bff;
  text-decoration: none;
}
.footer-link:hover {
  text-decoration: underline;
}
.ai3-logo {
  height: 20px;
  width: auto;
}
.github-icon {
  height: 16px;
  width: 16px;
  fill: currentColor;
}
</style>
