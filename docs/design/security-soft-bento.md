# Security Review — TRIDENT Soft Bento Design Exploration

Status: review keamanan operasional untuk eksplorasi desain (issue #39). Reviewer: Sentinel.
Basis review: commit `9a03385` (spec token + motion Pixel) dan kode web saat ini di branch
(`main` basis `e5c2629b`, tanpa prototipe Forge). **Prototipe Forge belum ada di branch saat
review ini ditulis — semua temuan level implementasi ditandai UNVERIFIED dan harus di-recheck
begitu commit prototipe muncul.** Read-only terhadap kode; tanpa merge, tanpa force-push.

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
