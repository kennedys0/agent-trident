import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const baseCss = readFileSync(resolve(process.cwd(), 'src/styles/base.css'), 'utf8');
const tokensCss = readFileSync(resolve(process.cwd(), 'src/styles/tokens.css'), 'utf8');

function cssBlock(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(baseCss);
  if (match?.[1] === undefined) {
    throw new Error(`Missing CSS rule for ${selector}`);
  }
  return match[1];
}

function tokenHex(name: string): string {
  const match = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(tokensCss);
  if (match?.[1] === undefined) {
    throw new Error(`Missing six-digit colour token --${name}`);
  }
  return match[1];
}

function linearChannel(value: number): number {
  const channel = value / 255;
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const red = Number.parseInt(hex.slice(1, 3), 16);
  const green = Number.parseInt(hex.slice(3, 5), 16);
  const blue = Number.parseInt(hex.slice(5, 7), 16);
  return 0.2126 * linearChannel(red) + 0.7152 * linearChannel(green) + 0.0722 * linearChannel(blue);
}

function contrastRatio(foreground: string, background: string): number {
  const light = Math.max(luminance(foreground), luminance(background));
  const dark = Math.min(luminance(foreground), luminance(background));
  return (light + 0.05) / (dark + 0.05);
}

describe('active navigation contrast', () => {
  it.each([
    ['sidebar', ".nav-link[aria-current='page']"],
    ['bottom navigation', ".bottom-nav__link[aria-current='page']"],
  ])('uses the status foreground token for %s', (_label, selector) => {
    expect(cssBlock(selector)).toMatch(/color:\s*var\(--status-ink\)/);
  });

  it('keeps the active wait pair at WCAG AA contrast in dark theme', () => {
    const ratio = contrastRatio(tokenHex('status-ink'), tokenHex('wait'));
    expect(ratio).toBeGreaterThanOrEqual(4.5);
    expect(ratio).toBeCloseTo(14.78, 2);
  });

  it('preserves the existing active foreground in light theme', () => {
    expect(tokenHex('status-ink')).toBe(tokenHex('ink'));
  });
});
