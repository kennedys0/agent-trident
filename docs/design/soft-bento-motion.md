# TRIDENT Motion Spec — Robinhood Soft Bento

Status: DRAFT untuk design exploration (issue #39). Pasangan dari `soft-bento-tokens.md`. Pemilik: Pixel. Implementasi: Forge.

Sumber: Taste Engine `references/motion-engine.md` (FLOOR/REFLEX/FINISH), section Motion style pack `minimalism` (100–140ms quiet ease-out; "felt, not watched"), `references/anti-slop.md` §D. Tanpa dependensi — CSS transitions saja; tidak ada Anime.js/Framer Motion.

## 1. Prinsip

1. **Terasa, bukan tontonan.** Motion hanya untuk konfirmasi, kontinuitas, orientasi, atau affordance. Bila efek dihapus dan pemahaman tidak berkurang, efek itu dibuang.
2. **Satu easing untuk semua**: `--ease: cubic-bezier(0.2, 0, 0, 1)` — decelerate, tanpa bounce, tanpa elastic.
3. **Durasi tiga tingkat (Revision 2)**: `--motion-fast: 100ms` (press/warna), `--motion: 170ms` (hover, pill, thumb, panel), `--motion-slow: 220ms` (transisi halaman/masuk viewport pertama). Rentang brief CEO Revision 2: press 80–140ms, hover 150–200ms, panel/page 180–240ms — ketiga nilai berada di dalam rentangnya masing-masing.
4. **Hanya properti compositor-friendly**: `transform`, `opacity`, `background-color`, `border-color`, `box-shadow`. Dilarang menganimasikan `top/left/width/height`, blur, atau glow.
5. **Start static**: tidak ada entrance stagger, tidak ada loop idle, tidak ada autoplay yang menutupi konten.

## 2. Token motion (siap pakai)

```css
:root {
  /* Revision 2 (CEO brief §5): press 80–140ms, hover 150–200ms,
     panel/page 180–240ms — 100/170/220 berada di dalam ketiga rentang. */
  --motion-fast: 100ms;
  --motion: 170ms;
  --motion-slow: 220ms;
  --ease: cubic-bezier(0.2, 0, 0, 1);
  --lift: -2px;              /* card hover travel */
  --press: 1px;              /* button press travel */
}

@media (prefers-reduced-motion: reduce) {
  :root {
    --lift: 0px;
    --press: 0px;
  }
  *, *::before, *::after {
    transition-duration: 0.01ms !important;
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
  }
}
```

## 3. Micro-interactions

### 3.1 Card lift (tile interaktif)

Tile yang benar-benar bisa diklik/bisa dibuka (decision tile → inspector, activity row → journal). Tile statis (equity, PnL) TIDAK lift — hanya tile interaktif.

```css
.bento-tile--interactive {
  transition: transform var(--motion) var(--ease), box-shadow var(--motion) var(--ease);
}
.bento-tile--interactive:hover {
  transform: translateY(var(--lift));       /* -2px, 3px pada tile feature */
  box-shadow: var(--shadow-md);
}
.bento-tile--interactive:active {
  transform: translateY(0);
  transition-duration: var(--motion-fast);
}
```

### 3.2 Button press

```css
.btn {
  transition: transform var(--motion-fast) var(--ease), background-color var(--motion-fast) var(--ease),
              border-color var(--motion-fast) var(--ease), box-shadow var(--motion-fast) var(--ease);
}
.btn:active:not(:disabled) {
  transform: translateY(var(--press));      /* 1px down — feedback ditekan */
}
.btn:disabled { transform: none; }          /* disabled tidak bergerak */
```

### 3.3 Sidebar active pill

Item nav aktif: pill lime `--brand-accent` + teks `--brand-on-accent`, radius `--radius-pill`, tinggi 40px. Transisi background-color saja (posisi pill TIDAK meluncur antar item — perpindahan halaman sudah memberi konteks; sliding pill = kompleksitas tanpa nilai).

```css
.sidebar .nav-link {
  border-radius: var(--radius-pill);
  transition: background-color var(--motion-fast) var(--ease), color var(--motion-fast) var(--ease);
}
.sidebar .nav-link:hover { background: rgba(255, 255, 255, 0.08); }
.sidebar .nav-link[aria-current='page'] {
  background: var(--brand-accent);
  color: var(--brand-on-accent);
}
```

### 3.4 Toggle thumb

Track pill 40×24, thumb lingkaran 18px dengan `aspect-ratio: 1/1; flex-shrink: 0` (anti-oval), warna thumb `--surface` (off) → `--brand-on-accent` di track lime (on). Perpindahan via `transform: translateX(16px)`, bukan `left`.

```css
.toggle__track {
  width: 40px; height: 24px;
  border-radius: var(--radius-pill);
  background: var(--surface-well);
  border: 1px solid var(--border);
  transition: background-color var(--motion) var(--ease);
}
.toggle__thumb {
  width: 18px; height: 18px;
  aspect-ratio: 1 / 1; flex-shrink: 0;
  border-radius: 50%;
  background: var(--surface);
  box-shadow: var(--shadow-sm);
  transform: translateX(0);
  transition: transform var(--motion) var(--ease), background-color var(--motion) var(--ease);
}
.toggle[aria-checked='true'] .toggle__track { background: var(--brand-accent); }
.toggle[aria-checked='true'] .toggle__thumb { transform: translateX(16px); background: var(--brand-on-accent); }
```

**Aturan non-optimistic (Sentinel S-2, wajib):** `aria-checked` dan warna track/thumb hanya berubah SETELAH backend mengonfirmasi perubahan state — bukan saat klik. Nilai optimistik dilarang pada toggle, watchlist action, dan filter yang menyentuh state server: klik menandai in-flight (`aria-busy` / disabled + `status-pending`), lalu state visual mengikuti respons server. Referensi pola yang benar di repo: `apps/web/src/components/StopControl.tsx:24-31` (sukses hanya setelah re-read `/health`). Toggle tema lokal (light/dark) dikecualikan karena state-nya di klien.

### 3.5 Row hover (tabel)

```css
.table tbody tr {
  transition: background-color var(--motion-fast) var(--ease);
}
.table tbody tr:hover { background: var(--surface-hover); }
```

Row hover tidak mengubah angka; badge status dan watch button tetap stabil (tidak ada reveal-on-hover yang menyembunyikan informasi).

### 3.6 Page / panel transition

Saat berpindah halaman: konten utama fade + rise 4px sekali, 240ms. Tanpa view-transition API, cukup CSS animation pada mount halaman.

```css
@keyframes page-in {
  from { opacity: 0; transform: translateY(4px); }
  to   { opacity: 1; transform: translateY(0); }
}
.shell__main > * { animation: page-in var(--motion-slow) var(--ease); }
```

Panel yang datanya baru terisi (loading → populated) tidak dianimasikan ulang — nilai berganti tanpa fade ulang supaya data finansial tidak berkedip (aturan anti-slop: tanpa stagger informasi transaksional).

### 3.7 Fokus

Focus ring 2px `--focus`, offset 2px, muncul hanya pada `:focus-visible`; ring tidak dianimasikan (langsung tampil/hilang — orientasi keyboard lebih cepat dari hover mouse).

## 4. Reduced-motion (FLOOR)

Dengan `prefers-reduced-motion: reduce`:

- Lift/press = 0 (variabel `--lift`/`--press` jadi 0), semua transition 0.01ms, animasi `page-in` praktis instan.
- **Yang TETAP berubah**: warna state (active pill lime, row hover, badge) tetap terjadi secara instan — perubahan status tidak pernah hilang bersama motionnya.
- Skeleton/pulse: bila ada, tetap statis (opacity konstan, tanpa pulse).
- Aksi tetap tersedia tanpa animasi; screen reader tidak bergantung pada gerakan.

## 5. Larangan (REFLEX, langsung gagal review)

- Bounce/elastic/overshoot di mana pun.
- Entrance stagger per-card atau per-row.
- Elemen mengambang/perpetual loop (float, pulse dekoratif, berkedip).
- Animated glow/blur/gradient.
- Scroll hijacking; reveal-on-hover yang menyembunyikan informasi penting (provenance, reason).
- Loading palsu dengan animasi yang tidak mencerminkan progres nyata.
- Animasi pada `transition: all`.

## 6. Verifikasi

Bukti implementasi (Forge, saat fase implementasi): hover/press/navigasi/toggle terekam Playwright light+dark; reduced-motion pass (emulasi `prefers-reduced-motion: reduce`); keyboard-only pass menunjukkan fokus terlihat dan aksi tetap berfungsi; tidak ada klaim fps/Vitals tanpa pengukuran nyata.
