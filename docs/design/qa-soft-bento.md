# QA Report — Soft Bento prototype (issue #39)

Author: Probe (independent QA). Head reviewed: `design/soft-bento-exploration` @ `28ac069`.
Method: real stack — local API (`/health` PAPER / HEALTHY, chain 4663, real WETH/USDG pool) + production web build served by `vite preview`. Battery: Playwright + `@axe-core/playwright` harness (`apps/web/e2e/qa-soft-bento-harness.mjs`), 20 screenshot combinations, navigation/keyboard/axe/motion probes. Baseline ("before") = `main` `e5c2629` Neo-Brutalism, same harness (`before-*` files).

Raw artifacts: `docs/design/evidence/qa/` (before/after pairs + after full set). Local full sets: `/tmp/opencode/probe-soft-bento/evidence-{before,after}/` incl. `summary.json`.

## Verdict per item

| # | Item | Verdict | Notes |
|---|------|---------|-------|
| 1 | Responsive 320/375/768/1024/1440 × light/dark | **PASS** | 0 horizontal overflow, 0 clipped controls in all 20 shots; Bento stacks to one column at 320/375; bottom nav 5 items fits 320 |
| 2 | All routes open, no fake pages | **PASS** | 12/12 nav links (sidebar 6 + bottom nav 5 + More page links) open real pages at 1440 and 375; no `Page not found`; Candidates still reachable via sidebar + More |
| 3 | Keyboard | **PASS** | ringMissing 0/60 tab stops (16/24/13/21); full cycle length = stop count → no trap; bottom-nav + sidebar Enter-activation verified 14/14 in fresh contexts |
| 4 | axe light+dark, Overview+Discover, 1440+375 | **PASS** | 0 violations in all 8 scans |
| 5 | Motion | **PASS** | durations only 0.12/0.16/0.24s; only animation is one-shot `page-in` 0.24s; 0 loops; 0 `transition: all` with duration > 0; reduced-motion → lift/press = `0px`, durations ≈ 0 (0.01ms), no fake market-motion animation on numbers |
| 6 | Before/after comparison | see below | |

## Findings

### F-1 (Minor, non-blocking) — filter chip peeks under the bottom nav on first paint, Discover 375
- Repro: open `/discover` at 375×667 → quality filter chip `All` (`[data-testid="filter-quality-ANY"]`) renders ~94% hidden behind the fixed `.bottom-nav` band (chip top ≈635px, nav band 606.8–667px; visible sliver ≈6px). Screenshot: `qa/after-discover-375-light.png` / `-dark.png` (yellow sliver below the nav).
- Code: `apps/web/src/styles/base.css:343` (`.bottom-nav { position: fixed; bottom: 0 }`), `base.css:130` (`padding: … 96px` bottom reserve on `.shell__main`).
- Assessment: this is transit, not a blocked control — scrolling down ~70px brings the chip fully above the band, and at every rest position (top-of-page content scrolled, or full scroll) no control rests inside the band (verified programmatically). Same fixed-bottom-bar behavior exists in the baseline. Cosmetic; no fix required for the exploration. If Forge wants it perfect: add the same 96px clearance to the `discover-filters` block top margin is not needed — instead consider `scroll-margin-bottom` on filter rows.

### F-2 (Info) — baseline regressions confirmed fixed
- Before: `main` showed controls inside the nav band at load — Refresh (Overview 320, light+dark), Search (`discover-search-submit`, Discover 375, light+dark). After: those are clear; Overview 320 and Discover 375 no longer flag any control at load except the F-1 chip sliver.

### F-3 (Info) — Enter-activation false alarm resolved
- Two initial runs showed Enter on bottom-nav links not navigating at Discover 375. Not reproducible in 14/14 fresh-context runs (keyboard Enter and mouse click). Diagnosis: transient on a cold preview server; no product bug.

### F-4 (Info) — motion "transition: all" was measurement noise
- Raw probe flagged `transition-property: all` — that is the computed default on elements with **no** transition. With duration > 0 filter applied, zero real occurrences. Only animation in the product: `page-in` (0.24s, one-shot, keyed by route mount — complies with spec §3.6 / Sentinel S-3).

## Comparison before → after (Neo-Brutalism → Soft Bento)

| Check | Before (`e5c2629`) | After (`28ac069`) |
|---|---|---|
| Horizontal overflow (20 shots) | 0 | 0 |
| Controls in nav band at load | 4 combos (Overview-320, Discover-375 × light/dark) | 2 combos (Discover-375 chip sliver only, F-1) |
| axe violations (8 scans) | 0 | 0 |
| Keyboard: tab stops / ring missing / trap | 14/24/12/22 stops, 0 missing, no trap | 16/24/13/21 stops, 0 missing, no trap |
| Nav pages reachable | 13/13 | 12/12 (+ sidebar 6 routes incl. Candidates/Journal) |
| Motion: `transition: all` (real, dur > 0) | present (legacy UI) | 0 |
| Motion: durations in {120,160,240}ms | violations | 0 violations |
| Reduced motion | — | lift/press `0px`, durations ≈0, one-shot `page-in` remains visible-but-instant |
| Visual | hard shadows, 2.5px borders | hairline + soft elevation, lime accent only on active nav/CTA/filters; PAPER lavender badge prominent in HUD on every page; STOP NEW ENTRIES red filled; BUY = semantic emerald, not lime |

Status honesty: no fake numbers observed — unavailable price/liquidity render "Unavailable" with reason text (`discover` inspector), risk tile states "No risk decision in the scanned window" with the scan window, discovery tile shows real counts (1 pool tracked, 0 watchlisted).

## Per-viewport status (after)

| Viewport | Overflow | Clipped controls | Bento | Bottom nav |
|---|---|---|---|---|
| 320 | none | none | single column, readable | 5 items fit, no overlap at rest |
| 375 | none | F-1 chip sliver at load only | single column | ok |
| 768 | none | none | 2-col | hidden (sidebar appears) |
| 1024 | none | none | multi-col | hidden |
| 1440 | none | none | 12-col map per spec | hidden |

## Not verifiable in this run
- Real keyboard/screen-reader pass (VoiceOver/NVDA) — probes are programmatic, not AT-based.
- Pointer/touch interaction beyond Enter/click (no touch device).
- `More` page content beyond route reachability; Watchlist/Strategy/Settings pages do not exist and were not faked (correct per Nexus advisory).

## Reproduce
```sh
cd apps/web && node e2e/qa-soft-bento-harness.mjs http://127.0.0.1:4373 <outDir> after
```
API: `DATABASE_PATH=/tmp/…/qa.sqlite PORT=8080 DISCOVERY_ENABLED=0 RPC_URL=https://rpc.mainnet.chain.robinhood.com`.
