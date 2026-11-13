import type { ReactNode } from 'react';
import { ExternalLink } from 'lucide-react';

/**
 * The explorer host for Robinhood Chain 4663 is a product decision, not a
 * frontend one, and this repository does not record one. Rather than link to a
 * guessed host (or ship a dead control), the base URL comes from
 * `VITE_CHAIN_EXPLORER_URL` and the UI says so when it is unset.
 *
 * The base URL is read on every call instead of once at module load, so the
 * value cannot go stale behind a build flag, and the address is checked
 * against the chain address format before it reaches a URL.
 */

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

function configuredExplorerBase(): string | null {
  const configured: unknown = import.meta.env['VITE_CHAIN_EXPLORER_URL'];
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
  return base.toString().replace(/\/+$/, '');
}

export function explorerAddressUrl(address: string): string | null {
  if (!ADDRESS_PATTERN.test(address)) {
    return null;
  }
  const base = configuredExplorerBase();
  if (base === null) {
    return null;
  }
  return `${base}/address/${address}`;
}

export function ExplorerLink({ address }: { readonly address: string }): ReactNode {
  const url = explorerAddressUrl(address);
  if (url === null) {
    if (!ADDRESS_PATTERN.test(address)) {
      return (
        <span className="meta" data-testid="explorer-invalid-address">
          Explorer link unavailable — the address is not a valid 0x chain address.
        </span>
      );
    }
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