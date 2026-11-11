import { useCallback, useEffect, useRef, useState } from 'react';
import type { AuditEvent } from '@trident/api-contract';
import { apiGet } from '../../lib/api/client.js';
import { endpoints } from '../../lib/api/endpoints.js';

export type JournalFeed = {
  readonly events: AuditEvent[];
  readonly status: 'loading' | 'ready' | 'error';
  readonly error: Error | null;
  readonly hasMore: boolean;
  readonly loadingMore: boolean;
  readonly refresh: () => void;
  readonly loadMore: () => void;
};

const PAGE_SIZE = 50;

export function useJournalFeed(): JournalFeed {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<Error | null>(null);
  const [cursor, setCursor] = useState<number | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [tick, setTick] = useState(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    const load = async (): Promise<void> => {
      try {
        const page = await apiGet(endpoints.journal(PAGE_SIZE).path, endpoints.journal(PAGE_SIZE).schema, controller.signal);
        if (!mounted.current) {
          return;
        }
        setEvents(page.data.events);
        setCursor(page.data.nextCursor === null ? null : Number(page.data.nextCursor));
        setHasMore(page.data.nextCursor !== null);
        setStatus('ready');
        setError(null);
      } catch (cause) {
        if (controller.signal.aborted || !mounted.current) {
          return;
        }
        setError(cause instanceof Error ? cause : new Error('Unknown journal error'));
        setStatus('error');
      }
    };
    void load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void load();
      }
    }, 15_000);
    return () => {
      mounted.current = false;
      controller.abort();
      window.clearInterval(timer);
    };
  }, [tick]);

  const refresh = useCallback(() => setTick((value) => value + 1), []);

  const loadMore = useCallback(() => {
    if (cursor === null || loadingMore) {
      return;
    }
    setLoadingMore(true);
    const endpoint = endpoints.journal(PAGE_SIZE, cursor);
    apiGet(endpoint.path, endpoint.schema)
      .then((page) => {
        if (!mounted.current) {
          return;
        }
        setEvents((previous) => {
          const seen = new Set(previous.map((event) => event.id));
          return [...previous, ...page.data.events.filter((event) => !seen.has(event.id))];
        });
        setCursor(page.data.nextCursor === null ? null : Number(page.data.nextCursor));
        setHasMore(page.data.nextCursor !== null);
      })
      .catch((cause: unknown) => {
        if (mounted.current) {
          setError(cause instanceof Error ? cause : new Error('Unknown journal error'));
        }
      })
      .finally(() => {
        if (mounted.current) {
          setLoadingMore(false);
        }
      });
  }, [cursor, loadingMore]);

  return { events, status, error, hasMore, loadingMore, refresh, loadMore };
}