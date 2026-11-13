import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { render, screen } from '@testing-library/react';
import { ExplorerLink, explorerAddressUrl } from '../src/features/discover/components/ExplorerLink.js';

const ADDRESS = '0x52e65b17fb6e5ba00ed806f37afcd2daa50271ca';

describe('explorerAddressUrl', () => {
  it('returns null when no explorer URL is configured', () => {
    vi.stubEnv('VITE_CHAIN_EXPLORER_URL', '');
    expect(explorerAddressUrl(ADDRESS)).toBeNull();
    vi.unstubAllEnvs();
  });

  it('returns null for a configured URL that is not https', () => {
    vi.stubEnv('VITE_CHAIN_EXPLORER_URL', 'http://explorer.example');
    expect(explorerAddressUrl(ADDRESS)).toBeNull();
    vi.unstubAllEnvs();
  });

  it('returns null for an address that is not a 0x chain address', () => {
    vi.stubEnv('VITE_CHAIN_EXPLORER_URL', 'https://explorer.example');
    expect(explorerAddressUrl('not-an-address')).toBeNull();
    expect(explorerAddressUrl('0x1234')).toBeNull();
    expect(explorerAddressUrl('https://evil.example/steal')).toBeNull();
    vi.unstubAllEnvs();
  });

  it('builds an address URL from a configured https base', () => {
    vi.stubEnv('VITE_CHAIN_EXPLORER_URL', 'https://explorer.example/');
    expect(explorerAddressUrl(ADDRESS)).toBe(`https://explorer.example/address/${ADDRESS}`);
    vi.unstubAllEnvs();
  });

  it('says the address is invalid instead of claiming the explorer is unconfigured', () => {
    vi.stubEnv('VITE_CHAIN_EXPLORER_URL', 'https://explorer.example');
    render(createElement(ExplorerLink, { address: 'not-an-address' }));
    expect(screen.getByTestId('explorer-invalid-address')).toHaveTextContent('not a valid 0x chain address');
    expect(screen.queryByTestId('explorer-unavailable')).toBeNull();
    vi.unstubAllEnvs();
  });
});
