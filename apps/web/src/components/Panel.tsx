import type { ReactNode } from 'react';

type PanelProps = {
  readonly title: string;
  readonly actions?: ReactNode | undefined;
  readonly children: ReactNode;
  readonly foot?: ReactNode | undefined;
  readonly flush?: boolean;
  readonly labelledBy?: string | undefined;
};

export function Panel({ title, actions, children, foot, flush = false, labelledBy }: PanelProps): ReactNode {
  const id = title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return (
    <section className="panel" {...(labelledBy === undefined ? {} : { 'aria-labelledby': labelledBy })}>
      <header className="panel__head">
        <h2 className="panel__title" id={id}>
          {title}
        </h2>
        {actions === undefined ? null : <div className="panel__actions">{actions}</div>}
      </header>
      <div className={`panel__body${flush ? ' panel__body--flush' : ''}`}>{children}</div>
      {foot === undefined ? null : <div className="panel__foot">{foot}</div>}
    </section>
  );
}