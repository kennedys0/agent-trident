import type { ChainClient } from './client.js';
import type { AssetIdentity, PoolIdentity, Venue } from '../domain/types.js';

/**
 * Single verified venue. Addresses come from the official Uniswap deployment
 * list and were confirmed on chain before this file was written; the boot
 * check re-derives the pool from the factory so a wrong entry cannot survive.
 */
export const VERIFIED_VENUE: Venue = {
  id: 'uniswap-v3-robinhood',
  chainId: 4663,
  factory: '0x1f7d7550b1b028f7571e69a784071f0205fd2efa',
  quoterV2: '0x33e885ed0ec9bf04ecfb19341582aadcb4c8a9e7',
  swapRouter02: '0xcaf681a66d020601342297493863e78c959e5cb2',
  provenance:
    'https://docs.uniswap.org/docs/protocols/v3/deployments/v3-robinhood-chain-deployments and https://docs.robinhood.com/chain/contracts',
};

export const WETH: AssetIdentity = {
  id: 'WETH',
  symbol: 'WETH',
  address: '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73',
  decimals: 18,
};

export const USDG: AssetIdentity = {
  id: 'USDG',
  symbol: 'USDG',
  address: '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168',
  decimals: 6,
};

export const VERIFIED_FEE = 100;
export const VERIFIED_TICK_SPACING = 1;
export const EXPECTED_POOL: `0x${string}` = '0x52e65b17fb6e5ba00ed806f37afcd2daa50271ca';

export class VenueVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VenueVerificationError';
  }
}

export type VerifiedVenue = {
  readonly venue: Venue;
  readonly pool: PoolIdentity;
};

function sameAddress(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/**
 * Proves at boot that the allowlist still matches reality: the factory returns
 * the expected pool, the pool orders the expected tokens, and token metadata
 * matches. Any mismatch aborts startup instead of trading on stale addresses.
 */
export async function verifyVenue(chain: ChainClient): Promise<VerifiedVenue> {
  if ((await chain.getCodeSize(VERIFIED_VENUE.factory)) === 0) {
    throw new VenueVerificationError('Uniswap v3 factory has no code on chain 4663');
  }
  if ((await chain.getCodeSize(VERIFIED_VENUE.quoterV2)) === 0) {
    throw new VenueVerificationError('QuoterV2 has no code on chain 4663');
  }

  const derived = await chain.getPool(VERIFIED_VENUE.factory, WETH.address, USDG.address, VERIFIED_FEE);
  if (!sameAddress(derived, EXPECTED_POOL)) {
    throw new VenueVerificationError(`Factory returned pool ${derived}, expected ${EXPECTED_POOL}`);
  }

  const state = await chain.readPoolState(derived, (await chain.getHead()).number);
  const token0 = sameAddress(state.token0, WETH.address) ? WETH : sameAddress(state.token0, USDG.address) ? USDG : null;
  const token1 = sameAddress(state.token1, WETH.address) ? WETH : sameAddress(state.token1, USDG.address) ? USDG : null;
  if (token0 === null || token1 === null) {
    throw new VenueVerificationError('Pool tokens do not match the WETH/USDG allowlist');
  }
  if (token0.id === token1.id) {
    throw new VenueVerificationError('Pool reports the same token twice');
  }

  for (const asset of [WETH, USDG]) {
    const [symbol, decimals] = [await chain.readSymbol(asset.address), await chain.readDecimals(asset.address)];
    if (symbol !== asset.symbol) {
      throw new VenueVerificationError(`Token ${asset.address} symbol ${symbol} does not match ${asset.symbol}`);
    }
    if (decimals !== asset.decimals) {
      throw new VenueVerificationError(`Token ${asset.address} decimals ${decimals} does not match ${asset.decimals}`);
    }
  }

  return {
    venue: VERIFIED_VENUE,
    pool: {
      id: derived,
      venueId: VERIFIED_VENUE.id,
      token0,
      token1,
      fee: VERIFIED_FEE,
      tickSpacing: VERIFIED_TICK_SPACING,
    },
  };
}