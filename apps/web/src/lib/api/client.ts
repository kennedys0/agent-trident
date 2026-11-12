/** Minimal typed API client. Every payload is parsed with the shared contract schema. */

export type ParseSchema<T> = { parse(input: unknown): T };

export type Envelope<T> = {
  readonly data: T;
  readonly meta: Record<string, unknown>;
};

export class ApiError extends Error {
  readonly code: string;
  readonly requestId: string | null;
  readonly status: number;

  constructor(message: string, options: { code: string; requestId?: string | null; status: number }) {
    super(message);
    this.name = 'ApiError';
    this.code = options.code;
    this.requestId = options.requestId ?? null;
    this.status = options.status;
  }
}

export type Transport = (input: string, init: RequestInit) => Promise<Response>;

const defaultTransport: Transport = (input, init) => globalThis.fetch(input, init);

let transport: Transport = defaultTransport;

/** Test-only seam: replaces the network transport. Production code never calls this. */
export function setTransport(next: Transport): void {
  transport = next;
}

export function resetTransport(): void {
  transport = defaultTransport;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function errorFromBody(body: unknown, status: number): ApiError {
  const record = asRecord(body);
  const error = asRecord(record?.['error']);
  const code = typeof error?.['code'] === 'string' ? error['code'] : `HTTP_${status}`;
  const message = typeof error?.['message'] === 'string' ? error['message'] : `Request failed with status ${status}`;
  const requestId = typeof error?.['requestId'] === 'string' ? error['requestId'] : null;
  return new ApiError(message, { code, requestId, status });
}

type RequestOptions<T> = {
  readonly method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  readonly path: string;
  readonly schema: ParseSchema<T>;
  readonly payload?: unknown;
  readonly signal?: AbortSignal | undefined;
};

async function request<T>(options: RequestOptions<T>): Promise<Envelope<T>> {
  const { method, path, schema, payload, signal } = options;
  const hasBody = payload !== undefined;
  const headers: Record<string, string> = { accept: 'application/json' };
  if (hasBody) {
    headers['content-type'] = 'application/json';
  }

  let response: Response;
  try {
    response = await transport(path, {
      method,
      headers,
      credentials: 'same-origin',
      ...(hasBody ? { body: JSON.stringify(payload) } : {}),
      ...(signal === undefined ? {} : { signal }),
    });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') {
      throw cause;
    }
    throw new ApiError('The API could not be reached', { code: 'NETWORK_ERROR', status: 0 });
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new ApiError('The API returned a response that is not JSON', {
      code: 'BAD_RESPONSE',
      status: response.status,
    });
  }

  if (!response.ok) {
    throw errorFromBody(body, response.status);
  }

  const record = asRecord(body);
  if (record === null || !('data' in record)) {
    throw new ApiError('The API response is missing its data envelope', {
      code: 'BAD_RESPONSE',
      status: response.status,
    });
  }

  let data: T;
  try {
    data = schema.parse(record['data']);
  } catch (cause) {
    throw new ApiError(
      `The API payload does not match the shared contract: ${cause instanceof Error ? cause.message : 'schema mismatch'}`,
      { code: 'CONTRACT_MISMATCH', status: response.status },
    );
  }

  const meta = asRecord(record['meta']) ?? {};
  return { data, meta };
}

export async function apiGet<T>(path: string, schema: ParseSchema<T>, signal?: AbortSignal): Promise<Envelope<T>> {
  return request<T>({ method: 'GET', path, schema, signal });
}

export async function apiPost<T>(
  path: string,
  payload: unknown,
  schema: ParseSchema<T>,
  signal?: AbortSignal,
): Promise<Envelope<T>> {
  return request<T>({ method: 'POST', path, schema, payload, signal });
}

/** DELETE for idempotent removals; no body, response still validated. */
export async function apiDelete<T>(path: string, schema: ParseSchema<T>, signal?: AbortSignal): Promise<Envelope<T>> {
  return request<T>({ method: 'DELETE', path, schema, signal });
}

/** PUT for idempotent upserts (watchlist add). */
export async function apiPut<T>(
  path: string,
  payload: unknown,
  schema: ParseSchema<T>,
  signal?: AbortSignal,
): Promise<Envelope<T>> {
  return request<T>({ method: 'PUT', path, schema, payload, signal });
}
