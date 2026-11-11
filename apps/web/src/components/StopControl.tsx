import { useState, type ReactNode } from 'react';
import { OctagonX, Play } from 'lucide-react';
import { healthSchema } from '@trident/api-contract';
import { apiGet } from '../lib/api/client.js';
import { readFlag, setKillSwitch } from '../lib/api/system.js';
import { useStatus } from '../app/StatusProvider.js';
import { ConfirmDialog } from './ConfirmDialog.js';

export function StopControl(): ReactNode {
  const { health } = useStatus();
  const engaged = health.meta === undefined ? null : readFlag(health.meta, 'killSwitchEngaged');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verification, setVerification] = useState<'idle' | 'confirmed' | 'unconfirmed'>('idle');

  const target = engaged !== true;
  const targetLabel = target ? 'STOP NEW ENTRIES' : 'Resume new entries';

  const confirm = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await setKillSwitch(target);
      // Success is only claimed after an independent read of backend state.
      const fresh = await apiGet('/health', healthSchema);
      const confirmed = readFlag(fresh.meta, 'killSwitchEngaged') === target;
      setVerification(confirmed ? 'confirmed' : 'unconfirmed');
      if (!confirmed) {
        setError('The backend accepted the request but still reports the previous state. Nothing was reported as done.');
        return;
      }
      setOpen(false);
      health.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The halt request failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="inline">
        <button
          type="button"
          className={`btn ${target ? 'btn--danger' : 'btn--primary'}`}
          onClick={() => {
            setError(null);
            setVerification('idle');
            setOpen(true);
          }}
          disabled={engaged === null || health.data === null}
          title={engaged === null ? 'Backend kill-switch state is unavailable' : undefined}
          data-testid="stop-new-entries"
        >
          {target ? <OctagonX size={16} aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}
          {targetLabel}
        </button>
        {verification === 'confirmed' ? (
          <span className="badge badge--success" role="status">
            Confirmed by backend
          </span>
        ) : null}
        {verification === 'unconfirmed' ? (
          <span className="badge badge--danger" role="alert">
            Not confirmed
          </span>
        ) : null}
      </div>

      <ConfirmDialog
        open={open}
        title={target ? 'Stop new entries?' : 'Resume new entries?'}
        confirmLabel={targetLabel}
        busy={busy}
        error={error}
        onCancel={() => setOpen(false)}
        onConfirm={() => void confirm()}
      >
        {target ? (
          <>
            <p>This stops new PAPER orders from being created.</p>
            <p>Reconciliation and the audit journal keep running. Open paper positions are not closed.</p>
            <p className="meta">The control only reports success after the backend confirms the new state.</p>
          </>
        ) : (
          <>
            <p>This re-enables new PAPER orders. The risk gate still evaluates every intent.</p>
            <p className="meta">No real money is involved: this deployment is PAPER-only.</p>
          </>
        )}
      </ConfirmDialog>
    </>
  );
}