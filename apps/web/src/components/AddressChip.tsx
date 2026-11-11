import { useState, type ReactNode } from 'react';
import { Check, Copy } from 'lucide-react';
import { copyText, shortAddress } from '../lib/format.js';

type AddressChipProps = {
  readonly address: string;
  readonly label?: string;
  readonly full?: boolean;
};

export function AddressChip({ address, label, full = false }: AddressChipProps): ReactNode {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');

  const onCopy = async (): Promise<void> => {
    const ok = await copyText(address);
    setState(ok ? 'copied' : 'failed');
    window.setTimeout(() => setState('idle'), 2000);
  };

  return (
    <span className="addr">
      {label === undefined ? null : <span className="muted">{label}</span>}
      <code>{full ? address : shortAddress(address)}</code>
      <button type="button" onClick={() => void onCopy()} aria-label={`Copy address ${address}`}>
        {state === 'copied' ? <Check size={12} aria-hidden="true" /> : <Copy size={12} aria-hidden="true" />}
        <span aria-live="polite" className="sr-only">
          {state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy failed' : ''}
        </span>
      </button>
    </span>
  );
}