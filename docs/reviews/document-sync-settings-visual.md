# ADR006 document synchronization and focused Settings — visual evidence

Product candidate: `a926336a`, branch `codex/document-sync-settings`.
Checkout: `/Users/anhdang/.codex/worktrees/c6-next/Orbyn`.
This is the initial bounded findings batch, not whole-scope acceptance.

## Provenance and authorization

Only the separate UI Preview disposable account was used: preexisting Chrome
tab177870268 at `http://localhost:5174/app`, plus Expo QA tab177870465 at
`http://127.0.0.1:8083/`. Chrome's current browser inventory ID is4; this is the
same QA Chrome profile/tab, not the denied owner's in-app page. The saved denial
for owner `http://127.0.0.1:5174/app` was respected; no attempt to inspect it or
substitute another surface was made. No credentials printed, provider execution,
uploads, production, security scans or native checks.

Actual measured web CSS viewport1280×900, dark; Expo390×844 then320×800, light.
Both clients loaded candidate frontend. Read AGENT, UI/content skills and ADR006.
Tester shared package writes interrupted one profile-save aftermath; this is
recorded as an interruption, not a product failure.

## Actual observed outcomes

| Flow | Evidence |
| --- | --- |
| Existing Note to whole-document LaTeX | Structured fixture3e7556af-8a68-492c-9fcc-e9ac898da0b3 includes prose, display equation, two embedded standalone TeX blocks and two further paragraphs. LaTeX now projects the entire note with block markers; preview preserves all content. It does not substitute an unrelated starter. Embedded source remains commented/preserved with its ID. |
| Prose/equation canonical editing | Changed first prose to “A synchronized workshop note.” and equation to x²+y²=z² through LaTeX. Live canonical preview immediately changed; Markdown contained the same new text/equation. Mode change saved, reload/reopen retained both changes. Replaced through Markdown with original prose/equation; reopening LaTeX reflected restoration. |
| Unsupported source and recovery | Unknown command in editable block retained exact source, displayed conversion limitation with Restore current document. Clicking Note did not leave the unsupported draft. Restore returned canonical source and Note; original content remained. No silent overwrite. |
| Mobile canonical source | Expo320 LaTeX contains same complete projection. Changed prose, switched Preview while Unsaved: new prose and existing equation/embedded results visible together. Source returned exact draft. Restored original source and returned Note/Saved. |
| Activity before Settings | Actual first opening Activity at1280 yielded1000px dialog, centered x140..1140, no root horizontal overflow. Initial screenshot captures loading; populated mobile evidence described below. |
| Focused Settings | Your account chevron opens only its content with Back; other account sections are absent. Search “reading” result opens focused Reading parent with Back. Assistants has Background & overnight, schedule/context/rules categories distinct from Connections. |
| Draft retention | Changed Background name to Workshop helper, Back then reopen retained draft. Background/Overnight lane controls disabled with explicit Save or cancel instruction. |
| Customization | Live named character preview plus one active Shape group; body shape options available. Changed Orb→Cloud, Cancel restored Background name and closed customization. Temporary name Save persisted Workshop helper across interrupted reload; reopened and restored Background using Save, confirmed disabled Save/Cancel afterward. |
| Connection separation | Connected agents detail has Connected apps and Orbyn assistant categories; empty external list separate from built-in Orbyn permission entry and standing rules. No permission mutation. |
| Expo focused Settings |390 section list→Assistants→Background & overnight opens one detail, Back available.320 customization shows one selected group with visible live preview. Category menu Close menu dismisses only menu. Body shape ChoicePicker has its own Close, dismissed without closing Settings or changing selection. |
| Expo Activity |320 CSS width/root scrollWidth320;30/90/365-day choices distinct, metrics readable, heatmap and Daily details reachable. No horizontal overflow. |

## Findings, limitations and design judgment

No new reproducible product defect was established in this executed batch.
Whole-document synchronization is materially different from the prior embedded
preview: existing note text/equations now visibly round-trip. Focused Settings
reduces competing sections, and assistant identity/permissions are understandable
as separate destinations. Customize has recognizable grouping and live feedback.
Phone control targets remain usable; the conversion helper is long but explains
an important boundary rather than optional marketing text.

Qualification is incomplete, with these explicit remaining cases:

- Existing heading through whole-document TeX was not exercised (current fixture
  has no ordinary heading block); actual ordinary Note edit→TeX refresh was not
  separately exercised beyond Markdown→TeX refresh.
- The historical `\\null` default starter was not newly entered in this batch;
  existing standalone blocks rendered, but that is not starter acceptance.
- Name Save persisted; character choice Cancel was verified, but saving a changed
  character and reopening it was not separately exercised.
- Web narrow Activity and Settings/character reflow remain unverified. After the
  shared-build interruption, supported web CDP reports “Raw CDP is unavailable
  while Browser Use is resolving a paused document response.” A browser viewport
  request did not change measured web1280 (it targets selected surface). It is
  not counted as a narrow result. No restriction or policy bypass attempted.
- Enlarged-text/reflow and native scaling remain unverified; no magnification
  surrogate is claimed. External consent/reliability not visually qualified.

## Absolute screenshot paths

- `/private/tmp/orbyn-adr006-tex-recovery-web.jpg`
- `/private/tmp/orbyn-adr006-customize-web.jpg`
- `/private/tmp/orbyn-adr006-activity-web.jpg` (first opening/loading,1000px width)
- `/private/tmp/orbyn-adr006-customize-mobile-320.jpg`
- `/private/tmp/orbyn-adr006-tex-preview-mobile-320.jpg`
- `/private/tmp/orbyn-adr006-activity-mobile-320.jpg` (initial capture; subsequent
  screenshot inspected populated metrics/heatmap at same measured320)

The file named `activity-narrow.jpg` was captured while measured web1280; it is
not narrow evidence and is intentionally excluded above.

## Fixture handback

Original Markdown equality confirmed byte-for-byte against captured pre-edit
baseline (including source IDs). Returned web Note/Saved; mobile Note/Saved then
closed own document/Settings overlays. Background saved name restored. No owned
comment/request/proposal or unsent source draft remains. Mobile metrics and browser
viewport override cleared, tabs marked handoff. Web tab remains at1280×900 because
its CDP reset is subject to the same paused-response limitation; owner may clear
that tab override when control resumes. Product source untouched. Parent owns
fixture again for correction batch; retain these passes and qualify remaining
cases in the targeted closure rather than repeating the completed matrix.
