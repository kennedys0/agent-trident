import type { ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, HelpCircle, TimerOff } from 'lucide-react';
import type { MarketSnapshot } from '@trident/api-contract';
import { Badge, type Tone } from './Badge.js';

type Status = MarketSnapshot['status'];

const STATUS: Record<Status, { tone: Tone; icon: ReactNode; label: string }> = {
  COMPLETE: { tone: 'success', icon: <CheckCircle2 size={14} />, label: 'Complete' },
  STALE: { tone: 'wait', icon: <TimerOff size={14} />, label: 'Stale' },
  INCOMPLETE: { tone: 'wait', icon: <AlertTriangle size={14} />, label: 'Incomplete' },
  UNAVAILABLE: { tone: 'danger', icon: <HelpCircle size={14} />, label: 'Unavailable' },
};

export function SnapshotBadge({ status }: { readonly status: Status }): ReactNode {
  const entry = STATUS[status];
  return (
    <Badge tone={entry.tone} icon={entry.icon}>
      {entry.label}
    </Badge>
  );
}

export function statusTone(status: Status): Tone {
  return STATUS[status].tone;
}

/** UNAVAILABLE and INCOMPLETE must never be presented as a pass. */
export function isUsable(status: Status): boolean {
  return status === 'COMPLETE';
}