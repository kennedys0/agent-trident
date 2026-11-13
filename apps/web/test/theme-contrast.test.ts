import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Design-contract tests for the Robinhood Soft Bento exploration (issue #39).
 *
 * They read the real stylesheets and assert the invariants Pixel's spec
 * (docs/design/soft-bento-tokens.md + soft-bento-motion.md) makes testable:
 * WCAG contrast for every fixed foreground/background pair in both themes,
 * brand lime never carrying a status meaning, neo-brutalism gone (hairline
 * borders, soft zero-offset shadows), and the single motion contract.
 */
const baseCss = readFileSync(resolve(process.cwd(), 'src/styles/base.css'), 'utf8');
const tokensCss = readFileSync(resolve(process.cwd(), 'src/styles/tokens.css'), 'utf8');
const discoverCss = readFileSync(resolve(process.cwd(), 'src/styles/discover.css'), 'utf8');
const allCss = `${baseCss}\n${tokensCss}\n${discoverCss}`;

function cssBlock(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  if (match?.[1] === undefined) {
    throw new Error(`Missing CSS rule for ${selector}`);
  }
  return match[1];
}

function tokenBlock(opener: string): string {
  const match = new RegExp(`${opener.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(tokensCss);
  if (match?.[1] === undefined) {
    throw new Error(`Missing token block ${opener}`);
  }
  return match[1];
}

const lightTokens = tokenBlock(':root');
const darkTokens = tokenBlock("[data-theme='dark']");

function tokenRaw(name: string, theme: 'light' | 'dark'): string | null {
  const block = theme === 'dark' ? darkTokens : lightTokens;
  const match = new RegExp(`--${name}:\\s*([^;]+);`).exec(block);
  return match?.[1]?.trim() ?? null;
}

/** Dark keeps its own tokens but may reuse a light value; fall back honestly. */
function tokenColor(name: string, theme: 'light' | 'dark'): Color {
  const raw = tokenRaw(name, theme) ?? tokenRaw(name, 'light');
  if (raw === null) {
    throw new Error(`Missing colour token --${name}`);
  }
  return parseColor(raw);
}

type Color = { r: number; g: number; b: number; a: number };

function parseColor(raw: string): Color {
  const hex = /^#([0-9a-fA-F]{6})$/.exec(raw.trim());
  if (hex?.[1] !== undefined) {
    return {
      r: Number.parseInt(hex[1].slice(0, 2), 16),
      g: Number.parseInt(hex[1].slice(2, 4), 16),
      b: Number.parseInt(hex[1].slice(4, 6), 16),
      a: 1,
    };
  }
  const rgba = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(raw.trim());
  if (rgba?.[1] !== undefined && rgba[2] !== undefined && rgba[3] !== undefined) {
    return {
      r: Number.parseInt(rgba[1], 10),
      g: Number.parseInt(rgba[2], 10),
      b: Number.parseInt(rgba[3], 10),
      a: rgba[4] === undefined ? 1 : Number.parseFloat(rgba[4]),
    };
  }
  throw new Error(`Unsupported colour literal: ${raw}`);
}

function over(fg: Color, bg: Color): Color {
  return {
    r: fg.a * fg.r + (1 - fg.a) * bg.r,
    g: fg.a * fg.g + (1 - fg.a) * bg.g,
    b: fg.a * fg.b + (1 - fg.a) * bg.b,
    a: 1,
  };
}

function linearChannel(value: number): number {
  const channel = value / 255;
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

function luminance(color: Color): number {
  return 0.2126 * linearChannel(color.r) + 0.7152 * linearChannel(color.g) + 0.0722 * linearChannel(color.b);
}

function contrastRatio(a: Color, b: Color): number {
  const light = Math.max(luminance(a), luminance(b));
  const dark = Math.min(luminance(a), luminance(b));
  return (light + 0.05) / (dark + 0.05);
}

/**
 * True WCAG contrast of fg on bg for a theme. Semi-transparent dark-theme
 * tokens are composited over that theme's canvas first, so the number is what
 * the eye actually sees, not an alpha-blended fiction.
 */
function themeContrast(fgName: string, bgName: string, theme: 'light' | 'dark'): number {
  const canvas = tokenColor('canvas', theme);
  const bg = over(tokenColor(bgName, theme), canvas);
  return contrastRatio(tokenColor(fgName, theme), bg);
}

describe('active navigation contrast (spec §1)', () => {
  it.each([
    ['sidebar pill', ".nav-link[aria-current='page']"],
  ])('%s binds the lime brand pair', (_label, selector) => {
    const block = cssBlock(baseCss, selector);
    expect(block).toMatch(/background:\s*var\(--brand-accent\)/);
    expect(block).toMatch(/color:\s*var\(--brand-on-accent\)/);
  });

  it('bottom navigation active item uses the tinted accent with plain ink', () => {
    const block = cssBlock(baseCss, ".bottom-nav__link[aria-current='page']");
    expect(block).toMatch(/background:\s*var\(--brand-accent-tint\)/);
    expect(block).toMatch(/color:\s*var\(--ink\)/);
  });

  it.each(['light', 'dark'] as const)('brand-on-accent reaches AA on brand-accent in %s theme', (theme) => {
    expect(themeContrast('brand-on-accent', 'brand-accent', theme)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(['light', 'dark'] as const)('ink reaches AA on the active tint over surface in %s theme', (theme) => {
    const surface = tokenColor('surface', theme);
    const tint = over(tokenColor('brand-accent-tint', theme), surface);
    expect(contrastRatio(tokenColor('ink', theme), tint)).toBeGreaterThanOrEqual(4.5);
  });
});

/** Tone name → semantic package (spec §2/§4): names kept, meaning remapped. */
const BADGE_PACKAGES: ReadonlyArray<readonly [string, string]> = [
  ['wait', 'status-stale'],
  ['danger', 'status-negative'],
  ['info', 'status-pending'],
  ['success', 'status-positive'],
  ['muted', 'status-unavailable'],
  ['halted', 'status-halted'],
];

describe('semantic status badges (brand is never a status)', () => {
  it.each(BADGE_PACKAGES)('badge--%s binds the %s package', (tone, pkg) => {
    const block = cssBlock(baseCss, `.badge--${tone}`);
    expect(block).toMatch(new RegExp(`background:\\s*var\\(--${pkg}-bg\\)`));
    expect(block).toMatch(new RegExp(`color:\\s*var\\(--${pkg}-fg\\)`));
    expect(block).toMatch(new RegExp(`border-color:\\s*var\\(--${pkg}-border\\)`));
  });

  it('testnet tone uses the lavender secondary accent, not lime', () => {
    const block = cssBlock(baseCss, '.badge--testnet');
    expect(block).toMatch(/background:\s*var\(--brand-secondary\)/);
    expect(block).toMatch(/color:\s*var\(--brand-on-secondary\)/);
    expect(block).not.toMatch(/--brand-accent[^-]/);
  });

  it.each(BADGE_PACKAGES)('badge--%s text reaches AA on its fill in both themes', (tone, pkg) => {
    for (const theme of ['light', 'dark'] as const) {
      expect(themeContrast(`${pkg}-fg`, `${pkg}-bg`, theme), `${tone}/${theme}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('the lavender accent pair reaches AA in light theme', () => {
    expect(themeContrast('brand-on-secondary', 'brand-secondary', 'light')).toBeGreaterThanOrEqual(4.5);
  });

  it('no badge fill ever uses brand lime', () => {
    for (const tone of ['wait', 'danger', 'info', 'success', 'testnet', 'muted', 'halted', 'neutral']) {
      const match = new RegExp(`\\.badge${tone === 'neutral' ? '' : `--${tone}`}\\s*\\{([^}]*)\\}`).exec(baseCss);
      const block = match?.[1] ?? '';
      expect(block, `badge--${tone}`).not.toMatch(/var\(--brand-accent\)/);
    }
  });

  it('halted is the only filled status: solid critical red at AA', () => {
    expect(tokenRaw('status-halted-bg', 'light')).toBe('#b91c1c');
    expect(themeContrast('status-halted-fg', 'status-halted-bg', 'light')).toBeGreaterThanOrEqual(4.5);
  });
});

describe('soft geometry (neo-brutalism removed)', () => {
  it('borders are 1px hairlines', () => {
    expect(tokenRaw('border-width', 'light')).toBe('1px');
  });

  it('no hard offset shadow survives in any stylesheet', () => {
    expect(allCss).not.toMatch(/\d+px\s+\d+px\s+0\s/);
  });

  it('elevation tokens are zero-offset soft shadows', () => {
    for (const name of ['shadow-sm', 'shadow-md', 'shadow-lg']) {
      expect(tokenRaw(name, 'light'), name).toMatch(/^0\s/);
    }
  });

  it('radius scale is the spec 8/12/16/pill', () => {
    expect(tokenRaw('radius-sm', 'light')).toBe('8px');
    expect(tokenRaw('radius', 'light')).toBe('12px');
    expect(tokenRaw('radius-lg', 'light')).toBe('16px');
    expect(tokenRaw('radius-pill', 'light')).toBe('999px');
  });

  it('dark mode carries its own tokens instead of inverting light', () => {
    expect(tokenRaw('canvas', 'dark')).not.toBe(tokenRaw('canvas', 'light'));
    expect(tokenRaw('surface', 'dark')).not.toBe(tokenRaw('surface', 'light'));
    expect(tokenRaw('ink', 'dark')).not.toBe(tokenRaw('ink', 'light'));
    expect(tokenRaw('canvas', 'dark')).not.toBe('#000000');
  });
});

describe('motion contract (soft-bento-motion.md)', () => {
  it('keeps the three-tier duration scale and the single easing', () => {
    // Revision 2 ranges (CEO brief §5): press 80–140ms, hover 150–200ms,
    // panel/page 180–240ms — 100/170/220 sits inside all three.
    expect(tokenRaw('motion-fast', 'light')).toBe('100ms');
    expect(tokenRaw('motion', 'light')).toBe('170ms');
    expect(tokenRaw('motion-slow', 'light')).toBe('220ms');
    expect(tokenRaw('ease', 'light')).toBe('cubic-bezier(0.2, 0, 0, 1)');
  });

  it('uses exactly one cubic-bezier across all stylesheets', () => {
    const easings = [...allCss.matchAll(/cubic-bezier\([^)]*\)/g)].map((match) => match[0]);
    expect(easings.length).toBeGreaterThan(0);
    for (const easing of easings) {
      expect(easing).toBe('cubic-bezier(0.2, 0, 0, 1)');
    }
  });

  it('has no bounce or elastic easing words', () => {
    expect(allCss).not.toMatch(/bounce|elastic|back-out/i);
  });

  it('hover lift and press travel go through the collapseable tokens', () => {
    expect(tokenRaw('lift', 'light')).toBe('-2px');
    expect(tokenRaw('press', 'light')).toBe('1px');
    expect(cssBlock(baseCss, '.btn:active:not(:disabled)')).toMatch(/translateY\(var\(--press\)\)/);
    expect(cssBlock(baseCss, '.bento-tile--interactive:hover')).toMatch(/translateY\(var\(--lift\)\)/);
  });

  it('page transition exists and runs on the slow tier', () => {
    expect(baseCss).toContain('@keyframes page-in');
    expect(cssBlock(baseCss, '.page')).toMatch(/animation:\s*page-in var\(--motion-slow\)/);
  });

  it('reduced motion zeroes travel in tokens and transitions in base', () => {
    const reduceBlock = /prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?\n\}/.exec(tokensCss)?.[0] ?? '';
    expect(reduceBlock).toMatch(/--lift:\s*0px/);
    expect(reduceBlock).toMatch(/--press:\s*0px/);
    const baseReduce = /prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?\n\}/.exec(baseCss)?.[0] ?? '';
    expect(baseReduce).toMatch(/transition-duration:\s*0\.01ms/);
    expect(baseReduce).toMatch(/transform:\s*none/);
  });
});

describe('charcoal feature panel PnL contrast (QA P-1)', () => {
  it.each(['light', 'dark'] as const)(
    'feature-positive-fg reaches AA on feature-bg in %s theme',
    (theme) => {
      expect(themeContrast('feature-positive-fg', 'feature-bg', theme)).toBeGreaterThanOrEqual(4.5);
    },
  );

  it.each(['light', 'dark'] as const)(
    'feature-negative-fg reaches AA on feature-bg in %s theme',
    (theme) => {
      expect(themeContrast('feature-negative-fg', 'feature-bg', theme)).toBeGreaterThanOrEqual(4.5);
    },
  );

  it('keeps the feature PnL pair separate from the lime accent', () => {
    for (const theme of ['light', 'dark'] as const) {
      expect(tokenRaw('feature-positive-fg', theme)).not.toBe(tokenRaw('brand-accent', theme));
      expect(tokenRaw('feature-negative-fg', theme)).not.toBe(tokenRaw('brand-accent', theme));
    }
  });

  it('binds the panel scope to the feature pair with a scoped override', () => {
    for (const [modifier, token] of [
      ['--positive', '--feature-positive-fg'],
      ['--negative', '--feature-negative-fg'],
    ] as const) {
      const block = cssBlock(baseCss, `.bento-tile--portfolio .bento-figure__value${modifier}`);
      expect(block).toMatch(new RegExp(`color:\\s*var\\(${token}\\)`));
    }
  });

  it('leaves semantic status fg outside the panel untouched', () => {
    expect(tokenRaw('status-positive-fg', 'light')).toBe('#065f46');
    expect(tokenRaw('status-negative-fg', 'light')).toBe('#991b1b');
  });
});
