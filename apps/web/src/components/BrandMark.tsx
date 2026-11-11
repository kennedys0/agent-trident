import type { ReactNode } from 'react';

/**
 * The official TRIDENT mark, used as supplied: a square 2000×2000 PNG whose trident
 * glyph keeps its own proportions. The two transparent variants let the mark sit on
 * the page surface instead of carrying a background that would fight the theme:
 * black on the light canvas, white on the dark one. Only the variant for the active
 * theme is rendered, so the accessible name is announced once.
 */
export function BrandMark(): ReactNode {
  return (
    <span className="brand-mark" role="img" aria-label="TRIDENT" data-testid="brand-mark">
      <img
        className="brand-mark__img brand-mark__img--light"
        src="/brand/logo-black-transparent.png"
        alt=""
        aria-hidden="true"
        width={40}
        height={40}
        decoding="async"
      />
      <img
        className="brand-mark__img brand-mark__img--dark"
        src="/brand/logo-white-transparent.png"
        alt=""
        aria-hidden="true"
        width={40}
        height={40}
        decoding="async"
      />
    </span>
  );
}