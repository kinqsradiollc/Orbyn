# Orbyn LinkedIn assets

Upload these PNGs to the Orbyn **company Page**:

| File | Size | Use |
| --- | --- | --- |
| `orbyn-linkedin-profile.png` | 400 × 400 | Company logo / profile picture |
| `orbyn-linkedin-cover.png` | 1512 × 256 | Recommended light cover |
| `orbyn-linkedin-cover-green.png` | 1512 × 256 | Alternative forest-green cover |

Dimensions follow [LinkedIn's current company Page image specifications](https://www.linkedin.com/help/lms/answer/a570368), checked on 3 October 2026. Each upload is below the 3 MB limit. These are company Page assets; personal profile covers use a different format. LinkedIn may crop covers across screens; the logo and wordmark are positioned toward the center with generous edge space. Check the upload preview on desktop and mobile.

The profile picture reuses the existing orbit mark from `mobile/assets/icons/icon-light.svg`, with an opaque forest-green background for light/dark layouts and square/circular crops. Covers use the existing palette from `packages/core/src/presentation.ts` and bundled DM Sans. The layout uses only the existing mark, wordmark and website address on a flat background.

SVG originals are resolution-independent. Lettering is outlined so it renders consistently without installing fonts. Change the copy or layout in `generate.py` to regenerate them; no application files or dependencies are changed.

## Regenerate

Create an isolated Python environment with `fonttools[woff]`, then run `generate.py`. Export each SVG to a PNG at its intrinsic size using an SVG renderer (for example Sharp). DM Sans's existing license is at `desktop/src/assets/fonts/OFL-DM-Sans.txt`.

## Verification

- All PNG dimensions and file sizes checked.
- PNGs visually reviewed at full cover width and small logo size.
- Only this asset folder is included in the commit.
