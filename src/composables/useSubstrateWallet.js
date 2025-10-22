// src/composables/useSubstrateWallet.js
import { ref, markRaw } from 'vue';
import { web3Accounts, web3Enable, web3FromAddress } from '@polkadot/extension-dapp';
import { ApiPromise, WsProvider } from '@polkadot/api';  // Back to direct for control
import { decodeAddress, encodeAddress } from '@polkadot/util-crypto';
import { CONSENSUS_RPC, AUTONOMYS_PREFIX, DECIMALS, SUBSCAN_BASE, DOMAIN_ID } from '@/constants';

export function useSubstrateWallet(addLog) {
    // Substrate State
    const consensusApi = ref(null); // Signed API
    const readOnlyConsensusApi = ref(null); // Read-only API
    const consensusAccount = ref(null);
    const consensusBalance = ref(0);
    const consensusBalanceLoading = ref(false);
    const consensusAddress = ref('');
    const fetchedTransactions = ref([]); // Consensus transporter transfers

    // Cleanup function (call on unmount)
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

    async function createApiInstance(rpcUrl) {
        try {
            addLog('Creating API instance...');
            const provider = new WsProvider(rpcUrl);
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

            await apiInstance.isReady;

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
            throw error;
        }
    }

    // Create read-only API if address set
    const initReadOnlyApi = async () => {
        if (consensusAddress.value && !readOnlyConsensusApi.value) {
            try {
                readOnlyConsensusApi.value = await createApiInstance(CONSENSUS_RPC);
                addLog('Read-only Consensus API initialized with custom types (Mainnet)');

                // Initial fetches after API is ready
                await updateBalance();
                await fetchTransactions();
            } catch (error) {
                addLog(`Error initializing read-only Consensus API: ${error.message}`);
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
                //console.log('Subscan Extrinsics Response (page ' + page + '):', JSON.stringify(data, null, 2));
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

            // Use consistent decimals for calculations
            const decimals = Number(10n ** DECIMALS);

            // Fetch details using Polkadot API
            for (const tx of transporterTxs) {
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
                        const destAccount = args.account || '';
                        const domainId = args.domainId || '';

                        // Log detailed information to page via addLog
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
                            direction: destAccount.startsWith('0x') ? 'consensusToEVM' : 'consensusToConsensus',
                            tip: tx.tip || '0',
                            nonce: tx.nonce,
                            success: tx.success,
                            fee: (Number(tx.fee || 0) / decimals).toFixed(6),
                            timestamp: new Date(tx.block_timestamp * 1000).toISOString(),
                            finalized: tx.finalized,
                        });
                    }
                } catch (detailError) {
                    addLog(`Error fetching details for tx ${tx.extrinsic_hash}: ${detailError.message}`);
                }
            }

            fetchedTransactions.value.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
            addLog(`Processed ${fetchedTransactions.value.length} Consensus transporter transfers`);
        } catch (error) {
            addLog(`Error fetching Consensus extrinsics via Subscan V2: ${error.message}`);
        }
    };

    // Perform Consensus to EVM transfer (moved here for substrate-specific isolation)
    const performConsensusTransfer = async (evmAddress, amountWei, onStatusUpdate) => {
        if (!consensusApi.value) {
            throw new Error('Consensus API not initialized');
        }

        // Inspect logging before SDK call
        addLog(`=== Transfer Initialization Inspect ===`);
        addLog(`Consensus API exists: ${!!consensusApi.value}`);
        addLog(`Consensus API ready: ${consensusApi.value?.isReady ? 'yes' : 'no'}`);
        addLog(`API registry has SpDomainsChainId: ${!!consensusApi.value.registry.get('SpDomainsChainId')}`);
        addLog(`API registry has AccountId20: ${!!consensusApi.value.registry.get('AccountId20')}`);
        addLog(`API registry has DomainId: ${!!consensusApi.value.registry.get('DomainId')}`);
        addLog(`DOMAIN_ID value/type: ${DOMAIN_ID} (${typeof DOMAIN_ID})`);
        addLog(`EVM address: ${evmAddress} (type: ${typeof evmAddress})`);
        addLog(`Amount Wei: ${amountWei} (type: ${typeof amountWei})`);
        addLog(`Consensus account address: ${consensusAccount.value?.address || 'N/A'}`);
        addLog(`Consensus encoded address: ${consensusAddress.value || 'N/A'}`);
        addLog(`Signer attached: ${!!consensusApi.value._signer}`);
        addLog(`============================`);

        try {
            // Dynamic import of SDK (mimic test.html to isolate bundling issues)
            const { transferToDomainAccount20Type } = await import('@autonomys/auto-xdm');
            addLog('Auto-XDM SDK imported dynamically');

            const tx = await transferToDomainAccount20Type(consensusApi.value, DOMAIN_ID, evmAddress, amountWei.toString());
            addLog('Transfer extrinsic prepared via SDK');

            addLog('Signing and sending transaction... (check extension for signature prompt)');
            const unsubscribe = await tx.signAndSend(consensusAccount.value.address, ({ status }) => {
                const statusMsg = `Transaction status: ${status.type}`;
                addLog(statusMsg);
                onStatusUpdate?.(status);

                if (status.isInBlock) {
                    addLog('Transaction in block');
                }
                if (status.isFinalized) {
                    addLog('Substrate transaction finalized');
                    unsubscribe();
                }
                if (status.isRetracted) {
                    addLog('Transaction retracted');
                    unsubscribe();
                }
                if (status.isFinalityTimeout) {
                    addLog('Transaction finality timeout - may finalize later');
                    unsubscribe();
                }
            });
            addLog('signAndSend initiated (unsubscribe ready)');
            return unsubscribe;  // Return for potential external cleanup
        } catch (error) {
            addLog(`SDK transfer failed: ${error.message}`);
            console.error('SDK transfer error:', error);
            throw error;
        }
    };

    // Connect Consensus wallet (creates signed API with types)
    const connect = async () => {
        try {
            addLog('Attempting to connect Consensus wallet...');
            await web3Enable('ai3-transfer-app');
            const allAccounts = await web3Accounts();
            if (allAccounts.length === 0) {
                alert('No accounts found. Install/Unlock SubWallet or Talisman.');
                addLog('No accounts found in extension');
                return;
            }
            consensusAccount.value = allAccounts[0];

            const publicKey = decodeAddress(consensusAccount.value.address);
            consensusAddress.value = encodeAddress(publicKey, AUTONOMYS_PREFIX);

            // Create signed API with custom types (Mainnet)
            consensusApi.value = await createApiInstance(CONSENSUS_RPC);
            await consensusApi.value.isReady;
            // Attach extension signer
            const injector = await web3FromAddress(consensusAccount.value.address);
            if (!injector) {
                throw new Error('No injector found for address');
            }
            consensusApi.value.setSigner(injector.signer);

            await updateBalance();
            await fetchTransactions();
            addLog('Consensus connection successful');
        } catch (error) {
            console.error('Consensus connection failed:', error);
            addLog(`Consensus connection failed: ${error.message}`);
            alert('Connection failed: ' + error.message);
        }
    };

    return {
        // State
        consensusApi,
        readOnlyConsensusApi,
        consensusAccount,
        consensusBalance,
        consensusBalanceLoading,
        consensusAddress,
        fetchedTransactions,
        // Actions
        connect,
        updateBalance,
        fetchTransactions,
        initReadOnlyApi,
        disconnectApis,
        performConsensusTransfer,  // New: Substrate-specific transfer handler
    };
}