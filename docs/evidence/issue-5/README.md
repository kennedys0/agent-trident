# Issue #5 — PAPER operational UI: evidence

Run date: 2026-11-11 (UTC). Branch `feat/issue-5-operational-ui`, rebased onto
`feat/issue-2-paper-backend` at `11c1808`, which is itself stacked on the
contract amendment `0fb7be6` from PR #7. `11c1808` adds the backend checkpoint
and reorg recovery; it changes only `apps/api/**`, and
`packages/api-contract` is byte-identical to `0fb7be6`, so this rebase is
contract-neutral. The contract package is a real dependency here, not a copy:
the UI and the API are validated against the same schemas.

Everything below was produced on this machine against a real backend process
and the real Robinhood Chain mainnet RPC. Nothing in `apps/web` fakes market
data; the only intercepted responses are inside Playwright tests, and those
tests are labelled "intercepted transport, clearly test-only".

## Runtime

- Node 24.22.2, pnpm 9.12.3, Playwright 1.65 (chromium headless shell).
- API: `node apps/api/dist/server.js` with `EXECUTION_MODE=PAPER`,
  `RPC_URL=https://rpc.mainnet.chain.robinhood.com`, `EXPECTED_CHAIN_ID=4663`,
  `PORT=8099`. The database path changed per phase (below).
- Web: `pnpm --filter @trident/web build` then `pnpm preview` on
  `127.0.0.1:4173`, proxying `/api` and `/health` to the API on 8099.

## Gates (at the rebased tree)

| Command | Result |
|---|---|
| `pnpm -r typecheck` | PASS (3 packages) |
| `pnpm -r test` | PASS — contract 17, API 73 passed / 4 skipped (real-RPC tests need `RUN_RPC_TESTS=1`), web 42 |
| `pnpm -r build` | PASS — web 393.70 kB JS / 115.93 kB gzip, 13.24 kB CSS / 3.14 kB gzip |
| `npx playwright test` (apps/web) | 24 passed |

## Live intent evidence — four honest phases

The market decides which states are reachable, so each phase used its own
paper database and the UI was driven by a real browser click. The raw SQLite
files and logs are in `/tmp/opencode/trident-web/` on the run machine.

### 1. Executed (approved) intent — `intent-result-filled.png`

Fresh paper portfolio (`trident-final.sqlite`, 10 000 USDG opening cash, no
position), so the strategy proposed `BUY` and the button was enabled.

- Evaluation `871bd48e…` `BUY`, snapshot `COMPLETE`, proposed 0.239034 WETH.
- Click → confirm → backend `201` with `intent`, `riskDecision`, `order`, `fill`.
- Rendered: `APPROVED`, intent `FILLED`, order `b1bb7321-baf2-4485-b69f-abdcd096cd85`,
  fill time `2026-11-11 17:52:15Z`, approved size `0.239009 WETH`, maximum quote
  cost `500.05 USDG`, filled `0.239009 WETH`, price `2,091.96 USDG/WETH`,
  fee `0.050000 USDG`, 15/15 rules `PASS`.
- Fill row shows the fill time, not a second copy of the order id: the contract
  `PaperFill` has no `id` of its own.
- Gas: `AVAILABLE`, `91596` units at `20024000` wei/gas = `1834118304000` wei,
  provenance "QuoterV2 quoteExactInputSingle gasEstimate simulated at block
  111888863 + baseFeePerGas at block 111888863; priority fee not included".
  The quote-currency cost row says the backend has no sourced ETH/USDG
  conversion; it never prints `0`.
- No `CONTRACT_MISMATCH` in the browser or the console.

### 2. Rejected intent — `intent-result-rejected.png`

Fresh paper portfolio (`trident-reject.sqlite`), kill switch engaged through
`POST /api/v1/system/halt`.

- Mode badge `ENTRIES STOPPED`, header exposes `Resume new entries`.
- Click → confirm → backend `200` with `intent`, `riskDecision`, `order: null`,
  `fill: null`.
- Rendered: `REJECTED`, intent `REJECTED`, `Order: None — rejected`,
  `Fill: None — rejected`, reason `R02_kill_switch: Kill switch is engaged; new
  entries are blocked`, R02 `FAIL`, the other 14 rules still `PASS`, and no gas
  row at all (there is no fill to describe).
- No `CONTRACT_MISMATCH`.

### 3. HOLD evaluation — `intent-disabled-hold.png`

The long-running paper portfolio (`trident.sqlite`) currently holds WETH, so the
strategy reports `HOLD` on every evaluation in the window. All 20 entries from
`GET /api/v1/candidates?limit=20` were `HOLD`.

- `Create PAPER intent` is disabled and the page states
  "Disabled: This evaluation is HOLD; the strategy did not propose a trade."
- The button is not hidden and no result is invented; there is no success state
  without a backend decision.

### 4. Duplicate evaluation replay — `intent-replay-filled.png`

This is the path that used to fail with a 500. At backend `24e39e8`, a POST that
carries a **new idempotency key** but an `evaluationId` that already has an
execution returns `200` with `meta.replayed: true` and the stored execution; no
second intent, order, fill, ledger entry, or audit row is written. The UI mints
a fresh key for every submit by design, so a second click is exactly this case.

Fresh paper portfolio (`trident-replay3.sqlite`), one duplicated browser click:

- First submit: `201`, `APPROVED`, intent `d7dffdcb…` `FILLED`, order
  `c86121c9-1d9c-4944-afda-4ab47c1e54f9`, fill
  `2026-11-11 18:31:32Z`, 0.239380 WETH / 500.05 USDG, fee 0.050000 USDG,
  15/15 rules `PASS`.
- Second submit on the same evaluation with a new key: `200`,
  `meta.replayed: true`, same intent/order/fill. The page renders the
  `REPLAYED — NO NEW FILL` badge and the banner "This evaluation already
  produced an execution. The backend replayed the stored result; no new order,
  fill, or ledger entry was written." The order id and fill time are unchanged,
  no error banner appears, and no request returns 5xx.
- Gas for the stored fill: `AVAILABLE`, 91566 units at 20028000 wei/gas =
  1833883848000 wei, provenance block 111911693, priority fee excluded.
- An additional raw duplicate POST (`replay-duplicate-response.json`) returned
  `200 replayed: true` while row counts stayed `intents 1, orders 1, fills 1,
  ledger 8, audit 15`.
- The dedicated browser run is recorded in `replay-test.json`
  (`--grep "duplicate submit"`, 1 passed, 0 unexpected).

The replay assertion lives in the same live browser test as phase 1: it submits
twice, requires the second response to be `200` with `meta.replayed === true`,
and requires the same order/fill plus the `intent-replayed` badge. The
`REPLAYED` copy also appears in `apps/web/test/views.test.tsx`, but the browser
run above is the live proof.

## Reorg-quarantined evaluation — manual review, no retry

`POST /api/v1/intents` on an evaluation quarantined by a chain reorg now returns
`409` with `error.code: "CONFLICT"` and the message "Evaluation was quarantined
by a chain reorg and requires manual review". The backend makes this check
before it creates an intent, so no order, fill, or ledger entry exists for the
refused request.

- `IntentAction` has a dedicated `manualReview` state. It clears any prior
  result, closes the confirm dialog, and renders
  `intent-manual-review`: a `MANUAL REVIEW REQUIRED` badge, `HTTP 409 · CONFLICT`,
  the heading "This evaluation was quarantined by a chain reorg", the statement
  that no paper order/fill/ledger entry was created, the backend message and
  request id, and "Do not resubmit. This control stays disabled until the review
  is cleared."
- The entry control is disabled and `intent-disabled-reason` says the evaluation
  is under manual review. There is no automatic retry: the Playwright test
  counts exactly one `POST /api/v1/intents`.
- A `409 CONFLICT` whose message does not mention reorg/quarantine gets the same
  manual-review treatment with generic "no longer actionable" wording, so an
  unexpected conflict can never fall through to a generic success or error.
- Screenshot: `intent-reorg-manual-review.png`. The `ENTRIES STOPPED` badge is
  visible in the same view, so the reorg halt is shown, not merely implied by
  the refused intent.
- The manual-review panel is scanned by axe in both themes. Its computed
  metadata foreground inherits the fixed status-ink token and measures at
  `6.02:1` against the danger background (WCAG AA requires `4.5:1`).
- In the refreshed dark-mode evidence, `Refresh` and `All candidates` are
  enabled secondary controls with computed opacity `1`; disabled controls keep
  the separate `0.55` treatment.

Unit coverage: `apps/web/test/views.test.tsx` "stops at manual review on a reorg
409 and never retries" asserts the badge, the reorg copy, the absence of
`intent-result`/`intent-error`, the disabled control, and exactly one transport
call.

## Unavailable snapshot — truthful health, portfolio, and entry

A quarantined snapshot is excluded by `getLatestSnapshot`, so the snapshot
endpoint can `404` and the portfolio reports `meta.priceStatus: "UNAVAILABLE"`
with unpriced positions. The UI now reads that meta instead of inventing a
valuation.

- `PortfolioPage` validates `meta.priceStatus` against
  `COMPLETE | STALE | INCOMPLETE | UNAVAILABLE` and passes `priceAsOf` through.
- `PortfolioView` renders `portfolio-price-status`: stale prices say the values
  are the last known valuation, not live; unavailable/incomplete prices say
  there is no complete canonical snapshot. Equity notes "excludes unpriced
  positions" or "no canonical price", and unrealized PnL shows `Unavailable` —
  never a fabricated `0.00`.
- `OverviewPage` renders `SnapshotBadge status="UNAVAILABLE"` plus "no canonical
  snapshot · {backend message}" for a 404/error snapshot instead of
  "None recorded". `Reference price` shows `Unavailable`; `New entries` shows
  `STOPPED` while the reorg halt is engaged.
- Screenshot: `state-snapshot-unavailable.png`. It shows head block, RPC health,
  and chain id still true, with freshness/reference price unavailable and the
  paper portfolio equity excluding the unpriced position.
- The candidate with `snapshotStatus: "UNAVAILABLE"` has its entry action
  disabled with the reason naming the status. Because the contract only permits
  a non-`COMPLETE` snapshot on `SELL`/`HOLD`/`WAIT`/`AVOID`, the fixture uses
  `SELL`; `BUY` with a non-`COMPLETE` snapshot is unrepresentable by design.

Unit coverage: "labels an unavailable canonical price and never shows a zero
unrealized PnL", "labels a stale price without claiming the values are live",
and "disables the entry action when the evaluation snapshot is unavailable".
Playwright: "an unavailable snapshot keeps health, portfolio and entry controls
truthful".

## Live API data observed during this run

- `/health`: `mode PAPER`, `chainId 4663`, `rpcStatus HEALTHY`, head blocks
  between `111888302` and `111893128` for phases 1–3; the replay phase ran at
  head `111910423`–`111911754`.
- `/api/v1/markets/weth-usdg/snapshot`: status `COMPLETE`, price around
  `2090–2092 USDG/WETH` in phases 1–3 and `2088.50 USDG/WETH` in the replay
  phase, `sourceTime` from the pinned block, block hash and `block:` shown on
  the candidate page from the same payload.
- `/api/v1/portfolio`: mode `PAPER`, real equity, one open WETH position in the
  long-running database, none in the fresh ones.
- `/api/v1/journal`: real `strategy.evaluation.recorded`,
  `market.snapshot.persisted`, `risk.decision.recorded` and ledger events.

## Browser acceptance (24 tests)

1. Overview renders the head block, the pinned snapshot block, the latest
   action, and the strategy id from the same HTTP responses it consumed.
2. Candidate detail shows block hash, `block:` from the same snapshot response,
   source, and `sourceTime:`.
3. Portfolio is labelled `SIMULATED`, shows a real equity value, and states
   `PAPER — no real money`.
4. Journal lists a real audit event type returned by the API.
5. **Intent action follows the live evaluation, and a duplicate submit
   replays** — disabled with the exact reason when the evaluation is not
   tradable; otherwise a real click that ends `FILLED` or `REJECTED` with
   explicit order/fill, no contract mismatch, then a second click on the same
   evaluation that must receive `200 replayed: true` and render
   `REPLAYED — no new fill` with the stored order/fill unchanged. This is the
   test that produced the screenshots above and `replay-test.json`.
6. Risk page shows either real per-rule evidence or an explicit empty state.
7. Offline/error state keeps prior values labelled and offers retry.
8. An empty evaluation list renders as Empty, not Error.
9. A stale snapshot is labelled `Stale` and cannot look healthy.
10. A reorg-quarantined evaluation stops at `MANUAL REVIEW REQUIRED`, shows the
    chain-reorg copy, creates no result/error state, disables the control, and
    sends exactly one intent POST.
11. An unavailable snapshot keeps health, portfolio, and entry controls
    truthful: `UNAVAILABLE` freshness with the backend message, `Unavailable`
    reference price and unrealized PnL, `STOPPED` entries, and a disabled entry
    action.
12. Loading is announced with `aria-busy` and shows no invented numbers.
13–17. Overview at 320, 375, 768, 1024, 1280 px, light and dark.
18. Official brand mark follows the theme, with favicon and social metadata.
19. Brand mark leads the top bar at 320 px with zero overflow.
20. Route screenshots for candidates, candidate detail, risk, portfolio,
    journal, more.
21. axe scan of Overview: 0 serious/critical violations.
22. axe scan of candidate detail, risk, portfolio, journal, plus the manual-review
    panel in light and dark themes: 0 serious/critical.
23. Keyboard: first Tab focuses the skip link, second Tab focuses `Overview`
    navigation.
24. No button whose name starts with "Live"; the build states there is no LIVE
    control.

## Viewports

| Width | Horizontal overflow | Navigation |
|---|---|---|
| 320 | 0 px | bottom nav, 5 labelled items |
| 375 | 0 px | bottom nav |
| 768 | 0 px | bottom nav |
| 1024 | 0 px | 240 px sidebar |
| 1280 | 0 px | 240 px sidebar |

Measured with `document.documentElement.scrollWidth - window.innerWidth` in
both themes.

## Accessibility

- axe-core tags `wcag2a, wcag2aa, wcag21a, wcag21aa` on five routes: no
  serious or critical violations.
- Skip link, semantic `header/nav/main/section/footer`, one `h1` per page,
  visible `:focus-visible` ring (3 px `--focus`), 48 px targets on coarse
  pointers, `aria-current="page"` navigation, `role="alert"` for errors,
  `aria-live` for copy feedback, `prefers-reduced-motion` disables animation.
- Status is always label + icon + color, never color alone. Gas `UNAVAILABLE`
  is a labelled badge with the backend's reason, not a zero.

## Brand assets

Source: `Trident.zip` (SHA-256 `ba3b37f5…94ca06`, 8 entries). Extraction was
done in Python with an explicit path allow-list, so no entry could escape the
target directory; every shipped file was then re-hashed against the archive.

Shipped in `apps/web/public`:

| File | Role |
|---|---|
| `brand/logo-black-transparent.png` | mark on the light canvas |
| `brand/logo-white-transparent.png` | mark on the dark canvas |
| `brand/seo-light.png` | Open Graph / Twitter card, 2000×2000, light card |
| `brand/seo-green.png` | alternate social card on the Robinhood green, shipped for campaigns but not referenced yet |
| `favicon.ico` | supplied 32×32 icon, linked with `sizes="32x32"` |

The background-baked logo variants are deliberately not shipped: the interface
supplies its own surfaces, and a baked background would show a rectangle in
dark mode. `brand/README.md` records provenance and the source-to-destination
map.

Behaviour (covered by tests 16 and 17):

- The mark sits in a 1:1 box with `object-fit: contain`, so the 1024×1440 ink
  is never stretched and the layout does not jump between variants.
- Two `<img>` elements are toggled by `[data-theme]` CSS; the hidden one leaves
  the layout and the accessibility tree. The wrapper carries
  `role="img" aria-label="TRIDENT"`, so the mark is announced once.
- Placement: sidebar brand beside the `PAPER` label at ≥1024 px (`brand-sidebar-1280-light.png`,
  `brand-sidebar-1280-dark.png`); below 1024 px the sidebar is hidden and the
  mark leads the top bar (`brand-mobile-320-light.png`, zero overflow at 320 px).
- `theme-color` follows the active theme, read from the `--canvas` token, so the
  browser toolbar is retinted without duplicating a hex value.
- `index.html` carries the icon link, a description, Open Graph and Twitter card
  metadata with `og:image:alt`.

## Contract adoption

`apps/web` imports `@trident/api-contract` schemas and parses every response
with them. A payload that drifts becomes a visible `CONTRACT_MISMATCH` error
instead of a silently wrong number. The intent action posts only
`{evaluationId, idempotencyKey}`; the previous `meta.orderId` / `meta.fillId`
assumptions are gone. The result view branches on `fill === null` and on
`riskDecision.verdict`, and renders `gasEstimate` as `AVAILABLE`/`UNAVAILABLE`
with provenance — never as zero.

## Known gaps (not fixed here)

1. `GET /api/v1/intents/:id` is still outside the contract (`MIGRATION.md`
   records this). The web client parses it with a local, narrow schema
   (`intent` + nullable `riskDecision`), so a future backend change there will
   not be caught by the shared contract.
2. **Journal scan depth is bounded.** `/api/v1/journal` has no `type` filter, so
   finding a risk decision means paging back through worker events. Beyond
   roughly three hours of traffic (or the page budget) a decision is no longer
   reachable from the UI. A `type=` filter on the journal endpoint would remove
   the limit.
3. `gasQuoteCost` is absent because there is no sourced ETH/USDG price; the UI
   states that instead of converting with an invented rate.
4. Open Graph images use site-relative paths because the deployment origin is
   still undecided; a crawler needs absolute URLs at deploy time.
5. No real-device, Firefox, WebKit, or screen-reader run. 200% zoom is covered
   only as 320 px reflow.
6. The long-running paper database holds a position, so `BUY` is only reachable
   on a fresh paper portfolio; the executed-intent evidence above states which
   database produced it.
7. **Duplicate evaluation is now a replay, verified in the browser.** Earlier at
   `53ed588` a second click on a consumed evaluation produced
   `500 UNIQUE constraint failed: order_intents.evaluation_id`. At `24e39e8` the
   same request returns `200 replayed: true` with the stored execution; the
   duplicate scenario above proves the UI shows that without a 500 or a
   `CONTRACT_MISMATCH`. A typed `409` is not needed for this case.
8. **The reorg 409 is fixture-proven, not reproduced by a destructive live
   reorg.** The backend's real reorg and quarantine path is covered by
   `apps/api/test/reorg.test.ts` (10 cases) and its `409` contract was read from
   `apps/api/src/app.ts`; this branch's browser test intercepts the `409` so the
   UI state is deterministic. A deliberate reorg against the public chain was
   not performed.
