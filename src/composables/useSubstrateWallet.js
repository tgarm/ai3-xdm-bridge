import { ref, markRaw } from 'vue';
import { web3Accounts, web3Enable, web3FromAddress } from '@polkadot/extension-dapp';
import { ApiPromise, WsProvider } from '@polkadot/api';  // Back to direct for control
import { decodeAddress, encodeAddress } from '@polkadot/util-crypto';
import { CONSENSUS_RPC, AUTONOMYS_PREFIX, DECIMALS, LOCAL_STORAGE_KEY_CONSENSUS, SUBSCAN_BASE } from '@/constants';

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

    // Initialize from localStorage
    const initFromStorage = () => {
        const storedConsensus = localStorage.getItem(LOCAL_STORAGE_KEY_CONSENSUS);
        if (storedConsensus) {
            consensusAddress.value = storedConsensus;
            addLog(`Loaded consensus address from localStorage: ${consensusAddress.value}`);
        }
    };

    initFromStorage();

    // Helper: Create API instance (shared for read-only/signed)
    const createApiInstance = async (isSigned = false) => {
        try {
            const provider = new WsProvider(CONSENSUS_RPC);  // Mainnet RPC
            const apiInstance = await ApiPromise.create({provider});
            const metadata = await apiInstance.rpc.state.getMetadata();
            apiInstance.registry.setMetadata(metadata);
            addLog('Metadata refreshed for custom types');
            await apiInstance.isReady;

            /*      
                  // Refresh metadata to ensure runtime types (Domains pallet)
                  const metadata = await apiInstance.rpc.state.getMetadata();
                  apiInstance.registry.setMetadata(metadata);
            
                  // Verify key type
                  if (apiInstance.registry.get('SpDomainsChainId')) {
                    addLog(`${isSigned ? 'Signed' : 'Read-only'} Consensus API: SpDomainsChainId registered via custom types`);
                  } else {
                    addLog(`Warning: SpDomainsChainId not fully resolved`);
                  }
            */
            return markRaw(apiInstance);
        } catch (error) {
            addLog(`Error creating API instance: ${error.message}`);
            throw error;
        }
    };

    // Create read-only API if address set
    const initReadOnlyApi = async () => {
        if (consensusAddress.value && !readOnlyConsensusApi.value) {
            try {
                readOnlyConsensusApi.value = await createApiInstance(false);
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
            localStorage.setItem(LOCAL_STORAGE_KEY_CONSENSUS, consensusAddress.value);
            addLog(`Consensus address set: ${consensusAddress.value}`);

            // Create signed API with custom types (Mainnet)
            consensusApi.value = await createApiInstance(true);
            await consensusApi.value.isReady;
            // Attach extension signer
            const injector = await web3FromAddress(consensusAccount.value.address);
            if (!injector) {
                throw new Error('No injector found for address');
            }
            consensusApi.value.setSigner(injector.signer);

            addLog('Consensus signed API ready with custom types (Mainnet)');
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
    };
}