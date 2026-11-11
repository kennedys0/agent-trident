# Brand assets

Official TRIDENT artwork, shipped unchanged. Source archive `Trident.zip`
(SHA-256 `ba3b37f5161f45e6a051adc42cf15d3444fdb4a8af3b6c9b0344c9cbcb94ca06`),
extracted after checking every entry for absolute paths, `..` traversal and
Windows drive/ADS names.

| File | Source entry | Size | Format | Used for |
|---|---|---|---|---|
| `logo-black-transparent.png` | `logo_black_nobg.png` | 2000×2000 | PNG, RGBA | The mark on the light canvas (`[data-theme='light']`) |
| `logo-white-transparent.png` | `logo_white_nobg.png` | 2000×2000 | PNG, RGBA | The mark on the dark canvas (`[data-theme='dark']`) |
| `seo-light.png` | `seo.png` | 2000×2000 | PNG, RGB | `og:image` / `twitter:image`, light background `#F1F0F0` |
| `seo-green.png` | `seo_2.png` | 2000×2000 | PNG, RGB | Alternate social card on the Robinhood green `#D2FF08`; kept for campaigns, not referenced yet |
| `../favicon.ico` | `favicon.ico` | 32×32 | ICO, 32 bpp | `rel="icon"`; a black tile with a white mark, legible on light and dark browser chrome |

The bytes are identical to the archive (SHA-256 of each source entry matches its
copy). The transparent variants are the ones in the interface: the artwork
carries no background, so it sits on the page surface instead of punching a
foreign block of colour through the neo-brutalist tokens.

`logo_bg_white.png`, `logo_bg_black.png` and `logo_bg_robinhood.png` are not
shipped: each bakes in a background, which would either duplicate or contradict
`--canvas` and `--surface`. Use them only for surfaces outside this app.

Every asset keeps its original square canvas; nothing is cropped, resampled or
recoloured, and the interface renders it in a 1:1 box with `object-fit:
contain`, so the trident is never stretched.