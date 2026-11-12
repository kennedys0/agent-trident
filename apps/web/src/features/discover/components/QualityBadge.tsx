import type { ReactNode } from 'react';
import type { PoolSummary } from '@trident/api-contract';
import { Badge, type Tone } from '../../../components/Badge.js';

type PoolStatus = PoolSummary['status'];

/**
 * Pixel's tone mapping for S3-03: AVAILABLE→success, STALE→wait,
 * UNAVAILABLE→muted. `success` is only used when the backend reported a value
 * plus provenance; the badge never appears next to an absent value.
 */
const TONE: Record<PoolStatus, Tone> = {
  AVAILABLE: 'success',
  STALE: 'wait',
  UNAVAILABLE: 'muted',
};

const LABEL: Record<PoolStatus, string> = {
  AVAILABLE: 'Available',
  STALE: 'Stale',
  UNAVAILABLE: 'Unavailable',
};

/** Status is always written out; colour is never the only carrier of meaning. */
export function QualityBadge({ status, label }: { readonly status: PoolStatus; readonly label?: string }): ReactNode {
  return <Badge tone={TONE[status]}>{label ?? LABEL[status]}</Badge>;
}
