// src/state/substrateWallet.js
//
// Port of the P2-field-tested Vue composable useSubstrateWallet to the plain
// singleton store. Chain-facing semantics are unchanged (paced providers, no
// custom types, bare transporter.transfer construction); only the reactivity
// wrapper (refs → state fields) and notifications (ElNotification → dialogs)
// were adapted.

import { web3Accounts, web3Enable, web3FromAddress } from '@polkadot/extension-dapp';
import { ApiPromise } from '@polkadot/api';
import { BrowserProvider } from 'ethers';
import { decodeAddress, encodeAddress } from '@polkadot/util-crypto';
import { PacedWsProvider, probeProvider } from '@/lib/pacedProvider';
import { CONSENSUS_RPC, AUTONOMYS_PREFIX, DECIMALS, DOMAIN_ID, EVM_RPC_HTTPS } from '@/constants';
import { state, commit, addLog } from './engine';
import { toast } from '@/ui/dialogs';
import { t } from '@/i18n';
import { ensureCorrectNetwork } from './evmWallet';

const disconnectApis = async () => {
    if (state.consensusApi) {
        await state.consensusApi.disconnect().catch(() => {});
        state.consensusApi = null;
    }
    if (state.readOnlyConsensusApi) {
        await state.readOnlyConsensusApi.disconnect().catch(() => {});
        state.readOnlyConsensusApi = null;
    }
    commit();
    addLog('APIs disconnected');
};

async function createApiInstance(rpcUrl) {
    addLog(`Creating paced API instance for ${rpcUrl}...`);
    const provider = new PacedWsProvider(rpcUrl);

    // If the websocket drops for any reason, the UI reflects the
    // disconnected state, allowing the user to reconnect.
    provider.on('disconnected', () => {
        addLog(`API-WS: disconnected from ${rpcUrl}. Resetting wallet state.`);
        disconnect();
    });
    provider.on('connected', () => {
        addLog(`API-WS: connected to ${rpcUrl}.`);
    });

    // Probe before ApiPromise.create: its init burst lands on a banned IP
    // otherwise, and bans are extended by retrying.
    await probeProvider(provider);

    // No custom `types` and no manual metadata refresh: mainnet metadata
    // natively registers all transporter types (field-tested 2026-10-26;
    // injected aliases like AccountId20 crash storage decoding on
    // polkadot-api >= 16 and are redundant everywhere else).
    const apiInstance = await ApiPromise.create({ provider, noInitWarn: true });

    const chain = await apiInstance.rpc.system.chain();
    addLog(`Connected to chain: ${chain}`);
    return apiInstance;
}

// Create read-only API if address set
export const initReadOnlyApi = async () => {
    if (state.consensusAddress && !state.readOnlyConsensusApi) {
        try {
            state.readOnlyConsensusApi = await createApiInstance(CONSENSUS_RPC);
            commit();
            addLog('Read-only Consensus API initialized (Mainnet)');

            await updateBalance();
        } catch (error) {
            addLog(`Error initializing read-only Consensus API: ${error.message}`);
            await disconnect(); // Ensure state is cleared on failure
        }
    }
};

// Update balance
export const updateBalance = async () => {
    const apiToUse = state.readOnlyConsensusApi || state.consensusApi;
    if (apiToUse && state.consensusAddress) {
        state.consensusBalanceLoading = true;
        commit();
        try {
            const { data: { free } } = await apiToUse.query.system.account(state.consensusAddress);
            state.consensusBalance = (Number(free) / Number(10n ** DECIMALS)).toFixed(4);
            commit();
            addLog(`Consensus balance updated: ${state.consensusBalance} AI3`);
        } catch (error) {
            addLog(`Error updating consensus balance: ${error.message}`);
        } finally {
            state.consensusBalanceLoading = false;
            commit();
        }
    }
};

// Perform Consensus to EVM transfer.
// Bare extrinsic construction — the params are plain JS objects and are
// encoded against the chain metadata (no SDK wrapper, no custom types).
// Verified against mainnet (PermaDrive P2, tx 0x0758bae7…).
export const performConsensusTransfer = async (evmAddress, amountWei, onStatusUpdate) => {
    if (!state.consensusApi) {
        throw new Error('Consensus API not initialized');
    }

    addLog(`Preparing C2E transfer: ${evmAddress}, ${amountWei} wei, domain ${DOMAIN_ID}`);
    const tx = state.consensusApi.tx.transporter.transfer(
        { chainId: { Domain: DOMAIN_ID }, accountId: { AccountId20: evmAddress } },
        amountWei,
    );
    addLog('Transfer extrinsic prepared (bare metadata-driven construction)');

    addLog('Signing and sending transaction... (check extension for signature prompt)');
    const unsubscribe = await tx.signAndSend(state.consensusAccount.address, ({ status }) => {
        addLog(`Transaction status: ${status.type}`);
        onStatusUpdate?.({ status });

        if (status.isInBlock) {
            addLog('Transaction in block');
        }
        if (status.isFinalized) {
            addLog('Substrate transaction finalized');
        }
        if (status.isRetracted) {
            addLog('Transaction retracted');
        }
        if (status.isFinalityTimeout) {
            addLog('Transaction finality timeout - may finalize later');
        }
    });
    addLog('signAndSend initiated (unsubscribe ready)');
    return { unsubscribe, hash: tx.hash.toHex() };
};

// Perform EVM to Consensus transfer via the transporter precompile.
// auto-xdm's transferToConsensus sends a plain Ethereum tx to the
// precompile (transfer_to_consensus_v1(bytes32,uint256)); the precompile
// is deployed on Auto-EVM mainnet (min transfer 1 AI3, verified 2026-10-26).
// The signer is ANY EVM address with funds — the injected browser wallet
// (funds may have arrived from anywhere) or the Substrate-linked account.
// `src` comes from transfer.e2cSource(): { kind: 'injected'|'linked', from }.
export const performE2CTransfer = async (src, consensusDestAddress, amountWei, onStatusUpdate) => {
    addLog(`=== E2C Transfer (transporter precompile, ${src.kind} source) ===`);
    addLog(`Source EVM Address: ${src.from}`);
    addLog(`Destination Consensus Address: ${consensusDestAddress}`);
    addLog(`Amount (Wei): ${amountWei}`);

    try {
        const { transferToConsensus } = await import('@autonomys/auto-xdm');
        addLog('Auto-XDM precompile helper imported.');

        let signer;
        if (src.kind === 'linked') {
            if (!state.linkedEvmProvider) {
                throw new Error('Linked EVM provider not available.');
            }
            const browserProvider = new BrowserProvider(state.linkedEvmProvider);
            signer = await browserProvider.getSigner(src.from);
        } else {
            if (!state.evmProvider) {
                throw new Error('EVM wallet not connected.');
            }
            // The precompile lives on Auto-EVM — make sure the injected
            // wallet is on chain 870 (adds/switches the network if needed).
            await evm.ensureCorrectNetwork();
            signer = await state.evmProvider.getSigner(src.from);
        }

        addLog('Sending precompile transaction... (check wallet for signature prompt)');
        const result = await transferToConsensus(signer, consensusDestAddress, amountWei, { confirmations: 1 });

        if (!result.success) {
            throw new Error('Precompile transaction reverted');
        }
        addLog(`E2C precompile transaction confirmed: ${result.transactionHash} (block ${result.blockNumber})`);
        onStatusUpdate?.({ type: 'confirmed', hash: result.transactionHash });
        return { unsubscribe: () => {}, hash: result.transactionHash };
    } catch (error) {
        addLog(`E2C transfer failed: ${error.message}`);
        console.error('E2C transfer error:', error);
        throw error;
    }
};

// Linked EVM balance via a single raw eth_getBalance call — no ethers
// provider stack needed for a read-only balance.
export const getLinkedEvmBalance = async (evmAddress) => {
    if (!evmAddress) return;
    state.substrateLinkedEvmBalanceLoading = true;
    commit();
    try {
        const response = await fetch(EVM_RPC_HTTPS, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getBalance', params: [evmAddress, 'latest'] }),
        });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        const msg = await response.json();
        if (msg.error) {
            throw new Error(msg.error.message ?? 'eth_getBalance error');
        }
        const balanceWei = BigInt(msg.result);
        state.substrateLinkedEvmBalance = (Number(balanceWei) / Number(10n ** DECIMALS)).toFixed(4);
        commit();
        addLog(`Linked EVM balance updated: ${state.substrateLinkedEvmBalance} AI3`);
    } catch (error) {
        addLog(`Error updating linked EVM balance: ${error.message}`);
        console.error('Linked EVM balance update failed:', error);
        state.substrateLinkedEvmBalance = null; // Unknown on error — UI shows '—'
        commit();
    } finally {
        state.substrateLinkedEvmBalanceLoading = false;
        commit();
    }
};

// Discover the EVM address linked to the Substrate wallet (E2C source).
// Only discovers — API instances are created exclusively in connect().
const fetchLinkedEvmAddress = async (source) => {
    try {
        addLog('Attempting to find linked EVM address...');
        let walletEVMName = '';
        if (source === 'subwallet-js') {
            walletEVMName = 'SubWallet';
        } else if (source === 'talisman') {
            walletEVMName = 'Talisman';
        }

        if (!walletEVMName) {
            addLog(`Wallet source '${source}' does not expose a linked EVM address. EVM → Consensus transfers are disabled; Consensus → EVM still works.`);
            toast({
                type: 'info',
                title: t('notifications.evmLinkSkipped.title'),
                message: t('notifications.evmLinkSkipped.message', [source]),
                duration: 8000,
            });
            return;
        }

        // EIP-6963 discovery
        const announcedProviders = [];
        const handleAnnounce = (event) => {
            const providerDetail = event.detail;
            if (!announcedProviders.find(p => p.info.rdns === providerDetail.info.rdns)) {
                announcedProviders.push(providerDetail);
            }
        };
        window.addEventListener('eip6963:announceProvider', handleAnnounce);
        window.dispatchEvent(new Event('eip6963:requestProvider'));

        // Give providers time to announce
        await new Promise(resolve => setTimeout(resolve, 500));
        window.removeEventListener('eip6963:announceProvider', handleAnnounce);

        let evmProviderInfo = null;
        const matchingProviderDetail = announcedProviders.find(p => p.info.name === walletEVMName);

        if (matchingProviderDetail) {
            evmProviderInfo = { provider: matchingProviderDetail.provider, name: `EIP-6963: ${matchingProviderDetail.info.name}` };
            addLog(`Found EVM provider for ${walletEVMName} via EIP-6963.`);
        } else if (walletEVMName === 'Talisman' && window.talismanEth) {
            evmProviderInfo = { provider: window.talismanEth, name: 'window.talismanEth' };
            addLog('Used window.talismanEth as a fallback for Talisman.');
        }

        if (!evmProviderInfo) {
            addLog(`Could not find an EVM provider for ${walletEVMName}. EVM → Consensus transfers are disabled.`);
            return;
        }

        const evmAccounts = await evmProviderInfo.provider.request({ method: 'eth_requestAccounts' });
        if (evmAccounts && evmAccounts.length > 0) {
            state.substrateLinkedEvmAddress = evmAccounts[0];
            state.linkedEvmProvider = evmProviderInfo.provider;
            commit();
            addLog(`Successfully retrieved linked EVM address: ${evmAccounts[0]}`);
            await getLinkedEvmBalance(evmAccounts[0]);
        } else {
            addLog(`EVM provider for ${walletEVMName} did not return any accounts.`);
        }
    } catch (evmError) {
        addLog(`Could not get linked EVM address: ${evmError.message}`);
    }
};

// Connect Consensus wallet
export const connect = async () => {
    try {
        addLog('Attempting to connect Consensus wallet...');
        await web3Enable('ai3-transfer-app');
        const allAccounts = await web3Accounts();
        // SubWallet/Talisman also expose their EVM accounts here (type
        // 'ethereum', 0x… addresses). Only consensus-chain accounts are
        // usable on this side — decoding a 0x address into an Autonomys
        // address would silently produce garbage.
        const consensusAccounts = allAccounts.filter(acc => acc.type !== 'ethereum');
        addLog(`web3Accounts: ${allAccounts.length} total, ${consensusAccounts.length} consensus-chain (EVM accounts filtered)`);
        if (consensusAccounts.length === 0) {
            addLog('No consensus-chain accounts found in extension');
            toast({
                type: 'warn',
                title: t('notifications.noConsensusAccounts.title'),
                message: t('notifications.noConsensusAccounts.message'),
                duration: 0,
            });
            return;
        }
        state.substrateAccounts = consensusAccounts;
        await activateAccount(consensusAccounts[0]);

        // Balance first: a plain RPC read that must not wait on the
        // extension. Linked-EVM discovery runs AFTER, un-awaited — its
        // eth_requestAccounts blocks on the unlock prompt when the wallet
        // is locked, and hanging there used to leave the balance at 0.
        await updateBalance();
        addLog('Consensus connection successful');
        fetchLinkedEvmAddress(state.consensusAccount.meta.source).catch(() => {});
    } catch (error) {
        console.error('Consensus connection failed:', error);
        addLog(`Consensus connection failed: ${error.message}`);
        toast({
            type: 'danger',
            title: t('notifications.consensusConnectFailed.title'),
            message: t('notifications.consensusConnectFailed.message', [error.message]),
            duration: 0,
        });
        await disconnect(); // Ensure state is cleared on connection failure
    }
};

// Activate an extension account against the existing API (used by connect
// and by the account selector). APIs are chain-scoped, so switching
// accounts never recreates them — only the signer and derived state.
const activateAccount = async (account) => {
    state.consensusAccount = account;
    const publicKey = decodeAddress(account.address);
    state.consensusAddress = encodeAddress(publicKey, AUTONOMYS_PREFIX);
    commit();

    if (!state.consensusApi) {
        state.consensusApi = await createApiInstance(CONSENSUS_RPC);
        commit();
    }
    const injector = await web3FromAddress(account.address);
    if (!injector) {
        throw new Error('No injector found for address');
    }
    state.consensusApi.setSigner(injector.signer);
    addLog(`Active account: ${account.meta?.name || ''} ${state.consensusAddress}`);
};

// Switch the active account (account selector in the wallet panel).
export const switchAccount = async (account) => {
    if (!account || !state.consensusApi || state.consensusAccount?.address === account.address) return;
    try {
        state.substrateLinkedEvmAddress = '';
        state.substrateLinkedEvmBalance = null;
        state.linkedEvmProvider = null;
        commit();

        await activateAccount(account);
        await updateBalance();
        fetchLinkedEvmAddress(account.meta.source).catch(() => {});
    } catch (error) {
        addLog(`Account switch failed: ${error.message}`);
        toast({
            type: 'danger',
            title: t('notifications.accountSwitchFailed.title'),
            message: error.message,
            duration: 0,
        });
    }
};

export const disconnect = async () => {
    await disconnectApis();
    state.consensusAccount = null;
    state.substrateAccounts = [];
    state.consensusBalance = null;
    state.consensusAddress = '';
    state.substrateLinkedEvmAddress = '';
    state.substrateLinkedEvmBalance = null;
    state.substrateLinkedEvmBalanceLoading = false;
    state.linkedEvmProvider = null;
    commit();
    // Note: We don't clear localStorage as consensus address isn't stored there.
    addLog('Consensus wallet disconnected and state cleared.');
};
