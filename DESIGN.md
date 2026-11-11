# Design Contract

The UI follows Taste Engine `neo-brutalism`: 2.5px high-contrast borders, hard zero-blur offset shadows, 6px radius, 8px spacing grid, direct 130ms motion, and no gradients, glass, glow, or decorative status indicators.

## Tokens

- Light canvas `#FFFDF7`, surface `#FFFFFF`, ink `#121212`, muted `#4B4B4B`.
- Dark canvas `#18181B`, surface `#222227`, ink `#FAFAFA`, muted `#A1A1AA`.
- WAIT/stale `#FFE600`, danger `#FF5757`, info `#4DEEEA`, BUY `#00F0A8`, testnet `#D8B4FE`, focus `#3B5BFF`.

## Vertical-slice screens

- Overview: mode, chain health, current block, snapshot freshness, latest decision and risk result.
- Candidate: token/pool identity, chain ID, strategy version, action, strength, timestamps, invalidation, and reasons.
- Portfolio: visibly `SIMULATED`, cash/equity/PnL/positions, assumptions, and audit links.
- Risk: policy version, verdict, observed values versus thresholds, and persistent stop-new-entries control.

Loading, empty, error, stale, offline, and success are distinct. `UNAVAILABLE` is never displayed as zero or pass. Mobile uses labeled bottom navigation and 48px targets. Keyboard, focus-visible, reduced motion, 200% zoom, and WCAG 2.2 AA are required.

