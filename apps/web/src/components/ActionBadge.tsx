import type { ReactNode } from 'react';
import { Clock, Minus, PauseCircle, ShieldX, TrendingDown, TrendingUp } from 'lucide-react';
import type { Evaluation } from '@trident/api-contract';
import { Badge, type Tone } from './Badge.js';

const ACTION: Record<Evaluation['action'], { tone: Tone; icon: ReactNode }> = {
  BUY: { tone: 'success', icon: <TrendingUp size={14} /> },
  SELL: { tone: 'info', icon: <TrendingDown size={14} /> },
  HOLD: { tone: 'muted', icon: <PauseCircle size={14} /> },
  WAIT: { tone: 'wait', icon: <Clock size={14} /> },
  AVOID: { tone: 'danger', icon: <ShieldX size={14} /> },
};

export function ActionBadge({ action }: { readonly action: Evaluation['action'] }): ReactNode {
  const entry = ACTION[action];
  return (
    <Badge tone={entry.tone} icon={entry.icon}>
      {action}
    </Badge>
  );
}

export function NeutralActionIcon(): ReactNode {
  return <Minus size={14} aria-hidden="true" />;
}