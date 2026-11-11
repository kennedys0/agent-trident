import { apiPost } from './client.js';
import type { ParseSchema } from './client.js';

const haltResultSchema: ParseSchema<{ killSwitchEngaged: boolean }> = {
  parse: (input: unknown) => {
    if (typeof input !== 'object' || input === null) {
      throw new Error('Expected a halt result object');
    }
    const engaged = (input as Record<string, unknown>)['killSwitchEngaged'];
    if (typeof engaged !== 'boolean') {
      throw new Error('Expected killSwitchEngaged to be a boolean');
    }
    return { killSwitchEngaged: engaged };
  },
};

export async function setKillSwitch(engaged: boolean): Promise<{ killSwitchEngaged: boolean }> {
  const envelope = await apiPost('/api/v1/system/halt', { engaged }, haltResultSchema);
  return envelope.data;
}

export function readFlag(meta: Record<string, unknown>, key: string): boolean | null {
  const value = meta[key];
  return typeof value === 'boolean' ? value : null;
}

export function readNumber(meta: Record<string, unknown>, key: string): number | null {
  const value = meta[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function readString(meta: Record<string, unknown>, key: string): string | null {
  const value = meta[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}