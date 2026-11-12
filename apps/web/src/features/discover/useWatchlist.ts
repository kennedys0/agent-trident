import { useCallback, useMemo, useState } from 'react';
import { apiDelete, apiPost } from '../../lib/api/client.js';
import { useResource } from '../../lib/api/hooks.js';
import {
  createWatchlistEntry,
  watchlistAddPath,
  watchlistEndpoint,
  watchlistMutation,
  watchlistRemovePath,
} from './discoverApi.js';

type WatchlistError = {
  readonly address: string;
  readonly message: string;
};

export type WatchlistControls = {
  readonly isWatching: (address: string) => boolean;
  readonly isPending: (address: string) => boolean;
  readonly toggle: (address: string, name: string) => void;
  readonly retry: () => void;
  readonly error: WatchlistError | null;
  readonly message: string | null;
  readonly isLoading: boolean;
  readonly count: number;
  readonly refresh: () => void;
};

/**
 * The watchlist is server-persisted (S3-02 `watchlist_entries`). One toggle is
 * one idempotent request: POST `{address}` adds, DELETE `/watchlist/:address`
 * removes. There is no optimistic update and no local storage, so the pressed
 * state only changes from a server response and two browsers agree.
 */
export function useWatchlist(): WatchlistControls {
  const list = useResource(watchlistEndpoint(), { intervalMs: 60_000 });
  const [overrides, setOverrides] = useState<Readonly<Record<string, boolean>>>({});
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<WatchlistError | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [lastAttempt, setLastAttempt] = useState<{ address: string; name: string } | null>(null);

  const watching = useMemo(() => {
    const set = new Set<string>();
    for (const entry of list.data?.entries ?? []) {
      set.add(entry.address.toLowerCase());
    }
    for (const [address, value] of Object.entries(overrides)) {
      if (value) {
        set.add(address);
      } else {
        set.delete(address);
      }
    }
    return set;
  }, [list.data, overrides]);

  const toggle = useCallback(
    (address: string, name: string) => {
      const key = address.toLowerCase();
      if (pending.has(key)) {
        return;
      }
      const currentlyWatching = watching.has(key);
      setPending((previous) => new Set(previous).add(key));
      setError(null);
      setMessage(null);
      setLastAttempt({ address: key, name });

      const send = currentlyWatching
        ? apiDelete(watchlistRemovePath(key), watchlistMutation)
        : apiPost(watchlistAddPath, createWatchlistEntry.parse({ address: key }), watchlistMutation);

      void send
        .then((envelope) => {
          const watchingNow = envelope.data.result === 'ADDED' || envelope.data.result === 'EXISTING';
          setOverrides((previous) => ({ ...previous, [key]: watchingNow }));
          setMessage(`${name} ${watchingNow ? 'added to' : 'removed from'} watchlist`);
          list.refresh();
        })
        .catch((cause: unknown) => {
          setError({
            address: key,
            message: cause instanceof Error ? cause.message : 'Unknown watchlist error',
          });
        })
        .finally(() => {
          setPending((previous) => {
            const next = new Set(previous);
            next.delete(key);
            return next;
          });
        });
    },
    [list, pending, watching],
  );

  const retry = useCallback(() => {
    if (lastAttempt !== null) {
      toggle(lastAttempt.address, lastAttempt.name);
    }
  }, [lastAttempt, toggle]);

  return {
    isWatching: (address: string) => watching.has(address.toLowerCase()),
    isPending: (address: string) => pending.has(address.toLowerCase()),
    toggle,
    retry,
    error,
    message,
    isLoading: list.isLoading,
    count: watching.size,
    refresh: list.refresh,
  };
}