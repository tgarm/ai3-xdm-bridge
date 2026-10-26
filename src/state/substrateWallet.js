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
import { CONSENSUS_RPC_CANDIDATES, AUTONOMYS_PREFIX, DECIMALS, DOMAIN_ID, EVM_RPC_HTTPS } from '@/constants';
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

// Grace window before rebuilding a dropped socket: polkadot's WsProvider
// retries transient blips on its own, and recreating the ApiPromise under
// it would race that recovery.
const RECONNECT_GRACE_MS = 8000;

// Hooks notified when a consensus API is (re)available — transfer.js uses
// this to re-arm its progress watchers against the new instance.
const apiRestoredHooks = new Set();
export const onApiRestored = (fn) => { apiRestoredHooks.add(fn); };
const notifyApiRestored = () => {
    for (const fn of apiRestoredHooks) {
        try { fn(); } catch (error) { console.error('api-restored hook failed:', error); }
    }
};

// Transparently rebuild the transport after the active socket dies. Wallet,
// account and balance state are preserved — only the connection was lost.
// (Public RPCs reap idle connections routinely; field-tested annoyance was
// having to press Connect again after every E2C transfer.) One pass at a
// time: in practice only consensusApi is ever live, since the read-only
// instance is never created without a stored address.
let reconnecting = false;
async function reconnectActiveApi(deadInstance) {
    if (reconnecting) return;
    reconnecting = true;
    try {
        addLog('API-WS: reconnecting (candidate endpoints in turn)…');
        const replacement = await createApiInstance();
        // The slot must still point at the dead instance (a manual connect
        // may have won the race). Assign BEFORE disconnecting the old one so
        // its final 'disconnected' event reads as stale and is ignored.
        if (state.consensusApi === deadInstance) {
            state.consensusApi = replacement;
        } else if (state.readOnlyConsensusApi === deadInstance) {
            state.readOnlyConsensusApi = replacement;
        } else {
            await replacement.disconnect().catch(() => {});
            return;
        }
        commit();
        await deadInstance.disconnect().catch(() => {});
        // The replacement needs the extension signer re-attached for sends.
        if (state.consensusAccount) {
            const injector = await web3FromAddress(state.consensusAccount.address).catch(() => null);
            if (injector) replacement.setSigner(injector.signer);
        }
        addLog('Consensus connection restored automatically — wallet session preserved.');
        await updateBalance();
        notifyApiRestored();
    } catch (error) {
        addLog(`Auto-reconnect failed: ${error.message} — wallet state cleared, press Connect to retry.`);
        await disconnect();
        toast({
            type: 'warn',
            title: t('notifications.consensusLost.title'),
            message: t('notifications.consensusLost.message', [error.message]),
            duration: 0,
        });
    } finally {
        reconnecting = false;
    }
}

// Try each public RPC in turn; both rate-limit, one dying should not kill
// the connect.
async function createApiInstance() {
    let lastError;
    for (const rpcUrl of CONSENSUS_RPC_CANDIDATES) {
        try {
            return await createApiFor(rpcUrl);
        } catch (error) {
            addLog(`RPC ${rpcUrl} unavailable: ${error.message}`);
            lastError = error;
        }
    }
    throw lastError ?? new Error('No consensus RPC endpoint reachable');
}

async function createApiFor(rpcUrl) {
    addLog(`Creating paced API instance for ${rpcUrl}...`);
    const provider = new PacedWsProvider(rpcUrl);
    let apiInstance = null;

    provider.on('disconnected', () => {
        // Only the ACTIVE API's death matters. Stale sockets from superseded
        // connect attempts must not touch state (field-tested crash:
        // consensusAccount null while connect() was still running).
        const isActive = apiInstance != null
            && (state.consensusApi === apiInstance || state.readOnlyConsensusApi === apiInstance);
        if (!isActive) {
            addLog(`API-WS: socket closed for ${rpcUrl} (not the active API — ignored).`);
            return;
        }
        // Never wipe the wallet session for a dropped socket. Wait out the
        // provider's own retry first; if the socket is really gone, rebuild
        // the transport transparently (session preserved).
        addLog(`API-WS: active connection to ${rpcUrl} lost — waiting ${RECONNECT_GRACE_MS / 1000}s for spontaneous recovery…`);
        setTimeout(() => {
            if (apiInstance !== state.consensusApi && apiInstance !== state.readOnlyConsensusApi) return; // superseded meanwhile
            if (apiInstance.isConnected) {
                addLog('API-WS: socket recovered on its own.');
                updateBalance().catch(() => {});
                notifyApiRestored();
                return;
            }
            void reconnectActiveApi(apiInstance);
        }, RECONNECT_GRACE_MS);
    });
    provider.on('connected', () => {
        addLog(`API-WS: connected to ${rpcUrl}.`);
    });

    // Probe before ApiPromise.create: its init burst lands on a banned IP
    // otherwise, and bans are extended by retrying. Capped retries so the
    // fallback endpoint gets its turn in reasonable time.
    await probeProvider(provider, { maxRetries: 2 });

    // No custom `types` and no manual metadata refresh: mainnet metadata
    // natively registers all transporter types (field-tested 2026-10-26;
    // injected aliases like AccountId20 crash storage decoding on
    // polkadot-api >= 16 and are redundant everywhere else).
    apiInstance = await ApiPromise.create({ provider, noInitWarn: true });

    const chain = await apiInstance.rpc.system.chain();
    addLog(`Connected to chain: ${chain}`);
    return apiInstance;
}

// Create read-only API if address set
export const initReadOnlyApi = async () => {
    if (state.consensusAddress && !state.readOnlyConsensusApi) {
        try {
            state.readOnlyConsensusApi = await createApiInstance();
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
// Verified against mainnet (tx 0x0758bae7…, 2026-10-26).
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
        let provider;
        if (src.kind === 'linked') {
            if (!state.linkedEvmProvider) {
                throw new Error('Linked EVM provider not available.');
            }
            provider = new BrowserProvider(state.linkedEvmProvider);
            signer = await provider.getSigner(src.from);
        } else {
            if (!state.evmProvider) {
                throw new Error('EVM wallet not connected.');
            }
            // The precompile lives on Auto-EVM — make sure the injected
            // wallet is on chain 870 (adds/switches the network if needed).
            await ensureCorrectNetwork();
            provider = state.evmProvider;
            signer = await provider.getSigner(src.from);
        }

        // Field-tested 2026-10-26: the wallet's own fee estimate can land
        // below Auto-EVM's moving base fee and the RPC rejects the raw tx
        // ("gas price less than block base fee") AFTER signing. Read the
        // chain fees here and pin EIP-1559 fields with generous headroom —
        // the wallet confirm screen then shows these values as-is.
        let feeOptions = {};
        try {
            const fee = await provider.getFeeData();
            if (fee.maxFeePerGas != null) {
                feeOptions.maxFeePerGas = (fee.maxFeePerGas * 3n) / 2n;
                if (fee.maxPriorityFeePerGas != null) {
                    feeOptions.maxPriorityFeePerGas = fee.maxPriorityFeePerGas;
                }
            } else if (fee.gasPrice != null) {
                feeOptions.gasPrice = (fee.gasPrice * 3n) / 2n;
            }
            addLog(`E2C fees: ${JSON.stringify(Object.fromEntries(Object.entries(feeOptions).map(([k, v]) => [k, v.toString()])))}`);
        } catch (feeError) {
            addLog(`Fee data unavailable, using wallet estimate: ${feeError.message}`);
        }

        addLog('Sending precompile transaction... (check wallet for signature prompt)');
        const result = await transferToConsensus(signer, consensusDestAddress, amountWei, { confirmations: 1, ...feeOptions });

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
        const account = consensusAccounts[0];
        await activateAccount(account);

        // Balance first: a plain RPC read that must not wait on the
        // extension. Linked-EVM discovery runs AFTER, un-awaited — its
        // eth_requestAccounts blocks on the unlock prompt when the wallet
        // is locked, and hanging there used to leave the balance at 0.
        // Read from the LOCAL account: a socket teardown mid-connect clears
        // global state, and reading it back used to crash on null.meta.
        await updateBalance();
        addLog('Consensus connection successful');
        fetchLinkedEvmAddress(account.meta.source).catch(() => {});
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
        state.consensusApi = await createApiInstance();
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
