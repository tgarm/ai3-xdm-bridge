<!-- src/components/DocumentPanel.vue -->
<template>
  <div class="panel">
    <h2>Documentation</h2>
    <div class="doc-content">
      <h3>Consensus → EVM Transfers</h3>
      <p>Handled automatically via the app. Wait ~10 min for funds to appear.</p>
      
      <h3>EVM → Consensus Transfers</h3>
      <p>E2C transfers are not yet supported in the app (coming soon). For now, use Polkadot.js Apps following this guide: <a href="https://docs.autonomys.xyz/farming/guides/xdm/#auto-evm-domain-to-consensus-with-polkadotjs" target="_blank">Auto-EVM to Consensus Guide</a>.</p>
      
      <h3>Setup Notes</h3>
      <ul>
        <li>Consensus: Use SubWallet/Talisman with Autonomys Consensus (RPC: wss://rpc.mainnet.autonomys.xyz/ws, SS58 6094).</li>
        <li>EVM: Add Auto-EVM to MetaMask (ID 870 via <a href="https://chainlist.org/chain/870" target="_blank">Chainlist</a>).</li>
        <li>Minimum transfer: 5 AI3.</li>
        <li>This app is built using the <a href="https://docs.autonomys.xyz/farming/guides/xdm/" target="_blank">XDM Guide</a> and <a href="https://docs.autonomys.xyz/developers/auto-sdk/" target="_blank">Auto-SDK</a>.</li>
      </ul>
    </div>
  </div>
</template>

<script setup>
import { useTransferStore } from '@/stores/transferStore';

const store = useTransferStore();
</script>

<style scoped>
.panel {
  background: white;
  border-radius: 8px;
  padding: 20px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
}
.doc-content h3 {
  color: #2c3e50;
  margin-top: 15px;
}
.doc-content ol, .doc-content ul {
  margin: 10px 0;
  padding-left: 20px;
}
.doc-content li {
  margin: 5px 0;
}
.doc-content code {
  background: #ecf0f1;
  padding: 2px 4px;
  border-radius: 3px;
  font-family: monospace;
}
.doc-content a {
  color: #3498db;
  text-decoration: none;
}
.doc-content a:hover {
  text-decoration: underline;
}
</style>