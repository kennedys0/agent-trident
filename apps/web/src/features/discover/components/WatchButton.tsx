import type { ReactNode } from 'react';
import { Loader2, Star, StarOff } from 'lucide-react';

type WatchButtonProps = {
  readonly address: string;
  readonly name: string;
  readonly watched: boolean;
  readonly pending: boolean;
  readonly disabled: boolean;
  readonly onToggle: () => void;
};

/**
 * One token, one toggle. The label never changes while a request is in flight
 * and the pressed state only moves when the backend answers, so the control
 * cannot show a state that was not persisted.
 */
export function WatchButton({ address, name, watched, pending, disabled, onToggle }: WatchButtonProps): ReactNode {
  return (
    <button
      type="button"
      className="btn btn--quiet"
      aria-pressed={watched}
      aria-busy={pending}
      disabled={disabled || pending}
      onClick={onToggle}
      data-testid={`watch-${address}`}
    >
      {pending ? (
        <Loader2 className="watch-spin" size={16} aria-hidden="true" />
      ) : watched ? (
        <Star size={16} aria-hidden="true" />
      ) : (
        <StarOff size={16} aria-hidden="true" />
      )}
      {watched ? 'Unwatch' : 'Watch'}
      <span className="sr-only"> {name}</span>
    </button>
  );
}