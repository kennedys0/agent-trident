import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import { resetTransport } from '../src/lib/api/client.js';

afterEach(() => {
  cleanup();
  resetTransport();
});