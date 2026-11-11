import type { ReactNode } from 'react';
import { formatAge, formatUtc } from '../lib/format.js';

type ProvenanceProps = {
  readonly source: string;
  readonly blockNumber: string;
  readonly sourceTime?: string;
  readonly observedAt?: string;
  readonly now: number;
  readonly extra?: ReactNode;
};

export function Provenance({ source, blockNumber, sourceTime, observedAt, now, extra }: ProvenanceProps): ReactNode {
  const age = sourceTime === undefined ? null : Math.max(0, Math.floor((now - new Date(sourceTime).getTime()) / 1000));
  return (
    <div className="provenance">
      <span>source: {source}</span>
      <span>block: {blockNumber}</span>
      {sourceTime === undefined ? <span>sourceTime: Unavailable</span> : <span>sourceTime: {formatUtc(sourceTime)}</span>}
      <span>age: {formatAge(age)}</span>
      {observedAt === undefined ? null : <span>observedAt: {formatUtc(observedAt)}</span>}
      {extra}
    </div>
  );
}