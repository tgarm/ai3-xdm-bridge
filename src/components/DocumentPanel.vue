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
      <p>Handled automatically via the app. Wait ~10 min for funds to appear.</p>
      
      <h3>EVM → Consensus Transfers</h3>
      <p>E2C transfers are not yet supported in the app (coming soon). For now, use Polkadot.js Apps following this guide: <el-link type="primary" href="https://docs.autonomys.xyz/farming/guides/xdm/#auto-evm-domain-to-consensus-with-polkadotjs" target="_blank">Auto-EVM to Consensus Guide</el-link>.</p>
      
      <h3>Setup Notes</h3>
      <ul>
        <li>Consensus: Use SubWallet/Talisman with Autonomys Consensus (RPC: wss://rpc.mainnet.autonomys.xyz/ws, SS58 6094).</li>
        <li>EVM: Add Auto-EVM to MetaMask (ID 870 via <el-link type="primary" href="https://chainlist.org/chain/870" target="_blank">Chainlist</el-link>).</li>
        <li>Minimum transfer: 5 AI3.</li>
        <li>This app is built using the <el-link type="primary" href="https://docs.autonomys.xyz/farming/guides/xdm/" target="_blank">XDM Guide</el-link> and <el-link type="primary" href="https://docs.autonomys.xyz/developers/auto-sdk/" target="_blank">Auto-SDK</el-link>.</li>
      </ul>
    </div>
  </el-card>
</template>

<style scoped>
.doc-content h3 {
  color: #2c3e50;
  margin-top: 15px;
}
.doc-content ul {
  margin: 10px 0;
  padding-left: 20px;
}
.doc-content li {
  margin: 5px 0;
}
</style>