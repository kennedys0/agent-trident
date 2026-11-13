# Soft Bento — Revision 2 evidence (issue #39, CEO revision brief)

Semua artefak di folder ini dihasilkan oleh `apps/web/e2e/soft-bento-rev2-evidence.mjs`
terhadap build produksi yang dilayani `vite preview`. **Setiap respons API adalah
fixture uji yang di-intercept di browser** (label di `results.json`): tidak ada
pembacaan chain atau backend live, jadi tidak ada screenshot yang bisa disalahartikan
sebagai data produksi. Angka besar (9.999,89 USDG, pool 2.500 USDG/WETH) adalah
bentuk fixture, bukan data nyata.

## Isi (35 artefak)

- `overview-{320,375,768,1024,1440}.png` + `overview-dark-*` — komposisi Revision 2
  light dan dark pada lima lebar viewport (modul portfolio charcoal dominan 7×2,
  modul market/strategy tinted 5×2, row ringkas risk/discovery/activity).
- `discover-{...}.png` + `discover-dark-*` — halaman Discover dengan toolbar ringkas,
  judul sentence-case, angka tabel sans tabular.
- `compare-overview-1440.png`, `compare-overview-dark-1440.png`,
  `compare-overview-375.png`, `compare-discover-1440.png` — komposit side-by-side
  **before (main, rev 1) / after (Revision 2)**; sumbernya adalah evidence rev-1 yang
  sudah ter-commit di `../soft-bento/`. File `.html` sumber komposit ikut disimpan.
- `interaction-recording.webm` + still `interaction-*.png` — rekaman micro-interaksi:
  hover tile, press tombol, toggle tema, pindah rute, filter, search.
- `state-halted-1280.png`, `state-meta-missing-1280.png` — keadaan jujur: kill switch
  STOPPED (badge filled) dan meta discovery tidak tersedia ("Unavailable", bukan 0).
- `reduced-motion-1280.png` — bukti `prefers-reduced-motion`: lift/press 0px,
  durasi transisi ≈0 (`1e-05s`).
- `results.json` — log lengkap: screenshot, hasil axe per halaman, probe layout
  (overflow), state yang direkam.

## Verifikasi yang tercakup artefak ini

- axe (wcag2a/2aa/21a/21aa): **0 pelanggaran** di 20 kombinasi halaman × viewport × tema.
- Layout: **0 horizontal overflow** di semua lebar yang dipindai (320–1440).
- Bottom nav mobile: 5 item berlabel (Overview · Discover · Portfolio · Risk · More).
- Reduced motion: token lift/press collapse ke 0px.

## Yang TIDAK tercakup di sini

Pass screen reader nyata (VoiceOver/NVDA), interaksi sentuh di perangkat fisik, dan
pemeriksaan halaman More selain reachability-nya — masih menunggu verifikasi Probe.
