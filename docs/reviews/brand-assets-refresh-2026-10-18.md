# Brand asset refresh — 18 October 2026

Baseline: `47785f28`. Branch: `codex/brand-assets-refresh`.

## Scope and implementation

Preserve the existing orbit/lowercase wordmark and use the current blue palette.
The original favicon, PWA/mobile/Clipper icons and social preview were still
forest green. Mobile's dynamic config already wired native icon variants;
its adaptive background and assets were stale, while its web favicon was absent.
Electron had no explicit packaging icon configuration and reused a square app
icon in the macOS tray. Several web wordmarks gave the dot a separate flex item,
leaving its colour/baseline inconsistent.

`npm run generate:brand` now renders from the actual Lucide Orbit geometry,
core presentation tokens and the Manrope/DM Sans font files already used by the
mobile app. SVG lettering is outlined. Pinned resvg/fontkit development tools
provide deterministic exports; deployment consumes committed assets and does
not run the generator. The initial variable-WOFF2 generation attempt failed in
fontkit (`head.unitsPerEm` on a variation); the completed generator uses the
existing static mobile TTF faces. No extra fonts or external image services.

Outputs cover SVG/ICO favicons, touch/PWA/maskable icons, native variants,
Windows/macOS/Linux packaging, macOS template tray, light/dark wordmarks,
Clipper icons/palette/badge and social/LinkedIn exports. Legacy explicitly green
covers are archived. The old Python LinkedIn command delegates to the same
source. The PWA launch URL remains `/`.

Web HTML, manifest and SEO retain content-versioned asset URLs. Nginx handles
new icon filenames. Public MCP/plugin metadata advertises a first-party icon;
no account data or credentials enter its URL. Expo and native target config use
the generated palette; native permissions and deep-link configuration are unchanged.

## Evidence and limits

- Asset generation completed: 50 generated files, revision in
  `assets/brand/manifest.json`; log `/private/tmp/orbyn-brand-generation.log`.
- Backend, desktop and mobile typechecks exited 0; logs
  `/private/tmp/orbyn-brand-{backend,desktop,mobile}-types*.log`.
- Web production build exited 0; `/private/tmp/orbyn-brand-web-build.log`.
  Its unrelated generated LaTeX/PDF runtime JSON changes were restored.
- Node syntax checks for Electron, Expo config and Clipper worker exited 0.
- File inspection confirmed favicon/Windows ICO, macOS ICNS, maskable 512px
  PNG and opaque-looking 1024px native exports. Generated small-icon contact
  sheet and social preview were personally inspected as static images.
- `git diff --check` passed. No tests were added or run; no Tester, Visual Check
  or Reviewer role was started, preserving the owner's delivery preference.

No installed-native build, launcher/tray runtime, PWA install, browser tab cache,
MCP-host icon rendering, app-store or social-profile publication was performed.
These require deployment/new native packages and platform cache refresh as
applicable; a source merge is not proof of those rendered outcomes.
