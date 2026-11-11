/**
 * Verified allowlist for the single PAPER venue (Robinhood Chain 4663, Uniswap v3
 * WETH/USDG 0.01%). Addresses come from the backend's verified venue payload and
 * Nexus' on-chain verification; they are configuration, never market data.
 * If the API reports a different pair, the UI falls back to raw addresses.
 */
export const PAIR = {
  chainId: 4663,
  base: { address: '0x0bd7d308f8e1639fab988df18a8011f41eacad73', symbol: 'WETH', decimals: 18 },
  quote: { address: '0x5fc5360d0400a0fd4f2af552add042d716f1d168', symbol: 'USDG', decimals: 6 },
} as const;

export function symbolFor(address: string, knownAddress: string, knownSymbol: string): string {
  return address.toLowerCase() === knownAddress ? knownSymbol : shorten(address);
}

function shorten(address: string): string {
  return address.length <= 12 ? address : `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function isVerifiedPair(baseToken: string, quoteToken: string): boolean {
  const [a, b] = [baseToken.toLowerCase(), quoteToken.toLowerCase()];
  return (
    (a === PAIR.base.address && b === PAIR.quote.address) ||
    (a === PAIR.quote.address && b === PAIR.base.address)
  );
}