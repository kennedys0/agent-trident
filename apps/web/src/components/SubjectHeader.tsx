import type { ReactNode } from 'react';

export function SubjectHeader({
  title,
  description,
  meta,
}: {
  readonly title: string;
  readonly description: string;
  readonly meta?: string;
}): ReactNode {
  return (
    <header className="stack stack--tight">
      <h1>{title}</h1>
      <p className="meta">{description}</p>
      {meta === undefined ? null : <p className="provenance">{meta}</p>}
    </header>
  );
}