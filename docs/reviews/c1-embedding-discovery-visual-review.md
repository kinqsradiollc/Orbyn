# C1 embedding discovery — root visual review

8 October 2026. Partial review; feature source remains local, not delivered to main.

## Source and originals

Visual Check's partial manifest:
`/Users/anhdang/.codex/visualizations/2026/10/07/01a1150d-e6e8-7c93-a48e-edd209938fec/orbyn-qa/QA-026-c1-captures-2026-10-08/manifest.md`.
Original PNGs live in that same directory. Root opened and inspected all three:

| Original                                            | Root finding                                                                                                                                |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `QA-026-mobile-embedding-last249-light.png`         | ✓ Searching the last of250 catalog entries shows exactly one candidate. The typed model remains empty; discovery does not select a default. |
| `QA-026-mobile-embedding-last249-manual-light.png`  | ✓ The independent search query leaves `manual-unlisted-model` intact. Provider labels and controls wrap within the viewport.                |
| `QA-026-mobile-embedding-no-match-manual-light.png` | ✓ No-match notice and manual draft remain visible. ✗ An empty segmented track remains beneath the query.                                    |

The viewport is320×740 CSS pixels; originals640×1480, DPR2. Chrome's bundle path
identifies the owned discovery worktree. Product UI is5466bc1c;15301fbd changes
only tests/documentation. These screenshots are Light-theme mobile browser
samples, not full-surface, Dark, desktop, installed-native or complete C1 evidence.

## Required correction

C1-EMB-UI-01, low: omit the empty `Segmented` catalog control when filtered
matches are zero. Preserve the typed model, query and no-match notice. A targeted
patch is prepared outside the source tree; it is not applied while Visual Check
is capturing this frozen product. After the batch finishes, qualify the fix and
request new mobile no-match originals in Light and Dark.

## Remaining evidence

- Mobile generation model exact-match correction and actual disabled Test control.
- Dark embedding states and web wide1280/narrow320 originals.
- Targeted post-correction no-match recaptures and root inspection.
- Full regression qualification after the recorded aborted run/harness correction.
- Remaining retained C1 provider, live cache and embedding acceptance gates.

The screenshots show semantic consent off and validation unavailable. Separately,
root's authenticated API check returns an inert250-model catalog with the matching
embedding revision while semantic search remainsOFF. Neither source asserts live
vendor entitlement, document indexing or production deployment.
