# Orbyn brand assets

Use the current blue orbit and lowercase wordmark. The existing Lucide Orbit
geometry and `packages/core/src/presentation.ts` palette are authoritative.
Manrope 800 is the wordmark; social text uses Manrope and DM Sans, matching the
apps. Lettering is outlined using the existing mobile font packages, so exported
images do not depend on system fonts or fetch fonts from the network.

## Regenerate

From the repository root after `npm ci`:

```sh
npm run generate:brand
```

The generator uses pinned development dependencies and produces committed SVG,
PNG, ICO and ICNS assets. It does not run during deployment or download images.
`manifest.json` lists its outputs and content revision. Do not hand-edit outputs.

- `orbit.svg`, `wordmark.svg`: standalone vector identity.
- `social-preview.svg` / `.png`: 1200×630 link preview.
- `palette.json`: generated shared palette for native config and extensions.
- `desktop/public`: SVG/multisize ICO favicon, Apple touch, install/maskable,
  social and monochrome macOS tray assets. Web references include a revision.
- `desktop/build`: explicit macOS, Windows and Linux packaging icons.
- `mobile/assets/icons`: opaque light/dark/tinted iOS icons, safe-area Android
  foreground/monochrome icons and Expo web favicon.
- `clipper`: extension icons, palette and badge colour.
- `assets/linkedin`: current company profile and light/blue cover exports.

The white orbit sits inside the icon's maskable safe area. iOS icons have square,
opaque backgrounds; the operating system applies its own mask. Android adaptive
foregrounds leave additional room for launcher masks and motion. macOS's tray
uses a template image that the OS recolours; installed app icons require a new
native package to change. No native build or store publication is implied.

Legacy green cover variants are retained under `archive/` as historical exports.
They are not current branding. Existing user-selected planning colours and
saved document highlight colours are not brand assets and are left intact.
