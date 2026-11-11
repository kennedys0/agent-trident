import { createPublicClient, defineChain, http, type PublicClient } from 'viem';
import { ROBINHOOD_CHAIN_ID } from '../config.js';
import { erc20Abi, quoterV2Abi, uniswapV3FactoryAbi, uniswapV3PoolAbi } from './abi.js';

export const robinhoodChain = defineChain({
  id: ROBINHOOD_CHAIN_ID,
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://rpc.mainnet.chain.robinhood.com'] },
  },
});

export class ChainMismatchError extends Error {
  constructor(expected: number, actual: number) {
    super(`RPC chain id ${actual} does not match required chain id ${expected}`);
    this.name = 'ChainMismatchError';
  }
}

export type PoolState = {
  readonly sqrtPriceX96: bigint;
  readonly tick: number;
  readonly liquidity: bigint;
  readonly token0: `0x${string}`;
  readonly token1: `0x${string}`;
};

export type QuoteResult = {
  readonly amountOut: bigint;
  readonly gasEstimate: bigint;
};

/** Minimal HTTP JSON-RPC surface; the only RPC caller in the process. */
export type RpcTransport = {
  readonly client: PublicClient;
  readonly url: string;
};

export type ChainClientOptions = {
  readonly rpcUrl: string;
  readonly minIntervalMs?: number;
  readonly timeoutMs?: number;
  readonly maxRetries?: number;
  readonly sleep?: (ms: number) => Promise<void>;
};

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Serialises RPC calls to stay inside the conservative public-RPC budget and
 * retries transient transport failures with exponential backoff and jitter.
 */
export class ChainClient {
  private readonly client: PublicClient;
  private readonly minIntervalMs: number;
  private readonly maxRetries: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private queue: Promise<unknown> = Promise.resolve();
  private lastCallAt = 0;

  constructor(options: ChainClientOptions) {
    this.client = createPublicClient({
      chain: robinhoodChain,
      transport: http(options.rpcUrl, { timeout: options.timeoutMs ?? 15_000, retryCount: 0 }),
    });
    this.minIntervalMs = options.minIntervalMs ?? 250;
    this.maxRetries = options.maxRetries ?? 3;
    this.sleep = options.sleep ?? defaultSleep;
  }

  private async throttle(): Promise<void> {
    const wait = this.minIntervalMs - (Date.now() - this.lastCallAt);
    if (wait > 0) await this.sleep(wait);
    this.lastCallAt = Date.now();
  }

  /** Executes one RPC call at a time; a rejected call never blocks the queue. */
  private async run<T>(work: () => Promise<T>): Promise<T> {
    const task = this.queue.then(async () => {
      let attempt = 0;
      for (;;) {
        await this.throttle();
        try {
          return await work();
        } catch (error) {
          if (attempt >= this.maxRetries || !isTransient(error)) throw error;
          attempt += 1;
          await this.sleep(250 * 2 ** (attempt - 1) + Math.floor(Math.random() * 100));
        }
      }
    });
    this.queue = task.catch(() => undefined);
    return task;
  }

  get raw(): PublicClient {
    return this.client;
  }

  async assertChain(): Promise<number> {
    const chainId = await this.run(() => this.client.getChainId());
    if (chainId !== ROBINHOOD_CHAIN_ID) throw new ChainMismatchError(ROBINHOOD_CHAIN_ID, chainId);
    return chainId;
  }

  async getHead(): Promise<{ number: number; hash: `0x${string}`; timestamp: number }> {
    const block = await this.run(() => this.client.getBlock({ blockTag: 'latest' }));
    return { number: Number(block.number), hash: block.hash, timestamp: Number(block.timestamp) };
  }

  async getCodeSize(address: `0x${string}`): Promise<number> {
    const code = await this.run(() => this.client.getCode({ address }));
    return (code ?? '0x').length;
  }

  async getPool(factory: `0x${string}`, tokenA: `0x${string}`, tokenB: `0x${string}`, fee: number): Promise<`0x${string}`> {
    return this.run(() =>
      this.client.readContract({
        address: factory,
        abi: uniswapV3FactoryAbi,
        functionName: 'getPool',
        args: [tokenA, tokenB, fee],
      }),
    );
  }

  async readPoolState(pool: `0x${string}`, blockNumber: number): Promise<PoolState> {
    const [slot0, liquidity, token0, token1] = await Promise.all([
      this.run(() =>
        this.client.readContract({ address: pool, abi: uniswapV3PoolAbi, functionName: 'slot0', blockNumber: BigInt(blockNumber) }),
      ),
      this.run(() =>
        this.client.readContract({ address: pool, abi: uniswapV3PoolAbi, functionName: 'liquidity', blockNumber: BigInt(blockNumber) }),
      ),
      this.run(() => this.client.readContract({ address: pool, abi: uniswapV3PoolAbi, functionName: 'token0' })),
      this.run(() => this.client.readContract({ address: pool, abi: uniswapV3PoolAbi, functionName: 'token1' })),
    ]);
    const slot = slot0 as readonly [bigint, number, number, number, number, number, boolean];
    return { sqrtPriceX96: slot[0], tick: slot[1], liquidity, token0, token1 };
  }

  async readSymbol(address: `0x${string}`): Promise<string> {
    return this.run(() => this.client.readContract({ address, abi: erc20Abi, functionName: 'symbol' }));
  }

  async readDecimals(address: `0x${string}`): Promise<number> {
    return this.run(() => this.client.readContract({ address, abi: erc20Abi, functionName: 'decimals' }));
  }

  async readBalance(token: `0x${string}`, account: `0x${string}`, blockNumber: number): Promise<bigint> {
    return this.run(() =>
      this.client.readContract({
        address: token,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [account],
        blockNumber: BigInt(blockNumber),
      }),
    );
  }

  /**
   * Executes QuoterV2 at a pinned block. QuoterV2 is a simulated call, so this
   * never signs, never sends, and never moves funds.
   */
  async quoteExactInputSingle(
    quoter: `0x${string}`,
    params: { tokenIn: `0x${string}`; tokenOut: `0x${string}`; amountIn: bigint; fee: number },
    blockNumber: number,
  ): Promise<QuoteResult> {
    const result = await this.run(() =>
      this.client.readContract({
        address: quoter,
        abi: quoterV2Abi,
        functionName: 'quoteExactInputSingle',
        args: [{ ...params, sqrtPriceLimitX96: 0n }],
        blockNumber: BigInt(blockNumber),
      }),
    );
    const tuple = result as readonly [bigint, bigint, number, bigint];
    return { amountOut: tuple[0], gasEstimate: tuple[3] };
  }

  async getBaseFeePerGas(): Promise<bigint> {
    const block = await this.run(() => this.client.getBlock({ blockTag: 'latest' }));
    return block.baseFeePerGas ?? 0n;
  }
}

function isTransient(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return (
    message.includes('timeout') ||
    message.includes('fetch failed') ||
    message.includes('econnreset') ||
    message.includes('socket') ||
    message.includes('429') ||
    message.includes('502') ||
    message.includes('503')
  );
}