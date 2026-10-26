export const CONSENSUS_RPC = 'wss://rpc.mainnet.autonomys.xyz/ws';
export const EVM_RPC_HTTPS = 'https://auto-evm.mainnet.autonomys.xyz/ws';
export const DOMAIN_ID = 0;
export const DECIMALS = 18n;
export const AUTONOMYS_PREFIX = 6094;
export const MIN_TRANSFER_AMOUNT = 1.0; // Minimum transfer amount in AI3
export const EVM_CHAIN_ID = 870;
export const EVM_CHAIN_NAME = 'Autonomys'; // As per Chainlist, though 'Auto-EVM' is also used.
export const EVM_NATIVE_CURRENCY = { name: 'AI3', symbol: 'AI3', decimals: 18 };
export const EVM_EXPLORER_URLS = ['https://explorer.auto-evm.mainnet.autonomys.xyz'];

// C2E arrival window: protocol docs say 100 domain blocks (~10 min), but the
// 2026-10-26 mainnet field test measured ~25 min for funds to land. 30 min
// keeps us polling long enough to see the real arrival instead of a fake failure.
export const C2E_ARRIVAL_MS = 30 * 60 * 1000;
// E2C goes through the transporter precompile and has a 1-day challenge period.
export const E2C_CHALLENGE_MS = 24 * 60 * 60 * 1000;