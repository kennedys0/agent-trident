import { describe, expect, it } from 'vitest';

describe('deliberate CI failure probe', () => {
  it('proves a failing test makes the deterministic workflow red', () => {
    expect(1).toBe(2);
  });
});
