# QA Report — Soft Bento Revision 2 (issue #39, CEO "REVISION REQUIRED — DO NOT MERGE")

Author: Probe (independent QA). Head reviewed: `design/soft-bento-rev2` @ `9fde781` (DRAFT PR #44, not merged).
Method: real stack — local API (`/health` PAPER / HEALTHY, chain 4663, live WETH/USDG) + production web build on `vite preview`. Battery: Playwright + `@axe-core/playwright` harness (`apps/web/e2e/qa-soft-bento-harness.mjs`, duration gate widened to the CEO ranges 80–240ms). Comparison baseline: revision 1 = `main` `a8bef6e3` (PR #40 merge), same harness. Raw artifacts in `docs/design/evidence/rev2/` (rev2 full set + rev1 pairs + error-state capture); full local sets `/tmp/opencode/probe-soft-bento/evidence-{rev1,rev2}/`.

## Verdict per item

| # | Item | Verdict | Notes |
|---|------|---------|-------|
| 1 | Overview composition hierarchy | **PASS** | see C-1; span AND height vary, no filler cards |
| 2 | Motion fidelity | **PASS** | measured 100/170/220ms inside 80–140/150–200/180–240; easing uniform; no bounce; reduced-motion kills transforms; non-optimistic states untouched |
| 3 | Responsive + a11y | **PASS with 3 findings** | 0 horizontal overflow in all 20 shots; axe 4 violations in 4/8 scans (2 real issues, see R-1/R-3); touch targets partially below 48px (R-2) |
| 4 | Honesty of data | **PASS** | no invented numbers; UNAVAILABLE stays "Unavailable" with reason; PAPER/SIMULATED prominent |
| 5 | Evidence | **PASS** | Pixel's 41 artifacts incl. `interaction-recording.webm` (1 MB) + side-by-side composites; my 27 screenshots in `evidence/rev2/` |

## C-1 Composition (item 1) — verified in CSS and runtime
`base.css` ≥1280px: status-strip span 12 → **portfolio charcoal span 7 × row 2** (hero) → **market & strategy tinted span 5 × row 2** → risk 3 / discovery 3 / activity 6. 768–1279px: portfolio 6 / market 6, risk+discovery 3. Heights genuinely vary (row spans + hero figure 40px accent). No empty-space filler cards appeared. Screenshots: `rev2-overview-1440-light.png` vs rev1 pair `rev1-overview-1440-light.png` — rev2 reads as one dominant module + one distinct market module + a compact row; rev1 was flat 3+2 rows.

Functional regression check vs rev1: navigation 12/12 both; keyboard stops 16/24/13/21 vs 16/24/13/21 (same), no trap both; motion contract improved; Discover layout intact; `StopControl.tsx` and `useWatchlist.ts` untouched (diff `a8bef6e3..9fde781` = Shell.tsx, OverviewPage.tsx, 3 CSS files, tests, docs, evidence only).

## M-1 Motion (item 2) — measured
- Tokens: `--motion-fast: 100ms` (press), `--motion: 170ms` (hover), `--motion-slow: 220ms` (panel/page) — all inside CEO ranges. All measured computed durations in the runtime probe were in range (0 bad durations, 0 loops, no `transition: all` with duration > 0). Only animation: one-shot `page-in` 0.22s on route mount.
- Easing: single `cubic-bezier(0.2,0,0,1)`; no bounce/elastic keyframes found.
- Reduced motion: `--lift`/`--press` = `0px`, all durations ≈0 (0.01ms class), `page-in` still instant-visible; verified runtime (`reduced` pass) and Pixel's `reduced-motion-1280.png`.
- Success-before-backend: watchlist toggle / stop-control logic untouched by the diff; live-run states only appear from API responses (verified via intercepted error path: retry button does not fake success).

## R-1 (Serious, contrast) — error text on the charcoal hero panel is 2.07:1 in light mode
- Repro: light mode, Overview, block `GET /api/v1/portfolio` (or API down after first load) → `[data-testid="portfolio-error"]` appears on `.bento-tile--portfolio` (charcoal `#222123`) with `.state__text` and retry `[data-testid="portfolio-error-retry"]` in `--muted` `#52525b` → **2.07:1** (needs 4.5:1). Capture: `evidence/rev2/rev2-error-state.png`.
- Cause: `.state__text { color: var(--muted) }` (`base.css:1123`) and `.btn--quiet { color: var(--muted) }` (`base.css:937`) inherit a color calibrated against the light canvas (6.4:1 on `#e9e9e9`), but the rev2 charcoal feature panel reuses it (`tokens.css:23`).
- Scope measured: ONLY light-mode portfolio error state fails. Dark mode same state = 5.77:1 (pass); candidates error on tinted well = 7.03/6.77 (pass); all normal text inside the charcoal panel passes.
- Suggestion: add `--feature-muted` (light variant, e.g. `#a1a1aa` on `#222123` = 7.3:1) and use it for `.state__text`/`.btn--quiet` inside `.bento-tile--portfolio`.

## R-2 (Minor, touch targets) — several targets below 48px at 375
Measured minimum interactive dimension at 375×667 (Overview):
- Text links "All candidates" (16px), "Open risk" / "Open Discover" / "Open journal" (21px) — inline links without enlarged hit areas.
- `stop-new-entries` = 44px, `Refresh` = 44px, `open-candidate` = 44px (buttons, below the 48px target but close).
- Bottom-nav items and filter chips pass (≥48px).
- Suggestion: pad link hit areas (`padding` + negative margin) and raise button min-height to 48px on <768px.

## R-3 (Moderate, axe regression) — 2 issue classes vs rev1's zero
- **heading-order (moderate, 4/4 overview scans)**: `OverviewPage.tsx:278` uses `h3` module titles directly under `h1` (no `h2`). Rev1 had no h3 on Overview. Suggestion: demote module titles to `h2` (CSS unchanged) or insert a visually-hidden `h2`.
- **color-contrast (serious)** = R-1 above (appears only in the error state).
- Discover scans and dark Overview scans otherwise clean.

## R-4 (Minor, regression vs rev1) — Discover controls inside the bottom-nav band at first paint
- 375×667, `/discover` at load: `discover-search-submit` (Search) partially cut and `filter-quality-ANY` + `filter-quality-AVAILABLE` fully hidden behind the fixed `.bottom-nav` (screenshot `rev2-discover-375-light.png` — "All"/"Available" invisible). 320×568: `discover-search-input` in the band. Scrolling ~70px clears all of them; at full scroll nothing rests in the band; bottom nav itself works.
- Rev1 comparison: rev1 375 had Search + 1 chip; rev2 adds a second chip, and 320 gains the input. Driver: rev2 toolbar/labels are slightly taller; `scroll-margin-bottom` (`discover.css:302`) only helps programmatic focus scrolling, not initial paint.
- Suggestion: on <768px increase `.shell__main` bottom padding or move the quality filter row above the fold-clearing padding (keep STOP NEW ENTRIES reachable — it is, at 44px, top of page).

## Honesty check (item 4)
- Discovery tile: "Pools tracked 1 / 0 watchlisted" from live `discovery.meta` — no invented numbers. Risk tile: "No risk decision in the scanned window … 2.5h (960 events)" — real window. Price/liquidity "Unavailable" keeps reason text (Discover inspector).
- Pixel's `state-halted-1280.png` / `state-meta-missing-1280.png` use labeled browser-intercepted fixtures (`results.json.dataSource` discloses this); HALTED renders red filled badge + "ENTRIES STOPPED" + lime "Resume new entries" as an action (not a status green); verdict APPROVED carries its timestamp. No decorative charts anywhere.
- PAPER/SIMULATED visible in sidebar brand, topbar badge, HUD strip, and hero tile foot simultaneously.
- Navigation: single sidebar with group headings Trading / Research & system (duplicate targets removed vs rev1 double-listing); bottom nav 5 labeled items; Journal reachable; no fake Watchlist/Strategy/Settings pages.

## Dark surface ladder (item 3)
`tokens.css:113-117`: canvas `#131214` → surface `#201f22` → raised `#29272b`, well `#1b1a1c`; ordered and distinct. Text ratios all pass AA: ink ≥14.9:1, muted 6.4–7.3:1 on every layer. Layer-to-layer luminance steps are 1.06–1.14:1 — numerically distinct and monotonic; whether they read "clearly different" to a human eye is subjective and **not verifiable by automation**.

## Per-viewport status (rev2)
| Viewport | Overflow | Clipped at first paint | Bento | Bottom nav |
|---|---|---|---|---|
| 320 | 0 | Discover: search input in nav band (R-4) | 1 col | ok |
| 375 | 0 | Discover: Search + 2 chips in band (R-4); Overview: none | 1 col | ok |
| 768 | 0 | none | 2-col (portfolio/market 6) | hidden |
| 1440 | 0 | none | 12-col per C-1 | hidden |

## Not verifiable
- Real screen-reader pass (VoiceOver/NVDA); physical touch-device feel (44px buttons "feel" — only geometry measured); human perception of the dark surface layer separation; Pixel's webm recording reviewed only as file presence + extracted stills, not frame-by-frame.

## Reproduce
```sh
cd apps/web && node e2e/qa-soft-bento-harness.mjs http://127.0.0.1:4373 <outDir> rev2
```
API: `DATABASE_PATH=… PORT=8080 DISCOVERY_ENABLED=0 RPC_URL=https://rpc.mainnet.chain.robinhood.com`.
