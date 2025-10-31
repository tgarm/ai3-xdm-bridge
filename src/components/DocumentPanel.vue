<!-- src/components/DocumentPanel.vue -->
<template>
  <el-card>
    <template #header>
      <div class="card-header">
        <span>{{ t('docs.title') }}</span>
      </div>
    </template>
    <div class="doc-content">
      <h3>{{ t('docs.c2eTitle') }}</h3>
      <p>{{ t('docs.c2eBody') }}</p>
      
      <h3>{{ t('docs.e2cTitle') }}</h3>
      <p>
        {{ t('docs.e2cBody', '') }} <!-- The placeholder is now part of the string -->
        <el-link type="primary" href="https://docs.autonomys.xyz/farming/guides/xdm/#auto-evm-domain-to-consensus-with-polkadotjs" target="_blank">{{ t('docs.e2cLinkText') }}</el-link>.
      </p>
      
      <h3>{{ t('docs.setupTitle') }}</h3>
      <ul>
        <li v-html="t('docs.setupConsensus', [`<code>${CONSENSUS_RPC}</code>`, `<code>${AUTONOMYS_PREFIX}</code>`])"></li>
        <li v-html="t('docs.setupEvm', [`<code>${EVM_CHAIN_ID}</code>`, `<a href='https://chainlist.org/chain/870' target='_blank' class='el-link el-link--primary is-underline'><span class='el-link__inner'>Chainlist</span></a>`])"></li>
        <li v-html="t('docs.setupMinTransfer', [`<code>${MIN_TRANSFER_AMOUNT}</code>`])"></li>
        <li v-html="t('docs.setupSdkLink', [`<a href='https://docs.autonomys.xyz/farming/guides/xdm/' target='_blank' class='el-link el-link--primary is-underline'><span class='el-link__inner'>XDM Guide</span></a>`, `<a href='https://docs.autonomys.xyz/developers/auto-sdk/' target='_blank' class='el-link el-link--primary is-underline'><span class='el-link__inner'>Auto-SDK</span></a>`])"></li>
      </ul>
    </div>
  </el-card>
</template>

<script setup>
  import { CONSENSUS_RPC, MIN_TRANSFER_AMOUNT, AUTONOMYS_PREFIX, EVM_CHAIN_ID } from '@/constants';
  import { useI18n } from 'vue-i18n';
  const { t } = useI18n();
</script>
<style scoped>
.doc-content {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  font-size: 14px;
  line-height: 1.7;
  color: #333;
}

.doc-content h3 {
  color: #2c3e50;
  font-size: 1.1em;
  font-weight: 600;
  margin-top: 20px;
  margin-bottom: 10px;
  padding-bottom: 5px;
  border-bottom: 1px solid #eaecef;
}

.doc-content p {
  margin-bottom: 10px;
}

.doc-content ul {
  margin: 10px 0;
  padding-left: 25px;
}
.doc-content li {
  margin-bottom: 8px;
}
.doc-content code {
  background-color: #f0f2f5;
  padding: 2px 6px;
  border-radius: 4px;
  font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, Courier, monospace;
  font-size: 0.9em;
  color: #d63384;
}
</style>