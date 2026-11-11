import type { ReactNode } from 'react';
import { AlertTriangle, Inbox, RefreshCw, WifiOff } from 'lucide-react';

type Kind = 'loading' | 'empty' | 'error' | 'offline';

type StateViewProps = {
  readonly kind: Kind;
  readonly title: string;
  readonly text?: string;
  readonly onRetry?: () => void;
  readonly retryLabel?: string;
  readonly testId?: string;
};

const ICONS: Record<Exclude<Kind, 'loading'>, ReactNode> = {
  empty: <Inbox size={20} aria-hidden="true" />,
  error: <AlertTriangle size={20} aria-hidden="true" />,
  offline: <WifiOff size={20} aria-hidden="true" />,
};

export function StateView({ kind, title, text, onRetry, retryLabel = 'Retry', testId }: StateViewProps): ReactNode {
  const test = testId === undefined ? {} : { 'data-testid': testId };
  if (kind === 'loading') {
    return (
      <div className="state" aria-live="polite" aria-busy="true" {...test}>
        <div className="skeleton-stack" aria-hidden="true">
          <div className="skeleton skeleton--wide" />
          <div className="skeleton" />
          <div className="skeleton skeleton--narrow" />
        </div>
        <p className="state__text">{title}</p>
      </div>
    );
  }

  return (
    <div className="state" role={kind === 'error' ? 'alert' : 'status'} {...test}>
      <div className="inline">
        {ICONS[kind]}
        <span className="state__title">{title}</span>
      </div>
      {text === undefined ? null : <p className="state__text">{text}</p>}
      {onRetry === undefined ? null : (
        <button type="button" className="btn btn--quiet" onClick={onRetry} data-testid={`${testId ?? 'state'}-retry`}>
          <RefreshCw size={16} aria-hidden="true" />
          {retryLabel}
        </button>
      )}
    </div>
  );
}

export function isOfflineError(error: Error): boolean {
  return error.message === 'The API could not be reached' && (error as { code?: string }).code === 'NETWORK_ERROR';
}