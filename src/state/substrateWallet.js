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
import { CONSENSUS_RPC, AUTONOMYS_PREFIX, DECIMALS, SUBSCAN_BASE, DOMAIN_ID, EVM_RPC_HTTPS, C2E_ARRIVAL_MS } from '@/constants';
import { state, commit, addLog } from './engine';
import { toast } from '@/ui/dialogs';
import { t } from '@/i18n';

export { C2E_ARRIVAL_MS };

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
            await fetchTransactions();
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

// Subscan shut down anonymous API access (2026-10-26: both v1 and v2 return
// "strictly requires an API key", HTTP 400/code 403). A user-provided key is
// stored in localStorage and sent as the x-api-key header.
export const getSubscanApiKey = () => localStorage.getItem('subscanApiKey') || '';
export const setSubscanApiKey = (key) => {
  if (key) localStorage.setItem('subscanApiKey', key.trim());
  else localStorage.removeItem('subscanApiKey');
};

// Fetch transactions (Subscan-backed; keeps old data and flags the failure
// mode so the UI can distinguish "no history" / "API key required" /
// "service down").
export const fetchTransactions = async () => {
    const apiToUse = state.readOnlyConsensusApi || state.consensusApi;
    if (!apiToUse || !state.consensusAddress) return;

    try {
        addLog('Fetching Consensus extrinsics list via Subscan API V2...');
        const apiKey = getSubscanApiKey();
        const row = 100;
        let page = 0;
        let hasMore = true;
        const allExtrinsics = [];

        while (hasMore) {
            const url = `${SUBSCAN_BASE}/api/v2/scan/extrinsics`;
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(apiKey ? { 'x-api-key': apiKey } : {}),
                },
                body: JSON.stringify({
                    address: state.consensusAddress,
                    row,
                    page,
                }),
            });

            if (!response.ok) {
                throw new Error(`Subscan API V2 error: ${response.status}`);
            }

            const data = await response.json();
            addLog(`Subscan extrinsics page ${page} fetched: ${data.data?.extrinsics?.length || 0} items`);

            if (data.code !== 0) {
                if (data.code === 403 || /api key/i.test(data.message || '')) {
                    state.historyStatus = 'needsKey';
                    commit();
                    addLog('Subscan requires an API key — history panel needs one to load cross-session history.');
                    return;
                }
                throw new Error(`Subscan V2 error: ${data.message}`);
            }

            const txs = data.data.extrinsics || [];
            allExtrinsics.push(...txs);
            hasMore = txs.length === row;
            page++;
            if (page > 10) break;
        }

        state.historyStatus = 'ok';
        commit();

        // Filter to transporter.transfer
        const transporterTxs = allExtrinsics
            .filter(tx => tx.call_module === 'transporter' && tx.call_module_function === 'transfer')
            .slice(0, 50);

        addLog(`Found ${transporterTxs.length} transporter transfers; fetching details...`);

        // Dedup: get existing hashes
        const existingHashes = new Set(state.fetchedTransactions.map(tx => tx.hash));

        // Use consistent decimals for calculations
        const decimals = Number(10n ** DECIMALS);

        let newCount = 0;

        // Fetch details using Polkadot API only for new txs
        for (const tx of transporterTxs) {
            if (existingHashes.has(tx.extrinsic_hash)) continue;

            try {
                const blockNum = parseInt(tx.block_num);
                const extrinsicIdx = parseInt(tx.extrinsic_index.split('-')[1]);
                const blockHash = await apiToUse.rpc.chain.getBlockHash(blockNum);
                const block = await apiToUse.rpc.chain.getBlock(blockHash);
                const extrinsic = block.block.extrinsics[extrinsicIdx];

                if (extrinsic && extrinsic.method.section === 'transporter' && extrinsic.method.method === 'transfer') {
                    const args = extrinsic.method.toHuman().args || {};
                    // Handle comma-separated numbers in args.amount
                    const amountStr = (args.amount || '0').toString().replace(/,/g, '');
                    const amountPlanck = BigInt(amountStr);
                    const amount = Number(amountPlanck) / decimals;
                    const destAccount = args.dst_location.accountId.AccountId20 || '';
                    const domainId = args.dst_location.chainId.Domain || '';

                    const transferTime = new Date(tx.block_timestamp * 1000);
                    const expectedArrival = destAccount.startsWith('0x') ? new Date(transferTime.getTime() + C2E_ARRIVAL_MS).toISOString() : null;
                    const direction = destAccount.startsWith('0x') ? 'consensusToEVM' : 'consensusToConsensus';

                    addLog(`Transporter Tx ${tx.extrinsic_hash}: ${amount} AI3 to ${destAccount} (Domain: ${domainId})`);

                    state.fetchedTransactions.push({
                        type: 'consensus',
                        blockNumber: blockNum,
                        extrinsicIndex: tx.extrinsic_index,
                        hash: tx.extrinsic_hash,
                        method: `${tx.call_module}.${tx.call_module_function}`,
                        amount: amount,
                        destination: destAccount,
                        domainId: domainId,
                        direction: direction,
                        expectedArrival: expectedArrival,
                        tip: tx.tip || '0',
                        nonce: tx.nonce,
                        success: tx.success,
                        fee: (Number(tx.fee || 0) / decimals).toFixed(6),
                        timestamp: transferTime.toISOString(),
                        finalized: tx.finalized,
                    });
                    commit();
                    newCount++;
                }
            } catch (detailError) {
                addLog(`Error fetching details for tx ${tx.extrinsic_hash}: ${detailError.message}`);
            }
        }

        state.fetchedTransactions.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        commit();
        addLog(`Processed ${newCount} new Consensus transporter transfers (total: ${state.fetchedTransactions.length})`);
    } catch (error) {
        state.historyStatus = 'unavailable';
        commit();
        addLog(`History service unavailable (Subscan): ${error.message}`);
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
// This needs only an EVM signer from the linked wallet — no Auto-EVM
// Substrate API instance.
export const performEvmToConsensusTransfer = async (consensusDestAddress, amountWei, onStatusUpdate) => {
    if (!state.linkedEvmProvider) {
        throw new Error('Linked EVM provider not available. Connect a Substrate wallet with EVM support (SubWallet/Talisman) to transfer EVM → Consensus.');
    }
    if (!state.substrateLinkedEvmAddress) {
        throw new Error('Linked EVM address unknown; cannot sign the precompile transfer.');
    }

    addLog(`=== E2C Transfer (transporter precompile) ===`);
    addLog(`Destination Consensus Address: ${consensusDestAddress}`);
    addLog(`Amount (Wei): ${amountWei}`);
    addLog(`Source EVM Address: ${state.substrateLinkedEvmAddress}`);

    try {
        const { transferToConsensus } = await import('@autonomys/auto-xdm');
        addLog('Auto-XDM precompile helper imported.');

        const browserProvider = new BrowserProvider(state.linkedEvmProvider);
        const signer = await browserProvider.getSigner(state.substrateLinkedEvmAddress);

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
        state.substrateLinkedEvmBalance = '0'; // Reset on error
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
        if (allAccounts.length === 0) {
            addLog('No accounts found in extension');
            toast({
                type: 'warn',
                title: t('notifications.noConsensusAccounts.title'),
                message: t('notifications.noConsensusAccounts.message'),
                duration: 0,
            });
            return;
        }
        state.substrateAccounts = allAccounts;
        await activateAccount(allAccounts[0]);

        // Linked EVM discovery is best-effort: failure must not fail the
        // whole connection (C2E does not need it).
        await fetchLinkedEvmAddress(state.consensusAccount.meta.source);

        await updateBalance();
        addLog('Consensus connection successful');
        fetchTransactions();
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
        state.fetchedTransactions = [];
        state.substrateLinkedEvmAddress = '';
        state.substrateLinkedEvmBalance = '0';
        state.linkedEvmProvider = null;
        state.historyStatus = 'idle';
        commit();

        await activateAccount(account);
        await fetchLinkedEvmAddress(account.meta.source);
        await updateBalance();
        fetchTransactions();
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
    state.consensusBalance = 0;
    state.consensusAddress = '';
    state.substrateLinkedEvmAddress = '';
    state.substrateLinkedEvmBalance = '0';
    state.substrateLinkedEvmBalanceLoading = false;
    state.linkedEvmProvider = null;
    state.fetchedTransactions = [];
    state.historyStatus = 'idle';
    commit();
    // Note: We don't clear localStorage as consensus address isn't stored there.
    addLog('Consensus wallet disconnected and state cleared.');
};
