# C1 embedding discovery — root visual review

8 October 2026. Partial review; feature source remains local, not delivered to main.

## Source and originals

Visual Check's partial manifest:
`/Users/anhdang/.codex/visualizations/2026/10/07/01a1150d-e6e8-7c93-a48e-edd209938fec/orbyn-qa/QA-026-c1-captures-2026-10-08/manifest.md`.
Original PNGs live in that same directory. The initial review opened these three originals:

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
matches are zero. Preserve the typed model, query and no-match notice. After Visual Check confirmed capture quiescence, the correction was applied
and committed as d498febd. The added component regression fails before the fix
(30/31) and passes afterward (48/48 selected component/hook cases). Expanded
catalog authority/adapter/client/control coverage passes145/145 with no
failures/skips/cancellations; mobile typecheck exits zero. Corrected Light and
Dark no-match originals are requested; screenshot acceptance remains pending.

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

## Additional original inspection

Root inspected the six generation model originals (Light/Dark exact249,
manual no-match and actual disabled Test/Use states), plus Dark embedding
exact249 with retained manual draft and Dark embedding no-match.
The exact249 single chip and manual draft fit the320px viewport in both themes.
Disabled Test/Use buttons are visible, but the long catalog means the blank
input is not coframed; this is scoped button evidence supported by component
checks, not a complete surface capture. Dark generation no-match `-v2` clips
the notice at its bottom edge despite the manifest's framing description.
Root requested a lower-scroll recapture showing the full notice and buttons.
Both embedding no-match originals show the empty-track defect; new originals
must verify its removal. These browser samples do not prove native acceptance.

Fresh full regression log for frozen d498febd:
`/tmp/orbyn-c1-discovery-corrected-full-20261008.log` (running, no terminal result).

## Corrected mobile originals — root acceptance

Root opened all three files in the corrected batch manifest:
`/Users/anhdang/.codex/visualizations/2026/10/07/01a1150d-e6e8-7c93-a48e-edd209938fec/orbyn-qa/QA-026-c1-captures-postfix-2026-10-08/manifest.md`.
Source is d498febd,320×740 CSS pixels,DPR2.

| Saved image | Root acceptance |
| --- | --- |
| `QA-026-postfix-mobile-embedding-no-match-manual-light.png` | ✓ Empty segmented strip removed; complete no-match notice and manual draft preserved; controls fit horizontally. The validation button continues below this viewport and is disabled. |
| `QA-026-postfix-mobile-embedding-no-match-manual-dark.png` | ✓ Empty strip removed; manual draft and no-match text retained; consent off and complete disabled validation action visible after scrolling. |
| `QA-026-postfix-mobile-model-no-match-manual-dark.png` | ✓ Credential-safe crop shows complete manual model, no-match notice and Reload/Test/Use controls without overlap. This replaces the clipped Dark v2 notice evidence. |

The generation image is an explicit640×700 crop of the actual browser capture,
not a full-surface image. The embedding images are640×1480 originals. No Test,
Use, validation or consent action was performed. C1-EMB-UI-01 is visually closed
for these mobile browser states; native/keyboard/full-surface checks remain open.
Web1280/320 Light/Dark originals are still being captured. The newly reproduced
provider-redirect defect is a separate backend promotion gate.

## Current81e807ee web samples — partial root review

Root inspected these saved images under
`/Users/anhdang/.codex/visualizations/2026/10/07/01a1150d-e6e8-7c93-a48e-edd209938fec/orbyn-qa/QA-026-c1-captures-81e807ee-2026-10-08/`:

- `QA-026-postfix-web-embedding-1280-light-exact-81e807ee.png`: ✓ The Load
  catalog action now has the standard secondary appearance rather than the
  browser-default gray button. Exact249 is selected, controls are contained,
  consent remains off and validation disabled. This is a panel crop.
- `QA-026-postfix-web-320x740-light-no-match-81e807ee.png`: ✓ Closed navigation
  leaves the admin panel visible, manual model preserved and dropdown contained
  in320px. The search currently matches its added manual option; despite the
  filename, this is not zero-result search evidence. Root requested a distinct
  unmatched dropdown query while preserving the manual model field.

The capture session's earlier sidebar-open observation is not accepted as a
persistent narrow-layout defect without root-inspected originals and actions.
Wide/narrow Dark, true zero-result search, exact249 dropdown interaction and the
open/collapsed navigation originals remain pending. Mobile acceptance above is
unchanged because81e807ee did not change mobile UI. Complete C1/U1 acceptance is
not established by these samples.

## Completed81e807ee scoped browser batch — root acceptance

Root inspected all remaining originals from the81e807ee folder and its manifest:
wide1280 Light/Dark true-zero search, narrow320 Light/Dark true-zero and
selected249, wide Dark selected249, and wide/narrow Light open-dropdown
exact249 search. The latter shows a single matching final catalog option while
the underlying manual model remains preserved. Both themes' zero-result captures
show No matches with manual-unlisted-model unchanged. The secondary catalog
action and these controls fit horizontally. The narrow open navigation is an
overlay over content; closed navigation restores the main surface. These images
do not establish keyboard/focus dismissal, full navigation behavior or native
acceptance. Dropdowns intentionally overlay underlying controls while open.

The manifest distinguishes closed selected-model captures from actual search,
panel crops from narrow originals, and the earlier mislabeled matching-manual
image from genuine zero results. No whole-stage C1/U1 completion is inferred.
Light was restored and drafts cleared by the capture session. Runtime product
remains81e807ee; candidateHEADab01bcc8 adds only documentation.

After capture quiescence, root deleted only the exact inert18089 provider via
its authenticated admin API. Receipt /tmp/orbyn-c1-ui-fixture-cleanup-20261008.json
confirms204, original four provider IDs retained and saved AI settings unchanged.
The verified owned fixture process41586 was stopped. Cumulative server counts
are catalog16/completion3/unknown0, retained at
/tmp/orbyn-c1-ui-inert-provider-counts-20261008.json; these include earlier fixture
checks, not vendor traffic. The current capture batch performed no Test/Use/
validation/indexing. Preview servers and the original providers remain running.
