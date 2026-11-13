import { describe, expect, it } from 'vitest';
import { isTransientRpcError, rpcErrorCode } from '../src/chain/errors.js';

/**
 * The classifier mirrors real provider error shapes: viem wraps a JSON-RPC
 * error as RpcRequestError (numeric `code` at every level), an HTTP failure as
 * HttpRequestError (numeric `status`), and a network failure as a TypeError
 * chain ending in a Node system error (string `code`).
 */
describe('RPC error classification', () => {
  it('reads the numeric JSON-RPC code through the cause chain', () => {
    const wrapped = Object.assign(new Error('RPC Request failed'), {
      cause: Object.assign(new Error('provider copy'), { code: -32603 }),
    });
    expect(rpcErrorCode(wrapped)).toBe(-32603);
    expect(rpcErrorCode(new Error('no code'))).toBeNull();
    expect(rpcErrorCode(Object.assign(new Error('system'), { code: 'ECONNRESET' }))).toBeNull();
  });

  it('decides by numeric code and never by message text', () => {
    // A params error whose message happens to say "timeout" is not transient.
    const paramsError = Object.assign(new Error('Invalid parameters'), {
      code: -32602,
      cause: Object.assign(new Error('timeout happened'), { code: -32602 }),
    });
    expect(isTransientRpcError(paramsError)).toBe(false);
    // A server-side error whose message is calm is transient.
    const internal = Object.assign(new Error('oops'), { code: -32603 });
    expect(isTransientRpcError(internal)).toBe(true);
  });

  it('treats retryable HTTP statuses as transient and others as not', () => {
    expect(isTransientRpcError(Object.assign(new Error('HTTP request failed'), { status: 503 }))).toBe(true);
    expect(isTransientRpcError(Object.assign(new Error('HTTP request failed'), { status: 429 }))).toBe(true);
    expect(isTransientRpcError(Object.assign(new Error('HTTP request failed'), { status: 400 }))).toBe(false);
  });

  it('treats transport failures without any numeric code as transient', () => {
    const cause = Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' });
    expect(isTransientRpcError(new TypeError('fetch failed', { cause }))).toBe(true);
    expect(isTransientRpcError(new Error('socket hang up'))).toBe(true);
    expect(isTransientRpcError(new Error('gateway exploded'))).toBe(false);
  });

  it('keeps ambiguous server codes non-transient so reverts are not retried', () => {
    const revert = Object.assign(new Error('execution reverted'), { code: -32000 });
    expect(isTransientRpcError(revert)).toBe(false);
  });
});
