import { web3Accounts, web3Enable, web3FromAddress } from '@polkadot/extension-dapp';
import { ApiPromise, WsProvider } from '@polkadot/api';
import { transferToDomainAccount20Type, transferToConsensus } from '@autonomys/auto-xdm';
import { ethers } from 'ethers';

const CONSENSUS_RPC = 'wss://rpc.mainnet.autonomys.xyz/ws';
const EVM_RPC_HTTP = 'https://auto-evm.mainnet.autonomys.xyz';
const DOMAIN_ID = 0; // Auto-EVM domain ID on mainnet
const DECIMALS = 18n;

let consensusApi = null;
let consensusAccount = null;
let metamaskProvider = null;
let metamaskAddress = null;

const connectConsensusBtn = document.getElementById('connectConsensus');
const connectEVMBtn = document.getElementById('connectEVM');
const transferBtn = document.getElementById('transferBtn');
const amountInput = document.getElementById('amount');
const directionSelect = document.getElementById('direction');
const evmWarning = document.getElementById('evmWarning');

connectConsensusBtn.addEventListener('click', connectConsensus);
connectEVMBtn.addEventListener('click', connectEVM);
transferBtn.addEventListener('click', performTransfer);

amountInput.addEventListener('input', updateTransferButton);
directionSelect.addEventListener('change', updateTransferButton);

function updateTransferButton() {
  const amountValid = parseFloat(amountInput.value) > 0;
  const direction = directionSelect.value;
  const canTransfer = consensusAccount && metamaskAddress && amountValid &&
    (direction === 'consensusToEVM' || confirm('EVM → Consensus requires manual Substrate signing. Proceed to alert for instructions?'));
  transferBtn.disabled = !canTransfer;
  evmWarning.style.display = direction === 'evmToConsensus' ? 'block' : 'none';
}

async function connectConsensus() {
  try {
    await web3Enable('ai3-transfer-app');
    const allAccounts = await web3Accounts();
    if (allAccounts.length === 0) {
      alert('No accounts found. Install/Unlock SubWallet or Talisman.');
      return;
    }
    consensusAccount = allAccounts[0]; // Pick first; in prod, let user select
    const provider = new WsProvider(CONSENSUS_RPC);
    consensusApi = await ApiPromise.create({ provider });
    const injector = await web3FromAddress(consensusAccount.address);
    if (!injector) {
      throw new Error('No injector found for address');
    }
    consensusApi.setSigner(injector.signer);
    document.getElementById('consensusAddress').textContent = consensusAccount.address;
    await updateBalances();
    alert('Consensus wallet connected!');
    updateTransferButton();
  } catch (error) {
    console.error('Consensus connection failed:', error);
    alert('Connection failed: ' + error.message);
  }
}

async function connectEVM() {
  if (typeof window.ethereum !== 'undefined') {
    try {
      metamaskProvider = new ethers.BrowserProvider(window.ethereum);
      await metamaskProvider.send('eth_requestAccounts', []);
      const signer = await metamaskProvider.getSigner();
      metamaskAddress = await signer.getAddress();
      document.getElementById('evmAddress').textContent = metamaskAddress;
      await updateBalances();
      alert(`MetaMask connected for Auto-EVM! Ensure chain ID 870 is added.`);
      updateTransferButton();
    } catch (error) {
      console.error('MetaMask connection failed:', error);
      alert('MetaMask connection failed: ' + error.message);
    }
  } else {
    alert('MetaMask not detected. Install MetaMask and add Autonomys chain (ID 870 via https://chainlist.org/chain/870).');
  }
}

async function updateBalances() {
  if (consensusApi && consensusAccount) {
    const { data: { free } } = await consensusApi.query.system.account(consensusAccount.address);
    document.getElementById('consensusBalance').textContent = (Number(free) / Number(10n ** DECIMALS)).toFixed(4);
  }
  if (metamaskProvider && metamaskAddress) {
    const balance = await metamaskProvider.getBalance(metamaskAddress);
    document.getElementById('evmBalance').textContent = ethers.formatEther(balance);
  }
}

async function performTransfer() {
  const direction = directionSelect.value;
  const amount = parseFloat(amountInput.value);
  if (!amount || amount <= 0) {
    alert('Invalid amount');
    return;
  }
  const amountWei = BigInt(Math.floor(amount * (10 ** DECIMALS)));

  try {
    let tx;
    if (direction === 'consensusToEVM') {
      if (!consensusApi || !metamaskAddress) {
        alert('Connect both wallets first.');
        return;
      }
      tx = await transferToDomainAccount20Type(consensusApi, DOMAIN_ID, metamaskAddress, amountWei.toString());
      await tx.signAndSend(consensusAccount.address, ({ status }) => {
        if (status.isFinalized) {
          alert('Transfer to Auto-EVM finalized! (~10 min to appear)');
          updateBalances();
        }
      });
    } else {
      // EVM to Consensus - Not supported with MetaMask; guide user
      alert('EVM → Consensus transfers require signing a Substrate extrinsic on Auto-EVM.\n\nSteps:\n1. Go to https://polkadot.js.org/apps/?rpc=wss://auto-evm.mainnet.autonomys.xyz/ws#/extrinsics\n2. Select your EVM-derived account (import 0x private key as "substrate" type if needed).\n3. Choose transporter.transfer()\n4. Set dstLocation.chainId = Consensus\n5. Enter consensus address (e.g., your connected one: ' + consensusAccount.address + ')\n6. Amount: ' + amount + ' AI3 (in Shannons: ' + amountWei.toString() + ')\n7. Submit & wait ~1 day.\n\nOr use SubWallet connected to Auto-EVM.');
      return;
    }
  } catch (error) {
    console.error('Transfer failed:', error);
    alert('Transfer failed: ' + error.message);
  }
}