import { describe, expect, it } from 'vitest';
import { createPacer, makeDiscoveryPort, DISCOVERY_MIN_CALL_INTERVAL_MS } from '../src/services/discoveryWorker.js';
import type { ChainClient } from '../src/chain/client.js';

describe('createPacer', () => {
  it('serializes concurrent calls with at least the minimum spacing', async () => {
    const pacer = createPacer(50);
    const starts: number[] = [];
    const work = (n: number) => async () => {
      starts.push(Date.now());
      if (n === 0) await Promise.resolve();
      return n;
    };
    await Promise.all([pacer(work(0)), pacer(work(1)), pacer(work(2))]);
    expect(starts[1]! - starts[0]!).toBeGreaterThanOrEqual(45);
    expect(starts[2]! - starts[1]!).toBeGreaterThanOrEqual(45);
    // Even when a task resolves instantly, spacing still applies.
    expect(starts[2]! - starts[0]!).toBeGreaterThanOrEqual(90);
  });

  it('propagates rejections without stalling the queue', async () => {
    const pacer = createPacer(1);
    await expect(pacer(async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    await expect(pacer(async () => 'ok')).resolves.toBe('ok');
  });
});

describe('makeDiscoveryPort', () => {
  const chain = {
    getHead: async () => ({ number: 1, hash: '0xh', parentHash: '0xp', timestamp: 0 }),
    getBlockByNumber: async () => null,
    getCodeSize: async () => 24_535,
    getBytecode: async () => '0x00',
    readSymbol: async () => 'WETH',
    readDecimals: async () => 18,
    raw: {
      getCode: async () => `0x${'00'.repeat(24_535)}`,
      getBytecode: async () => `0x${'00'.repeat(24_535)}`,
      getLogs: async () => [],
    },
  } as unknown as ChainClient;

  it('paces every port call including raw getCode, so discovery cannot burst the RPC', async () => {
    const stamps: number[] = [];
    const tracked = {
      ...chain,
      getHead: async () => { stamps.push(Date.now()); return await chain.getHead(); },
      raw: {
        ...chain.raw,
        getCode: async () => { stamps.push(Date.now()); return `0x${'00'.repeat(24_535)}`; },
      },
    } as unknown as ChainClient;
    const port = makeDiscoveryPort(tracked, 250);
    // getCodeSize routes through paced raw.getCode; getHead through paced getHead.
    const [size, head] = await Promise.all([
      port.getCodeSize('0x1f7d7550b1b028f7571e69a784071f0205fd2efa' as never),
      port.getHead(),
    ]);
    expect(size).toBe(24_535); // hex-length → bytes, matches the pinned 24_535-byte factory
    expect(head.number).toBe(1);
    expect(stamps.length).toBe(2);
    expect(stamps[1]! - stamps[0]!).toBeGreaterThanOrEqual(200); // paced, not burst
  });

  it('uses the production default interval', () => {
    expect(DISCOVERY_MIN_CALL_INTERVAL_MS).toBe(250);
  });
});
