# TRIDENT Design Tokens — Robinhood Soft Bento

Status: DRAFT untuk design exploration (issue #39). Bukan implementasi; menggantikan arah Neo-Brutalism pada `apps/web/src/styles/tokens.css` bila disetujui. Pemilik: Pixel. Implementasi: Forge (terpisah, setelah spec ini disetujui).

Sumber gaya: Taste Engine `minimalism` (style pack), `references/anti-slop.md`, `references/responsive-baseline.md`, `references/web-interface-quality.md`, `references/motion-engine.md` (lihat `soft-bento-motion.md`). Blend dinyatakan: **primary = Minimalism**, fitur yang dipinjam = Bento Grid (tile asimetris multi-span diizinkan) + aksen brand Robinhood-style lime + micro-interaction tactile ringan.

## Revision 2 (CEO brief — visual hierarchy, komposisi Bento, motion fidelity)

Verdict CEO terhadap Rev 1: REVISION REQUIRED — masih terbaca "admin dashboard", bukan Soft Bento Trading Cockpit. Revisi ini presentation-layer saja; semua angka tetap dari endpoint nyata.

Perubahan token inti (semua kontras diverifikasi AA+):

1. **Ladder dark terkalibrasi** (§1 Rev 1: canvas dan surface nyaris sama): dark `--canvas #131214` → `--surface #201f22` → `--surface-raised #29272b`; ink 17,0/14,9:1, muted 7,3/6,4/5,8:1; sidebar dark `#0e0d0f` (chrome lebih gelap dari canvas).
2. **Feature panel**: token baru `--feature-bg/ink/muted/line`. Light = charcoal `#222123` di atas canvas abu lembut (feature-ink `#fafafa` 15,4:1, muted 6,3:1, lime 13,8:1); dark = raised layer `#29272b` (lime 12,7:1). Dipakai oleh modul portfolio dominan dan tidak oleh modul lain.
3. **Tipografi**: font sistem humanist + mono sistem — `--font-sans: system-ui, -apple-system, 'Segoe UI', 'Helvetica Neue', Arial` dan `--font-mono: ui-monospace, 'SFMono-Regular', 'Menlo', 'Consolas'`; nama webfont (Inter/Space Grotesk/JetBrains Mono) dihapus dari token. Token baru `--text-hero: 40px` untuk figur equity dominan. Mono hanya untuk address/hash/identifier teknis; nilai finansial = sans + `tabular-nums`.
4. **Label sentence-case**: `text-transform: uppercase` dihapus dari section/figure/strip/panel/table-header/stat label; badge tetap uppercase.
5. **Motion** (detail di motion spec): `--motion-fast 100ms` (press), `--motion 170ms` (hover), `--motion-slow 220ms` (panel/page) — di dalam rentang brief CEO 80–140/150–200/180–240ms.
6. **Komposisi Overview 12 kolom** (peta di §6): status-strip span 12; modul portfolio CHARCOAL dominan span 7 × 2 baris (equity hero lime, cash, PnL); modul market/strategy span 5 × 2 baris dengan surface-well (beda visual); row ringkas risk 3 + discovery 3 + activity 6. Span DAN tinggi bervariasi; tanpa kartu pengisi.

Asumsi yang diambil (menunggu konfirmasi CEO): aksen tetap lime `#D2FF00` (CEO menyebut "Robinhood-green" tanpa hex; lime disetujui di Rev 1 dan kontrasnya terkuat), charcoal feature panel diterapkan pada modul portfolio + sidebar, lavender tetap badge PAPER + aksen sekunder, dan font sistem tanpa unduhan webfont.

## 1. Keputusan palet dan alasannya

Kandidat CEO dievaluasi dengan perhitungan WCAG (rasio aktual, bukan klaim):

| Pasangan | Rasio | Keputusan |
| --- | --- | --- |
| `#171717` pada `#FFFFFF` | 17,93:1 | ink utama di surface — AAA |
| `#171717` pada `#E9E9E9` | 14,77:1 | ink utama di canvas — AAA |
| `#171717` pada `#D2FF00` | 15,40:1 | teks di atas fill lime — AA/AAA (syarat CEO terpenuhi) |
| `#222123` pada `#D2FF00` | 13,78:1 | alternatif teks di lime (charcoal) — AAA |
| `#52525B` pada `#FFFFFF` / `#E9E9E9` | 7,73 / 6,37:1 | teks sekunder — AA dengan margin |
| `#171717` pada `#B9AEF4` | 8,90:1 | teks di atas fill lavender — AA |
| `#FAFAFA` pada `#222123` | 15,36:1 | sidebar gelap charcoal — AAA |
| `#F4F4F5` pada `#1A191B` | 15,94:1 | ink dark mode — AAA |
| `#A1A1AA` pada `#1A191B` / `#222123` | 6,84 / 6,26:1 | muted dark — AA |

**Kalibrasi yang dilakukan terhadap kandidat awal:**

1. **Brand accent lime `#D2FF00` — dipertahankan sebagai fill, dilarang sebagai teks.** Rasio lime terhadap canvas terang hanya **1,04:1** sebagai batas bentuk, sehingga di light mode setiap fill lime WAJIB diberi hairline border + elevation (lihat §7) agar bentuk tombol terbaca. Lime tidak pernah dipakai sebagai warna teks di light mode (1,3:1 di putih — gagal AA). Semua fill lime memakai teks gelap `#171717` (15,40:1).
2. **Warning dikalibrasi `#C2410C` → `#9A3412`.** Kandidat oranye pada tint oranye hanya 4,52:1 (lulus tipis); varian lebih gelap memberi 6,38:1.
3. **Halted dipakai sebagai fill solid merah `#B91C1C` + teks putih (6,47:1), bukan `#DC2626`** (4,83:1 — lulus tapi tanpa margin).
4. **Dark canvas `#1A191B`, bukan invert dan bukan hitam murni.** Mengikuti aturan anti-slop (hindari `#000000`), charcoal kandidat `#222123` menjadi **surface/elevated** dark mode dan **sidebar light mode** — satu token, dua peran.
5. **Lavender `#B9AEF4` = aksen sekunder brand, bukan status.** Hanya sebagai fill/tag dekoratif ringan dengan teks gelap (8,90:1), dan sebagai glow-nontext di dark mode (8,70:1 terhadap canvas dark). Tidak pernah membawa makna sukses/gagal.

## 2. Prinsip pemakaian brand vs semantic

**Hukum nomor satu: hijau brand BUKAN makna "healthy / BUY / approved".** Lime adalah identitas merek dan warna aksi utama. Makna status 100% lewat semantic token yang terpisah:

- Status positif (AVAILABLE, PnL naik) = emerald semantic, BUKAN lime brand.
- Status negatif/critical/halted = merah semantic, tidak pernah hijau.
- Tidak ada state sukses yang dinyatakan hanya dengan lime; jika lime dan semantic muncul bersama (tombol Watch di row AVAILABLE), badge status tetap emerald.

Untuk setiap token status: **fg/bg/border adalah satu paket yang tidak boleh dicampur** antar status atau antar mode.

## 3. Token lengkap (CSS siap pakai)

```css
/* TRIDENT tokens — Robinhood Soft Bento (design exploration, issue #39).
   Replaces the neo-brutalism token set; names keep English per repo convention. */
:root {
  /* Surfaces (light) */
  --canvas: #e9e9e9;            /* page base — warm light gray */
  --surface: #ffffff;           /* tile / card fill */
  --surface-well: #f4f4f5;      /* recessed wells: inputs, table headers */
  --surface-hover: #f8fafc;     /* row hover */

  /* Ink */
  --ink: #171717;               /* primary text — 17.9:1 on surface */
  --muted: #52525b;             /* secondary text — 6.4:1 on canvas */

  /* Structure */
  --border: rgba(23, 23, 23, 0.12);       /* hairline tile border */
  --border-strong: rgba(23, 23, 23, 0.24);/* emphasized boundary, e.g. lime fills */
  --hairline: rgba(23, 23, 23, 0.08);     /* internal dividers */

  /* Brand (identity + primary action — NEVER a status meaning) */
  --brand-accent: #d2ff00;      /* lime fill: primary CTA, active nav pill */
  --brand-on-accent: #171717;   /* text on lime — 15.4:1 */
  --brand-secondary: #b9aef4;   /* lavender fill: light tags, empty-state art */
  --brand-on-secondary: #171717;
  --sidebar-bg: #222123;        /* dark sidebar on light canvas */
  --sidebar-ink: #fafafa;       /* 15.4:1 on charcoal */

  /* Semantic status — separate from brand, fixed fg/bg/border pairs (AA verified) */
  --status-positive-fg: #065f46;   --status-positive-bg: #ecfdf5;  --status-positive-border: #a7f3d0;
  --status-negative-fg: #991b1b;   --status-negative-bg: #fee2e2;  --status-negative-border: #fecaca;
  --status-warning-fg: #9a3412;    --status-warning-bg: #ffedd5;   --status-warning-border: #fed7aa;
  --status-critical-fg: #7f1d1d;   --status-critical-bg: #fecaca;  --status-critical-border: #f87171;
  --status-halted-fg: #ffffff;     --status-halted-bg: #b91c1c;    --status-halted-border: #b91c1c; /* filled; 6.5:1 */
  --status-stale-fg: #854d0e;      --status-stale-bg: #fef3c7;     --status-stale-border: #fde68a;
  --status-unavailable-fg: #52525b;--status-unavailable-bg: #f4f4f5; --status-unavailable-border: #e4e4e7;
  --status-pending-fg: #1d4ed8;    --status-pending-bg: #dbeafe;   --status-pending-border: #bfdbfe;

  /* Disabled controls (Sentinel S-4): readable by rule, never by opacity.
     offline (browser/RPC OFFLINE) is status-critical/negative, NOT these. */
  --disabled-fg: #52525b;            /* 7.0:1 on --disabled-bg */
  --disabled-bg: #f4f4f5;

  /* Focus + info */
  --focus: #2563eb;             /* 2px outline, offset 2px — AA vs both modes */
  --info: #1d4ed8;

  /* Geometry */
  --radius-sm: 8px;             /* controls, inputs, badges */
  --radius: 12px;               /* tiles, panels */
  --radius-lg: 16px;            /* bento feature tile */
  --radius-pill: 999px;         /* pills, toggle track */

  --border-width: 1px;          /* hairline — replaces 2.5px brutalist border */

  /* Elevation (soft, zero offset; no hard brutalist shadow) */
  --shadow-sm: 0 1px 2px rgba(23, 23, 23, 0.05);
  --shadow-md: 0 2px 8px rgba(23, 23, 23, 0.08);
  --shadow-lg: 0 8px 24px rgba(23, 23, 23, 0.12);   /* overlays/dropdowns only */

  /* Spacing — keep 8px grid, add half-step */
  --space-05: 4px;
  --space-1: 8px;
  --space-2: 16px;
  --space-3: 24px;
  --space-4: 32px;
  --space-5: 48px;

  /* Typography */
  --font-sans: 'Inter', 'Space Grotesk', system-ui, -apple-system, 'Segoe UI', sans-serif;
  --font-mono: 'JetBrains Mono', ui-monospace, 'SFMono-Regular', 'Menlo', monospace;
  --text-display: 30px;   /* page h1, weight 700, letter-spacing -0.025em */
  --text-h2: 20px;        /* panel/section title, weight 600 */
  --text-body: 15px;      /* body, line-height 1.6 */
  --text-meta: 13px;      /* meta/labels, weight 500 */
  --text-mono-num: 13px;  /* table numerics, tabular-nums, right-aligned */

  /* Motion (full contract in soft-bento-motion.md) */
  --motion-fast: 120ms;
  --motion: 160ms;
  --motion-slow: 240ms;
  --ease: cubic-bezier(0.2, 0, 0, 1);

  /* Layout */
  --sidebar: 240px;
  --content-max: 1440px;
  --bento-gap: 16px;
  --tap: 48px;
}

/* Dark mode — own tokens, NOT an invert of light. */
[data-theme='dark'] {
  --canvas: #1a191b;            /* warm charcoal, not pitch black */
  --surface: #222123;           /* candidate charcoal becomes surface */
  --surface-well: #2a292c;      /* recessed wells */
  --surface-hover: #2a292c;     /* row hover */

  --ink: #f4f4f5;               /* 15.9:1 on canvas */
  --muted: #a1a1aa;             /* 6.8:1 on canvas */

  --border: rgba(255, 255, 255, 0.10);
  --border-strong: rgba(255, 255, 255, 0.20);
  --hairline: rgba(255, 255, 255, 0.08);

  --brand-accent: #d2ff00;      /* lime stays; 13.8:1 vs charcoal — reads */
  --brand-on-accent: #171717;
  --brand-secondary: #b9aef4;   /* non-text accent in dark; text on it stays dark */
  --brand-on-secondary: #171717;
  --sidebar-bg: #141314;        /* sidebar darker than canvas */
  --sidebar-ink: #f4f4f5;

  /* Semantic dark: bright fg on low-alpha tint of the same hue over canvas */
  --status-positive-fg: #34d399;  --status-positive-bg: rgba(16, 185, 129, 0.15);  --status-positive-border: rgba(16, 185, 129, 0.35);
  --status-negative-fg: #f87171;  --status-negative-bg: rgba(239, 68, 68, 0.15);   --status-negative-border: rgba(239, 68, 68, 0.35);
  --status-warning-fg: #fbbf24;   --status-warning-bg: rgba(245, 158, 11, 0.15);   --status-warning-border: rgba(245, 158, 11, 0.35);
  --status-critical-fg: #f87171;  --status-critical-bg: rgba(239, 68, 68, 0.22);   --status-critical-border: rgba(239, 68, 68, 0.5);
  --status-halted-fg: #ffffff;    --status-halted-bg: #b91c1c;                     --status-halted-border: #ef4444; /* filled */
  --status-stale-fg: #fbbf24;     --status-stale-bg: rgba(251, 191, 36, 0.12);     --status-stale-border: rgba(251, 191, 36, 0.3);
  --status-unavailable-fg: #9ca3af; --status-unavailable-bg: rgba(156, 163, 175, 0.12); --status-unavailable-border: rgba(156, 163, 175, 0.25);
  --status-pending-fg: #93c5fd;   --status-pending-bg: rgba(59, 130, 246, 0.15);   --status-pending-border: rgba(59, 130, 246, 0.35);

  --focus: #60a5fa;
  --info: #93c5fd;

  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.3);
  --shadow-md: 0 2px 8px rgba(0, 0, 0, 0.35);
  --shadow-lg: 0 8px 24px rgba(0, 0, 0, 0.45);
}

@media (max-width: 767px) {
  :root {
    --text-display: 26px;
    --space-3: 16px;
    --space-4: 16px;
    --bento-gap: 12px;
  }
}
```

Catatan kontras dark semantic: semua fg lulus AA pada tintnya yang di-blend ke canvas `#1A191B` (positive 7,23; warning 7,99; negative 5,43; unavailable 5,64; pending 8,08; **critical 4,94 — lulus AA normal-text tanpa margin; jangan turunkan alpha, dan untuk teks yang butuh margin pakai `status-negative` atau perbesar alpha ≥0,25** — angka ini dicantumkan agar regresi terdeteksi (Sentinel S-5); halted fill putih-di-`#B91C1C` 6,47).

## 4. Status → token mapping (fitur nyata, bukan baru)

| State UI hari ini | Token baru |
| --- | --- |
| AVAILABLE, PnL positif | `status-positive` (emerald — BUKAN lime brand) |
| STALE | `status-stale` (amber; nilai tetap tampil normal) |
| UNAVAILABLE | `status-unavailable` (neutral gray; selalu dengan reason) |
| Error / gagal | `status-negative` |
| Risk breach / RPC offline | `status-critical` |
| Browser offline, RPC OFFLINE | `status-critical`/`status-negative` + banner — **jangan pernah abu-abu unavailable** (Sentinel S-4); data terakhir tetap tampil dengan label "not live" |
| Kontrol disabled | `--disabled-fg` pada `--disabled-bg` (terbaca by-rule, tanpa opacity); label tetap terbaca; `aria-disabled` bila bukan tombol asli |
| Kill switch engaged (STOP) | `status-halted` (fill solid merah — satu-satunya status filled) |
| Refresh in-flight, pending | `status-pending` (blue) |
| PAPER mode, testnet info | **Token PAPER eksplisit (Sentinel S-1): fill `brand-secondary` lavender + ink `#171717` + `border-strong`** — bukan pilihan "atau info". Wajib tampil di tiga tempat: brand sidebar, topbar/header tiap halaman, dan status-strip HUD. Bukan tag dekoratif, tidak boleh disembunyikan, dan tidak boleh memakai `status-unavailable` gray. |

## 5. Tipografi

- Display/h1: `--text-display` 30px, weight 700, `letter-spacing: -0.025em` (28→26px mobile).
- **Hero figure (Revision 2)**: `--text-hero` 40px, weight 700, `letter-spacing: -0.02em` — hanya figur equity di modul portfolio dominan, warna brand accent.
- Judul panel/section: 20px (`--text-h2`), weight 600, warna ink — bukan uppercase kecil.
- Body: 15px, line-height 1.6. Meta/label: 13px, weight 500, **sentence case** (uppercase hanya badge).
- Semua angka finansial/metric/timestamp: `font-variant-numeric: tabular-nums`, kolom numerik rata kanan, teks rata kiri (aturan minimalism).
- Font (Revision 2): **stack sistem** `system-ui, -apple-system, 'Segoe UI', 'Helvetica Neue', Arial` untuk UI; mono sistem `ui-monospace, 'SFMono-Regular', 'Menlo', 'Consolas'` **hanya** untuk address/hash/identifier teknis. Nilai finansial = sans + tabular-nums, bukan mono. Tanpa unduhan webfont.

## 6. Radius, spacing, grid bento

- Radius 3 tingkat (8/12/16) + pill; lingkaran (dot status, avatar) wajib `aspect-ratio: 1/1; flex-shrink: 0` (anti-oval 320px).
- Spacing 4/8px, gap bento 16px (12px mobile).
- **Bento 12 kolom** (`grid-template-columns: repeat(12, minmax(0, 1fr))`), tile minimal 4 span. Tile = satu owning surface; **dilarang tile di dalam tile** (anti-slop nested cards). Sisi nanekanan: tablet 6 kolom (span ×2), mobile 1 kolom.

### Peta Overview (desktop ≥1280, Revision 2)

| Row | Tile | Span | Isi (semua dari backend yang ada) |
| --- | --- | --- | --- |
| 1 | `status-strip` | 12 | HUD strip hairline (bukan tile terpisah): PAPER badge, chain health, head block, RPC latency, snapshot freshness, kill-switch |
| 2–3 | `portfolio` (feature panel charcoal) | **7 × 2 baris** | Equity hero 40px (accent), cash, PnL realised/unrealised (tint semantic), as-of, mode. Testid: `overview-equity-value`, `overview-cash-value`, `overview-pnl-realized`, `overview-pnl-unrealized` |
| 2–3 | `market` (surface-well) | **5 × 2 baris** | Kesegaran snapshot + provenance + reference price, lalu sub-modul `overview-strategy`: keputusan strategi terakhir + strategy id. Beda visual dari portfolio |
| 4 | `risk` | 3 | Risk verdict + HALT (critical/halted), link ke /risk |
| 4 | `discovery` | 3 | Registry status, jumlah pool tracked, watchlist — jujur, tanpa angka karangan |
| 4 | `activity` | 6 | Aktivitas PAPER terbaru (dari journal) |

Tablet (6 kolom): strip 6, portfolio 6, market 6, risk 3, discovery 3, activity 6. Mobile: satu kolom. Testid `overview-strategy` dipertahankan di dalam modul market.

### Peta Discover

- Toolbar (search + filter) = tile span 12, **bukan kartu KPI raksasa**. Intro halaman (deskripsi + catatan read-only) berada **di bawah toolbar** (R-4: first paint 375/320 tidak lagi menutup input, tombol Search, dan baris chip pertama di belakang bottom-nav; teks tidak berubah, hanya urutan).
- `INDEXED POOLS` = satu tile span 12 berisi tabel padat yang tetap seperti sekarang: header eksplisit, row 36–40px, `tabular-nums`, angka rata kanan, hover row `--surface-hover`, badge status pakai semantic token §4. Provenance/freshness/confidence/watch tetap. Bento TIDAK mengubah tabel jadi kartu.
- Inspector: satu tile, struktur sama, judul h1.

### Catatan QA Revision 2 (temuan Probe, diperbaiki Pixel)

- **R-1 (kontras):** semua teks/kontrol muted di dalam panel charcoal (`state__text`, `btn--quiet`, `meta`, dst.) memakai pasangan `--feature-muted`/`--feature-line` — `--muted` dikalibrasi ke canvas terang (2,07:1 di atas `#222123`). Lulus AA di light (6,3:1) dan dark (5,8:1).
- **R-2 (tap target):** semua `.btn` memakai `min-height: var(--tap)` (48px); tautan teks di judul/foot bento dapat hit-area 48px (padding + margin kompensasi, ritme baris tidak berubah).
- **R-3 (heading):** judul modul bento dan judul panel portfolio = `h2` (urutan h1→h2 valid; h3 hanya sebagai sub-judul di bawah h2).
- **R-4 (first paint mobile):** gap baris topbar mobile 8px; padding vertikal toolbar Discover 8px; pada ≤374px `flex-basis` field search di-reset (`flex: 0 0 auto`) agar tombol Search tidak terdorong ~150px oleh basis 220px yang berubah makna jadi tinggi di form kolom. Baris chip lebih dalam tetap dicapai lewat scroll dengan clearance F-1 (`scroll-margin-bottom`).

### Navigasi mobile (<768px)

Bottom bar 5 item berlabel + ikon (Lucide, 20px, `currentColor`): Overview · Discover · Portfolio · Risk · More. Target 48px (`--tap`), label 12px, item aktif = tint lime lembut (bukan fill penuh) + ikon dan label `--ink`; desktop tetap sidebar charcoal dengan active pill lime (lihat motion doc). Navigasi tambahan (Watchlist/Strategy/Journal/Settings) hanya lewat halaman yang benar-benar ada — tanpa halaman palsu.

## 7. Elevation dan bentuk

- Depth dari kontras + spacing + hairline + shadow lembut; **nol hard offset shadow** (mati total gaya brutalism: `3px 3px 0` dan kawan-kawannya).
- Tile: `--surface` + `--border` hairline + `--shadow-sm`. Hover tile interaktif: lift (motion doc).
- Fill lime/lavender di light mode: `--border-strong` + `--shadow-sm` karena boundary lime-canvas hanya 1,04:1.
- Tanpa gradient, tanpa glow, tanpa glass. Input well `--surface-well` recessed tanpa shadow.

## 8. Anti-slop checklist (wajib sebelum implementasi dianggap selesai)

- Tanpa data palsu: setiap angka dari API backend; state kosong/pending jujur; tanpa fake KPI tanpa denominator.
- Tanpa chart dekoratif/sparkline tanpa skala; v1 tanpa chart sama sekali.
- Tanpa kartu bersarang; tanpa badge/pill berlebihan; ikon Lucide saja, nol emoji.
- Tanpa dependensi baru (CSS transitions saja; tidak ada Anime.js/Framer).
- Sirkul elemen 1:1; tabel selamat sampai 320px tanpa horizontal blowout; teks mobile proporsional.
- Dark/light flip sinkron semua pasangan token; tidak ada teks gelap di canvas gelap.

## 9. Yang masih perlu keputusan CEO

1. **Font**: ~~self-hosted Inter + JetBrains Mono vs system~~ — Revision 2 memakai **stack sistem humanist + mono sistem** (tanpa unduhan webfont); konfirmasi akhir CEO masih menunggu.
2. **Lime vs Robinhood green asli**: Robinhood memakai hijau `#00C805`-ish; CEO memilih lime `#D2FF00` sebagai kandidat dan brief Revision 2 hanya menyebut "Robinhood-green accent" tanpa hex — implementasi tetap lime (kontras teks gelap 15,4:1, 13,8:1 di feature panel). Kalau CEO ingin `#00C805` sungguhan, butuh kalibrasi ulang pasangan teks.
3. **Lavender**: Revision 2 menahan lavender pada badge PAPER + aksen sekunder bermakna; peran lebih luas menunggu OK.
4. **Sidebar gelap di light mode**: dipertahankan (charcoal + pill lime) sesuai arah "charcoal feature panels" brief Revision 2.
