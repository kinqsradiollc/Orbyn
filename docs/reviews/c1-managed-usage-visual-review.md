# C1 managed usage browser review

Historical root review, 8 October 2026. Product source81e807ee; docs-only candidateab01bcc8.
Capture session: Orbyn Visual Check. Root inspects originals and owns findings.
Synthetic counters are confined to the disposable local QA account; no vendor
billing, plan limits, cost or live inference is established by this fixture.

## Current review responsibility

On 8 October the user authorized Orbyn Visual Check to analyze the rendered UI
and write findings, superseding its earlier capture-only role for this checkpoint.
Its scoped report belongs in QA-027/visual-analysis.md. The implementation session
reviews that report, owns corrections and integration, and distinguishes delegated
pixel review from its own image inspection. Inaccessible historical screenshots
remain unreviewed; capture manifests alone do not establish layout acceptance.
Direct browser access in the implementation session was rejected by the saved
site permission. No alternate-browser, port or export workaround is authorized.

## Current checkpoint

Current frozen correction d672fc50 is local, not merged. Earlier5e69d4eb full
regression passed4254/4254, zero failures/skips/cancellations, exit0,788822ms.
QA-028 delegated review confirms scoped portrait density/copy/help/single focus
improvements, but reproduces P2 narrow focus loss on dismissal and landscape
content height94px. It prevents complete Settings checkpoint acceptance.
Report: `QA-028-settings-density-2026-10-08/visual-analysis.md` under the same QA root.

The corrected source restores focus to the visible opener or current visible
workspace navigation, after removing background inertness; hidden, removed,
disabled and inert targets are skipped. Short windows use a compact category row,
stacking it on very narrow widths. A higher-specificity backdrop rule fixes the
actual later generic CSS override that retained phone gutters despite the earlier
source rule. Source-only density assertions were insufficient to establish that
rendered result. The extended test evaluates both global/local stylesheet orders.

Parent38558c8a focused29/29, both client types and production web build pass.
Its frozen full regression finished4260/4260, exit0, zero failures/skips/
cancellations: `/tmp/orbyn-c1-settings-recovery-full-20261008.log`.
QA-029 is complete; root reviewed its delegated report. Normal-scale full-screen
phone layout and740×320 task space pass; content height improves94→174px. Close
returns focus correctly, but original narrow Escape from Search or Close still
returns BODY. The checkpoint remains unaccepted. A primary-only follow-up rejects
the closing transformed sidebar as a focus target and is frozen as d672fc50.
Actual-source31/31 focused tests and desktop types pass;
the inferred transition cause and corrected browser behavior still need recheck.
There is no full d672fc50 regression or visual acceptance yet. QA-030 records a
blocked preview: account-loading error, no Settings dialog, API8008 timeout and
missing local PostgreSQL55436 listener; Docker queries also time out. Initial
disk-full approval failure prevented execution; space recovery subsequently
allowed the scoped freeze. Docker Desktop remains under user control.
Enlarged/native gaps remain.
Report: `QA-029-settings-recovery-2026-10-08/visual-analysis.md` under the same QA root.

## Parent density/copy candidate

Current follow-up5e69d4eb is frozen locally, not merged. Phone-width Settings
uses the available modal screen with compact gutters/section padding and existing
font/control tokens. Search retains the shared outer outline and neutral border;
QA-027's diagnostic confirmed the second frame was the wrapper's accent border,
not an input shadow. Connected agents uses a short helper, short empty state and
optional permission/context explanation on web/mobile; the existing connection
and authorization controls remain intact.

Focused23/23, desktop/mobile types and web build pass. The initial22/23 focused
run failed a new test's overly broad assertion against the existing18px header
font declaration; corrected checks verify unchanged normal/narrow heading size
and no font/scale overrides in the compact media block. Both logs are retained:
`/tmp/orbyn-c1-settings-density-focused-initial-20261008.log` and corrected
`/tmp/orbyn-c1-settings-density-focused-20261008.log`.
Actual mobile help closed/open state and its accessible toggle are executed by
the new component harness; CSS tests do not establish rendered usability.

Full regression completed in `orbyn_c1_settings_density_20261008_test`:
`/tmp/orbyn-c1-settings-density-full-20261008.log`. QA-028 internal-browser review
completed for V02/V03/V04, both clients/themes, narrow/wide, scrolling,
dismissal/focus return and actual enlargement where supported. No current full
main delivery is inferred from the focused checks; its separate terminal and
delegated findings are recorded above.

## Qualified navigation and Theme checkpoint

Frozen candidate dbcf8c84 adds a narrow Theme control correction to c69f342f.
Focused23/23, desktop types and web build pass. Fresh full4250/4250 passes with
zero failures/skips/cancellations, exit0,815595ms on the marked stock database.
Integrated as994d6de3, with application/test source identical to the tested
candidate and unrelated mobile changes preserved. Logs:
`/tmp/orbyn-c1-theme-containment-full-20261008.log` and terminal JSON.

Delegated review report:
`/Users/anhdang/.codex/visualizations/2026/10/08/01a1150d-e6e8-7c93-a48e-edd209938fec/orbyn-qa/QA-027-c1-usage-loading-error-retry-2026-10-08/visual-analysis.md`.
Root reviewed the report; this is delegated pixel review, with inline-only
images, not exported originals or personal root inspection.

| Finding | Current state | Next action |
| --- | --- | --- |
| V01: Theme clipping | Corrected at normal web320/390/1280 and mobile-browser320/390, both themes; pointer/keyboard checked on web; qualified on main994d6de3 | Keep enlarged/native gates open |
| V02: double search focus | Open P3, web1280 Dark | One visible focus owner, targeted recheck |
| V03: Settings density | Open P2, actual CSS320×740; 192px header/navigation, 54.5px collapsed rows plus12–14px gaps | Compact chrome/rows while retaining readable text and touch targets |
| V04: Connected agents copy | Open P2;165px introduction pushes Connect to y601; another110px explanation | Short helper and immediate action; optional detail in disclosure |
| Enlarged text | Unverified; zoom shortcut had no actual effect | Supported measured enlargement, no inferred pass |
| Overall Settings/full C1/native | Not accepted | Complete remaining flow and platform matrices |

After the local container stopped, its temporary DB was lost. Only the owned
stock test container was started; missing `orbyn_ui_preview` was migrated and the
same disposable QA account recreated. Health200/register201/authenticated-me200
receipt: `/tmp/orbyn-c1-preview-after-stop-recovery-20261008.json`.
Fresh browser sign-in succeeded. Current usage is zero; historical synthetic
usage/recovery captures below remain unreviewed and were not recreated.

The user's supplied Settings screenshots also reject density and explanatory
paragraphs. `skills/orbyn-ui-design` now records researched UI and UX rules;
changing guidance does not itself fix or accept the application UI.

## Previous checkpoint and fixture cleanup

Candidate c69f342f is frozen locally and not merged. Fresh4248/4248 regression,
69/69 vector cohort, upgrade1/1 and late-install1/1 pass; types/web build pass.
The usage-only loading/error gateway has been removed after capture completion.
Direct preview API8008 is restored and healthy; upstream8009 is released.
Ownership/readiness receipt: /tmp/orbyn-c1-preview-usage-lifecycle-state-20261008.json.
Its initial graceful gateway shutdown closed the listener but retained the process;
root rechecked exact PID/command/cwd and stopped only that owned fixture before
restoring the API. This was local test infrastructure, not a product fix.

Visual Check reports authenticated internal-browser web captures at320/390 and
1280 widths in Light/Dark. They are inline-only, not available to root as saved
originals, and are not accepted by metadata alone. One390Dark identity-containing
image is invalid and excluded; its separately named corrected retake is eligible
for later review. Mobile login succeeded and the initial Settings/overflow
capture batch is complete. QA-027 loading/error/successful Refresh captures are also complete.
Each phase covers web320Light/1280Dark and mobile-browser320Light/390Dark.
Only wide web and390mobile captured independent error-to-success transitions;
the320views repeated Refresh after their shared tabs had recovered. This does
not prove independent320error recovery or installed-native behavior. Root
requested valid images be attached here for inspection; the blocked file-export
route is not retried. Keyboard/focus and remaining client states are
not accepted by inference.

The fresh disposable-admin synthetic rows were removed after capture completion.
Cleanup deleted exactly the two owned terminal jobs, left zero fixture usage rows
and preserved all other jobs; /tmp/orbyn-c1-usage-fixture-cleanup-fresh-admin-20261008.json.
Before cleanup, authenticated pass-mode API200 returned requests2/window30,
input unknown, output200/reasoning40/cached1000/cache-write100:
/tmp/orbyn-c1-usage-pass-recovery-api-20261008.json. No vendor inference occurred.
QA-026/QA-027 images remain inline-only and unavailable for root pixel inspection.
A manually attached image handoff is still pending; metadata is not acceptance.
Old fixture identifiers below describe the lost pre-recovery database and must
not be used for current cleanup.

The sections below retain chronological evidence, failed attempts and superseded
states. Their earlier live/pending descriptions are historical, not current.

## Historical fixture and API

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

### Recovery fixture qualification — local HTTP only

The prepared temporary gateway passes an actual inert local HTTP check:
forward normal routes, hold only GET /ai/usage, release the held request as503
with the fixture error and correct origin header, return immediate503 in error
mode, and return the unchanged upstream response after pass mode is restored.
Receipt /tmp/orbyn-c1-usage-network-fixture-test-20261008.log exits0; counters
/tmp/orbyn-c1-usage-network-test-counts-20261008.json show3forwarded/1held/
2failed/0forwardErrors. Owned test listener/stub were stopped by the harness.
No credentials, production endpoint, provider calls or preview API were used.
This validates test infrastructure, not client loading/error screenshots.

Current overflow Light original now has2560×2158 PNG dimensions and root
inspected contained modal/counters; the original path was replaced, so prior
1728-width evidence must be treated as superseded, not preserved by that path.
Dark's current original remains right-edge clipped. Root requested separately
named replacements and same-tab ID/viewport/DPR/pixel metadata. Full viewport
acceptance remains open until that provenance is verified. Disk recovered from
260MiB to526MiB but remains too low for heavy builds.

### Preview interruption and local narrow-navigation correction

Chrome is available again. Root inspected separately named wide Light/Dark v2
originals: the usage block and modal are horizontally contained, and the unknown
input aggregate is omitted. The capture manifest records same-tab1280×1000,
DPR2 and2560×2158 full-page images. This is scoped usage/layout evidence, not a
fresh successful network-response receipt at capture time.

The API subsequently died with an ENOSPC logging error. Its unchanged compiled
listener was restored, with output discarded to avoid another disk-write crash;
health still returns503 because PostgreSQL is unreachable. Docker CLI also
hangs. Visual Check is quiescent. Its two320Light images are explicitly stale/
error and unqualified;320Dark/mobile overflow and loading/error/retry remain
open. The synthetic rows remain owned and retained until database recovery and
capture completion allow exact cleanup. No production database was changed.

A local correction for U1-SETTINGS-NARROW-01 replaces wrapping category buttons
at600px and below with Orbyn's existing Select. Wide category navigation remains
available; both controls use the same guarded destination action. A stable
accessible section label avoids duplicate IDs and hidden-button references.
Only the settings navigation/component CSS and focused test changed. This is
not committed, pushed or visually accepted yet; the running preview remains on
the earlier frozen candidate.

The corrected focused cohort passes31/31, zero skips, exit0, including settings
navigation, modal focus/Escape, search, responsive grids and existing picker
behavior. Receipt:/tmp/orbyn-c1-compact-settings-focused-20261008.log. Main's
ordinary typecheck and picker run initially failed against stale compiled shared
packages; those failures are retained as environment failures. Desktop no-emit
typecheck passes with a temporary config targeting the already-qualified
candidate package declarations. The31-test receipt uses a temporary resolver
for those same compiled packages and the existing Darwin esbuild binary; no
dependency install or shared node_modules mutation occurred. This does not
replace fresh full regression or browser keyboard/layout acceptance of the new
navigation.

The final local cohort is32/32, exit0, zero skips, after adding a source-order
CSS cascade check. It verifies that exactly one category control is displayed
at320/390/560/600,601/900 and1280 widths, and proves the evaluator detects a
late rule that would reintroduce stacked navigation. Receipt:
/tmp/orbyn-c1-compact-settings-final-focused-20261008.log. This strengthens the
regression check but does not establish screenshot, text-size or keyboard proof.
Recheck: free space703MiB; API health remains503/database unreachable.

### Database recovery and frozen candidate

Docker recovered and disk space exceeded5GiB. Only the two owned C1 PostgreSQL
test containers were recreated after their startup failed on empty socket-lock
files. Their pgdata is tmpfs and was lost; the prior preview providers, account
and synthetic jobs are not claimed retained. Receipt:
/tmp/orbyn-c1-test-db-recovery-receipt-20261008.json. Unrelated containers were
not started or removed. The fresh local orbyn_ui_preview database migrated with
exit0, API health returned200, and the disposable admin was recreated with its
existing private credentials. No production credential was copied.

Fresh owned usage rows reproduce the positive and overflow API200 states;
receipts use the distinct -rebuilt- filenames and preserve prior receipts. The
new cleanup script targets only the new exact job IDs. The old fixture metadata
describes a lost database instance, not records to delete from the new one.

The compact-navigation source and its two test files are frozen in candidate
c69f342f, not merged or pushed to main. The existing5174 preview serves this
candidate;8083 remains unchanged. Visual Check is assigned same-tab originals
for narrow picker open/selection/focus, wide settings, and mobile usage overflow,
with browser sign-in renewed for the rebuilt QA account. Acceptance is pending.

Fresh full regression runs against its own marked
orbyn_c1_compact_settings_20261008_test database. Receipt:
/tmp/orbyn-c1-compact-settings-full-20261008.log. This run is active; no terminal
pass is claimed. Earlier4246/4246 applies to ab01bcc8, not this new candidate.

The candidate's fresh dedicated vector cohort passes69/69, zero skips, exit0,
using a separate newly marked pgvector database. Workspace typechecks and web
build also exit0. Receipts are
/tmp/orbyn-c1-compact-settings-vectors-20261008.log,
/tmp/orbyn-c1-compact-settings-workspace-types-20261008.log and
/tmp/orbyn-c1-compact-settings-web-build-20261008.log. These are local runtime/
compiler checks, not live embedding-recipient or native acceptance.

Post-fix capture has not started: Visual Check reached the expired-session login
page, and Computer Use denied com.apple.Terminal when it attempted to obtain
the QA account file. The agent stopped. Root requested manual Chrome sign-in;
no post-fix screenshots, fresh keyboard/layout acceptance or main delivery is
claimed. Full regression continues independently on its confirmed live handle.

The user then explicitly requested a new admin and autonomous sign-in. Root
created a fresh disposable admin through the local API and assigned direct
Chrome sign-in to Visual Check, without Terminal or the old account-file path.
Credentials are private and excluded from reports/captures. The two earlier
rebuilt usage jobs were deleted with exact ownership checks; their cleanup
receipt confirms zero remaining fixture usage and all other jobs preserved.
New owned rows for the fresh admin reproduce the same overflow API200 state.
Receipts:/tmp/orbyn-c1-usage-fixture-cleanup-rebuilt-20261008.json and
/tmp/orbyn-c1-usage-overflow-api-fresh-admin-20261008.json. Fresh-admin capture
is authorized and pending; no screenshot acceptance is inferred from API setup.

Fresh frozen c69f342f full regression completed4248/4248, zero failures/skips/
cancellations, exit0,809852ms. Terminal receipt:
/tmp/orbyn-c1-compact-settings-full-terminal-20261008.json. The source remained
clean/frozen during the run and capture task. Main delivery is still pending
root screenshot review; this full pass does not close the broader C1 gates.

### Screenshot export blocked

Visual Check confirms CUA screenshot bytes exist, but its file-writing Node
runtime is separate and cannot access them. CUA's documented screenshot API
has no save-to-path option. The ordinary Chrome save-image attempt using a
data:image URL was rejected by Browser Use: URL protocols are restricted to
http/https, and the rejection expressly forbids alternate surfaces/transport,
indirect execution or raw browser commands to achieve that blocked action.
That export path stopped. No saved post-fix image or visual acceptance exists.
Root requested manually attached web/mobile-browser Settings screenshots and
instructed Visual Check to remain quiescent. Candidate c69f342f remains local;
main delivery and later loading/error/retry visual gates are unfinished.

### Internal-browser retry and current-source migration qualification

The user requires Codex's internal browser for further visual work. Visual Check
opened the authorized HTTP preview in internal tab47; `/app` redirected to
`/login` with an expired-session message. It emitted that login screenshot inline,
not as a saved original. Settings has not been reviewed in this browser. The
visual session requested action-time confirmation for the Sign in Terms/Privacy
notice and is waiting; no credentials were submitted or disclosed.

Frozen candidate c69f342f now also passes two separate migration fixtures:

- Fresh pgvector upgrade:1/1, zero failures/skips/cancellations, exit0. Legacy
  unbound consent and vectors are cleared, repeated migrations remain safe and
  stale legacy inserts are rejected. Log:
  /tmp/orbyn-c1-compact-settings-upgrade-20261008.log.
- Fresh stock-Postgres schema/data restored into a separate pgvector database
  before extension installation:1/1, zero failures/skips/cancellations, exit0.
  Installation preserves recorded migration timestamps, queues the existing
  fixture page and grants no semantic consent. Log:
  /tmp/orbyn-c1-compact-settings-late-restored-20261008.log. Only PostgreSQL17's
  unsupported transaction_timeout header was removed for the PostgreSQL16
  restore; schema/data and migration history were preserved.

These tests used new marked local test databases, not the preview or production
database, and made no vendor calls. They add current-source migration evidence
to the4248 stock regression and69 vector cohort without changing their counts.
Wider mixed-version worker operations, visual/native acceptance and the retained
C1 live-provider/cache gates remain open. Merge-tree against current main
7bb95c07 reports no conflicts; all four primary Settings/test copies match the
frozen candidate and unrelated mobile/app.json retains its recorded SHA1.
Candidate promotion remains pending; no full C1 completion is claimed.

### Sign-in blocker resolved

The human explicitly approved submitting the disposable QA Sign in and accepting
its displayed Terms/Privacy notice. Visual Check reports successful internal
browser sign-in to `/app` and is capturing the requested Settings states through
documented inline image output. No further sign-in confirmation is pending.
The earlier credential-handoff interpretation was corrected to the ordinary
authorized file-read/form-fill workflow; it was not a browser policy rejection.
Credentials remain excluded from reports, manifests and screenshots. No saved
post-fix originals or root visual acceptance are claimed while this batch runs.
