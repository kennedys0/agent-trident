import type { ReactNode } from 'react';

export function SubjectHeader({
  title,
  description,
  meta,
}: {
  readonly title: string;
  /** Optional since the R-4 reorder: Discover renders its intro below the
      search toolbar so first paint on mobile clears the bottom-nav band. */
  readonly description?: string | undefined;
  readonly meta?: string | undefined;
}): ReactNode {
  return (
    <header className="stack stack--tight">
      <h1>{title}</h1>
      {description === undefined ? null : <p className="meta">{description}</p>}
      {meta === undefined ? null : <p className="provenance">{meta}</p>}
    </header>
  );
}