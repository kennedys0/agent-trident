import { useCallback, useEffect, useRef, useState } from 'react';
import { apiGet } from './client.js';
import type { Endpoint } from './endpoints.js';

export type ResourceState<T> = {
  readonly data: T | null;
  readonly meta: Record<string, unknown>;
  readonly error: Error | null;
  /** First load with no data yet. */
  readonly isLoading: boolean;
  /** A refresh is in flight while previous data is still displayed. */
  readonly isRefetching: boolean;
  readonly receivedAt: number | null;
  readonly refresh: () => void;
};

type Options = {
  readonly intervalMs?: number;
  readonly enabled?: boolean;
};

const INITIAL = {
  data: null,
  meta: {},
  error: null,
  isLoading: true,
  isRefetching: false,
  receivedAt: null,
} as const;

export function useResource<T>(endpoint: Endpoint<T>, options: Options = {}): ResourceState<T> {
  const { intervalMs, enabled = true } = options;
  const [state, setState] = useState<Omit<ResourceState<T>, 'refresh'>>(INITIAL);
  const [tick, setTick] = useState(0);
  const hasData = useRef(false);
  const path = endpoint.path;

  useEffect(() => {
    if (!enabled) {
      return undefined;
    }
    const controller = new AbortController();
    let stopped = false;

    const load = async (): Promise<void> => {
      if (hasData.current) {
        setState((previous) => ({ ...previous, isRefetching: true }));
      }
      try {
        const envelope = await apiGet(path, endpoint.schema, controller.signal);
        if (stopped) {
          return;
        }
        hasData.current = true;
        setState({
          data: envelope.data,
          meta: envelope.meta,
          error: null,
          isLoading: false,
          isRefetching: false,
          receivedAt: Date.now(),
        });
      } catch (cause) {
        if (stopped || controller.signal.aborted) {
          return;
        }
        setState((previous) => ({
          ...previous,
          error: cause instanceof Error ? cause : new Error('Unknown API error'),
          isLoading: false,
          isRefetching: false,
        }));
      }
    };

    void load();

    if (intervalMs !== undefined && intervalMs > 0) {
      const timer = window.setInterval(() => {
        if (document.visibilityState === 'visible') {
          void load();
        }
      }, intervalMs);
      return () => {
        stopped = true;
        controller.abort();
        window.clearInterval(timer);
      };
    }

    return () => {
      stopped = true;
      controller.abort();
    };
    // The endpoint object is recreated per render; path and schema are stable inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, intervalMs, enabled, tick]);

  const refresh = useCallback(() => {
    setTick((value) => value + 1);
  }, []);

  return { ...state, refresh };
}

/** Ticking clock for relative timestamps; keeps SSR-free rendering cheap. */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  useEffect(() => {
    const onOnline = (): void => setOnline(true);
    const onOffline = (): void => setOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);
  return online;
}