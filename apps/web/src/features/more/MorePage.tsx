import { type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { endpoints } from '../../lib/api/endpoints.js';
import { useResource } from '../../lib/api/hooks.js';
import { formatUtc } from '../../lib/format.js';
import { PAIR } from '../../lib/pair.js';
import { useStatus } from '../../app/StatusProvider.js';
import { AddressChip } from '../../components/AddressChip.js';
import { Badge } from '../../components/Badge.js';
import { Panel } from '../../components/Panel.js';
import { StateView } from '../../components/StateView.js';
import { SubjectHeader } from '../../components/SubjectHeader.js';
import { ThemeToggle } from '../../components/ThemeToggle.js';

export function MorePage(): ReactNode {
  const { health } = useStatus();
  const venues = useResource(endpoints.venues(), { intervalMs: 60_000 });
  const healthData = health.data;

  return (
    <>
      <SubjectHeader
        title="More"
        description="Resources that do not need their own primary destination: the audit journal, the verified venue allowlist, and display preferences."
      />

      <Panel title="Journal">
        <p className="meta">Every state change the backend records, newest first.</p>
        <Link className="btn" to="/journal">
          Open the audit journal
        </Link>
      </Panel>

      <Panel title="Verified venue">
        {venues.isLoading ? (
          <StateView kind="loading" title="Loading the venue allowlist…" testId="venues-loading" />
        ) : venues.error !== null ? (
          <StateView
            kind="error"
            title="The venue allowlist could not be loaded"
            text={venues.error.message}
            onRetry={venues.refresh}
            testId="venues-error"
          />
        ) : venues.data === null || venues.data.length === 0 ? (
          <StateView kind="empty" title="No venue is allowlisted" testId="venues-empty" />
        ) : (
          <div className="stack">
            {venues.data.map((venue) => (
              <dl className="facts facts--two" key={venue.pool}>
                <div className="fact">
                  <dt>Chain</dt>
                  <dd className="mono">{venue.chainId}</dd>
                </div>
                <div className="fact">
                  <dt>Fee tier</dt>
                  <dd className="mono">{(venue.fee / 10_000).toFixed(2)}%</dd>
                </div>
                <div className="fact">
                  <dt>Pool</dt>
                  <dd>
                    <AddressChip address={venue.pool} full />
                  </dd>
                </div>
                <div className="fact">
                  <dt>Factory</dt>
                  <dd>
                    <AddressChip address={venue.factory} full />
                  </dd>
                </div>
                <div className="fact">
                  <dt>Token 0</dt>
                  <dd>
                    <AddressChip address={venue.token0} full />
                  </dd>
                </div>
                <div className="fact">
                  <dt>Token 1</dt>
                  <dd>
                    <AddressChip address={venue.token1} full />
                  </dd>
                </div>
                <div className="fact">
                  <dt>Provenance</dt>
                  <dd>
                    <ul>
                      {venue.provenance.map((url) => (
                        <li key={url}>
                          <a href={url} rel="noreferrer noopener" target="_blank">
                            {url}
                          </a>
                        </li>
                      ))}
                    </ul>
                  </dd>
                </div>
              </dl>
            ))}
          </div>
        )}
      </Panel>

      <Panel title="Runtime">
        <div className="rows">
          <div className="row">
            <span className="row__label">Mode</span>
            <span className="row__value">
              <Badge tone="wait">{healthData?.mode ?? 'PAPER'} — simulated only</Badge>
            </span>
          </div>
          <div className="row">
            <span className="row__label">Chain</span>
            <span className="row__value mono">{healthData === null ? 'Unavailable' : healthData.chainId}</span>
          </div>
          <div className="row">
            <span className="row__label">RPC</span>
            <span className="row__value mono">{healthData === null ? 'Unavailable' : healthData.rpcStatus}</span>
          </div>
          <div className="row">
            <span className="row__label">Last response</span>
            <span className="row__value mono">
              {health.receivedAt === null ? 'Unavailable' : formatUtc(new Date(health.receivedAt).toISOString())}
            </span>
          </div>
          <div className="row">
            <span className="row__label">Pair</span>
            <span className="row__value mono">
              {PAIR.base.symbol}/{PAIR.quote.symbol}
            </span>
          </div>
        </div>
        <p className="meta">
          This build has no LIVE control: the execution mode enum accepted by the backend is OBSERVE or PAPER only.
        </p>
      </Panel>

      <Panel title="Display">
        <div className="inline" style={{ justifyContent: 'space-between' }}>
          <p className="meta">Theme is stored in this browser only.</p>
          <ThemeToggle />
        </div>
      </Panel>
    </>
  );
}