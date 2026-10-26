// src/composables/useSubstrateWallet.js
import { ref, markRaw } from 'vue';
import { web3Accounts, web3Enable, web3FromAddress } from '@polkadot/extension-dapp';
import { ElNotification } from 'element-plus';
import { ApiPromise } from '@polkadot/api';
import { BrowserProvider } from 'ethers';
import { decodeAddress, encodeAddress } from '@polkadot/util-crypto';
import { PacedWsProvider, probeProvider } from '@/lib/pacedProvider';
import { CONSENSUS_RPC, AUTONOMYS_PREFIX, DECIMALS, SUBSCAN_BASE, DOMAIN_ID, EVM_RPC_HTTPS } from '@/constants';

// C2E arrival window: protocol docs say 100 domain blocks (~10 min), but the
// 2026-10-26 mainnet field test measured ~25 min for funds to land. 30 min
// keeps us polling long enough to see the real arrival instead of a fake failure.
export const C2E_ARRIVAL_MS = 30 * 60 * 1000;
// E2C goes through the transporter precompile and has a 1-day challenge period.
export const E2C_CHALLENGE_MS = 24 * 60 * 60 * 1000;

export function useSubstrateWallet(addLog) {
    // Substrate State
    const consensusApi = ref(null); // Signed API
    const readOnlyConsensusApi = ref(null); // Read-only API
    const consensusAccount = ref(null);
    const substrateAccounts = ref([]); // All extension accounts (for the account selector)
    const consensusBalance = ref(0);
    const consensusBalanceLoading = ref(false);
    const consensusAddress = ref('');
    const substrateLinkedEvmAddress = ref(''); // EVM address linked to the Substrate wallet (E2C source)
    const substrateLinkedEvmBalance = ref('0');
    const substrateLinkedEvmBalanceLoading = ref(false);
    const linkedEvmProvider = ref(null); // EIP-6963 provider of the linked wallet (used for E2C precompile txs)
    const fetchedTransactions = ref([]); // Consensus transporter transfers
    const historyStatus = ref('idle'); // 'idle' | 'ok' | 'unavailable' (history service down)

    const disconnectApis = async () => {
        if (consensusApi.value) {
            await consensusApi.value.disconnect().catch(() => {});
            consensusApi.value = null;
        }
        if (readOnlyConsensusApi.value) {
            await readOnlyConsensusApi.value.disconnect().catch(() => {});
            readOnlyConsensusApi.value = null;
        }
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
    const initReadOnlyApi = async () => {
        if (consensusAddress.value && !readOnlyConsensusApi.value) {
            try {
                readOnlyConsensusApi.value = markRaw(await createApiInstance(CONSENSUS_RPC));
                addLog('Read-only Consensus API initialized (Mainnet)');

                await updateBalance();
                await fetchTransactions();
            } catch (error) {
                addLog(`Error initializing read-only Consensus API: ${error.message}`);
                await disconnect(); // Ensure state is cleared on failure
            }
        }
    };

    // Update balance (unchanged)
    const updateBalance = async () => {
        const apiToUse = readOnlyConsensusApi.value || consensusApi.value;
        if (apiToUse && consensusAddress.value) {
            consensusBalanceLoading.value = true;
            try {
                const { data: { free } } = await apiToUse.query.system.account(consensusAddress.value);
                consensusBalance.value = (Number(free) / Number(10n ** DECIMALS)).toFixed(4);
                addLog(`Consensus balance updated: ${consensusBalance.value} AI3`);
            } catch (error) {
                addLog(`Error updating consensus balance: ${error.message}`);
            } finally {
                consensusBalanceLoading.value = false;
            }
        }
    };

    // Fetch transactions (Subscan-backed; keeps old data and flags
    // 'unavailable' on failure so the UI can distinguish "no history" from
    // "history service down").
    const fetchTransactions = async () => {
        const apiToUse = readOnlyConsensusApi.value || consensusApi.value;
        if (!apiToUse || !consensusAddress.value) return;

        try {
            addLog('Fetching Consensus extrinsics list via Subscan API V2...');
            const row = 100;
            let page = 0;
            let hasMore = true;
            const allExtrinsics = [];

            while (hasMore) {
                const url = `${SUBSCAN_BASE}/api/v2/scan/extrinsics`;
                const response = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        address: consensusAddress.value,
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
                    throw new Error(`Subscan V2 error: ${data.message}`);
                }

                const txs = data.data.extrinsics || [];
                allExtrinsics.push(...txs);
                hasMore = txs.length === row;
                page++;
                if (page > 10) break;
            }

            historyStatus.value = 'ok';

            // Filter to transporter.transfer
            const transporterTxs = allExtrinsics
                .filter(tx => tx.call_module === 'transporter' && tx.call_module_function === 'transfer')
                .slice(0, 50);

            addLog(`Found ${transporterTxs.length} transporter transfers; fetching details...`);

            // Dedup: get existing hashes
            const existingHashes = new Set(fetchedTransactions.value.map(tx => tx.hash));

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

                        fetchedTransactions.value.push({
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
                        newCount++;
                    }
                } catch (detailError) {
                    addLog(`Error fetching details for tx ${tx.extrinsic_hash}: ${detailError.message}`);
                }
            }

            fetchedTransactions.value.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
            addLog(`Processed ${newCount} new Consensus transporter transfers (total: ${fetchedTransactions.value.length})`);
        } catch (error) {
            historyStatus.value = 'unavailable';
            addLog(`History service unavailable (Subscan): ${error.message}`);
        }
    };

    // Perform Consensus to EVM transfer.
    // Bare extrinsic construction — the params are plain JS objects and are
    // encoded against the chain metadata (no SDK wrapper, no custom types).
    // Verified against mainnet (PermaDrive P2, tx 0x0758bae7…).
    const performConsensusTransfer = async (evmAddress, amountWei, onStatusUpdate) => {
        if (!consensusApi.value) {
            throw new Error('Consensus API not initialized');
        }

        addLog(`Preparing C2E transfer: ${evmAddress}, ${amountWei} wei, domain ${DOMAIN_ID}`);
        const tx = consensusApi.value.tx.transporter.transfer(
            { chainId: { Domain: DOMAIN_ID }, accountId: { AccountId20: evmAddress } },
            amountWei,
        );
        addLog('Transfer extrinsic prepared (bare metadata-driven construction)');

        addLog('Signing and sending transaction... (check extension for signature prompt)');
        const unsubscribe = await tx.signAndSend(consensusAccount.value.address, ({ status }) => {
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
    const performEvmToConsensusTransfer = async (consensusDestAddress, amountWei, onStatusUpdate) => {
        if (!linkedEvmProvider.value) {
            throw new Error('Linked EVM provider not available. Connect a Substrate wallet with EVM support (SubWallet/Talisman) to transfer EVM → Consensus.');
        }
        if (!substrateLinkedEvmAddress.value) {
            throw new Error('Linked EVM address unknown; cannot sign the precompile transfer.');
        }

        addLog(`=== E2C Transfer (transporter precompile) ===`);
        addLog(`Destination Consensus Address: ${consensusDestAddress}`);
        addLog(`Amount (Wei): ${amountWei}`);
        addLog(`Source EVM Address: ${substrateLinkedEvmAddress.value}`);

        try {
            const { transferToConsensus } = await import('@autonomys/auto-xdm');
            addLog('Auto-XDM precompile helper imported.');

            const browserProvider = new BrowserProvider(linkedEvmProvider.value);
            const signer = await browserProvider.getSigner(substrateLinkedEvmAddress.value);

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
    const getLinkedEvmBalance = async (evmAddress) => {
        if (!evmAddress) return;
        substrateLinkedEvmBalanceLoading.value = true;
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
            substrateLinkedEvmBalance.value = (Number(balanceWei) / Number(10n ** DECIMALS)).toFixed(4);
            addLog(`Linked EVM balance updated: ${substrateLinkedEvmBalance.value} AI3`);
        } catch (error) {
            addLog(`Error updating linked EVM balance: ${error.message}`);
            console.error('Linked EVM balance update failed:', error);
            substrateLinkedEvmBalance.value = '0'; // Reset on error
        } finally {
            substrateLinkedEvmBalanceLoading.value = false;
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
                ElNotification({
                    title: 'EVM Linking Skipped',
                    message: `The connected wallet ('${source}') is not known to expose a linked EVM address. EVM → Consensus transfers are disabled, but Consensus → EVM works.`,
                    type: 'info',
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
                substrateLinkedEvmAddress.value = evmAccounts[0];
                linkedEvmProvider.value = markRaw(evmProviderInfo.provider);
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
    const connect = async () => {
        try {
            addLog('Attempting to connect Consensus wallet...');
            await web3Enable('ai3-transfer-app');
            const allAccounts = await web3Accounts();
            if (allAccounts.length === 0) {
                addLog('No accounts found in extension');
                ElNotification({
                    title: 'No Consensus Accounts Found',
                    message: 'Please install and unlock a Substrate wallet extension (like SubWallet or Talisman), then refresh and try again.',
                    type: 'warning',
                    duration: 0,
                });
                return;
            }
            substrateAccounts.value = allAccounts;
            await activateAccount(allAccounts[0]);

            // Linked EVM discovery is best-effort: failure must not fail the
            // whole connection (C2E does not need it).
            await fetchLinkedEvmAddress(consensusAccount.value.meta.source);

            await updateBalance();
            addLog('Consensus connection successful');
            fetchTransactions();
        } catch (error) {
            console.error('Consensus connection failed:', error);
            addLog(`Consensus connection failed: ${error.message}`);
            ElNotification({
                title: 'Consensus Wallet Connection Failed',
                message: `Connection failed: ${error.message}. Please ensure the extension is installed, unlocked, and has accounts, then try again.`,
                type: 'error',
                duration: 0,
            });
            await disconnect(); // Ensure state is cleared on connection failure
        }
    };

    // Activate an extension account against the existing API (used by connect
    // and by the account selector). APIs are chain-scoped, so switching
    // accounts never recreates them — only the signer and derived state.
    const activateAccount = async (account) => {
        consensusAccount.value = account;
        const publicKey = decodeAddress(account.address);
        consensusAddress.value = encodeAddress(publicKey, AUTONOMYS_PREFIX);

        if (!consensusApi.value) {
            consensusApi.value = markRaw(await createApiInstance(CONSENSUS_RPC));
        }
        const injector = await web3FromAddress(account.address);
        if (!injector) {
            throw new Error('No injector found for address');
        }
        consensusApi.value.setSigner(injector.signer);
        addLog(`Active account: ${account.meta?.name || ''} ${consensusAddress.value}`);
    };

    // Switch the active account (account selector in the wallet panel).
    const switchAccount = async (account) => {
        if (!account || !consensusApi.value || consensusAccount.value?.address === account.address) return;
        try {
            fetchedTransactions.value = [];
            substrateLinkedEvmAddress.value = '';
            substrateLinkedEvmBalance.value = '0';
            linkedEvmProvider.value = null;
            historyStatus.value = 'idle';

            await activateAccount(account);
            await fetchLinkedEvmAddress(account.meta.source);
            await updateBalance();
            fetchTransactions();
        } catch (error) {
            addLog(`Account switch failed: ${error.message}`);
            ElNotification({
                title: 'Account Switch Failed',
                message: error.message,
                type: 'error',
                duration: 0,
            });
        }
    };

    const disconnect = async () => {
        await disconnectApis();
        consensusAccount.value = null;
        substrateAccounts.value = [];
        consensusBalance.value = 0;
        consensusAddress.value = '';
        substrateLinkedEvmAddress.value = '';
        substrateLinkedEvmBalance.value = '0';
        substrateLinkedEvmBalanceLoading.value = false;
        linkedEvmProvider.value = null;
        fetchedTransactions.value = [];
        historyStatus.value = 'idle';
        // Note: We don't clear localStorage as consensus address isn't stored there.
        addLog('Consensus wallet disconnected and state cleared.');
    };


    return {
        // State
        consensusApi,
        readOnlyConsensusApi,
        consensusAccount,
        substrateAccounts,
        consensusBalance,
        consensusBalanceLoading,
        consensusAddress,
        substrateLinkedEvmAddress,
        substrateLinkedEvmBalance,
        substrateLinkedEvmBalanceLoading,
        linkedEvmProvider,
        fetchedTransactions,
        historyStatus,
        // Actions
        connect,
        switchAccount,
        updateBalance,
        fetchTransactions,
        initReadOnlyApi,
        disconnectApis,
        disconnect,
        performConsensusTransfer,
        performEvmToConsensusTransfer,
        getLinkedEvmBalance,
    };
}
