import { useCallback, useEffect, useState } from 'react';
import type { AuditEvent } from '@trident/api-contract';
import { apiGet } from '../../lib/api/client.js';
import { endpoints } from '../../lib/api/endpoints.js';
import { useResource } from '../../lib/api/hooks.js';

/** Risk decisions are journaled with their intent id; the intent endpoint returns the full evidence. */
export function intentIdsFromJournal(events: readonly AuditEvent[], max: number): string[] {
  const ids: string[] = [];
  for (const event of events) {
    if (event.type !== 'risk.decision.recorded') {
      continue;
    }
    const id = event.payload['intentId'];
    if (typeof id === 'string' && !ids.includes(id)) {
      ids.push(id);
      if (ids.length >= max) {
        break;
      }
    }
  }
  return ids;
}

export function useIntentDecision(intentId: string | null) {
  const endpoint = endpoints.intent(intentId ?? 'none');
  return useResource(endpoint, { enabled: intentId !== null });
}

export type RiskDecisionScan = {
  readonly intentIds: string[];
  /** How many recent audit events were inspected to find the decisions. */
  readonly scanned: number;
  /** True when the scan reached the start of the journal instead of its page budget. */
  readonly exhausted: boolean;
  readonly status: 'loading' | 'ready' | 'error';
  readonly error: Error | null;
  readonly refresh: () => void;
};

const PAGE_SIZE = 100;
const MAX_PAGES = 5;
const SCAN_INTERVAL_MS = 30_000;

/**
 * The worker writes snapshot and evaluation events every ten seconds, so the most
 * recent journal page rarely contains a risk decision. Walk back a bounded number
 * of pages and report exactly how far the scan went; never claim "none" without it.
 */
export function useRiskDecisionScan(maxIntents: number): RiskDecisionScan {
  const [state, setState] = useState<Omit<RiskDecisionScan, 'refresh'>>({
    intentIds: [],
    scanned: 0,
    exhausted: false,
    status: 'loading',
    error: null,
  });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    const run = async (): Promise<void> => {
      try {
        const ids: string[] = [];
        let cursor: number | null = null;
        let scanned = 0;
        let exhausted = false;

        for (let page = 0; page < MAX_PAGES; page += 1) {
          const endpoint = endpoints.journal(PAGE_SIZE, cursor ?? undefined);
          const response = await apiGet(endpoint.path, endpoint.schema, controller.signal);
          scanned += response.data.events.length;
          for (const id of intentIdsFromJournal(response.data.events, maxIntents)) {
            if (!ids.includes(id)) {
              ids.push(id);
            }
          }
          if (response.data.nextCursor === null) {
            exhausted = true;
            break;
          }
          if (ids.length >= maxIntents) {
            break;
          }
          cursor = Number(response.data.nextCursor);
        }

        if (cancelled) {
          return;
        }
        setState({ intentIds: ids, scanned, exhausted, status: 'ready', error: null });
      } catch (cause) {
        if (cancelled || controller.signal.aborted) {
          return;
        }
        setState((previous) => ({
          ...previous,
          status: 'error',
          error: cause instanceof Error ? cause : new Error('Unknown journal error'),
        }));
      }
    };

    void run();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void run();
      }
    }, SCAN_INTERVAL_MS);

    return () => {
      cancelled = true;
      controller.abort();
      window.clearInterval(timer);
    };
  }, [maxIntents, tick]);

  const refresh = useCallback(() => setTick((value) => value + 1), []);

  return { ...state, refresh };
}