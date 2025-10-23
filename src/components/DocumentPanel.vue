<!-- src/components/DocumentPanel.vue -->
<template>
  <el-card>
    <template #header>
      <div class="card-header">
        <span>Documentation</span>
      </div>
    </template>
    <div class="doc-content">
      <h3>Consensus → EVM Transfers</h3>
      <p>Handled automatically via the app. Wait 100 consensus block time (~10 min) for funds to appear.</p>
      
      <h3>EVM → Consensus Transfers</h3>
      <p>E2C transfers are not yet supported in the app (coming soon). For now, use Polkadot.js Apps following this guide: <el-link type="primary" href="https://docs.autonomys.xyz/farming/guides/xdm/#auto-evm-domain-to-consensus-with-polkadotjs" target="_blank">Auto-EVM to Consensus Guide</el-link>.</p>
      
      <h3>Setup Notes</h3>
      <ul>
        <li>Consensus: Use SubWallet/Talisman with Autonomys Consensus (RPC: <code>{{ CONSENSUS_RPC }}</code>, SS58 <code>{{ AUTONOMYS_PREFIX }}</code>).</li>
        <li>EVM: Add Auto-EVM to MetaMask (ID <code>{{ EVM_CHAIN_ID }}</code> via <el-link type="primary" href="https://chainlist.org/chain/870" target="_blank">Chainlist</el-link>).</li>
        <li>Minimum transfer: <code>{{ MIN_TRANSFER_AMOUNT }} AI3</code>.</li>
        <li>This app is built using the <el-link type="primary" href="https://docs.autonomys.xyz/farming/guides/xdm/" target="_blank">XDM Guide</el-link> and <el-link type="primary" href="https://docs.autonomys.xyz/developers/auto-sdk/" target="_blank">Auto-SDK</el-link>.</li>
      </ul>
    </div>
  </el-card>
</template>

<script setup>
  import { CONSENSUS_RPC, MIN_TRANSFER_AMOUNT, AUTONOMYS_PREFIX, EVM_CHAIN_ID } from '@/constants';
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