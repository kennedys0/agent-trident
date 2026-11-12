# QA Report — S3-03 Discover UI, PR #26

> **VERIFIKASI ULANG F-1 (2026-11-12, head `2e69f61c55d4f54a8fd585c74878730bc2961fac`): F-1 TERTUTUP — verdict S303-12 dan verdict keseluruhan S3-03 dinaikkan dari FAIL menjadi PASS.**
>
> - **Diff `0822346..2e69f61`** (9 file, +111/−3): `apps/web/src/styles/base.css` (2 baris: `color: var(--ink)` → `var(--status-ink)` pada `.nav-link[aria-current='page']` dan `.bottom-nav__link[aria-current='page']`), `apps/web/test/theme-contrast.test.ts` (tes regresi baru, 4 tes), `apps/web/e2e/discover-evidence.mjs` (+8 baris: harness kini menjalankan axe gelap untuk listing DAN inspector), 5 screenshot `listing-dark-*.png` + `docs/evidence/s3-03/results.json` (10 entri axe dark baru). **Tidak ada file di luar `apps/web/` + `docs/evidence/`; 0 lockfile/workflow/rpc-guard; 0 tes dihapus/di-skip; gate tak dilemahkan.** Scope vs base `2e7ffa6` = 46 file (45 + tes kontras), semuanya masih dalam dua direktori itu.
> - **Rasio terukur (computed style, dark theme, backend nyata via preview):** sidebar + bottom nav aktif, `fg rgb(18,18,18)` (#121212) di atas `bg rgb(255,230,0)` (#ffe600) = **14.78:1** — PASS di 10/10 kombinasi (2 elemen × 320/375/768/1024/1280). Sebelumnya 1.21:1. Light theme tak berubah (`--status-ink` = `--ink` = #121212 pada root); token `--status-ink`/`--wait` tidak di-override di dark (`tokens.css:41-46`); selector badge/status tidak tersentuh (semua pemakaian `background: var(--wait)` lain sudah pakai teks gelap).
> - **10 axe run default (Discover listing + Inspector, dark, 320/375/768/1024/1280):** nol pelanggaran `color-contrast` (0 kemunculan di `qa-results.json`). Sisa 10 FAIL = `page-has-heading-one` di Inspector (light 5 + dark 5) = **F-2 non-blocking yang sudah dilaporkan sebelumnya**, tidak diubah oleh patch ini.
> - **Probe runtime penuh (backend nyata 3 instance, head `2e69f61`): 102 PASS / 10 FAIL dari 112** (head lama 97/15). Perbandingan: 5 check `axe-listing-dark-*` berubah FAIL→PASS, **nol check baru gagal**, 102 check yang dulu PASS tetap PASS → nol regresi acceptance lain.
> - **Gate diulang di `2e69f61` (exit 0 semua):** typecheck · contract 25/25 + drift · API 169 passed + 4 skipped · web **74/74** (70 + 4 tes kontras baru) · audit:gate + audit:gate:test 49/49 · build `index-Ciw3EYGa.js` 467.19 kB.
> - **Regression test** `apps/web/test/theme-contrast.test.ts` mengunci kedua selector ke `var(--status-ink)`, mengunci rasio ≥4.5 (≈14.78), dan mengunci kesetaraan `--status-ink` = `--ink` di light theme; terbukti berjalan (4 tes ikut 74/74).
> - **Jejak:** log gate `/tmp/opencode/probe-s3-03-gates-2e69f61.log`, log probe `/tmp/opencode/probe-s3-03-runtime/qa-run-2e69f61.log`, hasil `…/qa/qa-results.json` (baseline lama disimpan di `…/qa-head-0822346/`), skrip ukur `apps/web/qa-contrast-2e69f61.mjs` (10/10 PASS). Server review (API 8080/8081/8082, preview 4173/4174/4175) sudah dimatikan. Tanpa merge, tanpa mengubah branch; worktree tetap detached (kini di `2e69f61`) dengan hanya skrip QA untracked.
>
> Bagian di bawah adalah laporan lengkap pada head lama `0822346` (FAIL), dipertahankan sebagai riwayat.

- **PR:** https://github.com/kennedys0/agent-trident/pull/26 — `S3-03: add responsive Discover UI with real market data`
- **Head diuji (beku, lama):** `0822346d6074aecb3ede16d04b680d410e078dc0`
- **Base (stacked):** PR #25 `sprint3/s3-02-market-intelligence` @ `2e7ffa620b41946d67bf529b1b952b8d7c23fa6d` (bukan `main`)
- **Status PR:** `open`, `merged=false`, `mergeable_state=clean`, 45 file, +2637/−59
- **Matrix:** `/qa/s3-04-acceptance-matrix.md` (milik Probe, baseline `main` `4cd05c7`)
- **Waktu eksekusi:** 2026-11-12 13:57–16:40 UTC
- **Reviewer:** Probe (QA independen). Tidak ada merge, tidak ada gate yang diubah, tidak ada file tracked yang dimodifikasi.

## VERDICT KESELURUHAN: FAIL (1 butir blocker: S303-12) — >! SUPERSEDED: naik PASS di head `2e69f61`, lihat blok verifikasi ulang di atas

Satu butir acceptance gagal (kontras WCAG AA tema gelap pada elemen shell global). Asal-usulnya **pra-ada di base** — bukan regresi PR #26 (bukti di Temuan F-1). Semua butir lain PASS; **tidak ada temuan produk yang diperkenalkan diff ini**.

| Ringkasan | Hasil |
|---|---|
| Suite deterministik (install/typecheck/test/build) | PASS — exit 0 semua |
| Contract tests + drift | PASS — 25/25 |
| API tests | PASS — 169 passed, 4 skipped (real-RPC, `RUN_RPC_TESTS=0`) |
| Web tests | PASS — 70/70 |
| Audit gate + tesnya | PASS — exit 0, 0 advisory; 49/49 |
| Probe runtime Playwright (backend nyata,3 lebar-API) | 97 PASS / 15 FAIL — 15 FAIL = 2 akar temuan axe |
| Binding kontrak (3 payload adversarial) | PASS — 3/3 ditolak utuh |
| Explorer link (build bervariabel env) | PASS — href persis + `rel`/`target` aman |
| Mutation check (2 asersi kritis) | PASS — kedua tes gagal saat kode dimutasi |
| Audit manifest + 25 screenshot | PASS — lengkap, valid, jujur berlabel FIXTURE |
| PAPER-only / scan gate | PASS — nol pola signer/LIVE, gate tak dilemahkan |
| GitHub Actions | TIDAK TERPICU — check-run = 0 (base bukan `main`) |
| Acceptance S303-12 (kontras gelap) | **FAIL** |
| Acceptance S303-01..11, S303-13..15, X-01..06, X-11..13, SEC-01 | PASS |

## Perintah yang dijalankan dan hasilnya

Worktree beku: `/tmp/opencode/probe-s3-03` (detached `0822346`, hanya skrip QA untracked).

| Perintah | Hasil |
|---|---|
| `pnpm install --frozen-lockfile` | exit 0 |
| `pnpm -r typecheck` | exit 0 (contract, api, web) |
| `pnpm -r test` | contract `pass 25 / fail 0` + `check:drift` PASS; api `169 passed \| 4 skipped` (12 file pass, 1 skip); web `70 passed` (5 file) |
| `pnpm -r build` | exit 0; bundle web `index-BwraakH6.js` 467.19 kB / 139.34 kB gzip (hash sama dengan bukti Forge) |
| `node scripts/audit-gate.mjs` | PASS, exit 0 (0 advisory, 0 allowlist) |
| `node --test scripts/audit-gate.test.mjs` | 49/49 |
| `node qa-probe.mjs` (Playwright + axe, backend nyata) | 97 PASS / 15 FAIL, `qa-results.json` |
| `node qa-contract.mjs` (3 payload melanggar kontrak) | 3/3 PASS |
| `node qa-explorer.mjs` (build + `VITE_CHAIN_EXPLORER_URL`) | PASS |
| `node qa-dark-scope.mjs` (kontras gelap lintas halaman) | `/discover`, `/risk`, `/portfolio` kena; `/overview` tidak |
| Mutasi `orderPools` (urutan likuiditas dibalik) → `pnpm --filter @trident/web test` | **1 failed / 69 passed** → tes ordering menggigit; file dikembalikan, `git status` bersih |
| Mutasi `useWatchlist` (override optimistis sebelum request) → tes yang sama | **1 failed / 69 passed** (`aria-pressed` jadi `true` padahal seharusnya `false`); file dikembalikan, `git status` bersih |
| `git diff 2e7ffa6..0822346` + grep statis | 45 file: hanya `apps/web` (src/test/e2e/css) + `docs/evidence/s3-03`; **0** lockfile/workflow/`rpc-guard`/`audit-gate`/`config.ts` |

Log lengkap: `/tmp/opencode/probe-s3-03-gates.log`, `/tmp/opencode/probe-s3-03-runtime/qa-run.log`, hasil per-check `/tmp/opencode/probe-s3-03-runtime/qa/qa-results.json`.

## Temuan

### F-1 — BLOCKING (per matrix): kontras WCAG AA gagal di tema gelap (elemen shell global)

- **Severity:** serious (axe `color-contrast`, WCAG 2.2 SC 1.4.3)
- **Area:** shell navigasi — `apps/web/src/styles/base.css:238-243` (`.nav-link[aria-current='page'] { color: var(--ink); background: var(--wait) }`), token `apps/web/src/styles/tokens.css:5,8,44` (`--ink` gelap `#fafafa`, `--wait` `#ffe600`), penerapan di `apps/web/src/components/Shell.tsx:63-64` (sidebar) dan `Shell.tsx:147-149` (bottom nav)
- **Prasyarat:** theme gelap aktif (`data-theme="dark"`), lebar ≥1024 (sidebar) atau <1024 (bottom nav), halaman dengan nav aktif
- **Langkah reproduksi:**
  1. Jalankan API S3-02 + preview build `0822346` (di sini `http://127.0.0.1:8080` + `http://127.0.0.1:4173`)
  2. Buka `/discover` dengan `colorScheme: dark` + `document.documentElement.dataset.theme='dark'`
  3. `new AxeBuilder({ page }).analyze()` (tanpa filter tag)
- **Hasil aktual:** 1 pelanggaran `color-contrast` **serious** — `a[data-testid="nav-discover"]` (dan `bottom-nav-discover` pada 320/375/768): fg `#fafafa` vs bg `#ffe600` = **1.21:1** (min. 4.5:1). Gagal di 5 lebar listing + 5 lebar inspector.
- **Hasil diharapkan:** ≥4.5:1 di kedua tema (S303-12).
- **Bukti:** `/tmp/opencode/probe-s3-03-runtime/qa/qa-results.json` id `axe-listing-dark-*`, `axe-inspector-dark-*`; `node qa-dark-scope.mjs` → `/risk` dan `/portfolio` (halaman yang tidak disentuh PR ini) gagal serupa.
- **Tes yang gagal:** axe runtime (bukan unit test repo).
- **Asal-usul (klasifikasi):** **pra-ada, bukan regresi PR #26.** `git show 2e7ffa6:apps/web/src/styles/base.css` memuat aturan yang identik (baris 238-243); `tokens.css` tidak masuk diff (0 perubahan); tema gelap + `lib/theme.ts` pre-existing (tak ada di diff). PR #26 hanya mengubah bottom-nav `grid-template-columns` 5→6 dan `.addr` di `base.css`.
- **Rekomendasi fix:** aktifkan token foreground terang khusus latar `--wait` (mis. `color: #121212` pada `[data-theme='dark'] .nav-link[aria-current='page']`), bukan `var(--ink)`.
- **Dampak merge:** menurut aturan matrix (baris blocking, satu FAIL = blokir) butir S303-12 FAIL. Karena cacatnya tidak berasal dari diff ini, keputusan (perbaikan shell dulu vs waiver CEO) ada di Atlas/CEO — QA tidak menaikkan status.

### F-2 — NONBLOCKING: halaman Inspector tidak punya `<h1>`

- **Severity:** moderate (axe `page-has-heading-one`, aturan *best-practice*, bukan SC WCAG)
- **Area:** `apps/web/src/features/discover/components/PoolInspector.tsx:154` (judul pasangan dibungkus `Panel`, yang me-render `<h2>` di `apps/web/src/components/Panel.tsx:19`) — tidak ada elemen `<h1>` di halaman
- **Prasyarat/Repro:** buka `/discover/pools/0x…` lalu `AxeBuilder` tanpa filter tag
- **Aktual:** `page-has-heading-one` di 10 kombinasi (light+dark ×5 lebar); `document.querySelectorAll('h1').length === 0`
- **Harapkan:** satu `<h1>` per halaman
- **Bukti/Tes:** `qa-results.json` id `axe-inspector-*`; halaman `/overview` juga tanpa `h1` (pola lama, bukan hanya halaman baru ini)
- **Catatan penting pada klaim bukti Forge:** `apps/web/e2e/discover-evidence.mjs:148` menjalankan axe dengan `.withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa'])` — aturan best-practice seperti `page-has-heading-one` tidak ikut, dan axe gelap tidak dijalankan sama sekali (manifest hanya 10 entri light). Karena itu klaim "axe 0 violations" di PR **tidak mereproduksi** pada konfigurasi axe default, meski tetap benar untuk cakupan WCAG-tag yang mereka uji. Gap ini ditutup oleh run saya.
- **Rekomendasi fix:** render judul Inspector sebagai `<h1>` (mis. lewat `SubjectHeader`) atau tambahkan `<h1>` sr-only di halaman.

### F-3 — NONBLOCKING (catatan kecil)

1. **Copy kontrak vs perilaku:** footer halaman menyatakan payload yang melanggar kontrak "reported as a contract mismatch", tetapi pada respons 200 yang tubuhnya invalid, UI menampilkan judul generik **"Backend error"** (`apps/web/src/features/discover/DiscoverPage.tsx:33-41` — `ApiError` membawa `status: response.status` = 200, `apps/web/src/lib/api/client.ts:113-117`). Penolakan tetap utuh (tidak ada angka dirender), hanya judulnya yang tidak spesifik.
2. **Tema tak terjangkau di mobile:** toggle tema tersembunyi bersama sidebar <1024px sehingga tema hanya bisa diganti di desktop (terkonfirmasi: kontrol berukuran 0×0 di 320px). Shell pre-existing — temuan identik juga disampaikan Pixel.
3. **Sel pendek "FEE0.3%":** label menempel nilai pada 320px (kosmetik; sama dengan temuan nonblocking Pixel).

## Matriks acceptance S303 (PR #26 @ `0822346`)

| ID | Butir | Status | Bukti reproduksi |
|---|---|---|---|
| S303-01 | Semua metrik dari respons API S3; tanpa angka mock | **PASS** | Binding diikat ke respons yang diterima halaman: `listing-price-matches-api` (`2,003.61478741 USDG` identik API), `listing-reserves-match-api`, `inspector-price-matches-api`, `inspector-reserves-match-api`, `listing-footer-count`; 3 payload adversarial ditolak (`qa-contract.mjs`); grep mock/fixture/angka karangan di `apps/web/src` = 0 |
| S303-02 | Listing pool nyata; empty state jujur | **PASS** | `listing-real-pool`, `listing-status-matches-api` (baris menampilkan status persis API), `state-search-empty-real`; empty state "No pools discovered yet" = unit test `renders the discovered-empty copy` + screenshot fixture (batas: tidak ada backend backend-nol pool untuk empty penuh) |
| S303-03 | Search alamat: match, no match, input salah | **PASS** | `search-debounced-real` (ketik `USDG` → panggilan `search=USDG`, 1 baris), `state-search-empty-real` (`q=ZZZZNOPE`), `state-400-simulated` untuk query invalid |
| S303-04 | Inspector field nyata, provenance, link explorer persis | **PASS** | `inspector-title`, `inspector-price/reserves-matches-api`, `inspector-provenance` (block + blockHash dari API), `inspector-volume-unavailable`; href explorer diverifikasi pada build bervariabel env: `https://explorer.invalid/address/0x52e6…71ca`, `rel="noreferrer noopener"`, `target="_blank"`; build default menampilkan pesan jujur "no chain-4663 explorer URL is configured" |
| S303-05 | Watchlist round-trip ke backend persisten; kontrol tak mati | **PASS** | `watch-initial-state`, `watch-pending-nonoptimistic` (pressed=false, busy=true saat POST tertahan900ms), `watch-success-state`, `watch-persisted-server` (GET server ikut berubah), `watch-survives-reload`, `watch-unwatch-roundtrip` (server kembali kosong), `watch-no-client-storage` (localStorage/sessionStorage kosong), `watched-filter-real`, `watch-live-announcement`; mutasi optimistis → tes gagal |
| S303-06 | Loading diumumkan, tanpa angka karangan | **PASS** | `state-loading-real` (skeleton "Loading pools…" saat request nyata tertahan1,2s, `aria-live=polite`/`aria-busy`), `listing-count-live` |
| S303-07 | Empty/error/offline/unavailable beda; retry jalan | **PASS** | testid terpisah `discover-loading`/`discover-empty`/`discover-error`/`discover-refresh-error` + `state-unavailable-real` (alasan API persis); `state-offline-real` ("You are offline"), `state-offline-refresh-banner` (banner "Refresh failed…" + data lama tetap tampil), `state-offline-recovery` (Retry pulih), `state-400-simulated`, `state-500-simulated` |
| S303-08 | Stale dilabel; tak bisa terlihat sehat | **PASS** | `state-stale-listing-real` (API `STALE` → badge STALE + nilai terakhir tampil), `state-refresh-failure-simulated` (refreshError → banner + dipaksa STALE), unit test `keeps a STALE value visible`; catatan: endpoint detail melakukan pinned-refresh sehingga boleh jujur kembali `AVAILABLE` (dicek: UI selalu menampilkan status sesuai respons API) |
| S303-09 | 4xx/5xx/timeout tanpa crash/tanpa mengarang | **PASS** | `state-400-simulated` ("Request rejected" + pesan server), `state-500-simulated` ("Backend error"), `state-watch-failure-simulated` (POST500 → pressed tetap false + banner), 3 skenario kontrak invalid → error state utuh tanpa angka; batas: timeout transport tidak disimulasikan terpisah — jalurnya sama dengan penolakan fetch (terbukti lewat skenario offline) |
| S303-10 | Layout 320/375/768/1024/1280 tanpa overflow; light/dark | **PASS** | `no-page-overflow-*` 10/10 (scrollWidth == viewport), `listing-data-labels-*`, `listing-sr-only-thead-*`, `listing-dark-light` |
| S303-11 | Urutan keyboard, fokus terlihat, tanpa jebakan | **PASS** | `keyboard-first-focus` (skip-link), `keyboard-dom-order`, `focus-ring-3px` (`rgb(59,91,255)`3px), `keyboard-no-positive-tabindex`, `touch-targets-44` |
| S303-12 | Kontras WCAG AA light dan dark | **FAIL** | Lihat **F-1** — tema gelap, rasio1.21:1 pada nav aktif (shell, pra-ada) |
| S303-13 | Reduced-motion dihormati | **PASS** | `reduced-motion` (media `reduce` aktif; pulse/spin/transition mati) + aturan CSS ada di diff |
| S303-14 | Token desain & semantik PAPER utuh; tanpa LIVE | **PASS** | `inspector-paper-badge`, `no-live-copy`, `no-trade-copy`, `no-chart-canvas`, `no-volume-number`; scan diff nol pola signer/`eth_send*`/`LIVE`; `SUPPORTED_MODES = ['OBSERVE','PAPER']` tak tersentuh (`apps/api/src/config.ts:6`) |
| S303-15 | Link eksternal alamat persis + `rel`/`target` aman | **PASS** | `qa-explorer.mjs` PASS (href persis, https-only, `noreferrer noopener`, `_blank`); build default `inspector-explorer-honest` |

## Matriks lintas (X) dan SEC

| ID | Butir | Status | Bukti |
|---|---|---|---|
| X-01 | Tanpa signer/private key/wallet/`eth_send*`/LIVE di source & diff | **PASS** | grep baris tambahan diff = 0; grep `LIVE`/trade = 0 |
| X-02 | PAPER satu-satunya mode; kontrak tolak LIVE | **PASS** | `SUPPORTED_MODES` tak berubah; `EXECUTION_MODE=PAPER` pada runtime; `/health` → `mode: PAPER` |
| X-03 | Tanpa advisory baru; audit gate hijau | **PASS** | `audit-gate.mjs` exit 0; tes 49/49; lockfile tidak berubah |
| X-04 | Suite deterministik + build di PR head | **PASS** | tabel perintah di atas (exit 0 semua) |
| X-05 | Isolasi `RUN_RPC_TESTS=0`; tanpa job real-RPC di `pull_request` | **PASS** | 4 tes chain-rpc skip; `ci.yml:6-9` hanya `pull_request/push → main`; `real-rpc.yml` hanya `workflow_dispatch` + cron |
| X-06 | Tanpa pelemahan gate (tes dihapus/.skip/continue-on-error) | **PASS** | diff tes = +862/−0, tanpa `.skip`/`.only`/`continue-on-error`; 2 mutation check membuktikan asersi kritis menggigit |
| X-07..X-09 | DB/reorg/konsistensi discovery | **N/A untuk PR #26** | diff tidak menyentuh DB/discovery (milik review S3-01/S3-02) |
| X-10 | Migrasi aditif | **N/A untuk PR #26** | tidak ada perubahan skema/migrasi di diff |
| X-11 | provenance real-RPC per PR | **PASS** | run runtime memakai RPC4663 nyata: `/health` → `chainId 4663`, `rpcStatus HEALTHY`, `headBlock 112673403`, `2026-11-12T16:37:04Z`, latensi822ms; observasi pool dari blok nyata (`block 112660407` pada run probe) |
| X-12 | RPC guard utuh | **PASS** | tidak ada file `apps/api/src/chain/*` di diff |
| X-13 | Validasi input API di boundary | **PASS** | tidak ada perubahan API; 169 tes API +3 skenario kontrak UI |
| SEC-01 | Sentinel: temuan terdisposisi, tanpa blocker | **PASS** | verdict Sentinel untuk PR #26: PASS,2 Low nonblocking (ExplorerLink env di module-load & guard alamat) |

## Audit manifest + 25 screenshot (bukti Forge)

- `docs/evidence/s3-03/results.json`: `dataSource` **jujur** berlabel `FIXTURE: S3-02 is not merged into main (PR #25); every API response below is intercepted in the browser.`
- 25 nama di manifest = 25 file PNG di disk (0 hilang, 0 ekstra), semua PNG valid (magic + dimensi ≥320px), ukuran39–199 kB (tidak ada yang kosong).
- Isi visual saya periksa langsung: `listing-320.png` (3 pool AVAILABLE/STALE/UNAVAILABLE, angka fixture `2,500.00`, blok `123456`), `pool-inspector-320.png` (provenance per metrik, volume Unavailable, "Explorer link unavailable" jujur), `state-offline-375.png` (BROWSER OFFLINE + banner + "You are offline" + Retry), `watch-success-375.png` (kontrol berubah jadi "Unwatch").
- Manifest `axe` berisi 10 entri **light saja** dan hanya dengan filter tag WCAG → lihat catatan di F-2. Fixture **tidak** menggantikan bukti nyata: setiap klaim penting diulang dengan backend RPC4663 sungguhan oleh probe saya (97 PASS).

## Batas stacked-PR / CI / lingkungan

1. **GitHub Actions tidak terpicu:** `check-runs` pada `0822346` = **0**; `ci.yml` hanya memicu `pull_request`/`push` ke `main`, sedangkan base PR #26 adalah branch PR #25. Faktual, bukan bypass — gate lokal (install/typecheck/test/build/audit-gate) menjadi pengganti sementara dan semuanya hijau.
2. **Stacked PR:** diff dinilai terhadap `2e7ffa6` (bukan `main`); base-nya belum merge, jadi gabungan #25+#26 ke `main` belum bisa diverifikasi CI.
3. **CI nyata belum pernah menjalankan suite ini** — klaim "suite hijau" berasal dari eksekusi lokal saya di head beku.
4. **Empty state penuh (0 pool)** dan **timeout transport** tidak dieksekusi pada backend nyata (tutup oleh unit test/fiks + jalur offline yang sama) — dinyatakan sebagai batas, bukan PASS terselubung.
5. **Urutan multi-pool** diverifikasi lewat unit test + mutation (backend nyata hanya punya1 pool terlacak).
6. Semua server/skrip berjalan di worktree temp; **tidak ada file repo tracked yang diubah** (setelah mutasi dikembalikan, `git status --porcelain` hanya berisi skrip QA untracked saya).

## Artefak / jejak

- Laporan ini: `/data/OpenBot/Agents/agent-f2d6be6e-9d06-4649-b7bf-0caa350dc611/qa/bug-report.md`
- Log gate: `/tmp/opencode/probe-s3-03-gates.log`
- Probe runtime: `/tmp/opencode/probe-s3-03-runtime/qa-run.log`, hasil `/tmp/opencode/probe-s3-03-runtime/qa/qa-results.json` + 40+ screenshot
- Skrip QA (untracked di worktree temp): `apps/web/qa-probe.mjs`, `qa-contract.mjs`, `qa-explorer.mjs`, `qa-dark-scope.mjs`, `qa-diag*.mjs`
- Server review masih berjalan: API `8080/8081/8082`, preview `4173/4174/4175` (dapat dimatikan bila tidak diperlukan lagi)
