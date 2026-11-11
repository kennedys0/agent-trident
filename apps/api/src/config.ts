import { z } from 'zod';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SUPPORTED_MODES = ['OBSERVE', 'PAPER'] as const;
export type ExecutionMode = (typeof SUPPORTED_MODES)[number];

export const ROBINHOOD_CHAIN_ID = 4663;

const envSchema = z.object({
  EXECUTION_MODE: z.enum(SUPPORTED_MODES).default('PAPER'),
  RPC_URL: z.string().url().startsWith('https://'),
  EXPECTED_CHAIN_ID: z.coerce.number().int().positive().default(ROBINHOOD_CHAIN_ID),
  DATABASE_PATH: z.string().min(1).default('./data/trident.sqlite'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  HOST: z.string().min(1).default('127.0.0.1'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug']).default('info'),
  MARKET_FRESHNESS_SECONDS: z.coerce.number().int().positive().default(30),
  OPENING_CASH_USDG_BASE: z.string().regex(/^\d+$/).default('10000000000'),
});

export type Config = {
  readonly mode: ExecutionMode;
  readonly rpcUrl: string;
  readonly expectedChainId: number;
  readonly databasePath: string;
  readonly port: number;
  readonly host: string;
  readonly logLevel: string;
  readonly marketFreshnessSeconds: number;
  readonly openingCashUsdgBase: string;
};

/**
 * Parses configuration and fails closed. An unknown execution mode, a non-HTTPS
 * RPC URL, or a chain id other than the verified Robinhood Chain id aborts boot.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Invalid configuration: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  }
  const value = parsed.data;
  if (value.EXECUTION_MODE !== 'OBSERVE' && value.EXECUTION_MODE !== 'PAPER') {
    throw new Error(`Unsupported execution mode: ${String(value.EXECUTION_MODE)}`);
  }
  if (value.EXPECTED_CHAIN_ID !== ROBINHOOD_CHAIN_ID) {
    throw new Error(`Expected chain id must be ${ROBINHOOD_CHAIN_ID}, received ${value.EXPECTED_CHAIN_ID}`);
  }
  return {
    mode: value.EXECUTION_MODE,
    rpcUrl: value.RPC_URL,
    expectedChainId: value.EXPECTED_CHAIN_ID,
    databasePath: value.DATABASE_PATH,
    port: value.PORT,
    host: value.HOST,
    logLevel: value.LOG_LEVEL,
    marketFreshnessSeconds: value.MARKET_FRESHNESS_SECONDS,
    openingCashUsdgBase: value.OPENING_CASH_USDG_BASE,
  };
}

export function packageRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..');
}