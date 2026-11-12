import { expect, it } from 'vitest';

it('deliberately fails to prove the CI gate is fail-closed', () => {
  expect(1).toBe(2);
});
