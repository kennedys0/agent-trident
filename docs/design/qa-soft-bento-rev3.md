# QA Revision 3 — Baseline & Kriteria PASS/FAIL

- **Status:** BASELINE (tahap 1). Implementasi Rev 3 belum ada di branch — kriteria yang butuh perubahan UI berstatus **belum**, nilai "baseline" adalah pengukuran di head `2769c11` (= main, = Rev 2 ter-merge).
- **Head diukur:** `2769c11` (branch `design/soft-bento-rev3`, nol commit sendiri saat baseline diambil).
- **Harness:** `apps/web/e2e/rev3-baseline.mjs` (bisa dijalankan ulang, tanpa intercept API).
- **Artefak:** `docs/design/evidence/rev3/` — `rev3-baseline-results.json` + 18 PNG (viewport, full-page, zoom).
- **Laporan QA sebelumnya:** `docs/design/qa-soft-bento-rev2.md`.

## Lingkungan (dibangun sendiri, port sendiri)

| Komponen | Nilai |
|---|---|
| API lokal | `node apps/api/dist/server.js` (build produksi), `PORT=4673`, `EXECUTION_MODE=PAPER`, `RPC_URL=https://rpc.mainnet.chain.robinhood.com`, `EXPECTED_CHAIN_ID=4663`, `DISCOVERY_ENABLED=0`, DB di `/tmp/opencode/probe-rev3/data/trident.sqlite` |
| API health | `mode=PAPER, chainId=4663, rpcStatus=HEALTHY, headBlock=113475089, killSwitchEngaged=false` (live RPC, bukan fixture) |
| Web | `vite build` lalu `vite preview --port 4773` dengan `TRIDENT_API_URL=http://127.0.0.1:4673` |
| Port | API **4673**, preview **4773** (4373/4473/4573/4611 tidak disentuh) |
| Perintah ulang | `pnpm --filter @trident/web build && pnpm --filter @trident/api build` → start API (env di atas) → `TRIDENT_API_URL=http://127.0.0.1:4673 npx vite preview --port 4773` → `node apps/web/e2e/rev3-baseline.mjs http://127.0.0.1:4773` |

## §7 — Verdict: **ARTIFACT** (bukan bug nyata)

**Keluhan CEO:** full-page screenshot gelap menunjukkan sticky nav "displaced" dan "large empty regions".

### (a)+(b) Screenshot viewport normal + `getBoundingClientRect` per scroll offset

5 offset scroll (0/25/50/75/100% max), 3 konteks desktop-light, desktop-dark, mobile 375, plus zoom. Semua **60/60 pemeriksaan lulus, 0 gagal**:

| Kondisi | topbar `top` | sidebar `top`/`height` | bottom-nav `bottom` | link sidebar |
|---|---|---|---|---|
| Desktop 1440×900 light, scroll 0→810 | 0 di semua offset | 0 / 900 (=innerH) | n/a (display:none ≥768) | 12/12 di semua offset |
| Desktop 1440×900 dark, scroll 0→810 | 0 di semua offset | 0 / 900 | n/a | 12/12 |
| Mobile 375×667, scroll 0→2479 | 0 di semua offset | n/a (display:none) | 667 = innerH di **semua** offset (fixed, terkat) | n/a |
| Zoom 80% (viewport CSS 1800×1125) | 0 | 0 / 1125 | n/a | 12/12 |
| Zoom 125% (viewport CSS 1152×720) | 0 | 0 / 720 (−0,4 px di scroll maks, dalam toleransi ±1) | n/a | 12/12 |

Catatan metode: zoom Chrome menyusutkan viewport CSS, jadi zoom80/100/125% diemulasi `setViewportSize(1440/z × 900/z)` — identik untuk layout & media query; geometri dibaca dalam CSS px (DPR 1).
Ruang kosong hidup di scroll maks: desktop 47,9 px, mobile 95,6 px (nav tetap 60,2 px) → konten terakhir tetap tercapai, tidak ada wilayah kosong besar saat scrolling.

### (d) Full-page vs viewport — di sinilah "displaced"-nya terbentuk

Scan piksel (canvas, tanpa pustaka gambar) pada screenshot `fullPage`:

| Bukti | Angka |
|---|---|
| Desktop full-page (light & dark), 1440×**1710** | hairline bawah topbar (warna efektif rgb(227,227,227) / rgb(54,53,56)) hanya ada di **y=64** — topbar tercatat sekali di puncak dokumen; baris 65–1710 tanpa overlay topbar |
| Kolom sidebar di full-page (kedua tema) | run seragam **y=869–1709 = 841 px (49% tinggi gambar)** kosong di bawah kotak sticky (kotak tinggi 900 px = viewport) |
| Kolom utama full-page | **tidak ada** run kosong ≥120 px → "large empty regions" hanya ada di kolom sidebar gambar |
| Mobile full-page, 375×**3146** | hairline atas bottom-nav hanya di **y=607** (= dasar viewport pertama 667−60,2) — nav tercatat **tengah gambar**, tidak ada di dasar dokumen (y≈3086) |
| Live (viewport) | topbar selalu `top=0`, nav mobile selalu `bottom=667` di **semua** offset scroll → di penggunaan nyata tidak pernah displaced |

Interpretasi: capture `fullPage` (capture-beyond-viewport) menggambar elemen sticky/fixed hanya sekali pada posisi tangkap — sisanya jadi kolom kosong. Saat scroll sungguhan, band selalu terkat di tempatnya. Gejala yang dikeluhkan **hanya muncul di gambar**, bukan di UI.

### Reproduksi di evidence Rev 2 yang sudah ter-commit (kemungkinan sumber keluhan CEO)

Scan run kosong kolom sidebar pada gambar full-page yang ada:

| Gambar | Dimensi | Run kosong sidebar |
|---|---|---|
| `evidence/soft-bento-rev2/overview-dark-1024.png` | 1024×1958 | y=872–1957 (**1086 px**) |
| `evidence/soft-bento-rev2/overview-dark-768.png` | 768×2279 | y=872–2278 (**1407 px**) |
| `evidence/rev2/rev2-overview-1024-dark.png` | 1024×2193 | y=740–2192 (**1453 px**) |
| `evidence/rev2/rev2-overview-768-dark.png` | 768×2685 | y=996–2684 (**1689 px**) |
| `evidence/qa/after-overview-1024-dark.png` | 1024×2454 | y=740–2453 (**1714 px**) |

Semua pola sama: sidebar tergambar ±1 viewport pertama lalu kosong sampai dasar gambar. Gejala "displaced + empty region" **terreproduksi di gambar yang sudah ada**, dan **tidak** terreproduksi di viewport hidup (60/60).

### Diff piksel band vs kontrol (data pendukung)

Perbandingan baris gambar full-page vs screenshot viewport pada posisi dokumen yang sama (toleransi 12/ch): band topbar dark **41,8%** berbeda vs baris kontrol statis **21,8%** (beda 2× — selisih struktural); angka ini sekunder karena teks live (head block, umur snapshot) berubah antar-shot, jadi bukti utama tetap lokasi hairline + rect hidup di atas.

### Kesimpulan §7

**ARTIFACT** — sticky/fixed nav bekerja benar di semua viewport, theme, scroll offset, dan zoom yang diuui; "displacement" dan "large empty regions" adalah artefak capture full-page. **Rekomendasi (sesuai brief §7): jangan mengubah layout sticky yang berfungsi hanya untuk mengkompensasi tooling screenshot.** Evidence Rev 3 harus pakai screenshot viewport per-scroll (sudah disediakan harness), bukan `fullPage` tunggal, untuk halaman ber-sidebar/band sticky.

## Baseline §1 — modul Bento (angka sebelum perbaikan)

| Modul (testid) | Tinggi (px) | `min-height` CSS | Gap judul→nilai utama | Slack internal |
|---|---|---|---|---|
| `overview-strip` | 158,6 | `auto` | 2,0 | 17 |
| `overview-portfolio` | **839,5** | `auto` | **198,9** | 25 |
| `overview-market` | **839,5** (sama persis = stretch baris grid) | `auto` | 37,2 | 25 |
| `overview-risk` | 446,2 | `auto` | n/a | 25 |
| `overview-discovery` | 446,2 | `auto` | 37,2 | 25 |
| `overview-activity` | 446,2 | `auto` | n/a | **240,4** |

- Anak portfolio terdistribusi dengan gap **177,7 px** antar kelompok (judul→figure, figure-row→meta, meta→foot), figure→figures-row hanya 15,9 px. Penyebab terukur: `.bento-tile--portfolio > .bento-figure { margin-top: auto }` + `.bento-tile--portfolio > .bento-figures-row { margin-bottom: auto }` (`base.css:661-667`) membagi ruang bebas secara merata — inilah "excessive unused vertical space" §1.
- `grep min-height` seluruh stylesheet: hanya pada wadah layout & target sentuh (`html`, `.shell` 100vh, `--tap`, tombol 36px, kontrol Discover 44px) — **belum ada min-height arbitrer di tile**; penyebab tinggi berlebih adalah auto-margin + stretch baris grid, bukan min-height.

## Baseline §3 / §5 (pembanding kriteria)

- Tipografi Overview: hero **40px/700** `tabular-nums`; nilai figure 22px/700 `tabular-nums`; label 12px; judul tile 13px/600; meta 13px; **heading halaman terukur 13px/600 = sama besar dengan meta** (hierarki lemah). Elemen `.mono`: 20; leaf teks uppercase: 5 dari 72.
- Discover 1440×900: search `top=223` (h44), tabel `top=707` → header + baris pertama **terlihat di layar pertama**; baris tabel = **1** (API hanya mengembalikan 1 pool — dilarang mengarang).
- Discover 375×667: search `top=352`, tabel `top=1080` → tabel **DI BAWAH fold** (413 px di luar layar pertama) — target perbaikan §5.

## Kriteria PASS/FAIL §1–§8 (untuk verifikasi setelah Forge push)

Status: **Baseline** = sudah diukur di `2769c11`; **Belum** = butuh implementasi Rev 3. Semua pengukuran memakai harness/method yang sama agar bisa dibandingkan.

### §1 — Modul Bento tidak oversized

| ID | Kriteria | Metode | PASS | FAIL | Status |
|---|---|---|---|---|---|
| 1.1 | Tidak ada `min-height`/`height`/`aspect-ratio` arbitrer tersisa di tile/modul | `grep -n "min-height\|aspect-ratio" apps/web/src/styles/*.css` + bandingkan daftar baseline (di atas) | Nol entri baru pada `.bento*`/modul Overview | Ada aturan tinggi tetap tanpa alasan konten | Baseline: nol entri di tile |
| 1.2 | Tinggi tile mengikuti konten | `getBoundingClientRect` per tile + slack internal | Slack internal ≤ padding+foot (≤~40 px); gap judul→nilai turun ≥70% dari baseline (target ≤~60 px dari 198,9) | Gap tetap ≥100 px atau slack ≥100 px | Baseline: portfolio gap 198,9; activity slack 240,4 |
| 1.3 | Baris tidak memaksa tinggi sama tanpa alasan | Bandingkan tinggi tile se-baris + slack masing-masing | Tinggi sama hanya bila konten benar-benar sama tinggi (selisih slack ≤50 px) | Selisih slack ≥100 px dalam satu baris | Baseline: portfolio=market 839,5 (slack 25 vs 25, tetapi gap 198,9 vs 37,2); risk=discovery=activity 446,2 (activity slack 240,4) |
| 1.4 | Tidak ada chart/metrik karangan | Baca diff `OverviewPage.tsx` + hitung node `.bento-figure`/`svg` vs baseline | Nol metrik/chart baru yang tidak didukung API | Ada elemen data baru tanpa sumber API | Baseline: 0 (belum diubah) |
| 1.5 | Proporsi asimetri disengaja tetap ada | Bandingkan span grid vs spec komposisi Pixel | Span mengikuti spec (equity ~5 / signal ~4 / risk ~3 dst.) | Semua tile jadi simetris/seragam | Belum (spec Pixel menyusul) |

### §2 — Branding TRIDENT

| ID | Kriteria | Metode | PASS | FAIL | Status |
|---|---|---|---|---|---|
| 2.1 | Wordmark "TRIDENT" + emblem trident ada di sidebar; PAPER hanya indikator mode | DOM: teks brand + `.brand__sub`/badge | Wordmark TRIDENT tampil; PAPER berada di pill/mode indicator, bukan sebagai nama aplikasi | Nama app tertulis "PAPER" atau wordmark hilang | Baseline: emblem+`brand__sub` "PAPER" ada; wordmark TRIDENT **belum** (belum ada perubahan Rev 3) |
| 2.2 | Kontras emblem/wordmark ≥4,5:1 di sidebar light DAN dark | Ambil piksel latar sidebar + warna fg dari screenshot, hitung rasio (metode P-1 rev2) | ≥4,5:1 kedua tema | <4,5:1 di salah satu tema | Belum (ukur saat verifikasi) |
| 2.3 | Aksen hijau dipertahankan; tanpa meniru logo Robinhood | Review visual + diff `BrandMark.tsx` | Logo asli tetap, tanpa salinan aset Robinhood | Aset/logo Robinhood ditiru | Baseline: emblem asli, belum diubah |

### §3 — Hierarki tipografi

| ID | Kriteria | Metode | PASS | FAIL | Status |
|---|---|---|---|---|---|
| 3.1 | Mono hanya untuk identifier (hash/address/block/log/timestamp) | Inventaris semua elemen `.mono` di Overview+Discover + cek teksnya | Setiap `.mono` berisi identifier/teknis | `.mono` pada label/kalimat biasa | Baseline: 20 elemen `.mono` — daftar lengkap diukur saat verifikasi |
| 3.2 | Angka finansial tabular & sejajar | `getComputedStyle().fontVariantNumeric` pada semua `.bento-figure__value` | `tabular-nums` di semua nilai finansial | Ada nilai finansial non-tabular | Baseline: hero & figure value sudah `tabular-nums` |
| 3.3 | Nilai penting lebih besar; heading > label > meta | `font-size` heading halaman vs label vs meta | Heading halaman jelas > label (selisih ≥4 px) dan hierarki konsisten | Heading = meta (baseline 13px = 13px) | Baseline: **heading 13px = meta 13px** → target perbaikan |
| 3.4 | Uppercase berkurang | Hitung leaf teks `text-transform: uppercase` | Turun dari baseline 5/72 tanpa kehilangan status penting | Naik atau dipakai untuk copy biasa | Baseline: 5/72 |
| 3.5 | Density tidak diselesaikan dengan mengecilkan semua | Bandingkan `font-size` hero/figure/label/meta vs baseline | Tidak ada ukuran turun >10% dari baseline | Label/meta/nilai menyusut >10% | Baseline: hero 40, value 22, label 12, meta 13 |

### §4 — Semantik trading

| ID | Kriteria | Metode | PASS | FAIL | Status |
|---|---|---|---|---|---|
| 4.1 | Signal BUY ≠ posisi terbuka: 5 state dibedakan jelas (strategy signal / risk verdict / approved intent / PAPER order-fill / portfolio position) | Baca label di Overview/Discover/Portfolio + cocokkan field API contract | Label memisahkan keduanya; tidak ada teks yang menyiratkan fill/posisi dari signal | Ada label/visual yang menyiratkan posisi terbuka dari BUY | Baseline: terpisah (equity tile "Simulated equity", signal di tile market) — verifikasi ulang setelah ubahan teks |
| 4.2 | Hanya state yang didukung API yang tampil | Bandingkan state UI vs `packages/api-contract` + respons live | Nol state tanpa sumber API | Ada state karangan | Baseline: PAPER×7, Unavailable×3, confidence LOW (rev2) — ulangi |
| 4.3 | PAPER + emergency HALT tetap terlihat | DOM topbar badge PAPER + `StopControl` | Keduanya terlihat di semua viewport utama | Hilang/tersembunyi | Baseline: ada |

### §5 — Discover density

| ID | Kriteria | Metode | PASS | FAIL | Status |
|---|---|---|---|---|---|
| 5.1 | Tabel hasil terlihat di layar pertama (1440 & 375) | `getBoundingClientRect(table).top < innerHeight` saat paint | top tabel < 900 (1440) dan < 667 (375) | tabel di bawah fold | Baseline: 1440 = 707 ✓; **375 = 1080 ✗** |
| 5.2 | Search prominent, filter compact | Ukur tinggi search & baris filter | Search ≥ tinggi standar input (44 px) dan di posisi atas; filter ≤ tinggi baseline | Panel filter lebih tinggi dari baseline | Baseline: search 44 px, top 223 (1440) |
| 5.3 | Label scope eksplisit "server search" vs "on-page filter" | Cek teks label di toolbar | Keduanya ada dan benar | Tidak ada / keliru | Belum |
| 5.4 | Akses Inspector & Watchlist jelas; state seleksi filter terakses | DOM link + `aria-pressed`/`aria-selected` + axe | Link terlihat; state filter terbaca aria | State hanya lewat warna / link tersembunyi | Baseline: link ada (rev2) — ulangi |
| 5.5 | Tanpa pool karangan; Unavailable apa adanya | `rows == jumlah pool API` + teks Unavailable | Jumlah baris = respons API (baseline 1 pool) | Baris > data API | Baseline: 1 baris ✓ |

### §6 — Dark mode berlapis

| ID | Kriteria | Metode | PASS | FAIL | Status |
|---|---|---|---|---|---|
| 6.1 | Layer permukaan terpisah (canvas/surface/raised) | `getComputedStyle` bg canvas/tile/panel di dark | ≥3 nilai berbeda dengan pemisahan tonal terukur | Datar (1–2 warna sama) | Baseline: canvas rgb(19,18,20), surface/topbar rgb(32,31,34) — layer awal ada; raised diukur saat verifikasi |
| 6.2 | Aksen hijau selektif | Inventaris pemakaian lime/green per halaman | Hanya fill brand/CTA/nav-aktif/filter/focus + kartu equity (deviasi yang disetujui CEO) | Menyebar ke banyak elemen dekoratif | Baseline: token rev2 (lime terbatas) |
| 6.3 | Tanpa glow/gradien berlebih/border tebal | `grep box-shadow\|gradient\|border.*[2-9]px` pada komponen | Nol dekorasi berat | Ada glow/blur besar/border ≥2 px dekoratif | Baseline: hairline 1 px |
| 6.4 | Kontras AA, tabel terbaca, warna status terbedakan | Sweep kontras (metode P-1) + axe | Semua pasangan fg/bg ≥4,5:1; axe 0 pelanggaran | Ada pasangan <4,5:1 | Baseline rev2: terendah 5,35 / axe 0 — ulangi setelah ubahan |

### §7 — Sticky nav & rendering screenshot (sudah dibuktikan di atas)

| ID | Kriteria | Metode | PASS | FAIL | Status |
|---|---|---|---|---|---|
| 7.1 | Live: band nav terkat di semua offset/zoom | `node apps/web/e2e/rev3-baseline.mjs` → checks | 60/60 lulus (atau ekuivalen setelah layout berubah) | Ada check gagal = bug nyata | **Baseline: 60/60 → ARTIFACT** |
| 7.2 | Tidak ada "perbaikan layout" yang mengompensasi artefak screenshot | Diff CSS sticky (`position/top/z-index`) vs `2769c11` | Aturan sticky/fixed tak berubah kecuali ada alasan layout nyata | Aturan diubah hanya agar full-page screenshot rapi | Baseline: `.sidebar` sticky top:0/100vh, `.topbar` sticky, `.bottom-nav` fixed — belum diubah |
| 7.3 | Evidence §7 memakai viewport screenshot, bukan fullPage tunggal | Daftar artefak | Ada vp-s0/s50/s100 per tema/viewport | Hanya mengandalkan fullPage | Baseline: harness menyediakan |

### §8 — Micro-interaction

| ID | Kriteria | Metode | PASS | FAIL | Status |
|---|---|---|---|---|---|
| 8.1 | Rekaman interaksi nyata (webm) mencakup 8 poin brief | File + putar/cek durasi | Ada webm: transisi nav sidebar, press button, hover kartu, search/filter, seleksi tabel+inspector, transisi tema, pending/success/error API, reduced-motion | Tanpa rekaman / hanya screenshot | Belum (buat setelah implementasi) |
| 8.2 | Motion sesuai rentang, tanpa bounce/overshoot | Baca `transition`/`@keyframes` + ukur durasi aktual (metode rev2) | Durasi dalam token (120/160/240 ms ±10%), easing `cubic-bezier(0.2,0,0,1)`, lift ≤2 px, tanpa keyframes overshoot | Ada spring/bounce atau durasi di luar rentang | Baseline rev2: 100/170/220 ms, easing benar — ulangi |
| 8.3 | `prefers-reduced-motion` dihormati | Context `reducedMotion: 'reduce'` → ukur transisi/transform | Transisi non-esensial jadi 0/none; konten tetap terlihat | Animasi tetap jalan | Baseline rev2: 0 px — ulangi |
| 8.4 | Nol animasi pada kartu non-interaktif | Hover via mouse pada tile tanpa `--interactive`/link → `getComputedStyle` transition/transform + kursor | Tile statis: `transition: none`/tanpa transform; kursor default | Tile statis bergerak/`cursor: pointer` saat hover | Baseline: perlu diukur ulang pasca implementasi (kriteria baru Rev 3) |
| 8.5 | State sukses hanya setelah konfirmasi backend | Blokir/route-delay endpoint operasi (mis. watchlist/stop) di browser → amati state | Success hanya muncul setelah respons API sukses; error menampilkan error | Success muncul optimis sebelum respons | Belum (uji saat verifikasi) |
| 8.6 | Pending/success/error feedback pada operasi API | Sama seperti 8.5, tiga state | Ketiganya terlihat & benar | Ada yang hilang | Belum |

### §9 — Evidence (checklist penerimaan)

| Item | Status |
|---|---|
| Screenshot Overview light/dark (Rev 3) | Belum (menunggu implementasi) |
| Screenshot Discover light/dark | Belum |
| Screenshot viewport normal | **Baseline tersedia** (rev3-*) |
| Screenshot responsif | Baseline 1440/375 + zoom 80/125% tersedia |
| Rekaman interaksi | Belum |
| QA independen | Laporan ini (baseline); verifikasi akhir menyusul setelah Forge push |
| Backend & safety invariants tak berubah | Dilaporkan Sentinel; QA ulangi: `git diff --name-only 2769c11..HEAD` untuk file terlarang |

## Batasan (jujur)

- Screenshot asli dari CEO tidak tersedia di repo saya; yang saya lakukan adalah mereproduksi gejalanya dengan capture sendiri + memindai evidence Rev 2 yang sudah ter-commit (tabel di atas).
- Emulasi zoom = penyusutan viewport CSS (metode dijelaskan di §7); DPR dijaga 1, jadi zoom 125% tidak menguji crispness raster, hanya geometri layout.
- Diff piksel full-vs-viewport terpengaruh teks live yang berubah antar-shot (karena itu ada baris kontrol); angka diff sekunder, bukti utama = lokasi hairline + rect hidup.
- Temuan §1 (gap 177,7 px dari auto-margin) adalah fakta terukur; prioritas perbaikan tetap keputusan Pixel/Forge.
- Proses lokal masih berjalan saat laporan ditulis: API :4673, preview :4773 (matikan dengan membunuh proses `node dist/server.js` / `vite preview` di `/tmp/opencode/probe-rev3` bila tidak diperlukan).
