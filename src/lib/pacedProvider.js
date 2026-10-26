// Throttled RPC providers.
//
// The public Autonomys mainnet RPCs rate-limit by request frequency: a bare
// ApiPromise.create bursts ~10 requests at init and can trip an IP ban of
// 30+ minutes (field-tested 2026-10-24/26; bans are extended by retrying
// during the ban window). Every provider must therefore pass through one
// shared pacer: min interval between requests + exponential backoff on
// transient failures.
//
// Subscription sends (WS) are paced but never retried: a retried subscribe
// would register the callback twice. Tx-pool errors ("already imported",
// "temporarily banned") are deterministic and are not retried either.

import { WsProvider, HttpProvider } from '@polkadot/api';

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Shared across every provider in the app: two API instances must never
// issue concurrent requests even if they point at different hosts.
const sharedPacer = {
  minIntervalMs: 1600,
  lastStart: 0,
  async waitTurn() {
    const gap = Date.now() - this.lastStart;
    if (gap < this.minIntervalMs) await sleep(this.minIntervalMs - gap);
    this.lastStart = Date.now();
  },
};

const isTransient = (error) => {
  const message = error?.message ?? String(error);
  // Tx-pool errors are deterministic; resubmitting only makes things worse.
  if (/banned|already imported|invalid|priority|too large|exhaust/i.test(message)) return false;
  return /HTTP|fetch|network|timeout|empty|JSON|abnormal|1006|reset|closed|connect/i.test(message) || error?.code === -32603;
};

const pacedProvider = (Base) =>
  class extends Base {
    constructor(endpoint, { maxRetries = 6 } = {}) {
      super(endpoint);
      this.maxRetries = maxRetries;
    }

    send(...args) {
      const [method, params, isCacheable, subscription] = args;
      // Subscriptions: pace only — a retried subscribe would double-register.
      if (subscription) {
        return sharedPacer.waitTurn().then(() => super.send(...args));
      }
      const attempt = async (n, delay) => {
        await sharedPacer.waitTurn();
        try {
          return await super.send(method, params, isCacheable);
        } catch (error) {
          if (n >= this.maxRetries || !isTransient(error)) throw error;
          console.warn(`[paced] ${method} attempt ${n}/${this.maxRetries} failed: ${error?.message ?? error}, retrying in ${delay}ms`);
          await sleep(delay);
          return attempt(n + 1, Math.min(delay * 2, 30000));
        }
      };
      return attempt(1, 3000);
    }
  };

export const PacedWsProvider = pacedProvider(WsProvider);
export const PacedHttpProvider = pacedProvider(HttpProvider);

// Warm-up probe: if the host currently rate-limits or bans us, fail fast here
// (with generous retries) instead of letting ApiPromise.create fire its init
// burst into the void.
export async function probeProvider(provider, { method = 'system_chain', maxRetries = 8 } = {}) {
  let delay = 5000;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    await sharedPacer.waitTurn();
    try {
      return await provider.send(method, []);
    } catch (error) {
      if (attempt >= maxRetries) throw error;
      console.warn(`[paced] probe attempt ${attempt}/${maxRetries} failed: ${error?.message ?? error}`);
      await sleep(delay);
      delay = Math.min(delay * 2, 60000);
    }
  }
}
