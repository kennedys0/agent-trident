import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/**
 * The only RPC host trusted when the operator configures nothing else. Every
 * other provider must be opted into explicitly with RPC_ALLOWED_HOSTS.
 */
export const ROBINHOOD_RPC_HOST = 'rpc.mainnet.chain.robinhood.com';

export const DEFAULT_RPC_ALLOWED_HOSTS: readonly string[] = [ROBINHOOD_RPC_HOST];

export type RpcEndpointErrorCode =
  | 'RPC_URL_INVALID'
  | 'RPC_URL_NOT_HTTPS'
  | 'RPC_URL_HAS_CREDENTIALS'
  | 'RPC_URL_UNSAFE_FORM'
  | 'RPC_URL_HOST_NOT_ALLOWED'
  | 'RPC_URL_REDIRECTED'
  | 'RPC_HOST_ALLOWLIST_INVALID'
  | 'RPC_HOST_UNRESOLVABLE'
  | 'RPC_HOST_PRIVATE_ADDRESS';

/**
 * Raised whenever an RPC endpoint or allowlist entry could send signed-free
 * read traffic somewhere the operator did not approve. The `code` is stable so
 * boot failures and tests can assert the exact rejection reason.
 */
export class UnsafeRpcEndpointError extends Error {
  readonly code: RpcEndpointErrorCode;

  constructor(code: RpcEndpointErrorCode, message: string) {
    super(message);
    this.name = 'UnsafeRpcEndpointError';
    this.code = code;
  }
}

/** Label rules for a public DNS name; IP literals and single labels fail. */
const DNS_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const PUBLIC_TLD = /^[a-z]{2,63}$/;
/** Names that never belong to a remote provider, even if allowlisted. */
const LOCAL_TLDS = new Set(['localhost', 'local', 'internal', 'localdomain', 'home.arpa', 'test', 'example', 'invalid']);
const MAX_URL_LENGTH = 2048;

/**
 * Validates one DNS name. Deliberately strict: lowercase ASCII only, at least
 * two labels, public-looking TLD, so homographs, IP literals and local names
 * cannot reach fetch.
 */
function assertPublicDnsName(rawHostname: string): string {
  const hostname = rawHostname.toLowerCase();
  if (hostname.length === 0 || hostname.length > 253) {
    throw new UnsafeRpcEndpointError('RPC_URL_UNSAFE_FORM', 'RPC host must be a DNS name of 1-253 characters');
  }
  if (hostname.endsWith('.')) {
    throw new UnsafeRpcEndpointError('RPC_URL_UNSAFE_FORM', 'RPC host must not end with a trailing dot');
  }
  const withoutBrackets = hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
  if (isIP(withoutBrackets) !== 0) {
    throw new UnsafeRpcEndpointError('RPC_URL_UNSAFE_FORM', 'RPC host must be a public DNS name, not an IP literal');
  }
  const labels = withoutBrackets.split('.');
  if (labels.length < 2) {
    throw new UnsafeRpcEndpointError('RPC_URL_UNSAFE_FORM', 'RPC host must be a fully qualified public DNS name');
  }
  for (const label of labels) {
    if (!DNS_LABEL.test(label)) {
      throw new UnsafeRpcEndpointError('RPC_URL_UNSAFE_FORM', 'RPC host contains a label that is not a valid DNS label');
    }
  }
  const tld = labels[labels.length - 1] ?? '';
  if (!PUBLIC_TLD.test(tld) || LOCAL_TLDS.has(tld) || LOCAL_TLDS.has(withoutBrackets)) {
    throw new UnsafeRpcEndpointError('RPC_URL_UNSAFE_FORM', 'RPC host must be a public DNS name outside local/private namespaces');
  }
  return withoutBrackets;
}

function hostOf(url: URL): string {
  return url.hostname;
}

/**
 * Parses RPC_URL into a URL that is safe to call: HTTPS only, no credentials,
 * no query/fragment (JSON-RPC carries the payload in the body), no explicit
 * port, no IP literal, no local name, and a hostname present in the allowlist.
 * Error messages name the failure, never the raw secret-bearing input.
 */
export function assertSafeRpcUrl(raw: string, allowedHosts: readonly string[] = DEFAULT_RPC_ALLOWED_HOSTS): URL {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_URL_LENGTH) {
    throw new UnsafeRpcEndpointError('RPC_URL_INVALID', 'RPC_URL must be a non-empty string of at most 2048 characters');
  }
  if (/[\s\u0000-\u001f\u007f]/.test(raw)) {
    throw new UnsafeRpcEndpointError('RPC_URL_UNSAFE_FORM', 'RPC_URL must not contain whitespace or control characters');
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeRpcEndpointError('RPC_URL_INVALID', 'RPC_URL is not a valid absolute URL');
  }
  if (url.protocol !== 'https:') {
    throw new UnsafeRpcEndpointError('RPC_URL_NOT_HTTPS', `RPC_URL must use https://, received ${url.protocol}`);
  }
  if (url.username !== '' || url.password !== '') {
    throw new UnsafeRpcEndpointError('RPC_URL_HAS_CREDENTIALS', 'RPC_URL must not embed credentials');
  }
  if (url.search !== '' || url.hash !== '') {
    throw new UnsafeRpcEndpointError('RPC_URL_UNSAFE_FORM', 'RPC_URL must not contain a query string or fragment');
  }
  if (url.port !== '') {
    throw new UnsafeRpcEndpointError('RPC_URL_UNSAFE_FORM', 'RPC_URL must use the default HTTPS port');
  }
  const hostname = assertPublicDnsName(hostOf(url));
  if (!allowedHosts.includes(hostname)) {
    throw new UnsafeRpcEndpointError(
      'RPC_URL_HOST_NOT_ALLOWED',
      `RPC_URL host ${hostname} is not in RPC_ALLOWED_HOSTS`,
    );
  }
  return url;
}

/**
 * Operator allowlist. Empty or missing falls back to the single verified
 * Robinhood host; each entry is held to the same public-DNS rules as RPC_URL so
 * a mistyped allowlist cannot whitelist localhost or a private address.
 */
export function parseRpcAllowedHosts(raw: string | undefined): string[] {
  const entries = (raw ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  const source = entries.length > 0 ? entries : [...DEFAULT_RPC_ALLOWED_HOSTS];
  const hosts = new Set<string>();
  for (const entry of source) {
    if (entry.includes('://') || entry.includes('/') || entry.includes('@') || entry.includes(':')) {
      throw new UnsafeRpcEndpointError(
        'RPC_HOST_ALLOWLIST_INVALID',
        'RPC_ALLOWED_HOSTS entries must be bare hostnames such as rpc.example.com',
      );
    }
    try {
      hosts.add(assertPublicDnsName(entry.toLowerCase()));
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'invalid hostname';
      throw new UnsafeRpcEndpointError('RPC_HOST_ALLOWLIST_INVALID', `RPC_ALLOWED_HOSTS entry rejected: ${detail}`);
    }
  }
  return [...hosts];
}

function readIPv4(address: string): number[] | null {
  const parts = address.split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return parts;
}

function isPublicIPv4(address: string): boolean {
  const parts = readIPv4(address);
  if (parts === null) return false;
  const [a = 0, b = 0, c = 0] = parts;
  if (a === 0 || a === 10 || a === 127) return false;
  if (a === 100 && b >= 64 && b <= 127) return false; // carrier-grade NAT
  if (a === 169 && b === 254) return false; // link-local / cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 192 && b === 0 && c === 0) return false; // IETF protocol assignments
  if (a === 192 && b === 0 && c === 2) return false; // TEST-NET-1
  if (a === 198 && (b === 18 || b === 19)) return false; // benchmarking
  if (a === 198 && b === 51 && c === 100) return false; // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return false; // TEST-NET-3
  if (a >= 224) return false; // multicast and reserved
  return true;
}

function isPublicIPv6(address: string): boolean {
  const value = address.toLowerCase();
  if (value === '::' || value === '::1') return false;
  if (/^fe[89ab]/.test(value)) return false; // link-local fe80::/10
  if (/^f[cd]/.test(value)) return false; // unique local fc00::/7
  if (/^ff/.test(value)) return false; // multicast
  if (value.startsWith('2001:db8')) return false; // documentation
  if (value.startsWith('::ffff:')) return isPublicIPv4(value.slice('::ffff:'.length));
  if (value.startsWith('64:ff9b::')) return false; // NAT64 well-known prefix
  return true;
}

/** True only for globally routable addresses; used by the boot-time DNS check. */
export function isPublicAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return isPublicIPv4(address);
  if (version === 6) return isPublicIPv6(address);
  return false;
}

export type DnsRecord = { readonly address: string; readonly family: number };
export type DnsLookup = (hostname: string) => Promise<readonly DnsRecord[]>;

const defaultLookup: DnsLookup = async (hostname) => dnsLookup(hostname, { all: true, verbatim: true });

/**
 * Boot-time SSRF check: the allowlisted host must resolve, and every address it
 * resolves to must be public. A provider or local DNS setup that points the
 * name at loopback, a private range or cloud metadata aborts startup. This
 * narrows, but does not eliminate, DNS-rebinding risk; the hostname allowlist
 * remains the primary control.
 */
export async function assertRpcHostResolvesPublic(
  hostname: string,
  lookupFn: DnsLookup = defaultLookup,
): Promise<string[]> {
  let records: readonly DnsRecord[];
  try {
    records = await lookupFn(hostname);
  } catch (error) {
    const detail = error instanceof Error && error.message.length > 0 ? error.message : 'lookup failed';
    throw new UnsafeRpcEndpointError('RPC_HOST_UNRESOLVABLE', `RPC host ${hostname} could not be resolved: ${detail}`);
  }
  if (records.length === 0) {
    throw new UnsafeRpcEndpointError('RPC_HOST_UNRESOLVABLE', `RPC host ${hostname} resolved to no addresses`);
  }
  for (const record of records) {
    if (!isPublicAddress(record.address)) {
      throw new UnsafeRpcEndpointError(
        'RPC_HOST_PRIVATE_ADDRESS',
        `RPC host ${hostname} resolves to non-public address ${record.address}`,
      );
    }
  }
  return records.map((record) => record.address);
}

export type RpcFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

function requestUrl(input: string | URL | Request): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

/**
 * Wraps fetch for JSON-RPC: every request URL is re-validated against the
 * allowlist, redirects are refused at the transport level, and a response that
 * still reports a redirect or lands on another origin is rejected. A provider
 * that tries to bounce the read traffic elsewhere fails the call.
 */
export function createGuardedRpcFetch(options: { allowedHosts: readonly string[]; baseFetch?: RpcFetch }): RpcFetch {
  const allowedHosts = options.allowedHosts;
  const baseFetch: RpcFetch = options.baseFetch ?? ((input, init) => fetch(input, init));
  return async (input, init) => {
    const request = assertSafeRpcUrl(requestUrl(input), allowedHosts).toString();
    const response = await baseFetch(request, {
      ...init,
      redirect: 'error',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    });
    if (response.redirected) {
      throw new UnsafeRpcEndpointError('RPC_URL_REDIRECTED', 'RPC provider redirected the request; refusing to follow');
    }
    if (typeof response.url === 'string' && response.url.length > 0) {
      assertSafeRpcUrl(response.url, allowedHosts);
    }
    return response;
  };
}