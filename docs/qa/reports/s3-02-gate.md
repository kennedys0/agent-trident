# QA Report — Final Gate PR #25 (S3-02 Market Intelligence)

- **PR:** https://github.com/kennedys0/agent-trident/pull/25 — `feat(s3-02): read-only market intelligence and persistent watchlists (issue #22)`
- **Head diuji (beku):** `2e7ffa620b41946d67bf529b1b952b8d7c23fa6d` (detached; orang tua = `main` `4cd05c7`)
- **Base:** `main` — PR ini menyentuh `main` langsung, sehingga GitHub Actions terpicu
- **Status PR saat dicek:** `open`, `merged=false`, `mergeable_state=clean`
- **Waktu:** 2026-11-12 17:15–17:30 UTC
- **Reviewer:** Probe (QA independen). Tanpa merge, tanpa mengubah branch, nol file tracked dimodifikasi.

## VERDICT: PASS — 0 blocker. Rekomendasi merge: YA (sesuai urutan yang diotorisasi: #25 dulu, lalu #26).

| Butir | Hasil | Bukti |
|---|---|---|
| install --frozen-lockfile | PASS (exit 0) | `probe-s3-02-gates.log:11` |
| typecheck (contract, api, web) | PASS (exit 0) | `:24` |
| full tests | PASS (exit 0) | contract **25/25 + drift PASS**; API **169 passed + 4 skipped**; web **42/42** | 
| build (seluruh workspace) | PASS (exit 0) | `:190` |
| audit:gate | PASS (exit 0, 0 advisory) | `:201` |
| audit:gate:test | PASS **49/49** | `:264` |
| CI GitHub (base `main`) | PASS — **2/2 check-run success**: "Deterministic gates (typecheck, tests, build)" + "Dependency security (high and critical)" | GitHub API, head `2e7ffa6` |
| Kontrak Zod + OpenAPI drift | PASS | `packages/api-contract` test menjalankan `generate` lalu `git diff --exit-code openapi.json src/generated.ts` — bersih |
| Migration 005 additive | PASS | `apps/api/src/db/migrations.ts:289-320` — hanya `CREATE TABLE watchlist_entries`, `CREATE TABLE pool_market_snapshots`, `CREATE INDEX`; 0 ALTER/DROP; startup DB segar & restart DB lama tanpa error log |
| Watchlist persistence (restart) | PASS (live) | POST WETH → **201 ADDED**; GET len=1; **proses API baru** (restart) → len=1, `addedAt` asli dipertahankan; DELETE → 200 → len=0. Malformed → **400**; unknown token → **404**; alamat pool (bukan token) → **404** (benar: watchlist hanya token). Unit: `apps/api/test/marketIntel.test.ts:257` |
| AVAILABLE / STALE / UNAVAILABLE | PASS (live) | DB segar → `UNAVAILABLE` "no observation persisted yet"; detail refresh → **AVAILABLE**; lewat freshness 8s → **STALE** ("observation is 24s old"); detail → AVAILABLE lagi (pinned refresh). Unit: `:115` (empty pool → UNAVAILABLE, bukan nol), `:134` (batas STALE deterministik) |
| Decimal/token-order price math | PASS (live + unit) | USDG/WETH = **2007.9713**, WETH/USDG = **0.00049802**, produk = **1.000000**, rentang masuk akal; scale = basis desimal string (`scale "1000000000000000000"`). Unit `:77` (sqrtPriceX96 nyata) + `:90` (round-trip dua arah) |
| Liquidity provenance | PASS (live) | `metrics.liquidity` AVAILABLE + provenance `uniswap-v3-slot0+balanceOf@block-112700748; … blockHash 0x6e916ec7…`, `blockNumber`, `sourceTime`, reserve0/reserve1 ikut terbawa |
| Volume SELALU UNAVAILABLE | PASS (live + kontrak) | Listing & detail: `volume24h.status=UNAVAILABLE`, alasan jujur "no verifiable volume source; the public RPC exposes no pinned-block per-pool volume". Kontrak: "volume can never be reported as zero or estimated away from UNAVAILABLE"; unit `:190` |
| Registry absent/malformed fail-closed | PASS | Live: `meta.registryStatus=ABSENT` (S3-01 belum merge) → hanya verified pool. Kode `apps/api/src/services/marketIntel.ts:77-101`: tabel hilang → ABSENT; `RegistryUnreadableError` → UNAVAILABLE + `discovered=[]`; baris jelek → `sanitizePool` null → dilewati (`registrySkipped++`). Unit `:233`: registry malformed → `UNAVAILABLE` + verified pool tetap disajikan |
| Discovered pool non-actionable | PASS | Unit `:285-324`: pool discovered + evaluasi BUY → `POST /api/v1/intents` → **422 `INTENT_NOT_ACTIONABLE`**; watchlist satu-satunya mutasi untuk aset discovered (`docs/s3-02-market-intelligence.md:80-83`) |
| Real-RPC evidence terpisah | PASS | (a) `apps/api/test/chain-rpc.test.ts:11-18` gated `RUN_RPC_TESTS=1` (default skip → 4 skip di suite normal); (b) section khusus `docs/s3-02-market-intelligence.md:85` "Evidence (live, read-only, 2026-11-12)". Saya jalankan: **RUN_RPC_TESTS=1 → 4/4 PASS** (chainId 4663, head live, pool dari factory, snapshot block-pinned + provenance) |
| PAPER-only | PASS | Diff scan: 0 pola `eth_send*`/signer/privateKey/LIVE; runtime `EXECUTION_MODE=PAPER`, chainId 4663; 0 lockfile/workflow/file keamanan berubah; 0 tes dihapus/di-skip |
| Scope diff `main..2e7ffa6` | PASS | 17 file: `apps/api` 8, `packages/api-contract` 5, `docs/s3-02-market-intelligence.md`, `README.md`, `ARCHITECTURE.md` — semua dalam lingkup S3-02 |

## Temuan blocker

Tidak ada. Tidak ada file:line blocker.

## Catatan non-blocking

1. **4 tes skip di suite default** = suite real-RPC yang memang gated `RUN_RPC_TESTS` (dokumentasi `chain-rpc.test.ts:15-16`); berjalan hijau saat diaktifkan (4/4). `ci.yml:6-9` tidak pernah menyentuh chain live by design; `real-rpc.yml` dispatch/cron — sama seperti baseline sebelumnya.
2. **Watchlist menerima token, bukan alamat pool** — POST alamat pool menghasilkan 404 (`app.ts:500-504`, `NOT_FOUND "Unknown asset…"`). Benar menurut kontrak, tapi mudah disalahartikan pengguna.
3. **Harga bukan oracle independen** — `confidence=LOW`, confidenceReason "single Uniswap v3 pool; a spot price is not an independent oracle" (jujur, sesuai batas yang dinyatakan di doc).
4. Bukti live memakai RPC publik Robinhood head ~112700748 (2026-11-12T17:23Z); angka akan berubah — yang diuji adalah perilaku, bukan nilai absolut.

## Perintah yang dijalankan

```
git worktree add --detach /tmp/opencode/probe-s3-02 2e7ffa6…   # detached, branch tak diubah
pnpm install --frozen-lockfile        # exit 0
pnpm -r typecheck                     # exit 0
pnpm -r test                          # exit 0 (contract 25+drift, api 169+4skip, web 42)
pnpm -r build                         # exit 0
pnpm audit:gate                       # exit 0, 0 advisory
pnpm audit:gate:test                  # 49/49
RUN_RPC_TESTS=1 pnpm --filter @trident/api test chain-rpc     # 4/4 PASS
bash /tmp/opencode/probe-s3-02-live.sh # uji live: status, harga, watchlist+restart, STALE
```

## Artefak / jejak (semua di luar repo)

- Log gate: `/tmp/opencode/probe-s3-02-gates.log`
- Skrip uji live: `/tmp/opencode/probe-s3-02-live.sh`; runtime: `/tmp/opencode/probe-s3-02-runtime/` (api.env, api*.log, detail.json, trident.sqlite)
- Worktree: `/tmp/opencode/probe-s3-02` (detached `2e7ffa6`, bersih — hanya file runtime di luar)
- Server live (API 8090) sudah dimatikan; port review lain (8080-8082, 4173-4175) sudah tertutup dari sesi sebelumnya.
