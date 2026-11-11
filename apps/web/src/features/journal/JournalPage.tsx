import { type ReactNode } from 'react';
import { formatUtc } from '../../lib/format.js';
import { useStatus } from '../../app/StatusProvider.js';
import { Panel } from '../../components/Panel.js';
import { StateView } from '../../components/StateView.js';
import { SubjectHeader } from '../../components/SubjectHeader.js';
import { useJournalFeed } from './useJournalFeed.js';

export function JournalPage(): ReactNode {
  const feed = useJournalFeed();
  const { online } = useStatus();

  return (
    <>
      <SubjectHeader
        title="Journal"
        description="Append-only audit events recorded by the backend. Payloads are shown as stored; nothing is rewritten in the browser."
      />

      <Panel
        title="Audit events"
        actions={
          <button type="button" className="btn btn--quiet" onClick={feed.refresh}>
            Refresh
          </button>
        }
      >
        {feed.status === 'loading' ? (
          <StateView kind="loading" title="Loading journal events…" testId="journal-loading" />
        ) : feed.status === 'error' ? (
          <StateView
            kind={online ? 'error' : 'offline'}
            title="The journal could not be loaded"
            text={feed.error?.message ?? 'Unknown error'}
            onRetry={feed.refresh}
            testId="journal-error"
          />
        ) : feed.events.length === 0 ? (
          <StateView
            kind="empty"
            title="The journal is empty"
            text="No audit event has been recorded yet. The backend writes the first event when it starts a run."
            testId="journal-empty"
          />
        ) : (
          <div className="journal" data-testid="journal-list">
            {feed.events.map((event) => (
              <details className="journal__item" key={event.id}>
                <summary className="journal__summary">
                  <span className="inline">
                    <code>{event.type}</code>
                    <span className="meta">{event.aggregateId.slice(0, 12)}…</span>
                  </span>
                  <span className="meta mono">{formatUtc(event.createdAt)}</span>
                </summary>
                <pre className="journal__payload">{JSON.stringify(event.payload, null, 2)}</pre>
              </details>
            ))}
          </div>
        )}
        {feed.hasMore ? (
          <button type="button" className="btn btn--quiet" onClick={feed.loadMore} disabled={feed.loadingMore}>
            {feed.loadingMore ? 'Loading older events…' : 'Load older events'}
          </button>
        ) : (
          <p className="meta">End of the journal as returned by the backend.</p>
        )}
      </Panel>
    </>
  );
}