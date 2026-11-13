/**
 * RPC error classification for retry decisions.
 *
 * A JSON-RPC error carries a numeric `code` and an HTTP error a numeric
 * `status`; those decide. Message text is free-form provider copy, and the old
 * substring matching misclassified errors (a params error whose message
 * happened to contain "timeout" was retried as transient). Message matching
 * survives only as a last resort for transport failures that carry no numeric
 * code at all.
 */

/** JSON-RPC codes that describe a temporary condition worth a bounded retry. */
const TRANSIENT_JSON_RPC_CODES: ReadonlySet<number> = new Set([
  -32603, // internal error
  -32002, // request pending (concurrency/rate)
  -32005, // limit exceeded (rate limit)
  -32015, // method-level rate limit (some providers)
  -32016, // method-level rate limit (some providers)
]);

const TRANSIENT_HTTP_STATUSES: ReadonlySet<number> = new Set([408, 425, 429, 500, 502, 503, 504]);

/** Node and undici system codes for transient transport failures. */
const TRANSIENT_TRANSPORT_CODES: ReadonlySet<string> = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'EPIPE',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'ENETUNREACH',
  'ENETDOWN',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
  'UND_ERR_SOCKET',
]);

const TRANSIENT_MESSAGE_HINTS = ['timeout', 'fetch failed', 'econnreset', 'socket hang up', 'network error'];

function errorChain(error: unknown): readonly Record<string, unknown>[] {
  const chain: Record<string, unknown>[] = [];
  let current: unknown = error;
  while (current !== null && typeof current === 'object' && chain.length < 10) {
    chain.push(current as Record<string, unknown>);
    current = (current as { cause?: unknown }).cause;
  }
  return chain;
}

/**
 * First numeric JSON-RPC code found anywhere in the error chain, if any.
 * Node system errors carry string codes (`ECONNRESET`); those are not
 * JSON-RPC codes and never match here.
 */
export function rpcErrorCode(error: unknown): number | null {
  for (const level of errorChain(error)) {
    const code = level['code'];
    if (typeof code === 'number') return code;
  }
  return null;
}

/**
 * True when a bounded retry can help. Numeric codes and HTTP statuses decide;
 * see the module comment for why messages are only a fallback.
 */
export function isTransientRpcError(error: unknown): boolean {
  const chain = errorChain(error);
  let sawNumericSignal = false;
  for (const level of chain) {
    const code = level['code'];
    if (typeof code === 'number') {
      sawNumericSignal = true;
      if (TRANSIENT_JSON_RPC_CODES.has(code)) return true;
      continue;
    }
    if (typeof code === 'string' && TRANSIENT_TRANSPORT_CODES.has(code)) return true;
    const status = level['status'] ?? level['statusCode'];
    if (typeof status === 'number') {
      sawNumericSignal = true;
      if (TRANSIENT_HTTP_STATUSES.has(status)) return true;
    }
    if (level['name'] === 'TimeoutError') return true;
  }
  if (sawNumericSignal) return false;
  const messages = chain.map((level) => String(level['message'] ?? '').toLowerCase());
  return TRANSIENT_MESSAGE_HINTS.some((hint) => messages.some((message) => message.includes(hint)));
}
