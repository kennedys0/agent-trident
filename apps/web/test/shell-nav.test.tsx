import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { StatusProvider } from '../src/app/StatusProvider.js';
import { Shell } from '../src/components/Shell.js';
import { setTransport } from '../src/lib/api/client.js';

/**
 * Navigation contract for the Soft Bento exploration (issue #39): the mobile
 * bottom bar carries exactly the five labelled primary destinations, every
 * nav entry is a real route (no placeholder pages for Watchlist/Strategy/
 * Settings), and the PAPER and kill-switch badges keep their honest tones.
 */
function useTransport(killSwitch: boolean): void {
  setTransport(async () =>
    new Response(
      JSON.stringify({
        data: { mode: 'PAPER', chainId: 4663, rpcStatus: 'HEALTHY', headBlock: '123456', lagSeconds: 2 },
        meta: { killSwitchEngaged: killSwitch, rpcLatencyMs: 42 },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ),
  );
}

function renderShell(): void {
  render(
    <StatusProvider>
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="*" element={<Shell />} />
        </Routes>
      </MemoryRouter>
    </StatusProvider>,
  );
}

describe('bottom navigation (mobile)', () => {
  it('carries exactly the five labelled primary destinations, in order', async () => {
    useTransport(false);
    renderShell();
    const nav = screen.getByRole('navigation', { name: 'Primary' });
    const links = nav.querySelectorAll('a');
    expect([...links].map((link) => link.getAttribute('href'))).toEqual([
      '/',
      '/discover',
      '/portfolio',
      '/risk',
      '/more',
    ]);
    expect([...links].map((link) => link.textContent)).toEqual(['Overview', 'Discover', 'Portfolio', 'Risk', 'More']);
    for (const id of ['bottom-nav-overview', 'bottom-nav-discover', 'bottom-nav-portfolio', 'bottom-nav-risk', 'bottom-nav-more']) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
    }
  });
});

describe('navigation honesty', () => {
  it('sidebar sections and resources link only to real routes', () => {
    useTransport(false);
    renderShell();
    for (const id of ['nav-overview', 'nav-discover', 'nav-candidates', 'nav-risk', 'nav-portfolio', 'nav-more']) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
    }
    const journal = screen.getByRole('link', { name: 'Journal' });
    expect(journal).toHaveAttribute('href', '/journal');
  });

  it('never links to placeholder pages that do not exist', () => {
    useTransport(false);
    renderShell();
    const hrefs = [...document.querySelectorAll('a')].map((link) => link.getAttribute('href'));
    for (const fake of ['/watchlist', '/strategy', '/settings']) {
      expect(hrefs).not.toContain(fake);
    }
  });

  it('keeps the PAPER badge on the testnet (lavender) tone, not a status tone', () => {
    useTransport(false);
    renderShell();
    const paper = screen.getByText('PAPER — SIMULATED');
    expect(paper.className).toContain('badge--testnet');
  });

  it('renders the kill-switch badge in the filled halted state only when engaged', async () => {
    useTransport(true);
    renderShell();
    const halted = await screen.findByText('Entries stopped');
    expect(halted.className).toContain('badge--halted');
  });

  it('shows no halted badge when entries are allowed', async () => {
    useTransport(false);
    renderShell();
    await screen.findByText(/RPC healthy/);
    expect(screen.queryByText('Entries stopped')).not.toBeInTheDocument();
  });
});
