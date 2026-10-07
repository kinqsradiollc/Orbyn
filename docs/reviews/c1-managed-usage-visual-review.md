# C1 managed usage browser review

Root review, 8 October 2026. Product source81e807ee; docs-only candidateab01bcc8.
Capture session: Orbyn Visual Check. Root inspects originals and owns findings.
Synthetic counters are confined to the disposable local QA account; no vendor
billing, plan limits, cost or live inference is established by this fixture.

## Fixture and API

Two tracked done jobs, no runner invocation. Fresh authenticated GET /ai/usage
returns200,enabledtrue,requests2/window30,input2000/output200/reasoning40,
cached1000/cache-write100. Exact ownership/cleanup metadata lives in
/tmp/orbyn-c1-usage-visual-fixture-20261008.json. Prior QA usage count was zero.
Do not delete other usage or jobs. Positive capture is still live; overflow is
prepared but not switched until the capture session is quiescent.

## Root-inspected evidence

Folder:
/Users/anhdang/.codex/visualizations/2026/10/08/01a1150d-e6e8-7c93-a48e-edd209938fec/orbyn-qa/QA-026-c1-usage-positive-2026-10-08/.
Privacy-safe crops retain the full usage subsection; full source originals are
kept separately. These are browser screenshots, not installed-native proof.

| Original/crop | Root result | Scope limit |
| --- | --- | --- |
| C1-usage-positive-web-1280x1000-light.png | ✓ All five counters,2responses/window30 and observed-only/ChatGPT-plan exclusion visible and contained. | Modal crop; no keyboard or alternate data-state proof. |
| C1-usage-positive-web-1280x1000-dark.png | ✓ Same five counters and honesty text visible and contained. | Modal crop; no whole-settings acceptance. |
| C1-usage-positive-web-320x740-dark.png | ✓ Counters/window/disclaimer/Refresh wrap horizontally; no clipped counters. | Settings navigation consumes substantial viewport height; usability finding below. |

Narrow Light/mobile320/390 both themes, overflow, loading/error and native
acceptance remain open until their own evidence is inspected. No whole C1 or
U1 completion is inferred from these three images.

## Retained layout finding

**U1-SETTINGS-NARROW-01 — settings navigation uses excessive vertical space.**
The320×740 Dark image shows the title, search and wrapping navigation filling
roughly the top40percent of the visible modal, leaving a restricted scrolling
content region. The usage counters themselves wrap correctly. This is a broader
settings layout issue, not evidence of horizontal counter overflow. During U1,
replace the narrow navigation with a compact section control or drawer, then
capture all sections and scroll/focus behavior on phone heights and large text.
Keep the original palette and modal design. Do not claim this issue fixed by a
passing usage-counter component test.

## Positive batch complete; overflow begun

Root inspected all eight final positive subsection crops: web1280/320 and
mobile browser320/390 in Light/Dark. Root reopened the final mobile320Light
file after the capture-session correction. All five known counters, response/
window line, disclosure and Refresh fit and remain visible. The separate
settings navigation issue remains retained; this is subsection/browser evidence.
Capture manifest is in the positive folder above. Its capture-agent Verified
labels are not independent acceptance; this root review is the acceptance.

After authoritative capture completion/quiescence, root changed only the two
owned input counters to9007199254740991 each. The authenticated API200 correctly
returns input_tokens:null for their unsafe aggregate, while requests2/window30,
output200/reasoning40/cached1000/cache-write100 remain known. Receipt:
/tmp/orbyn-c1-usage-overflow-api-20261008.json. No provider calls occurred.
Current shared formatter omits unavailable counters rather than inventing a
number; the upcoming fresh Refresh captures must show2000 input absent.
Overflow screenshots/root acceptance remain pending. Cleanup script is prepared
at /tmp/orbyn-c1-usage-fixture-cleanup-20261008.mjs and must run only after the
capture session is quiescent. It deletes only the exact tracked terminal fixture
jobs (usage cascades), preserves all other jobs and verifies remaining fixture
usage is zero. No production usage is affected.

### First overflow original — partial root review

Root inspected
/Users/anhdang/.codex/visualizations/2026/10/08/01a1150d-e6e8-7c93-a48e-edd209938fec/orbyn-qa/QA-026-c1-usage-overflow-2026-10-08/originals/C1-usage-overflow-web-1280x1000-light.png.
The prior2000 input counter is absent after Refresh. Output200/cached1000/
cache-write100/reasoning40,2responses/window30, disclosure and Refresh remain
visible and contained. This is accepted for wide Light only. Other overflow
views and cleanup are pending. No unknown input number is fabricated.

A local usage-only network fixture is prepared at
/tmp/orbyn-c1-usage-network-fixture-20261008.mjs; node syntax validation passes.
It is not running and no preview API has moved or restarted. Planned next check:
delay/fail only GET /ai/usage, forward other routes to the unchanged compiled
backend, capture actual loading/error/retry UI, then restore direct preview API.
This is test infrastructure, not application source or production deployment.
No loading/error visual acceptance is claimed until actual captures are inspected.

### Overflow viewport correction — root acceptance withdrawn

The capture session subsequently reports the first Light original came from
another Chrome tab at1728CSS width, despite a1280 viewport check on its target
tab. Therefore root withdraws1280 acceptance for that image; only its visible
counter contents were inspected. Preserve it as superseded, and require a
replacement-v2 with same-tab viewport/screenshot identity. Do not overwrite
history or infer1280 behavior from its dimensions.

Root also inspected the first Dark original. Its counter/disclosure contents
fit, but the modal's right edge and adjacent Refresh are cut at the image edge.
Full-modal containment is not accepted; root requested verified same-tab1280
Dark-v2 if identity is uncertain. Remaining overflow capture review is open.
Disk free fell to260MiB; the earlier space-recovery request remains pending.
No heavy build, API restart or fixture cleanup occurred during the live batch.
