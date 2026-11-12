/**
 * Codec for Uniswap v3 PoolCreated events on Robinhood Chain 4663.
 * Decode is pure: validation happens in the discovery service so unit tests
 * can inject malformed logs without touching the network.
 */

export const POOL_CREATED_TOPIC =
  '0x783cca1c0412dd0d695e784568c96da2e9c22ff989357a2e8b1d9b2b4e6b7118' as const;

export type PoolCreatedEvent = {
  readonly token0: string;
  readonly token1: string;
  readonly fee: number;
  readonly tickSpacing: number;
  readonly pool: string;
};

export type RawLog = {
  readonly address: string;
  readonly topics: readonly string[];
  readonly data: string;
  readonly blockNumber: number;
  readonly transactionHash: string;
  readonly logIndex: number;
};

/** Uniswap v3's PoolCreated indexes token0, token1 and fee; the rest is data. */

const addressFromPaddedTopic = (topic: string): string => {
  if (!/^0x[0-9a-fA-F]{64}$/.test(topic)) {
    throw new Error('topic is not a 32-byte word');
  }
  // Addresses are the last 20 bytes of a padded topic.
  return `0x${topic.slice(-40)}`.toLowerCase();
};

const wordAt = (data: string, offsetBytes: number): string => {
  const hex = data.startsWith('0x') ? data.slice(2) : data;
  if (hex.length < offsetBytes * 2 + 64) {
    throw new Error('event data is shorter than expected');
  }
  return `0x${hex.slice(offsetBytes * 2, offsetBytes * 2 + 64)}`;
};

/**
 * Decodes PoolCreated(address indexed token0, address indexed token1, uint24 indexed fee,
 * int24 tickSpacing, address pool). Throws on any structural mismatch; the
 * service turns the throw into a skipped event + registrySkipped counter.
 */
export function decodePoolCreated(log: RawLog): PoolCreatedEvent {
  if (log.topics.length !== 4) {
    throw new Error(`expected 4 topics, got ${log.topics.length}`);
  }
  if (log.topics[0]?.toLowerCase() !== POOL_CREATED_TOPIC) {
    throw new Error('not a PoolCreated event');
  }
  const token0 = addressFromPaddedTopic(log.topics[1]!);
  const token1 = addressFromPaddedTopic(log.topics[2]!);
  const feeWord = BigInt(log.topics[3]!);
  if (feeWord > 0xffffffn) {
    throw new Error('fee topic exceeds uint24');
  }
  const fee = Number(feeWord);

  const tickSpacingWord = BigInt(wordAt(log.data, 0));
  // int24 is signed; decode two's complement.
  const tickSpacingRaw = tickSpacingWord & ((1n << 24n) - 1n);
  const tickSpacing = (tickSpacingRaw >= (1n << 23n) ? tickSpacingRaw - (1n << 24n) : tickSpacingRaw);
  if (tickSpacing <= 0n || tickSpacing > 8_388_607n) {
    throw new Error('tickSpacing is not a plausible int24');
  }

  const poolWord = wordAt(log.data, 32);
  if (poolWord.slice(0, 26) !== '0x000000000000000000000000') {
    throw new Error('pool address word is not left-padded');
  }
  const pool = `0x${poolWord.slice(-40)}`.toLowerCase();

  return { token0, token1, fee, tickSpacing: Number(tickSpacing), pool };
}

export const UNISWAP_ALLOWED_FEES: ReadonlySet<number> = new Set([100, 500, 3000, 10000]);
export const EXPECTED_FACTORY_CODE_KECCAK =
  '0xec72b1abd1f2faee020cfea9c646bd8994f9fb389054f6e574f103a895091739';
export const EXPECTED_FACTORY_BYTES = 24_535;
export const UNISWAP_V3_FACTORY = '0x1f7d7550b1b028f7571e69a784071f0205fd2efa';
