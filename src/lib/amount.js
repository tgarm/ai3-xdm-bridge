// Pure amount helpers (unit-tested in src/lib/amount.test.js).

import { DECIMALS } from '@/constants';

// Convert a decimal AI3 string to wei (BigInt) without floating point.
// Refuses amounts with more decimal places than the chain supports instead
// of silently truncating them.
export const parseAmountToWei = (amountStr) => {
  // Remove any commas or spaces
  const cleanAmount = amountStr.replace(/[,\s]/g, '');
  // Split by decimal point
  const parts = cleanAmount.split('.');
  if (parts.length > 2) {
    throw new Error('Invalid amount format');
  }
  const integerPart = parts[0] || '0';
  const decimalPart = parts[1] || '';

  // More decimals than the chain supports would be silently truncated —
  // refuse instead so the user can fix the input.
  if (decimalPart.length > Number(DECIMALS)) {
    throw new Error(`At most ${DECIMALS} decimal places are supported`);
  }

  // Pad decimal part to match DECIMALS
  const paddedDecimal = decimalPart.padEnd(Number(DECIMALS), '0');

  // Combine integer and decimal parts
  const fullAmountStr = integerPart + paddedDecimal;

  // Remove leading zeros
  const trimmedAmountStr = fullAmountStr.replace(/^0+/, '') || '0';

  return BigInt(trimmedAmountStr);
};
