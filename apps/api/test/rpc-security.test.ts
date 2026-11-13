import { describe, expect, it } from 'vitest';
import { ChainClient } from '../src/chain/client.js';
import {
  DEFAULT_RPC_ALLOWED_HOSTS,
  ROBINHOOD_RPC_HOST,
  UnsafeRpcEndpointError,
  assertRpcHostResolvesPublic,
  assertSafeRpcUrl,
  createGuardedRpcFetch,
  isPublicAddress,
  parseRpcAllowedHosts,
  type RpcEndpointErrorCode,
} from '../src/chain/rpc-guard.js';
import { loadConfig } from '../src/config.js';

const MAINNET = `https://${ROBINHOOD_RPC_HOST}`;

function expectReject(action: () => unknown, code: RpcEndpointErrorCode): void {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(UnsafeRpcEndpointError);
    expect((error as UnsafeRpcEndpointError).code).toBe(code);
    return;
  }
  throw new Error(`expected rejection ${code} but the call resolved`);
}

async function expectRejectAsync(action: () => Promise<unknown>, code: RpcEndpointErrorCode): Promise<void> {
  try {
    await action();
  } catch (error) {
    expect(error).toBeInstanceOf(UnsafeRpcEndpointError);
    expect((error as UnsafeRpcEndpointError).code).toBe(code);
    return;
  }
  throw new Error(`expected rejection ${code} but the call resolved`);
}

function responseWith(overrides: { redirected?: boolean; url?: string } = {}): Response {
  const response = new Response('{"jsonrpc":"2.0","id":1,"result":"0x1"}', {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
  if (overrides.redirected !== undefined) {
    Object.defineProperty(response, 'redirected', { value: overrides.redirected });
  }
  if (overrides.url !== undefined) {
    Object.defineProperty(response, 'url', { value: overrides.url });
  }
  return response;
}

describe('RPC endpoint validation', () => {
  it('accepts the verified Robinhood endpoint and canonicalises it', () => {
    expect(assertSafeRpcUrl(MAINNET).toString()).toBe(`${MAINNET}/`);
    expect(assertSafeRpcUrl(`${MAINNET}/`).hostname).toBe(ROBINHOOD_RPC_HOST);
    // Hostnames are case-insensitive; URL parsing lowercases before matching.
    expect(assertSafeRpcUrl('https://RPC.MainNet.chain.robinhood.com').hostname).toBe(ROBINHOOD_RPC_HOST);
    // An explicit default port is the same as no port.
    expect(assertSafeRpcUrl(`${MAINNET}:443`).port).toBe('');
  });

  it.each([
    ['http://rpc.mainnet.chain.robinhood.com', 'RPC_URL_NOT_HTTPS'],
    ['ws://rpc.mainnet.chain.robinhood.com', 'RPC_URL_NOT_HTTPS'],
    ['wss://rpc.mainnet.chain.robinhood.com', 'RPC_URL_NOT_HTTPS'],
    ['file:///etc/passwd', 'RPC_URL_NOT_HTTPS'],
    ['ftp://rpc.mainnet.chain.robinhood.com', 'RPC_URL_NOT_HTTPS'],
    ['https://user:pass@rpc.mainnet.chain.robinhood.com', 'RPC_URL_HAS_CREDENTIALS'],
    ['https://user@rpc.mainnet.chain.robinhood.com', 'RPC_URL_HAS_CREDENTIALS'],
    // Userinfo trick: the real host is the one after the @.
    ['https://rpc.mainnet.chain.robinhood.com@evil.tld', 'RPC_URL_HAS_CREDENTIALS'],
    ['https://127.0.0.1', 'RPC_URL_UNSAFE_FORM'],
    ['https://0.0.0.0', 'RPC_URL_UNSAFE_FORM'],
    ['https://169.254.169.254/latest/meta-data', 'RPC_URL_UNSAFE_FORM'],
    ['https://10.0.0.5', 'RPC_URL_UNSAFE_FORM'],
    ['https://[::1]', 'RPC_URL_UNSAFE_FORM'],
    ['https://[fe80::1]', 'RPC_URL_UNSAFE_FORM'],
    ['https://localhost', 'RPC_URL_UNSAFE_FORM'],
    ['https://rpc.localhost', 'RPC_URL_UNSAFE_FORM'],
    ['https://metadata.google.internal', 'RPC_URL_UNSAFE_FORM'],
    ['https://rpc.internal', 'RPC_URL_UNSAFE_FORM'],
    ['https://rpc.mainnet.chain.robinhood.com.', 'RPC_URL_UNSAFE_FORM'],
    ['https://rpc.mainnet.chain.robinhood.com:8443', 'RPC_URL_UNSAFE_FORM'],
    ['https://rpc.mainnet.chain.robinhood.com/?apikey=secret', 'RPC_URL_UNSAFE_FORM'],
    ['https://rpc.mainnet.chain.robinhood.com/#fragment', 'RPC_URL_UNSAFE_FORM'],
    ['https://rpc.mainnet.chain.robinhood.com.evil.tld', 'RPC_URL_HOST_NOT_ALLOWED'],
    ['https://evil.tld', 'RPC_URL_HOST_NOT_ALLOWED'],
    ['https://rpc-mainnet.chain.robinhood.com', 'RPC_URL_HOST_NOT_ALLOWED'],
    ['https://chain.robinhood.com', 'RPC_URL_HOST_NOT_ALLOWED'],
    ['not-a-url', 'RPC_URL_INVALID'],
    ['', 'RPC_URL_INVALID'],
    [' https://rpc.mainnet.chain.robinhood.com', 'RPC_URL_UNSAFE_FORM'],
    ['https://rpc.mainnet.chain.robinhood.com\n', 'RPC_URL_UNSAFE_FORM'],
    [`https://${'a'.repeat(300)}.com`, 'RPC_URL_UNSAFE_FORM'],
  ] as const)('rejects %s with %s', (url, code) => {
    expectReject(() => assertSafeRpcUrl(url), code);
  });
});

describe('RPC host allowlist', () => {
  it('defaults to the single verified host', () => {
    expect(parseRpcAllowedHosts(undefined)).toEqual([ROBINHOOD_RPC_HOST]);
    expect(parseRpcAllowedHosts('  ,  ')).toEqual([ROBINHOOD_RPC_HOST]);
    expect(DEFAULT_RPC_ALLOWED_HOSTS).toEqual([ROBINHOOD_RPC_HOST]);
  });

  it('accepts a comma separated list of public hostnames', () => {
    expect(parseRpcAllowedHosts('rpc.example.com, RPC2.example.org')).toEqual(['rpc.example.com', 'rpc2.example.org']);
  });

  it.each([
    'https://rpc.example.com',
    'rpc.example.com/path',
    'user@rpc.example.com',
    'rpc.example.com:443',
    'localhost',
    'a.local',
    'rpc.internal',
    '10.0.0.1',
    '127.0.0.1',
    '169.254.169.254',
    '[::1]',
  ])('rejects unsafe allowlist entry %s', (entry) => {
    expectReject(() => parseRpcAllowedHosts(entry), 'RPC_HOST_ALLOWLIST_INVALID');
  });

  it('rejects an endpoint outside the allowlist even when it is well formed', () => {
    expectReject(() => assertSafeRpcUrl('https://rpc.example.com', parseRpcAllowedHosts(undefined)), 'RPC_URL_HOST_NOT_ALLOWED');
  });
});

describe('loadConfig RPC hardening', () => {
  it('loads the documented default configuration', () => {
    const config = loadConfig({ RPC_URL: MAINNET } as NodeJS.ProcessEnv);
    expect(config.rpcUrl).toBe(`${MAINNET}/`);
    expect(config.rpcAllowedHosts).toEqual([ROBINHOOD_RPC_HOST]);
    expect(config.expectedChainId).toBe(4663);
    expect(config.mode).toBe('PAPER');
    expect(config.host).toBe('127.0.0.1');
  });

  it('accepts an extra explicitly allowlisted provider', () => {
    const config = loadConfig({
      RPC_URL: 'https://rpc.example.com',
      RPC_ALLOWED_HOSTS: 'rpc.example.com',
    } as NodeJS.ProcessEnv);
    expect(config.rpcUrl).toBe('https://rpc.example.com/');
    expect(config.rpcAllowedHosts).toEqual(['rpc.example.com']);
  });

  it('refuses to load an unsafe endpoint', () => {
    expectReject(() => loadConfig({ RPC_URL: 'http://rpc.mainnet.chain.robinhood.com' } as NodeJS.ProcessEnv), 'RPC_URL_NOT_HTTPS');
    expectReject(() => loadConfig({ RPC_URL: 'https://evil.tld' } as NodeJS.ProcessEnv), 'RPC_URL_HOST_NOT_ALLOWED');
    expectReject(
      () => loadConfig({ RPC_URL: 'https://user:pass@rpc.mainnet.chain.robinhood.com' } as NodeJS.ProcessEnv),
      'RPC_URL_HAS_CREDENTIALS',
    );
    expectReject(() => loadConfig({ RPC_URL: MAINNET, RPC_ALLOWED_HOSTS: 'localhost' } as NodeJS.ProcessEnv), 'RPC_HOST_ALLOWLIST_INVALID');
  });

  it('keeps the chain id pinned to 4663', () => {
    expect(() => loadConfig({ RPC_URL: MAINNET, EXPECTED_CHAIN_ID: '1' } as NodeJS.ProcessEnv)).toThrow(/must be 4663/);
  });
});

describe('ChainClient refuses unsafe endpoints before any traffic', () => {
  it('validates at construction time', () => {
    expect(new ChainClient({ rpcUrl: MAINNET }).configuredChainId).toBe(4663);
    expectReject(() => new ChainClient({ rpcUrl: 'http://rpc.mainnet.chain.robinhood.com' }), 'RPC_URL_NOT_HTTPS');
    expectReject(() => new ChainClient({ rpcUrl: 'https://evil.tld' }), 'RPC_URL_HOST_NOT_ALLOWED');
    expectReject(() => new ChainClient({ rpcUrl: 'https://127.0.0.1' }), 'RPC_URL_UNSAFE_FORM');
    expectReject(
      () => new ChainClient({ rpcUrl: 'https://rpc.testnet.chain.robinhood.com' }),
      'RPC_URL_HOST_NOT_ALLOWED',
    );
  });
});

describe('guarded RPC fetch', () => {
  it('pins redirect handling and drops credentials/cookies on every call', async () => {
    const seen: RequestInit[] = [];
    const guarded = createGuardedRpcFetch({
      allowedHosts: [ROBINHOOD_RPC_HOST],
      baseFetch: async (_input, init) => {
        seen.push(init ?? {});
        return responseWith();
      },
    });

    const response = await guarded(MAINNET, { method: 'POST', body: '{"jsonrpc":"2.0","id":1,"method":"eth_chainId"}' });
    expect(response.status).toBe(200);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.redirect).toBe('error');
    expect(seen[0]?.credentials).toBe('omit');
    expect(seen[0]?.referrerPolicy).toBe('no-referrer');
    expect(seen[0]?.method).toBe('POST');
  });

  it('does not call the network for an unapproved host', async () => {
    let calls = 0;
    const guarded = createGuardedRpcFetch({
      allowedHosts: [ROBINHOOD_RPC_HOST],
      baseFetch: async () => {
        calls += 1;
        return responseWith();
      },
    });

    await expectRejectAsync(() => guarded('https://evil.tld'), 'RPC_URL_HOST_NOT_ALLOWED');
    await expectRejectAsync(() => guarded('http://rpc.mainnet.chain.robinhood.com'), 'RPC_URL_NOT_HTTPS');
    expect(calls).toBe(0);
  });

  it('rejects a response that reports a redirect', async () => {
    const guarded = createGuardedRpcFetch({
      allowedHosts: [ROBINHOOD_RPC_HOST],
      baseFetch: async () => responseWith({ redirected: true }),
    });
    await expectRejectAsync(() => guarded(MAINNET), 'RPC_URL_REDIRECTED');
  });

  it('rejects a response that landed on another origin', async () => {
    const guarded = createGuardedRpcFetch({
      allowedHosts: [ROBINHOOD_RPC_HOST],
      baseFetch: async () => responseWith({ url: 'https://evil.tld/rpc' }),
    });
    await expectRejectAsync(() => guarded(MAINNET), 'RPC_URL_HOST_NOT_ALLOWED');
  });

  it('rejects an https response that downgraded to http', async () => {
    const guarded = createGuardedRpcFetch({
      allowedHosts: [ROBINHOOD_RPC_HOST],
      baseFetch: async () => responseWith({ url: 'http://rpc.mainnet.chain.robinhood.com/' }),
    });
    await expectRejectAsync(() => guarded(MAINNET), 'RPC_URL_NOT_HTTPS');
  });
});

describe('host resolution guard', () => {
  it('accepts a host that only resolves to public addresses', async () => {
    await expect(
      assertRpcHostResolvesPublic(ROBINHOOD_RPC_HOST, async () => [
        { address: '93.184.216.34', family: 4 },
        { address: '2606:4700:4700::1111', family: 6 },
      ]),
    ).resolves.toEqual(['93.184.216.34', '2606:4700:4700::1111']);
  });

  it.each(['127.0.0.1', '10.0.0.5', '172.16.4.4', '192.168.1.10', '169.254.169.254', '100.64.0.7', '::1', 'fe80::1', 'fc00::1', '::ffff:10.0.0.1'])(
    'rejects a host resolving to %s',
    async (address) => {
      await expectRejectAsync(
        () => assertRpcHostResolvesPublic(ROBINHOOD_RPC_HOST, async () => [{ address, family: address.includes(':') ? 6 : 4 }]),
        'RPC_HOST_PRIVATE_ADDRESS',
      );
    },
  );

  it('fails closed when resolution fails or returns nothing', async () => {
    await expectRejectAsync(
      () =>
        assertRpcHostResolvesPublic(ROBINHOOD_RPC_HOST, async () => {
          throw new Error('ENOTFOUND');
        }),
      'RPC_HOST_UNRESOLVABLE',
    );
    await expectRejectAsync(() => assertRpcHostResolvesPublic(ROBINHOOD_RPC_HOST, async () => []), 'RPC_HOST_UNRESOLVABLE');
  });

  it('classifies addresses conservatively', () => {
    expect(isPublicAddress('8.8.8.8')).toBe(true);
    expect(isPublicAddress('1.1.1.1')).toBe(true);
    expect(isPublicAddress('2606:4700::1111')).toBe(true);
    expect(isPublicAddress('::ffff:8.8.8.8')).toBe(true);
    expect(isPublicAddress('0.0.0.0')).toBe(false);
    expect(isPublicAddress('127.0.0.1')).toBe(false);
    expect(isPublicAddress('192.0.2.10')).toBe(false);
    expect(isPublicAddress('203.0.113.9')).toBe(false);
    expect(isPublicAddress('224.0.0.1')).toBe(false);
    expect(isPublicAddress('::')).toBe(false);
    expect(isPublicAddress('fe80::abcd')).toBe(false);
    expect(isPublicAddress('fd12:3456::1')).toBe(false);
    expect(isPublicAddress('not-an-ip')).toBe(false);
  });
});