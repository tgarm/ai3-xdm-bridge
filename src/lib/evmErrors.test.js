// src/lib/evmErrors.test.js
//
// Error-shape coverage for the chain switch/add flow: every way an
// injected wallet reports "chain not added yet" must be recognized, and
// rejections / unrelated failures must not trigger the add-chain dialog.

import { describe, expect, it } from 'vitest';
import { isChainMissingSwitchError, isUserRejectedError } from './evmErrors';

describe('isChainMissingSwitchError', () => {
  it('accepts a top-level 4902 (classic MetaMask)', () => {
    expect(isChainMissingSwitchError({ code: 4902, message: 'Unrecognized chain.' })).toBe(true);
  });

  it('accepts a wrapped 4902 (-32603 with data.originalError.code)', () => {
    expect(
      isChainMissingSwitchError({
        code: -32603,
        message: 'Internal JSON-RPC error.',
        data: { originalError: { code: 4902, message: 'Unrecognized chain ID.' } },
      }),
    ).toBe(true);
  });

  it('accepts -32603 whose (nested) message says the chain is missing', () => {
    expect(isChainMissingSwitchError({ code: -32603, message: 'Unrecognized chain ID 0x366.' })).toBe(true);
    expect(isChainMissingSwitchError({ code: -32603, message: 'chain has not been added' })).toBe(true);
    expect(
      isChainMissingSwitchError({
        code: -32603,
        message: 'Internal JSON-RPC error.',
        data: { originalError: { message: 'Unrecognized chain.' } },
      }),
    ).toBe(true);
  });

  it('rejects unrelated failures', () => {
    expect(isChainMissingSwitchError({ code: 4001, message: 'User rejected the request.' })).toBe(false);
    expect(isChainMissingSwitchError({ code: -32603, message: 'Internal JSON-RPC error.' })).toBe(false);
    expect(isChainMissingSwitchError({ code: -32005, message: 'limit exceeded' })).toBe(false);
    expect(isChainMissingSwitchError(null)).toBe(false);
  });
});

describe('isUserRejectedError', () => {
  it('matches EIP-1193 4001 only', () => {
    expect(isUserRejectedError({ code: 4001 })).toBe(true);
    expect(isUserRejectedError({ code: -32603 })).toBe(false);
    expect(isUserRejectedError(null)).toBe(false);
  });
});
