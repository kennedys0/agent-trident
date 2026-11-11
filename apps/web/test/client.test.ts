import { describe, expect, it } from 'vitest';
import { portfolioSchema } from '@trident/api-contract';
import { ApiError, apiGet, apiPost, setTransport } from '../src/lib/api/client.js';
import { endpoints, intentExecution } from '../src/lib/api/endpoints.js';
import { PAIR } from '../src/lib/pair.js';

const portfolioBody = {
  data: {
    mode: 'PAPER',
    asOf: '2026-11-11T04:00:00Z',
    balances: [
      { asset: PAIR.quote.address, available: { value: '9499950000', decimals: 6 }, reserved: { value: '0', decimals: 6 } },
    ],
    positions: [],
    equityQuote: { value: '9999897923', decimals: 6 },
    realizedPnlQuote: { value: '0', decimals: 6 },
    unrealizedPnlQuote: { value: '-102077', decimals: 6 },
  },
  meta: { requestId: 'req-1', observedAt: '2026-11-11T04:00:01Z' },
};

function respond(body: unknown, status = 200): void {
  setTransport(async () =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }),
  );
}

describe('apiGet', () => {
  it('returns the payload parsed by the shared contract schema', async () => {
    respond(portfolioBody);
    const envelope = await apiGet('/api/v1/portfolio', portfolioSchema);
    expect(envelope.data.mode).toBe('PAPER');
    expect(envelope.data.equityQuote.value).toBe('9999897923');
    expect(envelope.meta['requestId']).toBe('req-1');
  });

  it('rejects a payload that drifts from the contract', async () => {
    respond({ ...portfolioBody, data: { ...portfolioBody.data, equityQuote: 'not-an-amount' } });
    await expect(apiGet('/api/v1/portfolio', portfolioSchema)).rejects.toMatchObject({
      name: 'ApiError',
      code: 'CONTRACT_MISMATCH',
    });
  });

  it('surfaces the backend error envelope with its code and request id', async () => {
    respond({ error: { code: 'KILL_SWITCH', message: 'Entries are stopped', details: null, requestId: 'req-9' } }, 409);
    const failure = await apiGet('/api/v1/portfolio', portfolioSchema).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ApiError);
    expect(failure).toMatchObject({ code: 'KILL_SWITCH', status: 409, requestId: 'req-9' });
  });

  it('reports an unreachable API without leaking a stack', async () => {
    setTransport(async () => {
      throw new TypeError('fetch failed');
    });
    await expect(apiGet('/api/v1/portfolio', portfolioSchema)).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
      status: 0,
    });
  });

  it('treats a non-JSON body as a bad response', async () => {
    setTransport(async () => new Response('<html>proxy error</html>', { status: 502 }));
    await expect(apiGet('/api/v1/portfolio', portfolioSchema)).rejects.toMatchObject({ code: 'BAD_RESPONSE' });
  });

  it('keeps every endpoint path in the documented API surface', () => {
    expect(endpoints.health().path).toBe('/health');
    expect(endpoints.portfolio().path).toBe('/api/v1/portfolio');
    expect(endpoints.candidates(5).path).toBe('/api/v1/candidates?limit=5');
    expect(endpoints.journal(10, 42).path).toBe('/api/v1/journal?limit=10&before=42');
    expect(endpoints.intent('abc').path).toBe('/api/v1/intents/abc');
  });
});

describe('intent execution contract', () => {
  it('rejects the legacy flat intent response that the current backend branch still returns', async () => {
    respond({
      data: { intent: { id: 'intent-1' }, riskDecision: null },
      meta: { requestId: 'req-1', orderId: 'order-1', fillId: 'fill-1', replayed: false },
    });
    await expect(
      apiPost('/api/v1/intents', { evaluationId: 'eval-1', idempotencyKey: 'key-00000001' }, intentExecution),
    ).rejects.toMatchObject({ code: 'CONTRACT_MISMATCH' });
  });

  it('accepts an execution whose order and fill are explicit nulls on rejection', async () => {
    respond({
      data: {
        intent: {
          id: 'intent-1',
          evaluationId: 'eval-1',
          idempotencyKey: 'key-00000001',
          mode: 'PAPER',
          side: 'BUY',
          token: PAIR.base.address,
          quoteToken: PAIR.quote.address,
          baseQty: '1',
          limitPrice: { value: '1', scale: '1' },
          snapshotId: 'snap-1',
          expiresAt: '2026-11-11T04:10:00.000Z',
          status: 'REJECTED',
        },
        riskDecision: {
          intentId: 'intent-1',
          policyVersion: 'paper-risk-v1',
          portfolioVersion: 'ledger:3',
          verdict: 'REJECTED',
          reasons: ['R02_kill_switch: blocked'],
          evaluatedAt: '2026-11-11T04:00:00.000Z',
          rules: [{ rule: 'R02_kill_switch', observed: true, threshold: false, status: 'FAIL', reason: 'blocked' }],
        },
        order: null,
        fill: null,
      },
      meta: { requestId: 'req-1', observedAt: '2026-11-11T04:00:02.000Z', replayed: false },
    });
    const envelope = await apiPost('/api/v1/intents', {}, intentExecution);
    expect(envelope.data.fill).toBeNull();
    expect(envelope.meta['replayed']).toBe(false);
  });
});
