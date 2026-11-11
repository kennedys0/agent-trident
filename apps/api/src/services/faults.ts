/**
 * Test seam for crash-boundary proof. Production code never installs these
 * hooks; tests use them to throw exactly between an entity write and its audit
 * write, which is the boundary a process death would hit.
 */
export type FaultStage =
  | 'market.snapshot'
  | 'strategy.evaluation'
  | 'order.intent'
  | 'intent.expired'
  | 'automation.state'
  | 'risk.decision'
  | 'paper.fill'
  | 'chain.reorg'
  | 'chain.hold';

export type FaultHooks = {
  readonly afterEntityWrite?: (stage: FaultStage) => void;
};

export function maybeInjectFault(hooks: FaultHooks | undefined, stage: FaultStage): void {
  hooks?.afterEntityWrite?.(stage);
}