# Design Contract

The UI follows Taste Engine `minimalism` with a Bento Grid layout system, in the "TRIDENT Robinhood Soft Bento" direction: hairline 1px borders, soft low-blur elevation shadows, 8/12/16/pill radii, a 4px-based spacing scale, and restrained 120/160/240ms motion on `cubic-bezier(0.2, 0, 0, 1)`. No gradients, glass, glow, or decorative status indicators.

The full specification lives in `docs/design/soft-bento-tokens.md` (tokens, light and dark) and `docs/design/soft-bento-motion.md` (motion). This file is the short contract; the specs are the source of truth for values.

## Tokens

- Light canvas `#E9E9E9`, surface `#FFFFFF`, ink `#171717`, muted `#52525B`.
- Dark canvas `#1A191B`, surface `#222123`, ink `#FAFAFA`, muted `#A1A1AA`.
- Brand accent lime `#D2FF00` is a fill only, always with dark ink `#171717` text, and never a status meaning.
- Status colours stay separate from the brand accent: positive emerald, negative `#B91C1C`, warning `#9A3412`, halted `#B91C1C`, plus dedicated stale, unavailable, pending, disabled and offline tokens.
- PAPER mode has its own explicit token (lavender `#B9AEF4` with dark ink and a strong border) and must appear in the sidebar, top bar and the HUD strip.

Every colour pair listed above meets WCAG 2.2 AA in its theme.

## Layout

- Desktop: dark charcoal sidebar plus a light canvas with a 12-column Bento grid. Overview is a full-width status strip (HUD) above equity, PnL, risk, strategy, freshness, activity and discovery tiles.
- Discover stays a dense scannable table with tabular numerals and right-aligned figures; it is not a card dashboard.
- Mobile (below 768px): labelled bottom navigation with five items (Overview, Discover, Portfolio, Risk, More) and 48px targets.

## Screens

- Overview: mode, chain health, current block, snapshot freshness, latest decision and risk result.
- Candidate: token/pool identity, chain ID, strategy version, action, strength, timestamps, invalidation, and reasons.
- Portfolio: visibly `SIMULATED`, cash/equity/PnL/positions, assumptions, and audit links.
- Risk: policy version, verdict, observed values versus thresholds, and persistent stop-new-entries control.

Every value comes from a live backend endpoint. There are no fabricated metrics, no decorative charts and no placeholder numbers. `UNAVAILABLE` is never displayed as zero or pass. Pages that do not exist (Watchlist, Strategy, Settings) are not faked.

Loading, empty, error, stale, offline, and success are distinct. Mobile uses labeled bottom navigation and 48px targets. Keyboard, focus-visible, reduced motion, 200% zoom, and WCAG 2.2 AA are required. Motion honours `prefers-reduced-motion`, and no visual state is shown before the backend confirms it.

## Evidence

Design QA and operational-safety reviews live in `docs/design/qa-soft-bento.md` and `docs/design/security-soft-bento.md`, with screenshots and interaction recordings under `docs/design/evidence/`.
