export const CONSENSUS_RPC = 'wss://rpc.mainnet.autonomys.xyz/ws';
export const EVM_WS_RPC = 'wss://auto-evm.mainnet.autonomys.xyz/ws';
export const DOMAIN_ID = 0;
export const DECIMALS = 18n;
export const AUTONOMYS_PREFIX = 6094;
export const MIN_TRANSFER_AMOUNT = 1.0; // Minimum transfer amount in AI3
export const EVM_CHAIN_ID = 870;
export const EVM_CHAIN_NAME = 'Autonomys';
export const EVM_NATIVE_CURRENCY = { name: 'AI3', symbol: 'AI3', decimals: 18 };
export const EVM_EXPLORER_URLS = ['https://explorer.auto-evm.mainnet.autonomys.xyz'];

const SUBSCAN_BASE = import.meta.env.DEV ? '/subscan' : 'https://autonomys.api.subscan.io';
export { SUBSCAN_BASE };