/**
 * Revision 3 §7 baseline harness — sticky navigation vs screenshot stitching.
 *
 * CEO brief §7: the supplied full-page dark screenshot shows "displaced sticky
 * navigation and large empty regions". This harness decides between
 * ARTIFACT (screenshot stitching) and BUG NYATA (genuine layout bug) with
 * numbers, by comparing what the LIVE viewport shows at several scroll
 * offsets against what the full-page capture contains, plus browser-zoom
 * emulation (80 / 100 / 125%) and §1 module-height baseline measurements.
 *
 * Method notes:
 * - Zoom emulation: Chrome page zoom shrinks the CSS-px viewport
 *   (window.innerWidth = physical / zoom). Playwright's setViewportSize sets
 *   CSS px directly, so viewport = round(1440/zoom) x round(900/zoom)
 *   reproduces the same CSS layout (media queries included). Screenshots are
 *   taken at DPR 1; geometry comes from getBoundingClientRect in CSS px.
 * - Pixel analysis (band scans, uniform-run detection, full-vs-viewport
 *   comparisons) runs on a canvas inside the page; no image libs needed.
 * - The API must be the real local PAPER API; no route interception anywhere.
 *
 * Usage: start the local PAPER API and `vite preview` (TRIDENT_API_URL), then
 *   node apps/web/e2e/rev3-baseline.mjs [baseUrl] [outDir]
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import { chromium } from '@playwright/test';

const BASE = process.argv[2] ?? 'http://127.0.0.1:4773';
const OUT = process.argv[3] ?? new URL('../../../docs/design/evidence/rev3/', import.meta.url).pathname;
const SCROLL_FRACTIONS = [0, 0.25, 0.5, 0.75, 1];

await mkdir(OUT, { recursive: true });

const commit = (() => {
  try {
    return execSync('git rev-parse --short HEAD', { cwd: new URL('../../..', import.meta.url).pathname }).toString().trim();
  } catch {
    return 'unknown';
  }
})();

const browser = await chromium.launch();
const results = { meta: { base: BASE, commit, when: new Date().toISOString(), method: 'live viewport vs full-page capture; zoom = CSS viewport / zoom factor' }, api: {}, desktopLight: {}, desktopDark: {}, mobileLight: {}, zoom: {}, tiles: {} };

/* ---------- API health proof (real local PAPER API) ---------- */
results.api = await (await fetch(`${BASE}/health`)).json();

/* ---------- measurement helpers (run in page) ---------- */
const measureNav = (page) =>
  page.evaluate(() => {
    const rect = (sel) => {
      const el = document.querySelector(sel);
      if (el === null) return null;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return {
        top: +r.top.toFixed(1), bottom: +r.bottom.toFixed(1), left: +r.left.toFixed(1),
        right: +r.right.toFixed(1), width: +r.width.toFixed(1), height: +r.height.toFixed(1),
        position: cs.position, display: cs.display, bg: cs.backgroundColor, zIndex: cs.zIndex,
      };
    };
    const inner = {
      w: window.innerWidth, h: window.innerHeight,
      scrollY: +window.scrollY.toFixed(1),
      docH: document.documentElement.scrollHeight,
      maxScroll: +(document.documentElement.scrollHeight - window.innerHeight).toFixed(1),
    };
    const links = [...document.querySelectorAll('.sidebar__nav .nav-link, .sidebar__foot *')].map((el) => {
      const r = el.getBoundingClientRect();
      return { label: (el.textContent ?? '').trim().slice(0, 24), top: +r.top.toFixed(0), bottom: +r.bottom.toFixed(0) };
    });
    const navVisible = links.filter((l) => l.bottom > 0 && l.top < inner.h).length;
    const contentRects = [...document.querySelectorAll('.topbar, .shell__main .page > *')].map((el) => el.getBoundingClientRect()).filter((r) => r.height > 0 && r.bottom > 0 && r.top < inner.h);
    const contentBottom = contentRects.length > 0 ? Math.max(...contentRects.map((r) => r.bottom)) : 0;
    return { inner, topbar: rect('.topbar'), sidebar: rect('.sidebar'), bottomNav: rect('.bottom-nav'), navLinks: { total: links.length, visible: navVisible }, trailingEmptyPx: +(inner.h - contentBottom).toFixed(1) };
  });

const scrollToY = async (page, y) => {
  await page.evaluate((t) => window.scrollTo({ top: t, behavior: 'instant' }), y);
  await page.waitForTimeout(120);
};

const captureSet = async (page, label, out) => {
  // viewport screenshots at 0 / mid / max scroll + rect table at every offset
  const table = [];
  const max = (await measureNav(page)).inner.maxScroll;
  for (const f of SCROLL_FRACTIONS) {
    const y = Math.round(max * f);
    await scrollToY(page, y);
    const m = await measureNav(page);
    m.requestedScrollY = y;
    table.push(m);
    if (f === 0 || f === 0.5 || f === 1) {
      const name = `${out}${label}-vp-s${Math.round(f * 100)}.png`;
      await page.screenshot({ path: `${OUT}${name}` });
      table[table.length - 1].screenshot = name;
    }
  }
  await scrollToY(page, 0);
  return table;
};

/* ---------- pixel analysis helpers (run in page) ---------- */
const parseRgb = (css) => {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(css);
  return m === null ? null : [Number(m[1]), Number(m[2]), Number(m[3])];
};

function scanFn(page, fn, arg) {
  return page.evaluate(
    async ({ code, arg: a }) => {
      const load = async (b64) => {
        const img = new Image();
        img.src = `data:image/png;base64,${b64}`;
        await img.decode();
        const c = document.createElement('canvas');
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0);
        return { w: c.width, h: c.height, d: ctx.getImageData(0, 0, c.width, c.height).data };
      };
      // eslint-disable-next-line no-new-func
      const run = new Function('load', `return (async () => { ${code} })()`);
      return run(load);
    },
    { code: `const arg = ${JSON.stringify(arg)}; const data = arg; ${fn}`, arg },
  );
}

/** Rows where >= frac of sampled x match color (tol per channel). */
const codeBands = `
  const img = await load(data.b64);
  const [cr, cg, cb] = data.color;
  const tol = data.tol ?? 10;
  const x0 = Math.floor(img.w * data.xFrom), x1 = Math.floor(img.w * data.xTo);
  const step = Math.max(1, Math.floor((x1 - x0) / 40));
  const hits = [];
  for (let y = 0; y < img.h; y++) {
    let n = 0, t = 0;
    for (let x = x0; x < x1; x += step) {
      const i = (y * img.w + x) * 4; t++;
      if (Math.abs(img.d[i] - cr) <= tol && Math.abs(img.d[i + 1] - cg) <= tol && Math.abs(img.d[i + 2] - cb) <= tol) n++;
    }
    if (t > 0 && n / t >= data.minFrac) hits.push(y);
  }
  const runs = [];
  for (const y of hits) {
    const last = runs[runs.length - 1];
    if (last && y === last.end + 1) last.end = y; else runs.push({ start: y, end: y });
  }
  return { w: img.w, h: img.h, runs: runs.filter(r => r.end - r.start + 1 >= (data.minRun ?? 8)) };
`;

/** Rows where the column slice [xFrom..xTo] is uniform (empty region scan). */
const codeUniform = `
  const img = await load(data.b64);
  const x0 = Math.floor(img.w * data.xFrom), x1 = Math.floor(img.w * data.xTo);
  const n = 12, step = Math.max(1, Math.floor((x1 - x0) / n));
  const uniform = (y) => {
    let min = [255, 255, 255], max = [0, 0, 0];
    for (let x = x0; x < x1; x += step) {
      const i = (y * img.w + x) * 4;
      for (let k = 0; k < 3; k++) { const v = img.d[i + k]; if (v < min[k]) min[k] = v; if (v > max[k]) max[k] = v; }
    }
    for (let k = 0; k < 3; k++) if (max[k] - min[k] > (data.tol ?? 6)) return false;
    return true;
  };
  const runs = [];
  for (let y = 0; y < img.h; y++) {
    if (!uniform(y)) continue;
    const last = runs[runs.length - 1];
    if (last && y === last.end + 1) last.end = y; else runs.push({ start: y, end: y });
  }
  const kept = runs.filter(r => r.end - r.start + 1 >= (data.minRun ?? 60));
  const sample = (y) => { const i = (y * img.w + Math.floor((x0 + x1) / 2)) * 4; return [img.d[i], img.d[i + 1], img.d[i + 2]]; };
  return { w: img.w, h: img.h, runs: kept.map(r => ({ ...r, len: r.end - r.start + 1, color: sample(r.start) })) };
`;

/** % of differing pixels between full-page rows [docY..docY+len) and viewport rows [vpY..vpY+len). */
const codeDiff = `
  const full = await load(data.fullB64), vp = await load(data.vpB64);
  const tol = data.tol ?? 12;
  let diff = 0, total = 0;
  const x0 = Math.floor(full.w * (data.xFrom ?? 0)), x1 = Math.floor(full.w * (data.xTo ?? 1));
  const step = Math.max(1, Math.floor((x1 - x0) / 120));
  for (let i = 0; i < data.len; i++) {
    const fy = data.docY + i, vy = data.vpY + i;
    if (fy < 0 || fy >= full.h || vy < 0 || vy >= vp.h) continue;
    for (let x = x0; x < x1; x += step) {
      const a = (fy * full.w + x) * 4, b = (vy * vp.w + x) * 4;
      total++;
      if (Math.abs(full.d[a] - vp.d[b]) > tol || Math.abs(full.d[a + 1] - vp.d[b + 1]) > tol || Math.abs(full.d[a + 2] - vp.d[b + 2]) > tol) diff++;
    }
  }
  return { pctDiff: total === 0 ? null : +((diff / total) * 100).toFixed(1), sampled: total };
`;

const toB64 = (path) => execSync(`base64 -w0 ${JSON.stringify(path)}`).toString();

/* ================= Desktop 1440x900, light ================= */
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.getByTestId('overview-equity-value').waitFor({ state: 'visible', timeout: 20_000 });

  results.desktopLight.viewportTable = await captureSet(page, 'd1440-light', 'rev3-');

  // §1 baseline: tile heights, min-height, heading->value gap, internal slack
  results.tiles.light = await page.evaluate(() =>
    [...document.querySelectorAll('.bento-tile, .status-strip')].map((el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const title = el.querySelector('.bento-tile__title, .status-strip__label');
      const value = el.querySelector('.bento-figure__value--hero, .bento-figure__value, .status-strip__value');
      const last = el.lastElementChild;
      const tr = title?.getBoundingClientRect() ?? null;
      const vr = value?.getBoundingClientRect() ?? null;
      const lr = last?.getBoundingClientRect() ?? null;
      return {
        testid: el.getAttribute('data-testid') ?? el.className,
        height: +r.height.toFixed(1),
        cssMinHeight: cs.minHeight,
        headingToValueGapPx: tr && vr ? +(vr.top - tr.bottom).toFixed(1) : null,
        internalSlackPx: lr ? +(r.bottom - lr.bottom).toFixed(1) : null,
      };
    }));

  // full-page light capture + scans
  const fullPath = `${OUT}rev3-d1440-light-full.png`;
  await page.screenshot({ path: fullPath, fullPage: true });
  const topbarBg = parseRgb(results.desktopLight.viewportTable[0].topbar.bg);
  const sidebarW = results.desktopLight.viewportTable[0].sidebar.width;
  const b64 = toB64(fullPath);
  results.desktopLight.fullpage = {
    file: 'rev3-d1440-light-full.png',
    topbarColor: topbarBg,
    topbarBands: await scanFn(page, codeBands, { b64, color: topbarBg, xFrom: sidebarW / 1440, xTo: 0.99, minFrac: 0.9, minRun: 8, tol: 10 }),
    // effective rgba(23,23,23,.12) hairline over white — the topbar's
    // bottom border spans the full main column, unlike tile borders.
    topbarHairline: await scanFn(page, codeBands, { b64, color: [227, 227, 227], xFrom: sidebarW / 1440, xTo: 0.99, minFrac: 0.95, minRun: 1, tol: 4 }),
    sidebarUniformRuns: await scanFn(page, codeUniform, { b64, xFrom: 0.005, xTo: (sidebarW - 8) / 1440, minRun: 60, tol: 6 }),
    mainUniformRuns: await scanFn(page, codeUniform, { b64, xFrom: (sidebarW + 8) / 1440, xTo: 0.99, minRun: 120, tol: 6 }),
  };

  // full-vs-viewport comparison at mid scroll: the topbar band the LIVE view
  // shows at viewport rows [0..H] must appear in the full-page image at doc
  // rows [scrollY..scrollY+H] — stitching artifacts break exactly here.
  const vpMid = `${OUT}rev3-d1440-light-vp-s50.png`;
  const mid = results.desktopLight.viewportTable.find((t) => t.requestedScrollY > 0 && t.requestedScrollY < t.inner.maxScroll);
  results.desktopLight.fullVsViewport = await scanFn(page, codeDiff, {
    fullB64: b64, vpB64: toB64(vpMid),
    docY: Math.round(mid.requestedScrollY), vpY: 0, len: Math.round(mid.topbar.height),
    xFrom: sidebarW / 1440, xTo: 0.99, tol: 12,
  });
  results.desktopLight.fullVsViewport.band = `topbar rows doc ${Math.round(mid.requestedScrollY)}..${Math.round(mid.requestedScrollY + mid.topbar.height)} vs viewport rows 0..${Math.round(mid.topbar.height)}`;
  // control: a static content band at the same document position (same live
  // text updates, no sticky overlay) — isolates stitching mismatch from
  // data that legitimately changed between captures.
  const ctlY = Math.round(mid.topbar.height) + 30;
  results.desktopLight.fullVsViewport.control = await scanFn(page, codeDiff, {
    fullB64: b64, vpB64: toB64(vpMid),
    docY: Math.round(mid.requestedScrollY) + ctlY, vpY: ctlY, len: 100,
    xFrom: sidebarW / 1440, xTo: 0.99, tol: 12,
  });

  await ctx.close();
}

/* ================= Desktop 1440x900, dark (CEO's complaint) ================= */
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.getByTestId('overview-equity-value').waitFor({ state: 'visible', timeout: 20_000 });
  await page.evaluate(() => { document.documentElement.dataset['theme'] = 'dark'; });
  await page.waitForTimeout(250);

  results.desktopDark.viewportTable = await captureSet(page, 'd1440-dark', 'rev3-');
  const themeApplied = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  results.desktopDark.bodyBg = themeApplied;

  const fullPath = `${OUT}rev3-d1440-dark-full.png`;
  await page.screenshot({ path: fullPath, fullPage: true });
  const topbarBg = parseRgb(results.desktopDark.viewportTable[0].topbar.bg);
  const sidebarW = results.desktopDark.viewportTable[0].sidebar.width;
  const b64 = toB64(fullPath);
  results.desktopDark.fullpage = {
    file: 'rev3-d1440-dark-full.png',
    topbarColor: topbarBg,
    topbarBands: await scanFn(page, codeBands, { b64, color: topbarBg, xFrom: sidebarW / 1440, xTo: 0.99, minFrac: 0.9, minRun: 8, tol: 10 }),
    // effective rgba(255,255,255,.1) hairline over #202122 topbar surface
    topbarHairline: await scanFn(page, codeBands, { b64, color: [54, 53, 56], xFrom: sidebarW / 1440, xTo: 0.99, minFrac: 0.95, minRun: 1, tol: 4 }),
    sidebarUniformRuns: await scanFn(page, codeUniform, { b64, xFrom: 0.005, xTo: (sidebarW - 8) / 1440, minRun: 60, tol: 6 }),
    mainUniformRuns: await scanFn(page, codeUniform, { b64, xFrom: (sidebarW + 8) / 1440, xTo: 0.99, minRun: 120, tol: 6 }),
  };

  const vpMid = `${OUT}rev3-d1440-dark-vp-s50.png`;
  const mid = results.desktopDark.viewportTable.find((t) => t.requestedScrollY > 0 && t.requestedScrollY < t.inner.maxScroll);
  results.desktopDark.fullVsViewport = await scanFn(page, codeDiff, {
    fullB64: b64, vpB64: toB64(vpMid),
    docY: Math.round(mid.requestedScrollY), vpY: 0, len: Math.round(mid.topbar.height),
    xFrom: sidebarW / 1440, xTo: 0.99, tol: 12,
  });
  results.desktopDark.fullVsViewport.band = `topbar rows doc ${Math.round(mid.requestedScrollY)}..${Math.round(mid.requestedScrollY + mid.topbar.height)} vs viewport rows 0..${Math.round(mid.topbar.height)}`;
  const ctlY = Math.round(mid.topbar.height) + 30;
  results.desktopDark.fullVsViewport.control = await scanFn(page, codeDiff, {
    fullB64: b64, vpB64: toB64(vpMid),
    docY: Math.round(mid.requestedScrollY) + ctlY, vpY: ctlY, len: 100,
    xFrom: sidebarW / 1440, xTo: 0.99, tol: 12,
  });

  await ctx.close();
}

/* ================= Mobile 375x667, light (fixed bottom-nav) ================= */
{
  const ctx = await browser.newContext({ viewport: { width: 375, height: 667 } });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.getByTestId('overview-equity-value').waitFor({ state: 'visible', timeout: 20_000 });

  results.mobileLight.viewportTable = await captureSet(page, 'm375-light', 'rev3-');

  const fullPath = `${OUT}rev3-m375-light-full.png`;
  await page.screenshot({ path: fullPath, fullPage: true });
  const topbarBg = parseRgb(results.mobileLight.viewportTable[0].topbar.bg);
  const navBg = parseRgb(results.mobileLight.viewportTable[0].bottomNav.bg);
  const b64 = toB64(fullPath);
  results.mobileLight.fullpage = {
    file: 'rev3-m375-light-full.png',
    topbarColor: topbarBg, bottomNavColor: navBg,
    topbarBands: await scanFn(page, codeBands, { b64, color: topbarBg, xFrom: 0.02, xTo: 0.98, minFrac: 0.9, minRun: 8, tol: 10 }),
    bottomNavBands: await scanFn(page, codeBands, { b64, color: navBg, xFrom: 0.02, xTo: 0.98, minFrac: 0.9, minRun: 8, tol: 10 }),
    navHairline: await scanFn(page, codeBands, { b64, color: [227, 227, 227], xFrom: 0.02, xTo: 0.98, minFrac: 0.95, minRun: 1, tol: 4 }),
    mainUniformRuns: await scanFn(page, codeUniform, { b64, xFrom: 0.02, xTo: 0.98, minRun: 120, tol: 6 }),
  };

  const mid = results.mobileLight.viewportTable.find((t) => t.requestedScrollY > 0 && t.requestedScrollY < t.inner.maxScroll);
  const vpMid = `${OUT}rev3-m375-light-vp-s50.png`;
  const navH = Math.round(results.mobileLight.viewportTable[0].bottomNav.height);
  results.mobileLight.fullVsViewport = {
    topbar: await scanFn(page, codeDiff, { fullB64: b64, vpB64: toB64(vpMid), docY: Math.round(mid.requestedScrollY), vpY: 0, len: Math.round(mid.topbar.height), tol: 12 }),
    bottomNav: await scanFn(page, codeDiff, { fullB64: b64, vpB64: toB64(vpMid), docY: Math.round(mid.requestedScrollY), vpY: 667 - navH, len: navH, tol: 12 }),
    control: await scanFn(page, codeDiff, { fullB64: b64, vpB64: toB64(vpMid), docY: Math.round(mid.requestedScrollY) + Math.round(mid.topbar.height) + 30, vpY: Math.round(mid.topbar.height) + 30, len: 100, tol: 12 }),
  };
  results.mobileLight.fullVsViewport.note = 'pctDiff = how far the full-page image differs from the LIVE viewport at the same document position, inside the sticky/fixed band';

  await ctx.close();
}

/* ================= Zoom 80% / 125% (CSS viewport emulation) ================= */
for (const z of [0.8, 1.25]) {
  const w = Math.round(1440 / z);
  const h = Math.round(900 / z);
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.getByTestId('overview-equity-value').waitFor({ state: 'visible', timeout: 20_000 });
  const table = await captureSet(page, `z${Math.round(z * 100)}`, 'rev3-');
  results.zoom[`${Math.round(z * 100)}pct`] = { emulatedViewport: `${w}x${h}`, viewportTable: table };
  await ctx.close();
}

await browser.close();

/* ---------- verdict ---------- */
const checks = [];
const push = (name, pass, detail) => checks.push({ name, pass, detail });

for (const [label, t] of [['desktop-light', results.desktopLight.viewportTable], ['desktop-dark', results.desktopDark.viewportTable], ['mobile', results.mobileLight.viewportTable]]) {
  for (const row of t) {
    const s = row.requestedScrollY;
    if (row.topbar.position === 'sticky') push(`${label} topbar pinned @scroll ${s}`, Math.abs(row.topbar.top) <= 1, `top=${row.topbar.top} (want 0±1)`);
    if (row.sidebar !== null && row.sidebar.display !== 'none') {
      push(`${label} sidebar pinned @scroll ${s}`, Math.abs(row.sidebar.top) <= 1 && Math.abs(row.sidebar.height - row.inner.h) <= 1, `top=${row.sidebar.top} height=${row.sidebar.height} vs innerH=${row.inner.h}`);
      push(`${label} sidebar links reachable @scroll ${s}`, row.navLinks.visible === row.navLinks.total, `${row.navLinks.visible}/${row.navLinks.total} inside viewport`);
    }
    if (row.bottomNav !== null && row.bottomNav.display !== 'none') {
      push(`${label} bottom-nav pinned @scroll ${s}`, Math.abs(row.bottomNav.bottom - row.inner.h) <= 1, `bottom=${row.bottomNav.bottom} vs innerH=${row.inner.h}`);
    }
  }
}
for (const [z, data] of Object.entries(results.zoom)) {
  for (const row of data.viewportTable) {
    push(`zoom ${z} topbar pinned @scroll ${row.requestedScrollY}`, Math.abs(row.topbar.top) <= 1, `top=${row.topbar.top}`);
    if (row.sidebar !== null && row.sidebar.display !== 'none') push(`zoom ${z} sidebar pinned @scroll ${row.requestedScrollY}`, Math.abs(row.sidebar.top) <= 1 && Math.abs(row.sidebar.height - row.inner.h) <= 1, `top=${row.sidebar.top} height=${row.sidebar.height}`);
    if (row.bottomNav !== null && row.bottomNav.display !== 'none') push(`zoom ${z} bottom-nav pinned @scroll ${row.requestedScrollY}`, Math.abs(row.bottomNav.bottom - row.inner.h) <= 1, `bottom=${row.bottomNav.bottom}`);
  }
}

const artifactEvidence = [];
const bugEvidence = [];
for (const c of checks) (c.pass ? artifactEvidence : bugEvidence).push(c);

// full-page vs live: a band the live view shows at EVERY scroll offset but
// that the full-page image contains only near the document top (or a single
// displaced run) = stitching artifact. The control band (static content,
// same document rows) must stay low, otherwise the diff is just live text
// updating between captures.
const darkFv = results.desktopDark.fullVsViewport ?? {};
const lightFv = results.desktopLight.fullVsViewport ?? {};
const stickyHigh = (darkFv.pctDiff ?? 0) > 50 || (lightFv.pctDiff ?? 0) > 50;
const controlLow = (darkFv.control?.pctDiff ?? 100) < Math.max(darkFv.pctDiff ?? 0, (lightFv.pctDiff ?? 0)) - 20;
const sidebarEmpty = [results.desktopLight, results.desktopDark].some(
  (r) => (r.fullpage?.sidebarUniformRuns?.runs ?? []).some((run) => run.len > 200),
);
const navBandDisplaced =
  (results.mobileLight.fullpage?.bottomNavBands?.runs ?? []).some((r) => r.start > 100 && r.start < (results.mobileLight.fullpage?.bottomNavBands?.h ?? 0) - 50) &&
  ((results.mobileLight.fullVsViewport?.bottomNav?.pctDiff ?? 0) > 50);

const pageVerdict =
  bugEvidence.length > 0
    ? 'BUG NYATA'
    : artifactEvidence.length > 0 && ((stickyHigh && controlLow) || sidebarEmpty || navBandDisplaced)
      ? 'ARTIFACT'
      : 'INDETERMINATE';

results.verdict = {
  pageVerdict,
  liveChecksPassed: artifactEvidence.length,
  liveChecksFailed: bugEvidence.length,
  failedChecks: bugEvidence,
  reasoning: 'Live checks = getBoundingClientRect of sticky/fixed bands at 5 scroll offsets x 3 themes/viewports x 3 zoom levels. Full-vs-viewport pctDiff = mismatch of the full-page capture against the live viewport inside the sticky band at the same document position.',
};

await writeFile(`${OUT}rev3-baseline-results.json`, `${JSON.stringify(results, null, 2)}\n`);
console.log(JSON.stringify({ verdict: results.verdict, api: results.api, fullVsViewport: { light: results.desktopLight.fullVsViewport, dark: results.desktopDark.fullVsViewport, mobile: results.mobileLight.fullVsViewport }, hairlines: { light: results.desktopLight.fullpage.topbarHairline, dark: results.desktopDark.fullpage.topbarHairline, mobileNav: results.mobileLight.fullpage.navHairline }, sidebarUniform: { light: results.desktopLight.fullpage.sidebarUniformRuns, dark: results.desktopDark.fullpage.sidebarUniformRuns }, topbarBands: { light: results.desktopLight.fullpage.topbarBands, dark: results.desktopDark.fullpage.topbarBands, mobile: results.mobileLight.fullpage.topbarBands }, bottomNavBands: results.mobileLight.fullpage.bottomNavBands, tiles: results.tiles.light }, null, 2));
