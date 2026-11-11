import type { ReactNode } from 'react';

export type Tone = 'neutral' | 'wait' | 'danger' | 'info' | 'success' | 'testnet' | 'muted';

type BadgeProps = {
  readonly tone?: Tone;
  readonly icon?: ReactNode;
  readonly children: ReactNode;
};

export function Badge({ tone = 'neutral', icon, children }: BadgeProps): ReactNode {
  return (
    <span className={`badge${tone === 'neutral' ? '' : ` badge--${tone}`}`}>
      {icon === undefined ? null : <span aria-hidden="true">{icon}</span>}
      {children}
    </span>
  );
}