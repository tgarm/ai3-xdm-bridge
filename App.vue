<template>
  <div class="app">
    <h1>AI3 Cross-Domain Transfer</h1>
    
    <div class="top-container">
      <div class="panel top-left">
        <h2>Consensus Chain</h2>
        <button @click="connectConsensus" :disabled="consensusConnected">
          {{ consensusConnected ? 'Connected' : 'Connect SubWallet/Talisman' }}
        </button>
        <div v-if="consensusConnected">
          <p>Balance: <span class="balance">{{ consensusBalance }} AI3</span></p>
          <p>Address: <span>{{ consensusAddress }}</span></p>
        </div>
      </div>
      
      <div class="panel top-right">
        <h2>Auto-EVM Chain</h2>
        <button @click="connectEVM" :disabled="evmConnected">
          {{ evmConnected ? 'Connected' : 'Connect MetaMask' }}
        </button>
        <div v-if="evmConnected">
          <p>Balance: <span class="balance">{{ evmBalance }} AI3</span></p>
          <p>Address: <span>{{ evmAddress }}</span></p>
        </div>
      </div>
    </div>
    
    <div class="bottom-container">
      <div class="panel bridging">
        <h2>Bridging Operation</h2>
        <select v-model="direction">
          <option value="consensusToEVM">Consensus → Auto-EVM</option>
          <option value="evmToConsensus">Auto-EVM → Consensus</option>
        </select>
        <div class="amount-section">
          <input v-model.number="amount" type="number" step="0.000000000000000001" placeholder="Amount in AI3">
          <div class="percent-buttons">
            <button @click="setAmount(0)">0%</button>
            <button @click="setAmount(25)">25%</button>
            <button @click="setAmount(50)">50%</button>
            <button @click="setAmount(75)">75%</button>
            <button @click="setAmount(100)">100%</button>
          </div>
        </div>
        <div v-if="direction === 'evmToConsensus'" class="warning">
          Note: Requires manual Substrate signing on Polkadot.js Apps.
        </div>
        <button @click="performTransfer" :disabled="!canTransfer">
          {{ isTransferring ? 'Transferring...' : 'Transfer AI3' }}
        </button>
      </div>
      
      <div class="panel status">
        <h2>Status & History</h2>
        <div v-if="isTransferring">Pending transfer in progress...</div>
        <div v-for="tx in transactions" :key="tx.timestamp" class="tx-item">
          <p>Direction: {{ tx.direction.replace('consensusToEVM', 'Consensus → Auto-EVM').replace('evmToConsensus', 'Auto-EVM → Consensus') }}</p>
          <p>Amount: {{ tx.amount }} AI3</p>
          <p>Status: {{ tx.status }}</p>
          <p>Estimated Time: {{ tx.estimatedTime }}</p>
          <p>Time: {{ tx.timestamp.toLocaleString() }}</p>
        </div>
        <div v-if="transactions.length === 0">No transactions yet.</div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, markRaw } from 'vue'; 
import { web3Accounts, web3Enable, web3FromAddress } from '@polkadot/extension-dapp';
import { ApiPromise, WsProvider } from '@polkadot/api';
import { transferToDomainAccount20Type } from '@autonomys/auto-xdm';
import { ethers } from 'ethers';
import { decodeAddress, encodeAddress } from '@polkadot/util-crypto';

const CONSENSUS_RPC = 'wss://rpc.mainnet.autonomys.xyz/ws';
const EVM_RPC_HTTP = 'https://auto-evm.mainnet.autonomys.xyz';
const DOMAIN_ID = 0;
const DECIMALS = 18n;
const AUTONOMYS_PREFIX = 6094;

const consensusApi = ref(null);
const consensusAccount = ref(null);
const metamaskProvider = ref(null);
const metamaskAddress = ref(null);
const consensusBalance = ref(0);
const evmBalance = ref(0);
const consensusAddress = ref('');
const evmAddress = ref('');
const direction = ref('consensusToEVM');
const amount = ref(null);
const isTransferring = ref(false);
const transactions = ref([]);

const consensusConnected = computed(() => !!consensusAccount.value);
const evmConnected = computed(() => !!metamaskAddress.value);

const sourceBalance = computed(() => {
  return direction.value === 'consensusToEVM' 
    ? (consensusBalance.value ? parseFloat(consensusBalance.value) : 0)
    : (evmBalance.value ? parseFloat(evmBalance.value) : 0);
});

const canTransfer = computed(() => {
  const connected = consensusConnected.value && evmConnected.value;
  const validAmount = amount.value > 0;
  if (direction.value === 'consensusToEVM') {
    return connected && validAmount && !isTransferring.value;
  } else {
    return connected && validAmount;
  }
});

const setAmount = (percent) => {
  amount.value = sourceBalance.value * (percent / 100);
};

const updateBalances = async () => {
  if (consensusApi.value && consensusAccount.value) {
    const { data: { free } } = await consensusApi.value.query.system.account(consensusAddress.value);
    consensusBalance.value = (Number(free) / Number(10n ** DECIMALS)).toFixed(4);
  }
  if (metamaskProvider.value && metamaskAddress.value) {
    const balance = await metamaskProvider.value.getBalance(metamaskAddress.value);
    evmBalance.value = ethers.formatEther(balance);
  }
};

const connectConsensus = async () => {
  try {
    await web3Enable('ai3-transfer-app');
    const allAccounts = await web3Accounts();
    if (allAccounts.length === 0) {
      alert('No accounts found. Install/Unlock SubWallet or Talisman.');
      return;
    }
    consensusAccount.value = allAccounts[0];
    
    const publicKey = decodeAddress(consensusAccount.value.address);
    consensusAddress.value = encodeAddress(publicKey, AUTONOMYS_PREFIX);
    
    const provider = new WsProvider(CONSENSUS_RPC);
    consensusApi.value = await ApiPromise.create({ provider });
    const injector = await web3FromAddress(consensusAccount.value.address);
    if (!injector) {
      throw new Error('No injector found for address');
    }
    consensusApi.value.setSigner(injector.signer);
    await updateBalances();
    alert('Consensus wallet connected! Address formatted for Autonomys.');
  } catch (error) {
    console.error('Consensus connection failed:', error);
    alert('Connection failed: ' + error.message);
  }
};

const connectEVM = async () => {
  if (typeof window.ethereum !== 'undefined') {
    try {
      const rawProvider = new ethers.BrowserProvider(window.ethereum);
      metamaskProvider.value = markRaw(rawProvider);
      await metamaskProvider.value.send('eth_requestAccounts', []);
      const signer = await metamaskProvider.value.getSigner();
      metamaskAddress.value = await signer.getAddress();
      evmAddress.value = metamaskAddress.value;
      await updateBalances();
      alert(`MetaMask connected for Auto-EVM! Ensure chain ID 870 is added.`);
    } catch (error) {
      console.error('MetaMask connection failed:', error);
      alert('MetaMask connection failed: ' + error.message);
    }
  } else {
    alert('MetaMask not detected. Install MetaMask and add Autonomys chain (ID 870 via https://chainlist.org/chain/870).');
  }
};

const performTransfer = async () => {
  if (!amount.value || amount.value <= 0) {
    alert('Invalid amount');
    return;
  }
  const amountWei = BigInt(Math.floor(amount.value * Number(10n ** DECIMALS)));
  const estimatedTime = direction.value === 'consensusToEVM' ? '~10 min' : '~1 day';
  const newTx = {
    direction: direction.value,
    amount: amount.value,
    status: 'pending',
    estimatedTime,
    timestamp: new Date()
  };
  transactions.value.push(newTx);

  try {
    if (direction.value === 'consensusToEVM') {
      if (!consensusApi.value || !metamaskAddress.value) {
        alert('Connect both wallets first.');
        newTx.status = 'failed';
        return;
      }
      isTransferring.value = true;
      const tx = await transferToDomainAccount20Type(consensusApi.value, DOMAIN_ID, metamaskAddress.value, amountWei.toString());
      await tx.signAndSend(consensusAccount.value.address, ({ status }) => {
        if (status.isInBlock) {
          newTx.status = 'in block';
        }
        if (status.isFinalized) {
          newTx.status = 'completed';
          isTransferring.value = false;
          updateBalances();
          alert('Transfer to Auto-EVM finalized!');
        }
      });
    } else {
      newTx.status = 'manual instructions provided';
      alert('EVM → Consensus transfers require signing a Substrate extrinsic on Auto-EVM.\n\nSteps:\n1. Go to https://polkadot.js.org/apps/?rpc=wss://auto-evm.mainnet.autonomys.xyz/ws#/extrinsics\n2. Select your EVM-derived account (import 0x private key as "substrate" type if needed).\n3. Choose transporter.transfer()\n4. Set dstLocation.chainId = Consensus\n5. Enter consensus address (e.g., your connected one: ' + consensusAddress.value + ')\n6. Amount: ' + amount.value + ' AI3 (in Shannons: ' + amountWei.toString() + ')\n7. Submit & wait ~1 day.\n\nOr use SubWallet connected to Auto-EVM.');
    }
  } catch (error) {
    newTx.status = 'failed';
    isTransferring.value = false;
    console.error('Transfer failed:', error);
    alert('Transfer failed: ' + error.message);
  }
};
</script>

<style>
body {
  font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
  max-width: 1200px;
  margin: 0 auto;
  padding: 20px;
  background-color: #f5f5f5;
  color: #333;
}
.app {
  display: flex;
  flex-direction: column;
}
h1 {
  text-align: center;
  color: #2c3e50;
}
h2 {
  margin-top: 0;
  color: #34495e;
}
.top-container, .bottom-container {
  display: flex;
  gap: 20px;
  margin-bottom: 20px;
}
.panel {
  background: white;
  border-radius: 8px;
  padding: 20px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
  flex: 1;
}
button {
  background-color: #3498db;
  color: white;
  border: none;
  padding: 12px 20px;
  margin: 5px 0;
  border-radius: 6px;
  cursor: pointer;
  font-size: 16px;
  transition: background-color 0.3s;
  width: 100%;
}
button:hover:not(:disabled) {
  background-color: #2980b9;
}
button:disabled {
  background-color: #bdc3c7;
  cursor: not-allowed;
}
select, input[type="number"] {
  padding: 10px;
  margin: 5px 0;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 16px;
  width: 100%;
  box-sizing: border-box;
}
.amount-section {
  display: flex;
  flex-direction: column;
  align-items: center;
}
.percent-buttons {
  display: flex;
  gap: 5px;
  margin-top: 10px;
  flex-wrap: wrap;
}
.percent-buttons button {
  padding: 5px 10px;
  font-size: 14px;
  width: auto;
  min-width: 50px;
}
.warning {
  color: #e74c3c;
  font-style: italic;
  background: #fdf2f2;
  padding: 10px;
  border-radius: 4px;
  margin: 10px 0;
}
.balance {
  font-weight: bold;
  color: #27ae60;
}
.tx-item {
  border: 1px solid #ddd;
  padding: 10px;
  margin: 10px 0;
  border-radius: 4px;
  background: #f9f9f9;
}
.tx-item p {
  margin: 5px 0;
}
@media (max-width: 768px) {
  .top-container, .bottom-container {
    flex-direction: column;
  }
}
</style>