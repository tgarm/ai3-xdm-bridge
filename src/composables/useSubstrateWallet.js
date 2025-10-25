// src/composables/useSubstrateWallet.js (Fixed with markRaw + dynamic SDK import)
import { ref, markRaw } from 'vue'; // ADDED: markRaw to skip reactivity on ApiPromise
import { web3Accounts, web3Enable, web3FromAddress } from '@polkadot/extension-dapp';
import { ElNotification } from 'element-plus';
import { ApiPromise, WsProvider } from '@polkadot/api'; // ADDED: ethers for balance
import { ethers } from 'ethers';
import { decodeAddress, encodeAddress } from '@polkadot/util-crypto';
// REMOVED: Static import of transferToDomainAccount20Type (revert to dynamic)
import { CONSENSUS_RPC, AUTONOMYS_PREFIX, DECIMALS, SUBSCAN_BASE, DOMAIN_ID, EVM_RPC } from '@/constants';

export function useSubstrateWallet(addLog) {
    // Substrate State
    const consensusApi = ref(null); // Signed API
    const readOnlyConsensusApi = ref(null); // Read-only API
    const consensusAccount = ref(null);
    const consensusBalance = ref(0);
    const consensusBalanceLoading = ref(false);
    const consensusAddress = ref('');
    const substrateLinkedEvmAddress = ref(''); // ADDED: To store the EVM address from the Substrate wallet
    const substrateLinkedEvmBalance = ref('0'); // ADDED: To store the linked EVM address balance
    const substrateLinkedEvmBalanceLoading = ref(false); // ADDED: Loading state for linked EVM balance
    const fetchedTransactions = ref([]); // Consensus transporter transfers

    // Cleanup function (unchanged)
    const disconnectApis = async () => {
        if (consensusApi.value) {
            await consensusApi.value.disconnect();
            consensusApi.value = null;
        }
        if (readOnlyConsensusApi.value) {
            await readOnlyConsensusApi.value.disconnect();
            readOnlyConsensusApi.value = null;
        }
        addLog('APIs disconnected');
    };

    // Reusable helper to wait for API readiness (unchanged)
    const waitForReady = async (api) => {
        try {
            await api.isReady;
            addLog('API ready (standard)');
            return;
        } catch (error) {
            console.warn('Standard isReady failed (expected in prod):', error.message);
            
            if (error.message.includes('#isReadyPromise') || error.message.includes('private member')) {
                addLog('Using ready event fallback...');
                await new Promise((resolve, reject) => {
                    const timeout = setTimeout(() => {
                        api.off('ready', handleReady);
                        api.off('disconnected', handleDisconnect);
                        reject(new Error('API readiness timeout (10s)'));
                    }, 10000);

                    const handleReady = () => {
                        clearTimeout(timeout);
                        api.off('ready', handleReady);
                        api.off('disconnected', handleDisconnect);
                        addLog('API ready (fallback)');
                        resolve();
                    };

                    const handleDisconnect = () => {
                        clearTimeout(timeout);
                        api.off('ready', handleReady);
                        reject(new Error('Disconnected before ready'));
                    };

                    api.on('ready', handleReady);
                    api.on('disconnected', handleDisconnect);

                    if (api.isConnected && api.registry?.isReady) { // Safe: Direct access post-markRaw
                        clearTimeout(timeout);
                        api.off('ready', handleReady);
                        addLog('API ready (immediate check)');
                        resolve();
                    }
                });
            } else {
                console.error('API readiness failed (non-proxy):', error);
                throw error;
            }
        }
    };

    async function createApiInstance(rpcUrl) {
        try {
            addLog('Creating API instance...');
            const provider = new WsProvider(rpcUrl);

            // --- Event-driven connection handling ---
            // Listen for disconnection events to reset the wallet state globally.
            provider.on('disconnected', async () => {
                addLog(`API-WS: disconnected from ${rpcUrl}. Resetting wallet state.`);
                // This ensures that if the websocket drops for any reason, the UI
                // reflects the disconnected state, allowing the user to reconnect.
                await disconnect();
            });

            provider.on('connected', () => {
                addLog(`API-WS: successfully connected to ${rpcUrl}.`);
            });
            // --- End event handling ---

            const apiInstance = await ApiPromise.create({
                provider,
                types: {
                    // Core types from SDK/docs + fix for SpDomainsChainId
                    AccountId20: '[u8;20]',
                    DomainId: 'u32',
                    ChainId: 'u32',
                    SpDomainsChainId: 'u32', // Registers the missing type (u32 alias)
                    // XCM for dest if needed by SDK internals
                    MultiLocation: {
                        parents: 'u8',
                        interior: 'Junctions'
                    },
                    Junctions: {
                        _enum: {
                            Here: null,
                            X1: 'Junction'
                        }
                    },
                    Junction: {
                        _enum: {
                            AccountId20: 'AccountId20'
                        }
                    }
                }
            });

            // Refresh metadata (critical for runtime types)
            const metadata = await apiInstance.rpc.state.getMetadata();
            apiInstance.registry.setMetadata(metadata);
            addLog('Metadata refreshed for mainnet custom types');

            await waitForReady(apiInstance);

            // Validate chain
            const chain = await apiInstance.rpc.system.chain();
            const expectedName = 'Autonomys Mainnet';
            addLog(`Connected to ${chain} (expected: ${expectedName})`);

            // Verify SDK-required types
            if (apiInstance.registry.get('SpDomainsChainId') && apiInstance.registry.get('AccountId20')) {
                addLog('SDK types (SpDomainsChainId, AccountId20) registered successfully');
            } else {
                throw new Error('SDK type registration failed');
            }

            return apiInstance;
        } catch (error) {
            addLog(`Error creating API: ${error.message}`);
            // If API creation fails (e.g., WebSocket error), reset state
            await disconnect();
            throw error;
        }
    }

    // Create read-only API if address set
    const initReadOnlyApi = async () => {
        if (consensusAddress.value && !readOnlyConsensusApi.value) {
            try {
                const rawApi = await createApiInstance(CONSENSUS_RPC);
                readOnlyConsensusApi.value = markRaw(rawApi); // ADDED: markRaw to prevent Vue reactivity proxy
                addLog('Read-only Consensus API initialized with custom types (Mainnet)');

                // Initial fetches after API is ready
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

    // Fetch transactions (unchanged)
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
                        const expectedArrival = destAccount.startsWith('0x') ? new Date(transferTime.getTime() + 10 * 60 * 1000).toISOString() : null;
                        const direction = destAccount.startsWith('0x') ? 'consensusToEVM' : 'consensusToConsensus';

                        // Log detailed information to page via addLog only for new
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
            addLog(`Error fetching Consensus extrinsics via Subscan V2: ${error.message}`);
        }
    };

    // Perform Consensus to EVM transfer (reverted to dynamic import + safe inspect)
    const performConsensusTransfer = async (evmAddress, amountWei, onStatusUpdate) => {
        if (!consensusApi.value) {
            throw new Error('Consensus API not initialized');
        }

        // Inspect logging with safe readiness check (unchanged)
        addLog(`=== Transfer Initialization Inspect ===`);
        addLog(`Consensus API exists: ${!!consensusApi.value}`);
        addLog(`Consensus API ready: ${consensusApi.value?.isConnected && consensusApi.value?.registry?.isReady ? 'yes' : 'no'}`);
        addLog(`API registry has SpDomainsChainId: ${!!consensusApi.value?.registry?.get('SpDomainsChainId')}`);
        addLog(`API registry has AccountId20: ${!!consensusApi.value?.registry?.get('AccountId20')}`);
        addLog(`API registry has DomainId: ${!!consensusApi.value?.registry?.get('DomainId')}`);
        addLog(`DOMAIN_ID value/type: ${DOMAIN_ID} (${typeof DOMAIN_ID})`);
        addLog(`EVM address: ${evmAddress} (type: ${typeof evmAddress})`);
        addLog(`Amount Wei: ${amountWei} (type: ${typeof amountWei})`);
        addLog(`Consensus account address: ${consensusAccount.value?.address || 'N/A'}`);
        addLog(`Consensus encoded address: ${consensusAddress.value || 'N/A'}`);
        addLog(`Signer attached: ${!!consensusApi.value?._signer}`);
        addLog(`============================`);

        try {
            // REVERTED: Dynamic import to delay SDK bundling (avoids early registry access)
            const { transferToDomainAccount20Type } = await import('@autonomys/auto-xdm');
            addLog('Auto-XDM SDK imported dynamically');

            // Pass markRaw-wrapped api (safe for SDK's registry access)
            const tx = await transferToDomainAccount20Type(consensusApi.value, DOMAIN_ID, evmAddress, amountWei.toString());
            const extrinsicHash = tx.hash.toHex();
            addLog('Transfer extrinsic prepared via SDK');

            addLog('Signing and sending transaction... (check extension for signature prompt)');
            const unsubscribe = await tx.signAndSend(consensusAccount.value.address, ({ status }) => {
                const statusMsg = `Transaction status: ${status.type}`;
                addLog(statusMsg);
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
            return { unsubscribe, hash: extrinsicHash };
        } catch (error) {
            addLog(`SDK transfer failed: ${error.message}`);
            console.error('SDK transfer error:', error);
            throw error;
        }
    };

    // --- ADDED: Function to get linked EVM balance ---
    const getLinkedEvmBalance = async (evmAddress) => {
        if (!evmAddress) return;
        substrateLinkedEvmBalanceLoading.value = true;
        try {
            // Use a read-only provider for balance checks
            const provider = new ethers.getDefaultProvider(EVM_RPC);
            const balanceWei = await provider.getBalance(evmAddress);
            const balanceEther = ethers.formatUnits(balanceWei, DECIMALS);
            substrateLinkedEvmBalance.value = parseFloat(balanceEther).toFixed(4);
            addLog(`Linked EVM balance updated: ${substrateLinkedEvmBalance.value} AI3`);
        } catch (error) {
            addLog(`Error updating linked EVM balance: ${error.message}`);
            console.error('Linked EVM balance update failed:', error);
            substrateLinkedEvmBalance.value = '0'; // Reset on error
        } finally {
            substrateLinkedEvmBalanceLoading.value = false;
        }
    };

    // --- ADDED: Local function to get linked EVM address ---
    const fetchLinkedEvmAddress = async (source, api) => {
        try {
            addLog('Attempting to find linked EVM address...');
            let walletEVMName = '';
            if (source === 'subwallet-js') {
                walletEVMName = 'SubWallet';
            } else if (source === 'talisman') {
                walletEVMName = 'Talisman';
            }

            if (!walletEVMName) {
                addLog(`Wallet source '${source}' is not configured for EVM address discovery.`);
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
                addLog(`Could not find an EVM provider for ${walletEVMName}.`);
                return;
            }

            const evmAccounts = await evmProviderInfo.provider.request({ method: 'eth_requestAccounts' });
            if (evmAccounts && evmAccounts.length > 0) {
                substrateLinkedEvmAddress.value = evmAccounts[0];
                addLog(`Successfully retrieved linked EVM address: ${evmAccounts[0]}`);
                await getLinkedEvmBalance(evmAccounts[0]); // Fetch balance for the linked address
            } else {
                addLog(`EVM provider for ${walletEVMName} did not return any accounts.`);
            }
        } catch (evmError) {
            addLog(`Could not get linked EVM address: ${evmError.message}`);
        }
    };

    // Connect Consensus wallet (updated with markRaw)
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
            consensusAccount.value = allAccounts[0];

            const publicKey = decodeAddress(consensusAccount.value.address);
            consensusAddress.value = encodeAddress(publicKey, AUTONOMYS_PREFIX);

            // Create signed API with custom types (Mainnet)
            const rawApi = await createApiInstance(CONSENSUS_RPC);
            consensusApi.value = markRaw(rawApi); // ADDED: markRaw to prevent Vue reactivity proxy on ApiPromise
            // Readiness covered by createApiInstance

            await fetchLinkedEvmAddress(consensusAccount.value.meta.source, consensusApi.value);
            // Attach extension signer
            const injector = await web3FromAddress(consensusAccount.value.address);
            if (!injector) {
                throw new Error('No injector found for address');
            }
            consensusApi.value.setSigner(injector.signer);

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

    const disconnect = async () => {
        await disconnectApis();
        consensusAccount.value = null;
        consensusBalance.value = 0;
        consensusAddress.value = '';
        substrateLinkedEvmAddress.value = ''; // ADDED: Clear the linked EVM address on disconnect
        substrateLinkedEvmBalance.value = '0'; // ADDED: Clear the linked EVM balance
        substrateLinkedEvmBalanceLoading.value = false;
        fetchedTransactions.value = [];
        // Note: We don't clear localStorage as consensus address isn't stored there.
        addLog('Consensus wallet disconnected and state cleared.');
    };


    return {
        // State
        consensusApi,
        readOnlyConsensusApi,
        consensusAccount,
        consensusBalance,
        consensusBalanceLoading,
        consensusAddress,
        substrateLinkedEvmAddress, // EXPOSED: Make the address available to components
        substrateLinkedEvmBalance, // EXPOSED: Make the balance available
        substrateLinkedEvmBalanceLoading, // EXPOSED: Make the loading state available
        fetchedTransactions,
        // Actions
        connect,
        updateBalance,
        fetchTransactions,
        initReadOnlyApi,
        disconnectApis,
        disconnect,
        performConsensusTransfer,
    };
}