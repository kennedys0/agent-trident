import { type ReactNode } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { Activity, Compass, LayoutDashboard, ListFilter, Menu, ShieldAlert, Wallet } from 'lucide-react';
import { useStatus } from '../app/StatusProvider.js';
import { readFlag, readNumber } from '../lib/api/system.js';
import { formatAge, formatUtc } from '../lib/format.js';
import { Badge } from './Badge.js';
import { BrandMark } from './BrandMark.js';
import { StopControl } from './StopControl.js';
import { ThemeToggle } from './ThemeToggle.js';

/* Every entry here is a real route — there are no placeholder pages. The
   mobile bottom bar carries the five primary destinations (spec §6); the
   sidebar additionally offers Candidates and the audit journal. */
const NAV = [
  { to: '/', label: 'Overview', icon: LayoutDashboard },
  { to: '/discover', label: 'Discover', icon: Compass },
  { to: '/candidates', label: 'Candidates', icon: ListFilter },
  { to: '/risk', label: 'Risk', icon: ShieldAlert },
  { to: '/portfolio', label: 'Portfolio', icon: Wallet },
  { to: '/more', label: 'More', icon: Menu },
] as const;

const BOTTOM_NAV = [
  { to: '/', label: 'Overview', icon: LayoutDashboard },
  { to: '/discover', label: 'Discover', icon: Compass },
  { to: '/portfolio', label: 'Portfolio', icon: Wallet },
  { to: '/risk', label: 'Risk', icon: ShieldAlert },
  { to: '/more', label: 'More', icon: Menu },
] as const;

function isCurrent(pathname: string, to: string): boolean {
  if (to === '/') {
    return pathname === '/';
  }
  return pathname === to || pathname.startsWith(`${to}/`);
}

function rpcTone(status: 'HEALTHY' | 'DEGRADED' | 'OFFLINE' | null): 'success' | 'wait' | 'danger' | 'muted' {
  if (status === 'HEALTHY') return 'success';
  if (status === 'DEGRADED') return 'wait';
  if (status === 'OFFLINE') return 'danger';
  return 'muted';
}

export function Shell(): ReactNode {
  const { health, online, now } = useStatus();
  const location = useLocation();
  const healthData = health.data;
  const lag = healthData === null ? null : healthData.lagSeconds;
  const lastSeen = health.receivedAt === null ? null : Math.max(0, Math.floor((now - health.receivedAt) / 1000));
  const engaged = readFlag(health.meta, 'killSwitchEngaged');
  const latency = readNumber(health.meta, 'rpcLatencyMs');

  return (
    <div className="shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>

      <aside className="sidebar" aria-label="Primary">
        <div className="brand">
          <BrandMark />
          <span className="brand__sub">PAPER</span>
        </div>
        <nav className="sidebar__nav" aria-label="Sections">
          {NAV.map((item) => {
            const Icon = item.icon;
            const current = isCurrent(location.pathname, item.to);
            return (
              <NavLink
                key={item.to}
                to={item.to}
                className="nav-link"
                {...(current ? { 'aria-current': 'page' as const } : {})}
                data-testid={`nav-${item.label.toLowerCase()}`}
              >
                <Icon size={18} aria-hidden="true" />
                {item.label}
              </NavLink>
            );
          })}
        </nav>
        <nav className="sidebar__nav" aria-label="Resources">
          <NavLink
            to="/journal"
            className="nav-link"
            {...(isCurrent(location.pathname, '/journal') ? { 'aria-current': 'page' as const } : {})}
          >
            <Activity size={18} aria-hidden="true" />
            Journal
          </NavLink>
        </nav>
        <div className="sidebar__foot">
          <ThemeToggle />
          <span>
            {healthData === null
              ? 'Chain status unavailable'
              : `chain ${healthData.chainId} · ${healthData.rpcStatus.toLowerCase()}`}
          </span>
          <span>{lastSeen === null ? 'not synced' : `last sync ${formatAge(lastSeen)}`}</span>
        </div>
      </aside>

      <div className="shell__body">
        <header className="topbar">
          <span className="topbar__brand">
            <BrandMark />
          </span>
          <div className="topbar__cluster">
            <Badge tone="testnet" icon={<span aria-hidden="true">●</span>}>
              PAPER — SIMULATED
            </Badge>
            <Badge tone={rpcTone(healthData?.rpcStatus ?? null)}>
              {healthData === null ? 'RPC unknown' : `RPC ${healthData.rpcStatus.toLowerCase()}`}
            </Badge>
            {healthData === null ? (
              <Badge tone="muted">chain unknown</Badge>
            ) : (
              <Badge tone={healthData.chainId === 4663 ? 'muted' : 'danger'}>chain {healthData.chainId}</Badge>
            )}
            {engaged === true ? <Badge tone="halted">Entries stopped</Badge> : null}
          </div>
          <div className="topbar__spacer" />
          <div className="topbar__meta">
            <span className="mono">
              {healthData === null
                ? 'head block Unavailable'
                : `head ${healthData.headBlock ?? 'Unavailable'}${lag === null ? '' : ` · lag ${lag}s`}`}
            </span>
            <span className="mono">
              {latency === null ? 'RPC latency Unavailable' : `RPC ${latency} ms`} ·{' '}
              {health.receivedAt === null ? 'no sync yet' : `seen ${formatUtc(new Date(health.receivedAt).toISOString())}`}
            </span>
          </div>
          {online ? null : <Badge tone="danger">Browser offline</Badge>}
          <StopControl />
        </header>

        <main id="main" className="shell__main">
          {online ? null : (
            <p className="banner banner--danger" role="alert">
              This browser is offline. Displayed values are the last received and are not live.
            </p>
          )}
          {/* Keyed per route: the page transition runs once on route entry. */}
          <div className="page" key={location.pathname}>
            <Outlet />
          </div>
        </main>
      </div>

      <nav className="bottom-nav" aria-label="Primary">
        {BOTTOM_NAV.map((item) => {
          const Icon = item.icon;
          const current = isCurrent(location.pathname, item.to);
          return (
            <NavLink
              key={item.to}
              to={item.to}
              className="bottom-nav__link"
              {...(current ? { 'aria-current': 'page' as const } : {})}
              data-testid={`bottom-nav-${item.label.toLowerCase()}`}
            >
              <Icon size={20} aria-hidden="true" />
              {item.label}
            </NavLink>
          );
        })}
      </nav>
    </div>
  );
}