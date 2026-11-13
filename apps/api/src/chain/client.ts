import { createPublicClient, defineChain, http, numberToHex, type PublicClient } from 'viem';
import { ROBINHOOD_CHAIN_ID } from '../config.js';
import { isTransientRpcError } from './errors.js';
import { type RawLog } from './poolCodec.js';

/** JSON-RPC log shape as returned by `eth_getLogs`; fields are hex strings. */
type RawRpcLog = {
  readonly address: string;
  readonly topics: readonly string[];
  readonly data: string;
  readonly blockNumber: string;
  readonly transactionHash?: string | undefined;
  readonly logIndex?: string | undefined;
};
import {
  DEFAULT_RPC_ALLOWED_HOSTS,
  assertSafeRpcUrl,
  createGuardedRpcFetch,
  type RpcFetch,
} from './rpc-guard.js';
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

/** One block identity, enough to prove chain continuity across restarts. */
export type ChainBlock = {
  readonly number: number;
  readonly hash: `0x${string}`;
  readonly parentHash: `0x${string}`;
  readonly timestamp: number;
};

/**
 * Narrow read port used by the market service. Keeping it small lets the
 * checkpoint/reorg tests drive a synthetic chain without an RPC.
 */
export type ChainReadPort = {
  getHead(): Promise<ChainBlock>;
  getBlockByNumber(blockNumber: number): Promise<ChainBlock | null>;
  readPoolState(pool: `0x${string}`, blockNumber: number): Promise<PoolState>;
  readBalance(token: `0x${string}`, account: `0x${string}`, blockNumber: number): Promise<bigint>;
};

/** Minimal HTTP JSON-RPC surface; the only RPC caller in the process. */
export type RpcTransport = {
  readonly client: PublicClient;
  readonly url: string;
};

export type ChainClientOptions = {
  readonly rpcUrl: string;
  /** Hosts approved for RPC traffic; defaults to the verified Robinhood host. */
  readonly allowedRpcHosts?: readonly string[];
  /** Test seam for the HTTP layer; the default is the guarded fetch below. */
  readonly fetchFn?: RpcFetch;
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
export class ChainClient implements ChainReadPort {
  private readonly client: PublicClient;
  private readonly minIntervalMs: number;
  private readonly maxRetries: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private queue: Promise<unknown> = Promise.resolve();
  private lastCallAt = 0;

  constructor(options: ChainClientOptions) {
    const allowedRpcHosts = options.allowedRpcHosts ?? DEFAULT_RPC_ALLOWED_HOSTS;
    // Fail closed before any traffic: an unsafe or unapproved endpoint never
    // becomes a public client, so market/risk reads cannot be redirected.
    const rpcUrl = assertSafeRpcUrl(options.rpcUrl, allowedRpcHosts).toString();
    const fetchFn = createGuardedRpcFetch({
      allowedHosts: allowedRpcHosts,
      ...(options.fetchFn === undefined ? {} : { baseFetch: options.fetchFn }),
    });
    this.client = createPublicClient({
      chain: robinhoodChain,
      transport: http(rpcUrl, { timeout: options.timeoutMs ?? 15_000, retryCount: 0, fetchFn }),
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

  /** Chain id pinned at construction; asserts the pin without any traffic. */
  get configuredChainId(): number {
    return this.client.chain?.id ?? 0;
  }

  /** Raw bytecode of a contract; part of the factory identity check. */
  async getBytecode(address: `0x${string}`): Promise<`0x${string}` | undefined> {
    return this.run(() => this.client.getBytecode({ address }));
  }

  /**
   * Raw logs for one topic filter over a bounded range. Goes through
   * `eth_getLogs` because viem's typed getLogs only filters by decoded event.
   * Queued and throttled like every other call: discovery must not open an
   * unthrottled path to the public RPC.
   */
  async getLogs(request: {
    readonly address: `0x${string}`;
    readonly fromBlock: number;
    readonly toBlock: number;
    readonly topics: readonly [string];
  }): Promise<readonly RawLog[]> {
    const logs = await this.run(() =>
      this.client.request({
        method: 'eth_getLogs',
        params: [
          {
            address: request.address,
            fromBlock: numberToHex(request.fromBlock),
            toBlock: numberToHex(request.toBlock),
            topics: [...request.topics],
          },
        ],
      } as Parameters<PublicClient['request']>[0]),
    );
    return (logs as readonly RawRpcLog[]).map((log, index) => ({
      address: log.address,
      topics: [...log.topics],
      data: log.data,
      blockNumber: Number(log.blockNumber),
      transactionHash: log.transactionHash ?? `0x${'0'.repeat(64)}`,
      logIndex: log.logIndex === undefined ? index : Number(log.logIndex),
    }));
  }

  async assertChain(): Promise<number> {
    const chainId = await this.run(() => this.client.getChainId());
    if (chainId !== ROBINHOOD_CHAIN_ID) throw new ChainMismatchError(ROBINHOOD_CHAIN_ID, chainId);
    return chainId;
  }

  async getHead(): Promise<ChainBlock> {
    const block = await this.run(() => this.client.getBlock({ blockTag: 'latest' }));
    return {
      number: Number(block.number),
      hash: block.hash,
      parentHash: block.parentHash,
      timestamp: Number(block.timestamp),
    };
  }

  /**
   * Reads one block by height. A block the provider does not know returns null
   * so the checkpoint check can fail closed instead of treating a pruned or
   * missing block as a fresh chain tip.
   */
  async getBlockByNumber(blockNumber: number): Promise<ChainBlock | null> {
    try {
      const block = await this.run(() => this.client.getBlock({ blockNumber: BigInt(blockNumber) }));
      return {
        number: Number(block.number),
        hash: block.hash,
        parentHash: block.parentHash,
        timestamp: Number(block.timestamp),
      };
    } catch (error) {
      if (error instanceof Error && error.name === 'BlockNotFoundError') return null;
      throw error;
    }
  }

  async getCodeSize(address: `0x${string}`): Promise<number> {
    const code = await this.run(() => this.client.getCode({ address }));
    // Byte length, not hex-string length: the factory identity check compares
    // against EXPECTED_FACTORY_BYTES.
    return code === undefined ? 0 : (code.length - 2) / 2;
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

  /**
   * Base fee of the same block the quote was taken at. Returns null when the
   * block does not report one, so callers can emit UNAVAILABLE instead of
   * inventing a price.
   */
  async getBaseFeePerGasAt(blockNumber: number): Promise<bigint | null> {
    const block = await this.run(() => this.client.getBlock({ blockNumber: BigInt(blockNumber) }));
    return block.baseFeePerGas ?? null;
  }
}

function isTransient(error: unknown): boolean {
  // Numeric JSON-RPC codes and HTTP statuses decide; message matching is only
  // the fallback for transport failures that carry no numeric code. The
  // classifier lives in errors.ts and is shared with the discovery service.
  return isTransientRpcError(error);
}