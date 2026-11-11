import type { ChainClient } from '../chain/client.js';
import type { Venue } from '../domain/types.js';

export type QuoteRequest = {
  readonly tokenIn: `0x${string}`;
  readonly tokenOut: `0x${string}`;
  readonly amountIn: bigint;
  readonly fee: number;
  readonly blockNumber: number;
};

export type QuoteResponse = {
  readonly amountOut: bigint;
  readonly gasEstimate: bigint;
  readonly blockNumber: number;
};

/** Narrow port so risk and paper execution can be tested without an RPC. */
export type QuotePort = {
  quote(request: QuoteRequest): Promise<QuoteResponse>;
  headBlockNumber(): Promise<number>;
  baseFeePerGas(): Promise<bigint>;
};

export function createQuotePort(chain: ChainClient, venue: Venue): QuotePort {
  return {
    async quote(request) {
      const result = await chain.quoteExactInputSingle(
        venue.quoterV2,
        { tokenIn: request.tokenIn, tokenOut: request.tokenOut, amountIn: request.amountIn, fee: request.fee },
        request.blockNumber,
      );
      return { amountOut: result.amountOut, gasEstimate: result.gasEstimate, blockNumber: request.blockNumber };
    },
    async headBlockNumber() {
      return (await chain.getHead()).number;
    },
    async baseFeePerGas() {
      return chain.getBaseFeePerGas();
    },
  };
}