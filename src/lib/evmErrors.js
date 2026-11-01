// src/lib/evmErrors.js
//
// Classify EIP-1193 wallet_switchEthereumChain failures. Wallets disagree
// on how "chain not added yet" is reported: classic MetaMask returns 4902
// at the top level, while newer and substitute wallets wrap it as -32603
// with the real code in data.originalError.code (sometimes only the
// message hints at it). Pure functions — no wallet access — so this is
// unit testable; the switch/add flow in state/evmWallet.js builds on it.

export function isChainMissingSwitchError(error) {
  if (!error) return false;
  if (error.code === 4902) return true;
  if (error?.data?.originalError?.code === 4902) return true;
  if (error.code === -32603) {
    const message = `${error?.message || ''} ${error?.data?.originalError?.message || ''}`;
    return /unrecognized|not (been )?added/i.test(message);
  }
  return false;
}

export function isUserRejectedError(error) {
  return error?.code === 4001;
}
