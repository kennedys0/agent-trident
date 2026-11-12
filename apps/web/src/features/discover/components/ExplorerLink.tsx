import type { ReactNode } from 'react';
import { ExternalLink } from 'lucide-react';

/**
 * The explorer host for Robinhood Chain 4663 is a product decision, not a
 * frontend one, and this repository does not record one. Rather than link to a
 * guessed host (or ship a dead control), the base URL comes from
 * `VITE_CHAIN_EXPLORER_URL` and the UI says so when it is unset.
 */
const configured: unknown = import.meta.env['VITE_CHAIN_EXPLORER_URL'];

export function explorerAddressUrl(address: string): string | null {
  if (typeof configured !== 'string' || configured.trim() === '') {
    return null;
  }
  let base: URL;
  try {
    base = new URL(configured.trim());
  } catch {
    return null;
  }
  if (base.protocol !== 'https:') {
    return null;
  }
  return `${base.toString().replace(/\/+$/, '')}/address/${address}`;
}

export function ExplorerLink({ address }: { readonly address: string }): ReactNode {
  const url = explorerAddressUrl(address);
  if (url === null) {
    return (
      <span className="meta" data-testid="explorer-unavailable">
        Explorer link unavailable — no chain-4663 explorer URL is configured for this build.
      </span>
    );
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer noopener"
      data-testid="explorer-link"
      aria-label={`View ${address} on the chain explorer`}
    >
      View contract on explorer <ExternalLink size={14} aria-hidden="true" />
    </a>
  );
}