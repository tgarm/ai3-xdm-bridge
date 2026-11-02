// src/lib/wallets.test.js
//
// Multi-wallet discovery: only valid AccountId32 consensus accounts survive
// the filter; injectedWeb3 discovery lists exactly the supported products;
// EVM discovery collects 6963 announcements and falls back to the legacy
// window.ethereum shapes.

import { describe, expect, it } from 'vitest';
import { encodeAddress } from '@polkadot/util-crypto';
import { consensusAccounts, discoverConsensusWallets, discoverEvmWallets } from './wallets';

// A well-known 32-byte account (Alice on prefix 42) — the filter re-encodes
// it to the Autonomys prefix.
const ALICE_42 = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY';
const ALICE_6094 = encodeAddress(ALICE_42, 6094);

describe('consensusAccounts', () => {
  it('keeps valid AccountId32 accounts and re-encodes to the Autonomys prefix', () => {
    const out = consensusAccounts([{ address: ALICE_42, name: 'Alice' }]);
    expect(out).toHaveLength(1);
    expect(out[0].address).toBe(ALICE_6094);
    expect(out[0].name).toBe('Alice');
  });

  it('filters EVM accounts and short keys', () => {
    const out = consensusAccounts([
      { address: '0x47cE1B1A2D6bB34FdBaf0a772694f72bA3d0668e', type: 'ethereum' },
      { address: '0x47cE1B1A2D6bB34FdBaf0a772694f72bA3d0668e' },
      { address: 'garbage' },
    ]);
    expect(out).toHaveLength(0);
  });

  it('deduplicates the same key presented on different prefixes', () => {
    const out = consensusAccounts([
      { address: ALICE_42, name: 'Alice' },
      { address: ALICE_6094, name: 'Alice' },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].address).toBe(ALICE_6094);
  });

  it('treats non-arrays as empty', () => {
    expect(consensusAccounts(undefined)).toEqual([]);
    expect(consensusAccounts(null)).toEqual([]);
  });
});

describe('discoverConsensusWallets', () => {
  it('lists exactly the supported products that are installed and enable-able', () => {
    const out = discoverConsensusWallets({
      talisman: { enable: () => {} },
      'subwallet-js': { enable: () => {} },
      'polkadot-js': { enable: () => {} }, // installed but deliberately not offered
      phantom: { enable: () => {} }, // not a Substrate wallet
    });
    expect(out.map((w) => w.extensionName)).toEqual(['talisman', 'subwallet-js']);
    expect(out.map((w) => w.title)).toEqual(['Talisman', 'SubWallet']);
  });

  it('skips entries without an enable function', () => {
    const out = discoverConsensusWallets({ talisman: {} });
    expect(out).toHaveLength(0);
  });
});

// Minimal fake window: records 6963 listeners and replays announcements on
// the request event, synchronously.
function fakeWindow({ announcements = [], ethereum } = {}) {
  const listeners = {};
  return {
    ethereum,
    addEventListener(type, fn) {
      (listeners[type] ??= []).push(fn);
    },
    removeEventListener(type, fn) {
      listeners[type] = (listeners[type] || []).filter((f) => f !== fn);
    },
    dispatchEvent(event) {
      if (event.type === 'eip6963:requestProvider') {
        for (const fn of listeners['eip6963:announceProvider'] || []) {
          for (const detail of announcements) fn({ detail });
        }
      }
      return true;
    },
  };
}

describe('discoverEvmWallets', () => {
  it('collects 6963 announcements and dedupes by uuid', async () => {
    const win = fakeWindow({
      announcements: [
        { info: { uuid: 'a', name: 'MetaMask', rdns: 'io.metamask' }, provider: { tag: 'mm' } },
        { info: { uuid: 'b', name: 'Phantom', rdns: 'app.phantom' }, provider: { tag: 'ph' } },
        { info: { uuid: 'a', name: 'MetaMask', rdns: 'io.metamask' }, provider: { tag: 'mm-dupe' } },
        { info: { name: 'NoUuid' }, provider: {} },
      ],
    });
    const out = await discoverEvmWallets({ win, timeoutMs: 10 });
    expect(out.map((w) => w.name)).toEqual(['MetaMask', 'Phantom']);
    expect(out[0].provider).toEqual({ tag: 'mm' });
  });

  it('falls back to the legacy providers array with brand names', async () => {
    const rabby = { isRabby: true, isMetaMask: true };
    const metamask = { isMetaMask: true };
    const win = fakeWindow({ ethereum: { providers: [rabby, metamask] } });
    const out = await discoverEvmWallets({ win, timeoutMs: 10 });
    expect(out.map((w) => w.name)).toEqual(['Rabby', 'MetaMask']);
    expect(out.map((w) => w.label)).toEqual(['Rabby', 'MetaMask']);
  });

  it('labels an unidentified legacy provider generically', async () => {
    const win = fakeWindow({ ethereum: { request: () => {} } });
    const out = await discoverEvmWallets({ win, timeoutMs: 10 });
    expect(out).toHaveLength(1);
    expect(out[0].label).toBe('injected');
  });

  it('returns empty without any wallet', async () => {
    expect(await discoverEvmWallets({ win: fakeWindow(), timeoutMs: 10 })).toEqual([]);
    expect(await discoverEvmWallets({ win: undefined })).toEqual([]);
  });
});
