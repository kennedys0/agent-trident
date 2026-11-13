import { describe, expect, it } from 'vitest';
import { ChainClient } from '../src/chain/client.js';

const RPC = 'https://rpc.mainnet.chain.robinhood.com';
const FACTORY = '0x1f7d7550b1b028f7571e69a784071f0205fd2efa';
const POOL_CREATED_TOPIC = '0x783cca1c0412dd0d695e784568c96da2e9c22ff989357a2e8b1d9b2b4e6b7118';

function jsonResult(request: unknown, result: unknown): Response {
  const id = (request as { id?: number }).id ?? 1;
  return new Response(JSON.stringify({ jsonrpc: '2.0', id, result }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function jsonRpcError(request: unknown, code: number, message: string): Response {
  const id = (request as { id?: number }).id ?? 1;
  return new Response(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * Offline ChainClient behaviour around the guarded transport: every call is
 * queued and throttled, and retry decisions come from numeric codes.
 */
describe('ChainClient queue and retry', () => {
  it('serialises getBytecode and getLogs through the one queue', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    let count = 0;
    const client = new ChainClient({
      rpcUrl: RPC,
      minIntervalMs: 0,
      sleep: async () => {},
      fetchFn: async (_input, init) => {
        count += 1;
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 2));
        inFlight -= 1;
        const request = JSON.parse(String(init?.body));
        return request['method'] === 'eth_getLogs' ? jsonResult(request, []) : jsonResult(request, '0x1234');
      },
    });
    const results = await Promise.all([
      client.getBytecode(FACTORY),
      client.getLogs({ address: FACTORY, fromBlock: 1, toBlock: 2, topics: [POOL_CREATED_TOPIC] }),
      client.getBytecode(FACTORY),
    ]);
    expect(results[0]).toBe('0x1234');
    expect(results[2]).toBe('0x1234');
    expect(count).toBe(3);
    expect(maxInFlight).toBe(1);
  });

  it('retries a transient HTTP status failure and then succeeds', async () => {
    let count = 0;
    const client = new ChainClient({
      rpcUrl: RPC,
      minIntervalMs: 0,
      maxRetries: 2,
      sleep: async () => {},
      fetchFn: async (_input, init) => {
        count += 1;
        if (count === 1) return new Response('upstream unavailable', { status: 503 });
        return jsonResult(JSON.parse(String(init?.body)), '0xabcd');
      },
    });
    await expect(client.getBytecode(FACTORY)).resolves.toBe('0xabcd');
    expect(count).toBe(2);
  });

  it('does not retry a request the provider rejected by numeric code', async () => {
    let count = 0;
    const client = new ChainClient({
      rpcUrl: RPC,
      minIntervalMs: 0,
      maxRetries: 3,
      sleep: async () => {},
      fetchFn: async (_input, init) => {
        count += 1;
        // Message says "timeout", the numeric code says bad params: the code
        // decides, so there is exactly one attempt.
        return jsonRpcError(JSON.parse(String(init?.body)), -32602, 'timeout happened');
      },
    });
    await expect(client.getBytecode(FACTORY)).rejects.toThrow();
    expect(count).toBe(1);
  });

  it('maps raw logs to the discovery log shape', async () => {
    const client = new ChainClient({
      rpcUrl: RPC,
      minIntervalMs: 0,
      sleep: async () => {},
      fetchFn: async (_input, init) => {
        const request = JSON.parse(String(init?.body));
        return jsonResult(request, [
          {
            address: FACTORY,
            topics: [POOL_CREATED_TOPIC, `0x${'0'.repeat(64)}`, `0x${'0'.repeat(64)}`, `0x${'0'.repeat(63)}1`],
            data: '0x',
            blockNumber: '0x64',
            transactionHash: `0x${'cd'.repeat(32)}`,
            transactionIndex: '0x0',
            logIndex: '0x2',
            blockHash: `0x${'ab'.repeat(32)}`,
            removed: false,
          },
        ]);
      },
    });
    const logs = await client.getLogs({ address: FACTORY, fromBlock: 100, toBlock: 100, topics: [POOL_CREATED_TOPIC] });
    expect(logs).toHaveLength(1);
    expect(logs[0]?.blockNumber).toBe(100);
    expect(logs[0]?.logIndex).toBe(2);
    expect(logs[0]?.transactionHash).toBe(`0x${'cd'.repeat(32)}`);
    expect(logs[0]?.topics).toHaveLength(4);
  });
});
