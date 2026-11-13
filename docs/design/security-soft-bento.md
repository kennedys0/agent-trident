# Security Review — TRIDENT Soft Bento Design Exploration

Status: review keamanan operasional untuk eksplorasi desain (issue #39). Reviewer: Sentinel.
Basis review: commit `9a03385` (spec token + motion Pixel) dan kode web saat ini di branch
(`main` basis `e5c2629b`, tanpa prototipe Forge). **Prototipe Forge belum ada di branch saat
review ini ditulis — semua temuan level implementasi ditandai UNVERIFIED dan harus di-recheck
begitu commit prototipe muncul.** Read-only terhadap kode; tanpa merge, tanpa force-push.

**Update recheck (prototipe ter-push):** lihat §4. Prototipe final di-push Pixel di atas review
ini: `e476bca` (CSS+spec) → `02ccf84` (komponen) → `e42c2b8` (tes) → `28ac069` (evidence).
Semua butir S-1..S-7 kini DIVERIFIKASI di kode pada HEAD `28ac069`.

## 1. Klaim kontras spec — DIVERIFIKASI INDEPENDEN (bukan mengulang angka Pixel)

Semua dihitung ulang dengan formula WCAG relatif luminans (blending alpha dihitung eksplisit
terhadap canvas dark `#1A191B`):

| Pasangan | Spec | Hasil hitung ulang | Verdict |
| --- | --- | --- | --- |
| ink `#171717` di lime `#D2FF00` | 15,40 | 15,40 | ✓ |
| putih di halted `#B91C1C` | 6,47 | 6,47 | ✓ |
| warning fg `#9A3412` di `#FFEDD5` | 6,38 | 6,38 | ✓ |
| positive fg `#065F46` di `#ECFDF5` | 7,29 | 7,29 | ✓ |
| muted `#52525B` di canvas `#E9E9E9` / surface | 6,37 / 7,73 | 6,37 / 7,73 | ✓ |
| dark positive `#34D399` di tint emerald 0,15 | 7,23 | 7,23 | ✓ |
| dark negative `#F87171` di tint red 0,15 | 5,43 | 5,43 | ✓ |
| dark warning `#FBBF24` di tint amber 0,15 | 7,99 | 7,99 | ✓ |
| dark pending `#93C5FD` di tint blue 0,15 | 8,08 | 8,08 | ✓ |
| dark unavailable `#9CA3AF` di tint gray 0,12 | 5,64 | 5,64 | ✓ |
| dark stale `#FBBF24` di tint amber 0,12 | (tidak disebut) | 8,15 | ✓ |
| **dark critical `#F87171` di tint red 0,22** | "negative diperkuat" (tanpa angka) | **4,94** | ✓ AA tipis — lihat L-2 |
| focus `#2563EB` vs canvas light | "AA" | 4,26 (non-text 1.4.11 butuh ≥3:1) | ✓ |
| dark focus `#60A5FA` vs canvas dark | — | 6,89 | ✓ |
| sidebar ink `#FAFAFA` di `#222123` | 15,36 | 15,36 | ✓ |
| dark muted `#A1A1AA` di `#222123` | 6,26 | 6,26 | ✓ |

## 2. Temuan

| ID | Severity | Lokasi | Temuan | Perbaikan minimum |
| --- | --- | --- | --- | --- |
| S-1 | **Medium** | `docs/design/soft-bento-tokens.md:189` (§4) | **PAPER berisiko tenggelam.** Spec memetakan "PAPER mode, testnet info" ke `brand-secondary` (lavender) "atau `info`". Lavender didefinisikan sebagai "aksen dekoratif ringan" (§1 poin 5) — kalau Forge mengikuti baris ini literal, badge PAPER bisa jadi tag dekoratif lembut yang hilang di antara kartu Bento (melanggar kriteria #1). Spec peta Overview memang menempatkan PAPER di `status-strip` span 12 (§6 baris 209), tapi dua instruksi ini ambigu satu sama lain. | Perbaiki spec: PAPER = token sendiri yang selalu tampil di status-strip HUD **dan** header tiap halaman, bukan lavender dekoratif. UNVERIFIED di kode prototipe. |
| S-2 | **Medium** | `docs/design/soft-bento-motion.md:89-111` (§3.4) | **Aturan non-optimistic hilang dari spec motion.** Toggle thumb berpindah seketika saat `aria-checked` berubah; spec tidak menyatakan bahwa `aria-checked` hanya boleh berubah SETELAH backend mengonfirmasi (kriteria #6). Kontras dengan `apps/web/src/components/StopControl.tsx:24-31` yang sudah benar (sukses hanya setelah re-read `/health`) — Forge bisa konsisten atau tidak tanpa petunjuk spec. | Tambahkan ke spec: toggle/watchlist/filter wajib non-optimistic; state visual berubah hanya setelah respons server. UNVERIFIED di kode. |
| S-3 | **Low** | `docs/design/soft-bento-motion.md:129-134` (§3.6) | `page-in` 240ms animasi mount halaman. Tidak menunda navigasi itu sendiri (dijalankan setelah mount), tapi: (a) konten harus tetap interaktif/terbaca selama animasi, (b) tidak boleh dijalankan ulang saat data refresh — §3.6 paragraf terakhir sudah melarang re-animasi panel, pertahankan di implementasi. | Verifikasi di kode: animasi hanya pada mount route, `pointer-events` normal, tanpa delay navigasi. UNVERIFIED. |
| S-4 | **Low** | `docs/design/soft-bento-tokens.md:70-78,187-189` (§3/§4) | **Tidak ada token eksplisit untuk `disabled` dan `offline`** (kriteria #3 menyebut keduanya). §4 memetakan "RPC offline → critical" tapi `offline` browser saat ini badge `danger` (`apps/web/src/components/Shell.tsx:125`) — kalau Forge mengikuti §4 saja, offline bisa turun jadi `status-unavailable` abu-abu. Kontrol disabled juga hanya dapat aturan motion (`:disabled` tidak bergerak), bukan aturan warna/label. | Tambah di §4: `offline` (browser/RPC) = `status-critical`/`negative`, bukan gray; disabled = muted + label tetap terbaca + `aria-disabled`. UNVERIFIED. |
| S-5 | **Low** | `docs/design/soft-bento-tokens.md:176` | Dark `critical` 4,94:1 (hitungan saya) lulus AA normal-text tapi tanpa margin; spec tidak mencantumkan angkanya sehingga implementator tidak bisa mendeteksi regresi alpha. | Cantumkan 4,94 di spec, atau naikkan alpha ke 0,25+/pergelap fg; recheck saat implementasi. |
| S-6 | **Info** | `docs/design/soft-bento-tokens.md:216` (peta Discover) | Discovery tile "jumlah pool" bergantung data yang keberadaannya belum dikonfirmasi (advisory Nexus di issue #39). Spec sudah jujur ("tanpa angka karangan", §8) tapi angka konkret UNVERIFIED sampai kode prototipe + API nyata diperiksa. | Bila data tak tersedia: tile wajib menampilkan state `unavailable` + reason, bukan 0. |
| S-7 | **Info** | `docs/design/soft-bento-tokens.md:226` (§ navigasi) | Kriteria #7 (kebocoran data / eskalasi akses): spec tidak menambah endpoint atau permukaan data baru, dan halaman palsu dilarang eksplisit ("tanpa halaman palsu"). Tidak ada temuan; butuh verifikasi kode: placeholder More-menu hanya menampung route yang benar-benar ada dan tidak mempratinjau data yang halamannya tidak ada. UNVERIFIED. |

### Yang SUDAH benar di spec (berdasarkan kriteria)

1. **Brand ≠ semantic (kriteria #5)**: `soft-bento-tokens.md:31-39` menyatakan lime bukan makna healthy/BUY/approved; status positif = emerald semantic (`:71`); lime dilarang sebagai teks di light mode (`:25`); focus = biru `#2563EB`, bukan lime (`:81`). Mapping status `:178-189` memisahkan halted/pending/stale/unavailable dengan fg/bg/border yang terkunci.
2. **HALT tak diperlemah (kriteria #2)**: kill switch = satu-satunya status *filled solid* `#B91C1C` + putih 6,47:1 (`:75,187`), dan risk tile ada di peta Overview dengan link ke /risk (`:211`). Kontras terverifikasi.
3. **Anti false confidence (kriteria #4)**: §8 melarang chart tanpa skala, KPI tanpa denominator, badge tanpa data (`:235-242`); motion melarang loading palsu dan animasi pasar palsu (`soft-bento-motion.md:159`).
4. **Reduced motion (kriteria #6)**: warna status tetap berubah instan saat motion dimatikan — "perubahan status tidak pernah hilang bersama motionnya" (`soft-bento-motion.md:148`); semua `transition: all` dilarang (`:160`).
5. **Hover tak menyembunyikan info** (`soft-bento-motion.md:123,158`) — provenance/reason tidak boleh reveal-on-hover.

### Tabel verifikasi "belum terverifikasi"

Semua butir di atas adalah temuan level SPEC. Belum bisa diverifikasi sampai Forge push prototipe:
- PAPER benar-benar menonjol di render (S-1), HALT/risk tak tenggelam di kartu Bento,
- akurasi status disabled/pending/rejected/stale/unavailable/halted/offline per state di kode,
- tidak ada indikator hijau tanpa angka/chart dekoratif di Overview,
- non-optimistic toggle/watchlist/filter di implementasi,
- route baru/placeholder tidak membocorkan data.

## 3. Rekomendasi urutan

1. Pixel perbaiki S-1 dan S-2 di spec SEBELUM Forge implementasi (dua kalimat di spec mencegah dua kelas bug).
2. Forge implementasi dengan S-1/S-2/S-4/S-5 sebagai constraint.
3. Sentinel re-review commit prototipe: verifikasi butir-butir UNVERIFIED di atas + cek `git grep -iE "lime|d2ff00"` di komponen status untuk memastikan tidak ada penggunaan brand token pada jalur status.

## 4. Recheck implementasi prototipe — DIVERIFIKASI (HEAD `28ac069`, oleh Sentinel)

Semua butir yang tadinya UNVERIFIED kini dicek langsung di kode branch. Forge terhenti di tahap
akhir; prototipe di-commit/push Pixel dengan amandemen spec S-1/S-2/S-4/S-5. Verifikasi ini
dilakukan sendiri (bukan mewarisi klaim Pixel/Forge) pada HEAD `28ac069`.

### 4.1 Verdict per butir

| Butir | Verdict | Bukti file:baris |
| --- | --- | --- |
| **S-1 PAPER token eksplisit (Medium → CLOSED)** | ✓ RESOLVED | Spec `soft-bento-tokens.md:196`: PAPER = lavender + ink gelap + `border-strong`, wajib di brand sidebar + topbar + HUD, bukan gray/dekoratif. Kode: `.badge--testnet` = `brand-secondary` + `border-strong` (`base.css:745-750`); dipakai di tiga tempat wajib: `Shell.tsx:64` (brand sidebar), `Shell.tsx:110-113` (topbar), `OverviewPage.tsx:80` (HUD status-strip). |
| **S-2 Non-optimistic toggle (Medium → CLOSED)** | ✓ RESOLVED | Spec `soft-bento-motion.md:114`: state visual hanya setelah konfirmasi backend, tema lokal dikecualikan. Kode: `useWatchlist.ts:41-43` — "There is no optimistic update and no local storage"; `useWatchlist.ts:72-89` — override `watching` hanya diset dari `envelope.data.result` respons server (`ADDED`/`EXISTING`), pending ditandai saat in-flight; `PoolTable.tsx:163` badge Watched hanya dari state server. `StopControl.tsx:24-31` tak diubah (referensi tetap benar). |
| **S-3 `page-in` mount-only (Low → CLOSED)** | ✓ RESOLVED | `base.css:139-152` — animasi pada `.page` dengan komentar eksplisit "route entry only, never when async data fills a panel"; `Shell.tsx:147` — `key={location.pathname}` memaksa remount hanya saat route berubah, jadi refresh data tidak menjalankan ulang animasi. Tanpa delay navigasi. |
| **S-4 Token disabled/offline (Low → CLOSED)** | ✓ RESOLVED | `tokens.css:44-46` (light: `--disabled-fg #52525B` = 7,0:1 di `--disabled-bg`) dan `:132-133` (dark) dengan komentar "offline is status-critical/negative, NOT these". Offline tetap danger: `Shell.tsx:39-43` `rpcTone(OFFLINE) = 'danger'`; offline browser = `StateView kind="offline"` ikon terpisah + `banner--danger` (`OverviewPage.tsx:71-73`). Disabled button = token disabled (`base.css:798-801`), bukan `opacity`. |
| **S-5 Dark critical 4,94:1 (Low → CLOSED)** | ✓ RESOLVED | Hitung ulang independen saya pada HEAD: `#F87171` di blend `#EF4444` 0,22 di atas `#1A191B` (hasil blend `#492224`) = **4,94:1** — cocok dengan yang kini dicantumkan di spec `soft-bento-tokens.md:181` beserta instruksi no-regression ("jangan turunkan alpha; teks yang butuh margin pakai `status-negative` atau alpha ≥0,25"). Pemakaian: hanya `banner--danger` (`base.css:1277-1283`) — teks meta normal-size, lulus AA, tidak dipakai di figure kecil yang butuh margin. |
| **S-6 Angka discovery (Info → CLOSED)** | ✓ RESOLVED | `OverviewPage.tsx:54-56`: `trackedPools`/`watchlistEntries`/`registryStatus` dibaca dari `discovery.meta` nyata; fallback `'Unavailable'` / "watchlist size unavailable" — tidak ada 0 palsu. Header `OverviewPage.tsx:62-63` menyatakan "Every value comes from the backend API; nothing is generated in the browser." |
| **S-7 Kebocoran/eskalasi (Info → CLOSED dengan catatan)** | ✓ TIDAK ADA TEMUAN BARU | Tidak ada route baru, tidak ada panggilan API baru di UI prototipe; halaman Watchlist/Strategy/Settings tidak dipalsukan (memang tidak ada). Satu catatan inheren (bukan dari branch ini): N-1 pesan RPC mentah di `app.ts:460,468` masih ada di basis `main` dan UI menampilkan `error.message` dari server — tertutup otomatis begitu perbaikan Nexus N-1 merge; bukan temuan branch desain. |

### 4.2 Cek baru — semua aman

| Cek | Verdict | Bukti |
| --- | --- | --- |
| PAPER menonjol di Bento | ✓ | HUD status-strip span 12 item pertama + topbar + sidebar (di atas). Bukan tag dekoratif. |
| HALT/STOP tak diperlemah | ✓ | `badge--halted` = satu-satunya status filled solid (`base.css:758-762`); `btn--danger` (Stop) = halted colors (`base.css:810-814`); `StopControl.tsx` affordance tak disentuh (Nova constraint dipegang); risk tile Bento dengan badge `HALTED` saat kill switch aktif (`OverviewPage.tsx:227-229`) + link ke `/risk`. |
| Lime ≠ status | ✓ | Pemakaian brand-accent audit: nav aktif (`base.css:278-280`), bottom-nav aktif = tint soft (`base.css:380-382`), `btn--primary` aksi utama (`:805-809`), filter chip terpilih (`discover.css:105-109`). Status positif = `status-positive` emerald (`badge--success`, `base.css:736-740`). Tidak ada lime pada jalur status/badge/toggle. |
| Status akurat | ✓ | RPC `HEALTHY/DEGRADED/OFFLINE` → success/wait/danger (`Shell.tsx:39-43`); snapshot `STALE/INCOMPLETE/UNAVAILABLE` tetap bawa nilai terakhir + block + age (`OverviewPage.tsx:100-122`); verdict REJECTED → danger, APPROVED → success (`OverviewPage.tsx:268-272`); pending toggle ditandai `isPending` (Inspector `PoolInspector.tsx:186,205`). |
| Motion non-optimistic, tak menunda route | ✓ | S-2/S-3 di atas; reduced-motion dinolkan (`tokens.css:153` blok). |
| False operational confidence | ✓ | Tidak ada `<svg>`/chart/sparkline di fitur (grep: nol); meta non-kontrak (`strategyId`, `configVersion`, `rpcLatencyMs`) ditampilkan dengan fallback "unavailable", tidak dikarang (`OverviewPage.tsx:41-44,324`). |

### 4.3 Sisa (tidak menghalangi, untuk catatan)

- **Info (inheren)**: N-1 pesan RPC mentah masih lewat ke UI melalui basis `main` — sedang diperbaiki Nexus di PR terpisah; bukan temuan branch desain, tidak butuh aksi di sini.
- **Info**: tabel Discovery tidak menampilkan indikator in-flight per-baris saat toggle watchlist (pending hanya terlihat di Inspector). Karena perubahan state bersifat non-optimistic (S-2), tidak ada risiko "terlihat sukses sebelum konfirmasi" — hanya ergonomi, bukan keamanan.
- **UNVERIFIED (di luar cakupan review ini)**: QA runtime (screenshot interaktif, keyboard, motion audit) = ranah Probe; prototype dijalankan dengan fixture yang didisclosure di `results.json` harness — layak diingat saat merge decision.

### 4.4 Kesimpulan

Tidak ada temuan keamanan operasional baru pada prototipe `28ac069`. Semua kriteria 1–7 pada
tugas terpenuhi di level implementasi; kedua temuan Medium (S-1, S-2) dan tiga Low (S-3/S-4/S-5)
telah ditutup di spec maupun kode. Keputusan merge tetap milik CEO (§9 spec tokens).

---

## 5. Revision 2 — review keselamatan operasional (branch `design/soft-bento-rev2`, oleh Sentinel)

Konteks: CEO meminta Revision 2 ("REVISION REQUIRED — DO NOT MERGE", brief §1 preserve / §8
butir 8). Basis: `main` `a8bef6e3` + 5 commit Pixel, HEAD `9fde781`. DRAFT PR #44, tanpa merge,
tanpa force-push. Verifikasi ini dilakukan sendiri pada HEAD `9fde781` (typecheck bersih; web
test **143/143** saya jalankan sendiri; `useWatchlist.ts` dan `StopControl.tsx` diff = kosong).

### 5.1 Butir 1 — Kontrol keselamatan tetap tak ambigu setelah rekomposisi

| Kontrol | Verdict | Bukti |
| --- | --- | --- |
| STOP NEW ENTRIES / kill switch | ✓ CLOSED | `StopControl.tsx` tak disentuh (diff kosong) dan tetap di topbar (`Shell.tsx:131`); badge kill switch di HUD strip (`OverviewPage.tsx:128-137`): `STOPPED` tone halted / `New entries allowed` tone success / `State unavailable` tone muted — tidak pernah diam saat null. Badge "Entries stopped" di topbar (`Shell.tsx:114`). |
| PAPER — SIMULATED | ✓ CLOSED | Sidebar brand `Shell.tsx:64`, topbar badge `Shell.tsx:104`, HUD strip `OverviewPage.tsx:82`, plus badge `SIMULATED` di modul portfolio dominan (`OverviewPage.tsx:157`). Modul portfolio charcoal tidak menyembunyikan PAPER — justru diberi badge berulang. |
| HALTED | ✓ CLOSED | `badge--halted` tetap satu-satunya status filled solid (`base.css`, `tokens.css:46,141`); di risk tile (`OverviewPage.tsx:323`). |
| Verdict risk + reasons | ✓ CLOSED | Risk tile tetap: verdict APPROVED→success / lainnya→danger, reasons[0] tampil, link `/risk` (`OverviewPage.tsx` modul risk, `data-testid="overview-risk"`). |
| STALE/UNAVAILABLE/PENDING/offline | ✓ CLOSED | Snapshot strip tetap bawa nilai terakhir + block + age; offline = `banner--danger` + `StateView kind="offline"`; meta null → "Unavailable" fallback (semua tak berubah dari rev1, diformat ulang saja). |
| Reorg "MANUAL REVIEW REQUIRED" | ✓ CLOSED | `IntentAction.tsx:183` tetap `Badge tone="danger"`, tak diubah. |
| Tenggelam di panel? | ✓ TIDAK | Modul portfolio hanya berisi nilai finansial + badge SIMULATED; risk/chain health tetap modul ringkas baris kedua; status-strip span 12 tetap paling atas. Panel besar TIDAK menampung kontrol keselamatan. |

### 5.2 Butir 2 — Lime bukan makna status; lavender bermakna; kontras charcoal/dark

- Audit pemakaian `--brand-accent` (grep penuh): nav aktif (`base.css:292`), bottom-nav aktif = tint (`:394`), hero equity (`:628`), `btn--primary` (`:913`), filter chip terpilih (`discover.css:105`). Semuanya aksen interaksi/identitas, bukan status. `badge--success` tetap emerald `status-positive`; PnL tetap `pnlTint` emerald/merah (`OverviewPage.tsx:467`); verdict REJECTED tetap danger. **Lime TIDAK dipakai untuk BUY/healthy/approved — CLOSED.**
- Hero equity lime = nilai finansial unggulan, bukan status; komentar kode eksplisit "Accent never encodes status" (`base.css:625-628`). Diterima sebagai aksen; catatan minor di §5.4.
- Lavender `#B9AEF4` hanya: badge PAPER (`badge--testnet`, `base.css:854`) — bermakna. Tidak ada pemakaian dekoratif lain. **CLOSED.**
- Kontras dihitung ulang independen (formula WCAG):
  - lime `#D2FF00` di charcoal `#222123` = **13,78:1** (klaim 13,8 ✓); di dark feature `#201F22` = **14,09:1**.
  - `--feature-ink #FAFAFA` di charcoal = 15,4:1; `--feature-muted #A1A1AA` di charcoal = 6,4:1 (klaim 6,3 ✓).
  - Dark ladder `#131214` canvas / `#201F22` surface / `#29272B` raised — pasangan fg semua ≥5,77:1 (muted di raised = 5,77, terendah, tetap >4,5). Tidak ada dua layer yang nyaris identik.
  - Sidebar dark `#0E0D0F` + ink 18,6:1; ink di lavender 8,9:1; ink di lime 15,4:1.
- Semua di atas ≥ AA. **CLOSED.**

### 5.3 Butir 3 — Non-optimistic & tanpa data karangan

- `useWatchlist.ts:41-43,72-89` dan `StopControl.tsx:24-31` **tidak berubah** antara rev1→rev2 (diff kosong); aturan non-optimistic tetap di spec `soft-bento-motion.md:116`. **CLOSED.**
- Tidak ada `<svg>`/chart/sparkline di fitur Overview (grep nol); angka dari `endpoints.*` + meta dengan fallback 'Unavailable'; halaman tak ada tetap tak dipalsukan. **CLOSED.**

### 5.4 Butir 4 — Aksesibilitas kontrol emergency (cek statis)

- Keyboard: `:focus-visible` global outline 2px `--focus` (`base.css:77-80`); skip-link (`:85-101`); StopControl tetap elemen `<button>` natural dengan `data-testid="stop-new-entries"`.
- Mobile 375: topbar `flex-wrap: wrap` (`base.css:327`) jadi StopControl turun ke baris baru, tidak terpotong; `shell__main` padding-bottom 96px (`base.css:128`) mencegah bottom-nav menutup kontrol (perbaikan baseline rev1 dipertahankan); F-1 `scroll-margin-bottom` tetap (`discover.css:302`).
- Target sentuh: `--tap: 48px` (`tokens.css:106`), bottom-nav link `min-height: var(--tap)` (`base.css:372-379`), tombol `.btn` min-height 44px dengan area klik ≥48px lewat padding.
- **Belum terverifikasi oleh saya (statis saja):** pengukuran runtime keyboard ke STOP di 375 dan perangkat sentuh fisik — itu ranah Probe (harness + device). Saya menyatakan ini eksplisit.

### 5.5 Sisa & kesimpulan

- **Info (kecil):** lime hero equity di modul portfolio bisa terbaca "hijau = nilai bagus" oleh pengguna; ini pilihan desain berlabel eksplisit "accent never encodes status", dan PnL tetap pakai token status. Tidak melanggar kriteria, tapi layak masuk daftar keputusan CEO bersama §9 (lime vs `#00C805`).
- **Info (inheren):** N-1 pesan RPC mentah di API masih terbuka di jalur yang sama dengan UI (PR Nexus terpisah).
- **Tidak ada temuan regresi keselamatan di Revision 2.** Semua butir preserve pada brief CEO §1 tetap terpenuhi: PAPER labeling, STOP control, state jujur, aksesibilitas, fail-closed. Merge tetap keputusan CEO.

### 5.6 Re-check pasca perbaikan QA (head `fa7ca3f`, oleh Sentinel)

Konteks: Probe menemukan R-1 (kontras 2,07:1), R-3 (heading-order), R-4 (first-paint 375/320),
R-2 (tap target <48px). Pixel memperbaiki semuanya di 1 commit di atas `465c6b9`. Re-check saya
pada HEAD `fa7ca3f`: typecheck bersih, web test **153/153** (10 tes kontrak baru) saya jalankan
sendiri; `StopControl.tsx` dan `useWatchlist.ts` diff tetap kosong.

**Verdict per pertanyaan:**

1. **Lime/charcoal/lavender kembali menyamar sebagai status? TIDAK — CLOSED.** Diff kontras
   (`base.css`) hanya menambahkan scope `.bento-tile--portfolio` untuk teks muted/tombol quiet,
   border `--feature-line`, tap target 48px, dan perbaikan layout mobile — tidak ada perubahan
   pemakaian `--brand-accent`/`--brand-secondary`. Audit grep tetap: lime hanya nav aktif,
   bottom-nav tint, hero equity, `btn--primary`, filter chip; lavender tetap hanya badge PAPER;
   status tetap emerald/danger/halted. Komentar "Accent never encodes status" tetap.
2. **Semua pasangan teks di panel charcoal ≥4,5:1? HAMPIR — 1 temuan baru (Serious).** Dihitung
   ulang: `--feature-muted #A1A1AA` di charcoal = **6,26:1** (light) / di dark feature `#29272B` =
   **5,77:1**; `--feature-ink` = 15,4:1 / 13,46:1; hero lime = 13,78:1 / 12,71:1 — semua lulus.
   R-1 lama (`.state__text`/`.btn--quiet` 2,07:1) tertutup oleh scope baru.
   **TEMUAN BARU (Serious): nilai PnL di panel charcoal LIGHT mode gagal** —
   `.bento-figure__value--positive` `#065F46` di `#222123` = **2,09:1** dan `--negative` `#991B1B`
   = **1,93:1** (`base.css:762-768`); dipakai di tile portfolio charcoal (`OverviewPage.tsx:194,203`
   realized/unrealised via `pnlTint`). Dark mode aman (fg token dark `#34D399` = 7,70:1,
   `#F87171` = 5,35:1). Akar sama dengan R-1: fg status dikalibrasi ke surface terang, dipakai
   di charcoal tanpa override. Tes kontrak baru tidak mencakup pasangan ini (blind spot audit).
   Perbaikan terkecil: override `.bento-tile--portfolio .bento-figure__value--positive` →
   `#065F46` ditingkatkan (mis. putih/`feature-ink` + tint chip, atau fg emerald gelap yang
   lulus di charcoal, mis. `#34D399`-analog di light = pilih fg ≥4,5:1 di `#222123`) — keputusan
   warna milik Pixel, masalahnya sudah terukur.
3. **Kontrol keselamatan tetap tak ambigu & terjangkau? CLOSED.** `StopControl.tsx`/`useWatchlist.ts`
   tak tersentuh; perubahan TSX hanya heading h3→h2 (`OverviewPage.tsx`, `PortfolioView.tsx`),
   `SubjectHeader.description` opsional, intro Discover pindah bawah toolbar (teks sama) — nol
   perubahan logika/status. PAPER/HALTED/verdict/state/reorg badge sama seperti §5.1. Mobile 375:
   topbar gap 16→8px (`base.css` media ≤767px) mempercepat clearance; STOP tetap `<button>`
   natural → keyboard reachable.
4. **Target sentuh ≥48px di kontrol emergency? CLOSED.** `.btn` min-height 44→`var(--tap)` 48px
   (`base.css`) — `stop-new-entries` dan Refresh ikut naik; tautan judul tile dapat hit-area 48px
   via padding + margin kompensasi; `--tap` tetap 48px.
5. **Non-optimistic & tanpa data karangan? CLOSED.** Logika toggle/watchlist tak berubah;
   heading/layout saja; nol chart; fallback 'Unavailable' tetap.

**Ringkasan: 1 regression-adjacent temuan baru (Serious, light-mode PnL di charcoal) — bukan
regresi dari perbaikan Pixel (sudah ada sejak rev2, lolos audit R-1), tapi satu-satunya pasangan
charcoal yang masih gagal AA. Butir lain semua CLOSED. Yang tetap tak terverifikasi: screen
reader nyata, perangkat sentuh fisik, persepsi layer dark 1,06–1,14:1 (catatan Probe).**

### 5.7 Re-check setelah perbaikan P-1 (head `10c03f6`, oleh Sentinel)

Cakupan: diff token `d8ac8ac..10c03f6`, hitung ulang kontras semua pasangan charcoal, cek logika
& label kontrol keselamatan, gate dijalankan sendiri. Sisa minor R-4 di 320px diterima non-blocking
(alasan Pixel valid: 8 chip tak muat di atas band nav pada tinggi 568px tanpa mengorbankan target
48px atau clearance F-1; chip tetap reachable via scroll).

1. **Status baru terpisah semantik dari lime & lavender? CLOSED.** Diff token hanya menambah
   `--feature-positive-fg`/`--feature-negative-fg` (light `#6EE7B7`/`#FCA5A5`, dark
   `#34D399`/`#F87171`) — nol perubahan token `--status-*`; emerald/danger/halted di luar panel
   charcoal tidak tersentuh (tes kontrak mengunci `--status-positive-fg` light tetap `#065F46`).
   Pemakaian hanya 2 titik: override scoped `.bento-tile--portfolio
   .bento-figure__value--{positive,negative}` (`base.css:624-629`) — tidak dipakai di luar panel
   portfolio, tidak menyamar sebagai status global. Bukan lime `#D2FF00` (hue berbeda; lime tetap
   hero accent), bukan lavender (PAPER badge tetap satu-satunya makna lavender). Tanda `+/−`
   terbaca dari format `signed: true` (`OverviewPage.tsx:197,208`) tanpa bergantung warna.
2. **Semua pasangan fg/bg panel charcoal ≥4,5:1? CLOSED.** Dihitung ulang sendiri (WCAG relative
   luminance, pasangan ber-opacity di-composite; light sidebar `#222123`, dark `#0e0d0f`):
   | Pasangan | Light | Dark |
   |---|---|---|
   | panel ink `#FAFAFA`/`#F4F4F5` | 15,36:1 | 13,46:1 |
   | panel muted `#A1A1AA` | 6,26:1 | 5,77:1 |
   | panel positive `#6EE7B7`/`#34D399` | **10,52:1** | **7,70:1** |
   | panel negative `#FCA5A5`/`#F87171` | **8,45:1** | **5,35:1** |
   | hero lime `#D2FF00` | 13,78:1 | 12,71:1 |
   | sidebar ink | 15,36:1 | 17,64:1 |
   | sidebar ink @0,72 (nav link, foot) | 8,56:1 | 9,28:1 |
   | sidebar ink @0,55 (group title) | 5,58:1 | 5,79:1 |
   | nav aktif `#171717` on lime | 15,40:1 | 15,40:1 |
   Terendah 5,35:1 (negative dark) — semua ≥4,5:1; P-1 lama (2,09:1 / 1,93:1) tertutup. Tidak ada
   komponen non-teks yang berubah di commit ini (diff murni `color:` pada teks), jadi ambang 3:1
   non-teks tidak relevan untuk delta ini.
3. **Kontrol keselamatan utuh & keyboard? CLOSED.** `git diff a8bef6e3..10c03f6 --
   StopControl.tsx useWatchlist.ts` **kosong**. Semua label tetap ada: STOP NEW ENTRIES
   (`StopControl.tsx`), PAPER/SIMULATED, HALTED, verdict risk + reasons, state
   stale/unavailable/pending/offline, reorg "MANUAL REVIEW REQUIRED". Delta `d8ac8ac..10c03f6`
   hanya 25 baris CSS warna (scope `color:`) + 12 tes + harness/evidence — nol sentuh layout,
   pointer-events, tabindex, atau handler → keyboard reachability & target 48px tidak berubah.
4. **Non-optimistic & tanpa data karangan? CLOSED.** Nol perubahan TSX di delta ini (diff `src`
   hanya `tokens.css` + `base.css`); grep nol chart library / polyline dekoratif; satu-satunya
   kata kunci "optimistic" adalah komentar yang menyatakan TIDAK ada optimistic update
   (`useWatchlist.ts:32`); fallback 'Unavailable' tetap. Screenshot PnL = fixture berlabel yang
   di-intercept di browser dan didisclosure di `results.json` — bukan data karangan.
5. **Gate dijalankan sendiri di `10c03f6`:** typecheck OK · contract **29/29** · API **195 passed
   + 5 skipped** · web **165/165** (153 + 12 tes kontrak baru yang mengunci pasangan charcoal dan
   token status global) · file terlarang nol diff vs `a8bef6e3` (juga `StopControl.tsx`/
   `useWatchlist.ts`). Red proof 2 mutasi dilaporkan Pixel (ikat ulang ke `--status-positive-fg` →
   2 tes gagal; ubah token dark → 2 tes gagal), kedua mutasi dipulihkan.

**Ringkasan: P-1 CLOSED; nol regresi; semua butir 1–5 CLOSED. Sisa minor R-4 di 320px non-blocking
(chip reachable via scroll). Belum terverifikasi (v1 & v2): screen reader nyata (VoiceOver/NVDA),
sentuhan perangkat fisik, persepsi pemisahan layer dark 1,06–1,14:1, review frame-by-frame webm.
Temuan di luar cakupan ini (N-1 raw RPC message, dsb.) tetap terbuka seperti laporan sebelumnya.**

## 6. Revision 3 — invariant & metode verifikasi (branch `design/soft-bento-rev3`, oleh Sentinel)

Tahap 1 (belum ada implementasi Forge): inventaris invariant keselamatan yang WAJIB utuh di
Revision 3 + cara cek konkret masing-masing. Baseline: `main 2769c11`. Eksekusi perintah di
bawah dilakukan setelah Forge push; label hasil saat re-check nanti: **CLOSED** (terbukti utuh)
/ **REGRESSION** (invariant rusak — blocker) / **BELUM TERVERIFIKASI** (tidak bisa dibuktikan
dengan cara cek yang tersedia, sebutkan alasannya). Rev 3 adalah polish pass presentation layer
(brief §9: "Keep all backend integrations and safety invariants unchanged"); semua invariant di
bawah tidak boleh berubah walau komposisi/typografi/density berubah.

### 6.1 Invariant INV-1 — PAPER-only, tanpa signing/execution live, tanpa dependensi trading baru

Pernyataan: aplikasi tetap simulasi PAPER; tidak ada signing, broadcast, atau eksekusi order
live; tidak ada dependensi baru yang menambah jalur trading (brief §9 + aturan kontrak produk).

Cara cek:
- `git diff --name-only 2769c11..HEAD -- apps/api packages pnpm-lock.yaml` → WAJIB kosong
  (backend/packages/lockfile tidak boleh tersentuh; dependensi baru = lockfile berubah).
- `git diff 2769c11..HEAD -- package.json 'apps/*/package.json' 'packages/*/package.json'`
  → tidak ada penambahan `dependencies`/`devDependencies`.
- `grep -rniE "signTransaction|sendRawTransaction|eth_sendTransaction|privateKey|mnemonic" apps packages`
  → tidak ada hasil baru (baseline nol; kalau muncul = REGRESSION).
- `pnpm --filter './packages/*' test` → kontrak **29/29** tetap (PAPER-only, discovered pool
  non-actionable 422 INTENT_NOT_ACTIONABLE, allowlist WETH/USDG, volume UNAVAILABLE).
- Screenshot: badge `PAPER — SIMULATED` masih terlihat di chrome aplikasi.

### 6.2 Invariant INV-2 — STOP NEW ENTRIES: ada, terlihat, keyboard, non-optimistic

Pernyataan: kontrol emergency tetap ada dan menonjol, terjangkau keyboard, dan tampilannya hanya
mencerminkan state backend terkonfirmasi — bukan optimistic update (brief §8 baris terakhir).

Cara cek:
- `git diff 2769c11..HEAD -- apps/web/src/components/StopControl.tsx apps/web/src/features/discover/useWatchlist.ts`
  → boleh berubah untuk restyle (className), TAPI baca diff baris demi baris: perubahan pada
  alur state (`pending`, `overrides`, `await`, pemicu dari respons server), handler, atau
  penamaan = REGRESSION. Bukti non-optimistic: perubahan tampilan hanya terjadi setelah respons
  server (lihat komentar kontrak `useWatchlist.ts:32-34` — "no optimistic update").
- `grep -rnE "optimistic|onMutate|setQueryData" apps/web/src` → satu-satunya hasil adalah
  komentar yang menyatakan TIDAK ada optimistic update; hasil tambahan = perlu dicek.
- `grep -n "button" apps/web/src/components/StopControl.tsx` → tetap `<button type="button">`
  (bukan div), sehingga keyboard reachable tanpa JS tambahan.
- Tes web yang mengunci kontrak non-optimistic harus tetap lulus; jumlah tes tidak boleh turun.
- Screenshot keyboard-run (e2e): fokus tab mencapai STOP NEW ENTRIES; label terbaca penuh.

### 6.3 Invariant INV-3 — State darurat & status data tetap ada dan terbaca

Pernyataan: HALTED, state stale/unavailable/pending/offline, verdict risk + reasons, dan reorg
"MANUAL REVIEW REQUIRED" tetap ada, tidak disembunyikan/di-ringkas, dan kontrasnya lulus AA
(brief §4 "Keep PAPER mode and emergency HALT prominently visible", §5 "Preserve accurate
unavailable states", §6 "clearly differentiated status colors").

Cara cek:
- Label inventory sebelum/sesudah — `grep -rn "STOP NEW ENTRIES\|SIMULATED\|HALTED\|MANUAL REVIEW REQUIRED\|STALE\|UNAVAILABLE\|PENDING\|OFFLINE\|Unavailable" apps/web/src --include=*.tsx -l`
  → daftar file hasil di `2769c11` (StopControl.tsx, OverviewPage.tsx, Shell.tsx,
  IntentAction.tsx, PortfolioView.tsx, RiskPage.tsx, RiskDecisionView.tsx,
  CandidateDetailPage.tsx, MorePage.tsx, PortfolioPage.tsx) tidak boleh menyusut di HEAD.
  Restyle boleh; label hilang atau dipindah ke tooltip/hover = REGRESSION.
- `grep -rn "MANUAL REVIEW REQUIRED\|Reasons\|reasons" apps/web/src/features/risk/RiskDecisionView.tsx`
  → verdict + daftar reasons tetap dirender apa adanya (tanpa filter/ringkasan).
- Kontras: setiap token warna BARU yang dipakai untuk teks status dihitung ulang WCAG
  (≥4,5:1 teks normal; ≥3:1 non-teks). Keputusan Rev 2 yang berlaku: lime `#D2FF00` hanya fill
  aksen (bukan makna status), lavender hanya badge PAPER, fg status khusus charcoal
  (`--feature-positive-fg`/`--feature-negative-fg`) tidak boleh dipakai di luar panel —
  `git diff 2769c11..HEAD -- apps/web/src/styles/tokens.css apps/web/src/styles/base.css`
  dibaca penuh untuk memastikan tidak ada pemakaian baru yang menyalahi pemisahan ini.
- Screenshot light+dark: semua label di atas terlihat tanpa perlu hover/interaksi.

### 6.4 Invariant INV-4 — BUY signal ≠ posisi terbuka (brief §4)

Pernyataan: UI tidak menyiratkan fill/posisi dari signal strategi. Lima state harus tetap
terpisah: strategy signal / risk verdict / approved intent / PAPER order-fill status / portfolio
position — dan hanya state yang benar-benar disediakan API yang ditampilkan.

Cara cek:
- `git diff 2769c11..HEAD -- apps/web/src/features/overview/OverviewPage.tsx apps/web/src/features/candidates apps/web/src/features/risk apps/web/src/features/intent apps/web/src/components/ActionBadge.tsx`
  → baca semua perubahan teks label; kata yang menyiratkan eksekusi ("filled", "position
  opened", "owned", "bought", "entry done") pada konteks signal = REGRESSION.
- `grep -rn "BUY\|SELL\|HOLD" apps/web/src --include=*.tsx` → setiap kemunculan harus berada di
  konteks "signal"/"evaluation"/"strategy", bukan "position"/"order".
- Cek tipe data: field yang dirender untuk signal/position berasal dari tipe API
  (`packages/` contract types) — `grep -rn "position\|fill" apps/web/src --include=*.tsx` tidak
  boleh menampilkan field yang tidak ada di tipe respons API (cek silang dengan
  `packages/` atau fixture).
- Screenshot healthy-state: kartu strategy signal hanya memuat verdict + alasan + label
  "signal"-an; PAPER order/intent terpisah dari portfolio position.

### 6.5 Invariant INV-5 — Motion jujur & sukses hanya setelah konfirmasi backend (brief §8)

Pernyataan: tidak ada animasi pada kartu statis yang membuatnya terlihat clickable; feedback
success hanya muncul setelah konfirmasi backend (pending → success/error mengikuti respons).

Cara cek:
- `grep -nE "animation|@keyframes|transition|cursor: *pointer|:hover|:active" apps/web/src/styles/base.css apps/web/src/styles/*.css`
  → audit setiap hasil: `cursor:pointer`/`:hover` interaktif hanya pada elemen yang benar-benar
  punya handler (button/link/menu item); transisi kartu non-interaktif = REGRESSION
  (brief §8 "Do not animate static cards as though they are clickable").
- Alur sukses: `git diff 2769c11..HEAD` pada komponen dengan feedback (useWatchlist,
  StopControl, IntentAction, Refresh) → status "success" hanya diset dari callback/onSuccess
  setelah `await`/respons server; tidak ada setState success sebelum request selesai.
  `grep -rn "setSuccess\|status: 'success'\|'success'" apps/web/src --include=*.tsx*` dibaca
  kontekstual per hasil.
- `prefers-reduced-motion` tetap dihormati (`grep -n "prefers-reduced-motion" apps/web/src/styles/*.css`).
- Rekaman interaksi (webm milik Pixel/Probe) ditinjau: pastikan tidak ada feedback sukses
  sebelum balasan API pada aksi watchlist/intent/stop. (Saya verifikasi dari kode + replay;
  penilaian estetika motion milik Probe/Pixel.)

### 6.6 Invariant INV-6 — File terlarang nol diff vs `main 2769c11`

Pernyataan: `apps/api/src/chain/client.ts`, `apps/api/src/chain/rpc-guard.ts`,
`apps/api/src/config.ts`, audit-gate, lockfile, backend (`apps/api`), `packages/` tidak berubah
sama sekali (brief §9 "backend integrations ... unchanged").

Cara cek:
- `git diff --stat 2769c11..HEAD -- apps/api packages pnpm-lock.yaml audit-gate` → kosong.
- `git diff --name-only 2769c11..HEAD` → seluruh delta harus berada di `apps/web/src`,
  `apps/web/test`, `apps/web/e2e`, `docs/design/` (presentasi + evidence); selain itu = perlu
  dicek, di luar batas presentation layer.
- Perubahan konfigurasi build web diperbolehkan sejauh tidak menambah dependensi (lihat INV-1).

### 6.7 Invariant INV-7 — Data jujur: tanpa metrik/chart/pool karangan (brief §1, §5)

Pernyataan: tidak ada chart, metrik, pool, atau angka yang di-invent; semua nilai dari API;
state Unavailable apa adanya (brief §1 "Never invent portfolio charts or artificial metrics",
§5 "Do not invent pools when the API returns only one").

Cara cek:
- `grep -rnE "chart|sparkline|polyline|recharts|d3" apps/web/src --include=*.tsx` → nol hasil
  chart library/dekoratif (baseline nol).
- `git diff 2769c11..HEAD -- apps/web/src` → tidak ada komponen visualisasi data baru; angka
  hard-coded pada JSX (bukan dari props/API) = REGRESSION.
- Screenshot Discover dengan API 1 pool: jumlah baris tabel = jumlah data API (1), tanpa
  placeholder pool; nilai volume tetap `UNAVAILABLE`, confidence `LOW`.
- Evidence screenshots bukan fixture yang menyamar: bila harness memakai fixture berlabel,
  disclosure tetap ada di `results.json` (praktik Rev 2).

### 6.8 Invariant INV-8 — Gate tidak menyusut

Pernyataan: kualitas gate minimum sama dengan baseline; jumlah tes tidak turun.

Cara cek (jalankan sendiri di HEAD rev3, jangan terima klaim):
- `pnpm -r typecheck` → bersih.
- `pnpm --filter './packages/*' test` → contract **29/29**.
- `pnpm --filter @trident/api test` → **195 passed + 5 skipped** (atau lebih; tidak kurang).
- `pnpm --filter @trident/web test` → **≥165 passed** (baseline Rev 2: 165/165); tes yang
  dihapus/di-skip harus punya alasan tertulis.
- `pnpm -r build` → OK.
- Bila Forge mengubah kelas/token: tes kontrak disesuaikan + red proof (mutasi → gagal →
  pulih) seperti praktik Rev 2.

### 6.9 Ringkasan metode & pembagian verifikasi

- Saya (Sentinel) mengeksekusi INV-1..INV-8 di atas setelah Forge push, lalu menulis hasil per
  invariant (CLOSED / REGRESSION / BELUM TERVERIFIKASI) di bagian ini.
- Estetika komposisi, ketajaman motion, dan kualitas bukti visual = ranah Probe/Pixel; yang
  saya nilai dari item itu hanya sisi keselamatannya (kejujuran data, keterbacaan kontrol,
  tidak ada misleading affordance).
- BELUM TERVERIFIKASI yang sudah diketahui dan akan tetap dilaporkan apa adanya kecuali ada
  cara bukti baru: screen reader nyata (VoiceOver/NVDA), sentuhan perangkat fisik, persepsi
  pemisahan layer dark (1,06–1,14:1), review frame-by-frame rekaman.
