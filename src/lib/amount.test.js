// src/lib/amount.test.js
import { describe, it, expect } from 'vitest';
import { parseAmountToWei } from './amount';

describe('parseAmountToWei', () => {
  it('converts whole amounts', () => {
    expect(parseAmountToWei('1').toString()).toBe((10n ** 18n).toString());
    expect(parseAmountToWei('10').toString()).toBe((10n ** 19n).toString());
  });

  it('converts fractional amounts without float error', () => {
    expect(parseAmountToWei('0.000001').toString()).toBe('1000000000000');
    expect(parseAmountToWei('1.5').toString()).toBe((15n * 10n ** 17n).toString());
  });

  it('tolerates commas, spaces and leading zeros', () => {
    expect(parseAmountToWei('1,000.5').toString()).toBe((10005n * 10n ** 17n).toString());
    expect(parseAmountToWei(' 0.5 ').toString()).toBe((5n * 10n ** 17n).toString());
    expect(parseAmountToWei('001').toString()).toBe((10n ** 18n).toString());
  });

  it('supports exactly 18 decimal places', () => {
    expect(parseAmountToWei('0.123456789012345678').toString()).toBe('123456789012345678');
  });

  it('refuses more than 18 decimal places instead of truncating', () => {
    expect(() => parseAmountToWei('0.1234567890123456789')).toThrow(/18 decimal places/);
  });

  it('refuses malformed input', () => {
    expect(() => parseAmountToWei('1.0.0')).toThrow(/Invalid amount format/);
  });

  it('matches the verified XDM example: 1 AI3 → 1e18 wei', () => {
    // P2 field test: 1 AI3 transferred, 0.9999 AI3 arrived (~0.01% XDM fee)
    expect(parseAmountToWei('1').toString()).toBe('1000000000000000000');
  });
});
