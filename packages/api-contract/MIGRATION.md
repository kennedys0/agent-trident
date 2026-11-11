# Migration note — intent execution contract (PR #7, 2026-11)

Amends `@trident/api-contract` after PR #8 integration review. Zod remains the
single source of truth; `openapi.json` and `src/generated.ts` are regenerated.
Breaking for the intent-execution slice only. Drift gate: `pnpm --filter
@trident/api-contract test`.

## What changed

### 1. `POST /api/v1/intents` has a full response contract

`201` (fresh, approved) and `200` (idempotent replay or rejected execution)
now return the same body:

```ts
// data
{
  intent: TradeIntent,
  riskDecision: RiskDecision,   // APPROVED ⇒ order+fill present; verdict discriminates
  order: PaperOrder | null,     // explicit null on REJECTED, never absent
  fill: PaperFill | null,       // explicit null on REJECTED, never absent
}
// meta — strict, route-specific
{ requestId: string, observedAt: string /* date-time */, replayed: boolean }
```

Cross-field invariants are enforced at parse time: `order.intentId ===
intent.id`, `fill.orderId === order.id`, `fill.snapshotId ===
intent.snapshotId`; `riskDecision.verdict === 'APPROVED'` requires status
`FILLED` with order and fill, `REJECTED` requires status `REJECTED` with
`order: null` and `fill: null`. `replayed: true` means a prior execution with
the same idempotency key was replayed — no new order, fill, or ledger effect
was written.

`meta.fee`, `meta.orderId`, `meta.fillId` are gone: the fee tier lives at
`/api/v1/venues`, and order/fill ids live in `data.order.id` / `data.fill.id`.

### 2. `PaperFill.gasQuoteEstimate` removed → `gasEstimate` discriminated union

```ts
gasEstimate:
  | { status: 'AVAILABLE', gasUnits: positiveBaseUnitString,
      gasPriceWei: baseUnitString,          // "0" is legal only for a genuinely zero baseFee
      gasCostWei: baseUnitString,           // MUST equal gasUnits * gasPriceWei (enforced)
      gasQuoteCost?: { value: string; decimals: number },  // only with a sourced ETH→quote conversion
      provenance: string }                  // e.g. "quoter-v2 gasEstimate + block baseFee at block N"
  | { status: 'UNAVAILABLE', reason: string, provenance: string }
```

Never emit `0`, `null`, or a placeholder to mean "unknown": use `UNAVAILABLE`
with a reason and where it was checked. `gasQuoteCost` is optional and must
carry a sourced conversion; do not derive it without an ETH/USDG price.

## Nexus (PR #8)

- Drop the hardcoded 20 gwei baseFee. Either price gas from the block you
  quote at (`eth_getBlockByNumber` baseFee, same pinned block) and emit
  `AVAILABLE` with `gasPriceWei` + `gasCostWei` + provenance, or emit
  `UNAVAILABLE` with reason. `gasQuoteCost` stays absent until an ETH→USDG
  conversion is sourced.
- Map order row → `order` (`CREATED|FILLED|CANCELLED`, `createdAt` =
  `created_at`) and fill row → `fill` (AmountIn→side-specific qty fields per
  existing `PaperFill` semantics). Delete the `meta.orderId` / `meta.fillId` /
  `meta.fee` workaround; send `meta: { requestId, observedAt, replayed }`.
- Validate the whole envelope with `intentExecutionSchema`; the rejected path
  must send `order: null, fill: null` and intent `status: 'REJECTED'` —
  anything else now fails `schema.parse`.
- `gasUnits` persist from `quotes.gasEstimate`; keep them quoted at the
  snapshot block. If the quote adapter adds `gasPriceWei`, units × price must
  equal the stored cost wei.
- Follow-up (not in this PR): `GET /api/v1/intents/:id` still has no contract
  path; add when convenient. It returns the same `{intent, riskDecision}`
  shape with `riskDecision: null` possible today — needs a decision, do not
  reuse `IntentExecution` for it as-is.

## Forge (web)

- Intent execution response is now
  `components.schemas.IntentExecution` (anyOf of the executed and rejected
  variants). Branch on `data.fill === null` (or `riskDecision.verdict`):
  approved renders order + fill; rejected renders reasons from
  `riskDecision.rules[]` and never shows an order id.
- `replayed: true` in meta means the user already executed this key — show a
  replay notice, not a new-activity confirmation.
- Gas UI binds to `gasEstimate.status`: `AVAILABLE` shows
  units/cost with a provenance tooltip; `UNAVAILABLE` shows the reason. Never
  render `0` as a gas estimate. Same discipline as `UNPRICED` positions.
- Regenerate/consume types from `./generated`; do not hand-write parallel
  types. Drift gate fails the build if generated types change without
  regenerating.

## Verification

`pnpm -r typecheck`, `pnpm -r build`, `pnpm --filter @trident/api-contract
test` — 17/17 contract tests including gas-estimate consistency, crossed-state
rejection, and meta round-trip. No live-network claims from fixture tests.
