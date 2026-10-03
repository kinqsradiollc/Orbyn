# Native and desktop Mermaid preview checkpoint

## Scope

Stacked on source/navigation PR172 (`2d5605f9`), preserving main1100ca98's
publication, authorization and Gantt readability corrections. Mobile replaces
its flowchart-only SVG implementation with the bundled strict Mermaid engine.
Web/desktop uses bounded source and output with fit, zoom, pan, source and SVG
controls. All ten declared diagram families remain in scope.

The build fingerprints root/mobile manifests, lockfile, core renderer helpers
and runtime. Backend and mobile isolated-runtime artifacts are generated together. Desktop
uses its existing first-party Mermaid build with the shared bounded helpers;
no unused duplicate renderer artifact is shipped.
Native WebView allows only about:blank and rejects file access, new windows,
cookies and mixed content; mobile web uses an opaque scripted iframe.
Late/stale, malformed, non-finite and oversized bridge results are rejected.
Native canvas height is at most half the current window (160–480 points).
Tall diagrams expose pan controls even at fit-to-width.

## Executed evidence

- Actual strict parser accepted all ten fixtures.
- 44 combined runtime/component/bounds/export/section-navigation/readability
  checks passed before the responsive canvas change.
- After that change, 16 component and actual download-utility checks passed,
  including narrow and landscape height limits. Final combined checks passed 52/52 plus 6/6 actual offline readability and
  embedded navigation checks, with no failures/skips/cancellations. Full-suite
  qualification remains pending.
- Final workspace typechecks, production build and full formatting passed
  after the responsive canvas change. Asset ownership cleanup is rechecked
  before freezing the candidate.
- CUA inspected the actual component in an isolated Expo Go iOS57 fixture on
  the iPhone SE simulator: flowchart, sequence, state, class, ER, Gantt, pie,
  journey, mindmap and timeline all rendered. Screenshots are in
  `native-diagrams/`. Source toggling, zoom out, fit reset, actual-size selection
  and pan down were exercised. `mindmap-pan-down.png` shows the final Notes
  node reached by pan. Toolbar rows wrap without overlap in this fixture.
- SVG export opened the native share sheet with the generated diagram file
  (12 KB): `native-diagrams/svg-share.png`. The sheet was dismissed without
  sending the file to another app or person.

## Failures and limits

The first desktop regression run failed three real bounds/normalization checks;
the scoped renderer repair retained the assertions and then passed them.
The temporary Expo fixture initially lacked the production lib0 crypto resolver.
Its separate /tmp root plus external symlink dependencies also produced invalid
Metro dynamic-import paths. Both were repaired only in temporary fixture config;
no download utility product change was necessary. A clean reload recovered an
Expo fast-refresh native-module error. Logs are retained in
`/tmp/orbyn-native-diagram-qa-metro-{2,3,4,5,6,7}.log`.

The original tall fixture header hid part of tall diagrams below the phone
viewport. The product canvas now adapts to window height; the temporary fixture
header was compacted for inspection. Actual signed-in Docs parent scrolling,
Android, light palette, editor/source-link navigation and whole-app acceptance
remain required. Journey/timeline labels are small at fit-to-width; zoom is
available, but their full readable-layout acceptance is not claimed.
No saved denied web product UI permission was bypassed. No full ADR completion,
main merge, deployment, release or cleanup is claimed by these fixture checks.
