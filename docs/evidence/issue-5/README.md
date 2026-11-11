# Issue #5 — PAPER operational UI: evidence

Run date: 2026-11-11 (UTC). Branch `feat/issue-5-operational-ui`, base
`feat/issue-2-paper-backend` at `7f8c0c2`, plus the contract amendment
`0fb7be6` from PR #7 (cherry-picked as file content, not history).

Everything below was produced on this machine against a real backend process
and the real Robinhood Chain mainnet RPC. Nothing in `apps/web` fakes market
data; the only intercepted responses are inside Playwright tests, and those
tests are labelled "intercepted transport, clearly test-only".

## Runtime

- Node 24.22.2, pnpm 9.12.3, Playwright 1.65 (chromium headless shell).
- API: `node apps/api/dist/server.js` with `EXECUTION_MODE=PAPER`,
  `RPC_URL=https://rpc.mainnet.chain.robinhood.com`, `EXPECTED_CHAIN_ID=4663`,
  `DATABASE_PATH=/tmp/opencode/trident-web/data/trident.sqlite`, port 8099.
- Web: `pnpm --filter @trident/web build` then `pnpm preview` on
  `127.0.0.1:4173`, proxying `/api` and `/health` to the API on 8099.

## Gates

| Command | Result |
|---|---|
| `pnpm -r typecheck` | PASS (3 packages) |
| `pnpm -r test` | PASS — API 42 passed / 4 skipped (real-RPC tests need `RUN_RPC_TESTS=1`), contract 17, web 32 |
| `pnpm -r build` | PASS — web 389.59 kB JS / 114.56 kB gzip, 12.88 kB CSS / 3.06 kB gzip |
| `npx playwright test` (apps/web) | 19 passed |

## Live API data observed at 09:09Z

- `/health`: `mode PAPER`, `chainId 4663`, `rpcStatus HEALTHY`, head block
  `111587151`, latency 131 ms, `killSwitchEngaged false`.
- `/api/v1/markets/weth-usdg/snapshot`: status `COMPLETE`, block `111587085`,
  hash `0x80527fb6…177a7`, source `uniswap-v3-pool+quoter`, price
  `2058811445504168297707` at scale `18`, `sourceTime` from the block.
- `/api/v1/portfolio`: mode `PAPER`, equity `10000838679` (6 decimals), cash
  `9499950000`, one open position.
- `/api/v1/journal`: real `strategy.evaluation.recorded` and
  `market.snapshot.persisted` events, plus `risk.decision.recorded` after a
  PAPER intent was created.

Screenshots are the exact frames the Playwright run captured; the header values
in them match the payloads above at capture time (blocks advance every second,
so later runs show later blocks).

## Browser acceptance (19 tests)

1. Overview renders the head block, the pinned snapshot block, the latest
   action, and the strategy id from the same HTTP responses it consumed.
2. Candidate detail shows block hash, `block:` from the same snapshot response,
   source, and `sourceTime:`.
3. Portfolio is labelled `SIMULATED`, shows a real equity value, and states
   `PAPER — no real money`.
4. Journal lists a real audit event type returned by the API.
5. Risk page shows either real per-rule evidence or an explicit empty state;
   it never renders a decision it does not have.
6. Offline/error state keeps prior values labelled and offers retry.
7. An empty evaluation list renders as Empty, not Error.
8. A stale snapshot is labelled `Stale` and cannot look healthy.
9. Loading is announced with `aria-busy` and shows no invented numbers.
10–14. Overview at 320, 375, 768, 1024, 1280 px, light and dark.
15. Route screenshots for candidates, candidate detail, risk, portfolio,
    journal, more.
16. axe scan of Overview: 0 serious/critical violations.
17. axe scan of candidate detail, risk, portfolio, journal: 0 serious/critical.
18. Keyboard: first Tab focuses the skip link, second Tab focuses `Overview`
    navigation.
19. No button whose name starts with "Live"; the build states there is no LIVE
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
both themes. Two real overflows were found and fixed during this run: the
per-rule evidence grid (min column width) and a long rule identifier.

## Accessibility

- axe-core tags `wcag2a, wcag2aa, wcag21a, wcag21aa` on five routes: no
  serious or critical violations.
- Skip link, semantic `header/nav/main/section/footer`, one `h1` per page,
  visible `:focus-visible` ring (3 px `--focus`), 48 px targets on coarse
  pointers, `aria-current="page"` navigation, `role="alert"` for errors,
  `aria-live` for copy feedback, `prefers-reduced-motion` disables animation.
- Status is always label + icon + color, never color alone.

## Contract adoption

`apps/web` imports `@trident/api-contract` schemas and parses every response
with them. A payload that drifts becomes a visible `CONTRACT_MISMATCH` error
instead of a silently wrong number. The intent action posts only
`{evaluationId, idempotencyKey}` and reads the amended `IntentExecution`
(`intent`, `riskDecision`, `order`, `fill`), branching on `fill === null`, and
renders `gasEstimate` as `AVAILABLE`/`UNAVAILABLE` with provenance — never as
zero.

## Known gaps (not fixed here)

1. **Backend response shape.** PR #8 at `7f8c0c2` still returns
   `{intent, riskDecision}` with `meta.orderId`/`meta.fillId`; the amended
   contract requires `order` and `fill` in `data`. A live `POST /api/v1/intents`
   on 2026-11-11T08:33Z returned `status FILLED` and 15/15 PASS but no
   `order`/`fill` keys. The UI therefore surfaces an explicit contract-mismatch
   message on that action until PR #8 adopts `0fb7be6`. Read paths, risk
   evidence, and portfolio are unaffected.
2. No real-device, Firefox, WebKit, or screen-reader run. 200% zoom is covered
   only as 320 px reflow.
3. Gas estimate rendering is exercised with contract-valid fixtures in unit
   tests; the backend does not emit `PaperFill` yet.