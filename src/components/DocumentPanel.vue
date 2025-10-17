<!-- src/components/DocumentPanel.vue -->
<template>
  <div class="panel">
    <h2>Documentation</h2>
    <div class="doc-content">
      <h3>EVM → Consensus Transfers</h3>
      <p>These require manual Substrate signing:</p>
      <ol>
        <li>Go to <a href="https://polkadot.js.org/apps/?rpc=wss://auto-evm.mainnet.autonomys.xyz/ws#/extrinsics" target="_blank">Polkadot.js Apps</a></li>
        <li>Select your EVM-derived account (import 0x private key as "substrate" type if needed).</li>
        <li>Choose <code>transporter.transfer()</code></li>
        <li>Set <code>dstLocation.chainId = Consensus</code></li>
        <li>Enter consensus address (e.g., {{ store.consensusAddress || 'your connected one' }})</li>
        <li>Amount: in Shannons (e.g., for 1 AI3: 1000000000000000000)</li>
        <li>Submit & wait ~1 day.</li>
      </ol>
      <p>Or use SubWallet connected to Auto-EVM.</p>
      
      <h3>Consensus → EVM Transfers</h3>
      <p>Handled automatically via the app. Wait ~10 min for funds to appear.</p>
      
      <h3>Setup Notes</h3>
      <ul>
        <li>Consensus: Use SubWallet/Talisman with Autonomys network.</li>
        <li>EVM: Add Auto-EVM chain (ID 870) to MetaMask via <a href="https://chainlist.org/chain/870" target="_blank">Chainlist</a>.</li>
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