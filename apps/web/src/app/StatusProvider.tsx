import { createContext, useContext, type ReactNode } from 'react';
import { endpoints } from '../lib/api/endpoints.js';
import type { Health } from '../lib/api/endpoints.js';
import { useNow, useOnlineStatus, useResource, type ResourceState } from '../lib/api/hooks.js';

type StatusValue = {
  readonly health: ResourceState<Health>;
  readonly online: boolean;
  readonly now: number;
};

const StatusContext = createContext<StatusValue | null>(null);

export function StatusProvider({ children }: { readonly children: ReactNode }): ReactNode {
  const health = useResource(endpoints.health(), { intervalMs: 5000 });
  const online = useOnlineStatus();
  const now = useNow(1000);
  return <StatusContext.Provider value={{ health, online, now }}>{children}</StatusContext.Provider>;
}

export function useStatus(): StatusValue {
  const value = useContext(StatusContext);
  if (value === null) {
    throw new Error('useStatus must be used inside StatusProvider');
  }
  return value;
}