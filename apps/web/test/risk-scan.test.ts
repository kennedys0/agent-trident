import { describe, expect, it } from 'vitest';
import type { AuditEvent } from '@trident/api-contract';
import { intentIdsFromJournal, scanWindowText, type RiskDecisionScan } from '../src/features/risk/useIntentDecision.js';

function event(id: string, type: string, payload: Record<string, unknown> = {}, createdAt = '2026-11-11T08:00:00.000Z'): AuditEvent {
  return { id, type, aggregateId: 'aggregate-1', payload, createdAt };
}

describe('intentIdsFromJournal', () => {
  it('keeps only risk decisions, deduplicates, and stops at the limit', () => {
    const events = [
      event('e1', 'strategy.evaluation.recorded'),
      event('e2', 'risk.decision.recorded', { intentId: 'intent-a' }),
      event('e3', 'market.snapshot.persisted'),
      event('e4', 'risk.decision.recorded', { intentId: 'intent-a' }),
      event('e5', 'risk.decision.recorded', { intentId: 'intent-b' }),
      event('e6', 'risk.decision.recorded', { intentId: 'intent-c' }),
    ];
    expect(intentIdsFromJournal(events, 2)).toEqual(['intent-a', 'intent-b']);
  });

  it('ignores a decision whose payload has no usable intent id', () => {
    const events = [event('e1', 'risk.decision.recorded', { intentId: 42 }), event('e2', 'risk.decision.recorded', {})];
    expect(intentIdsFromJournal(events, 5)).toEqual([]);
  });
});

describe('scanWindowText', () => {
  const base = {
    intentIds: [],
    scanned: 0,
    oldestAt: null,
    exhausted: false,
    status: 'ready' as const,
    error: null,
    refresh: () => {},
  };

  it('says the journal is empty instead of showing a duration', () => {
    expect(scanWindowText(base, Date.parse('2026-11-11T09:00:00.000Z'))).toBe('the journal is empty');
  });

  it('reports the covered window in hours and the event count', () => {
    const scan: RiskDecisionScan = { ...base, scanned: 1155, oldestAt: '2026-11-11T05:30:00.000Z', exhausted: true };
    expect(scanWindowText(scan, Date.parse('2026-11-11T09:06:00.000Z'))).toBe(
      'the last 3.6 h of the journal (1155 events, journal start reached)',
    );
  });

  it('uses minutes for a short window and has no text before the first page', () => {
    const scan: RiskDecisionScan = { ...base, scanned: 20, oldestAt: '2026-11-11T08:55:00.000Z' };
    expect(scanWindowText(scan, Date.parse('2026-11-11T09:00:00.000Z'))).toBe('the last 5 min of the journal (20 events)');
    expect(scanWindowText({ ...base, status: 'loading' }, Date.now())).toBe('');
  });
});