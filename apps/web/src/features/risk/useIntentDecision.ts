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
  /** Creation time of the oldest event the scan inspected, or null before the first page. */
  readonly oldestAt: string | null;
  /** True when the scan reached the start of the journal instead of its page budget. */
  readonly exhausted: boolean;
  readonly status: 'loading' | 'ready' | 'error';
  readonly error: Error | null;
  readonly refresh: () => void;
};

const PAGE_SIZE = 100;
/**
 * The worker writes snapshot and evaluation events every ten seconds, so a decision
 * from an hour ago sits roughly 700 events back. Twenty pages covers about three
 * hours of that background traffic; the scan stops as soon as it has enough ids.
 */
const MAX_PAGES = 20;
const SCAN_INTERVAL_MS = 30_000;

function oldestOf(events: readonly AuditEvent[]): string | null {
  let oldest: string | null = null;
  for (const event of events) {
    if (oldest === null || event.createdAt < oldest) {
      oldest = event.createdAt;
    }
  }
  return oldest;
}

/**
 * Walk back a bounded number of journal pages and report exactly how far the scan
 * went, including the time window it covered. Never claim "none" without it.
 */
export function useRiskDecisionScan(maxIntents: number): RiskDecisionScan {
  const [state, setState] = useState<Omit<RiskDecisionScan, 'refresh'>>({
    intentIds: [],
    scanned: 0,
    oldestAt: null,
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
        let oldestAt: string | null = null;
        let exhausted = false;

        for (let page = 0; page < MAX_PAGES; page += 1) {
          const endpoint = endpoints.journal(PAGE_SIZE, cursor ?? undefined);
          const response = await apiGet(endpoint.path, endpoint.schema, controller.signal);
          scanned += response.data.events.length;

          const pageOldest = oldestOf(response.data.events);
          if (pageOldest !== null) {
            oldestAt = pageOldest;
          }
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
        setState({ intentIds: ids, scanned, oldestAt, exhausted, status: 'ready', error: null });
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

/** Human description of the journal window a scan actually covered. */
export function scanWindowText(scan: RiskDecisionScan, now: number): string {
  if (scan.status !== 'ready') {
    return '';
  }
  if (scan.oldestAt === null) {
    return 'the journal is empty';
  }
  const startedAt = Date.parse(scan.oldestAt);
  const minutes = Number.isFinite(startedAt) ? Math.max(0, Math.round((now - startedAt) / 60_000)) : null;
  const span = minutes === null ? 'the most recent events' : minutes >= 60 ? `the last ${Math.round(minutes / 6) / 10} h` : `the last ${minutes} min`;
  return `${span} of the journal (${scan.scanned} events${scan.exhausted ? ', journal start reached' : ''})`;
}