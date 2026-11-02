// src/lib/wallets.js
//
// Multi-wallet discovery for both sides, ported from the PermaDrive
// injected-wallet layer ("one button per wallet"):
//  - Consensus: the injectedWeb3 registry (the de-facto Substrate injection
//    protocol that SubWallet and Talisman implement). The polkadot.js
//    extension is deliberately NOT offered: it is a developer tool with no
//    EVM side, and SubWallet/Talisman are the supported products. The
//    protocol itself is of course still theirs.
//  - EVM: EIP-6963 wallet announcements with a legacy window.ethereum
//    fallback (brand-flag sniffing, Multi-wallet installs expose a
//    .providers array) so wallets without 6963 still appear.
// Window access is injectable so the pure decision logic is unit testable.

import { decodeAddress, encodeAddress } from '@polkadot/util-crypto';
import { AUTONOMYS_PREFIX } from '@/constants';

// extensionName → display title. Only supported products are listed.
export const CONSENSUS_WALLET_TITLES = { talisman: 'Talisman', 'subwallet-js': 'SubWallet' };

/** Discovery is read-only: enable is called only after a connect click. */
export function discoverConsensusWallets(injected) {
  const providers = injected ?? (typeof window === 'undefined' ? {} : window.injectedWeb3 ?? {});
  return Object.entries(CONSENSUS_WALLET_TITLES).flatMap(([extensionName, title]) => {
    const extension = providers[extensionName];
    return typeof extension?.enable === 'function' ? [{ extensionName, title, extension }] : [];
  });
}

// Only valid AccountId32 accounts are usable on the consensus side: mixed
// wallets also expose EVM (type 'ethereum', 0x…) and malformed accounts, and
// one bad account must not prevent the valid ones. Addresses are re-encoded
// to the Autonomys prefix and deduplicated by public key.
export function consensusAccounts(raw) {
  const accounts = new Map();
  for (const account of Array.isArray(raw) ? raw : []) {
    if (account?.type === 'ethereum' || typeof account?.address !== 'string') continue;
    try {
      const key = decodeAddress(account.address);
      if (key.length !== 32) continue;
      const address = encodeAddress(key, AUTONOMYS_PREFIX);
      if (!accounts.has(address)) accounts.set(address, { ...account, address });
    } catch {
      // Ignore unsupported accounts, not the entire connection.
    }
  }
  return [...accounts.values()];
}

// window.ethereum has no standard shape (each wallet injects its own).
const legacyProviders = (win) => {
  const eth = win.ethereum;
  if (!eth) return [];
  if (Array.isArray(eth.providers) && eth.providers.length > 0) return eth.providers;
  return [eth];
};

// Legacy brand flags → display name. Order is priority: dedicated flags
// first, isMetaMask last — many wallets set it for compatibility (Rabby and
// SubWallet set both theirs and MetaMask's).
const BRAND_FLAGS = [
  ['isRabby', 'Rabby'],
  ['isSubWallet', 'SubWallet'],
  ['isCoinbaseWallet', 'Coinbase Wallet'],
  ['isPhantom', 'Phantom'],
  ['isTrust', 'Trust Wallet'],
  ['isBraveWallet', 'Brave Wallet'],
  ['isOKExWallet', 'OKX'],
  ['isOkxWallet', 'OKX'],
  ['isTokenPocket', 'Token Pocket'],
  ['isBitKeep', 'BitKeep'],
  ['isMetaMask', 'MetaMask'],
];

const brandName = (provider) => {
  for (const [flag, name] of BRAND_FLAGS) {
    if (provider[flag] === true) return name;
  }
  return undefined;
};

// EIP-6963 discovery + legacy fallback, unified into a wallet list. Request
// announcements, wait briefly (wallets answer the request asynchronously);
// falls back to window.ethereum when nothing announces.
export async function discoverEvmWallets({ win = typeof window === 'undefined' ? undefined : window, timeoutMs = 500 } = {}) {
  if (!win) return [];
  const found = new Map();
  const onAnnounce = (event) => {
    const detail = event.detail;
    const info = detail?.info;
    if (!info?.uuid || !info.name || !detail?.provider) return;
    if (found.has(info.uuid)) return;
    found.set(info.uuid, { name: info.name, label: info.name, provider: detail.provider });
  };
  win.addEventListener('eip6963:announceProvider', onAnnounce);
  // A real Event is required — browsers reject plain objects.
  win.dispatchEvent(new Event('eip6963:requestProvider'));
  await new Promise((resolve) => setTimeout(resolve, timeoutMs));
  win.removeEventListener('eip6963:announceProvider', onAnnounce);
  if (found.size > 0) return [...found.values()];
  return legacyProviders(win).map((provider) => {
    const name = brandName(provider);
    return name
      ? { name, label: name, provider }
      : { name: 'Injected Wallet', label: 'injected', provider };
  });
}

