# ADR 006 — Document consistency, connection recovery and focused Settings

Status: implementation complete; owner approved PR and merge on 16 October 2026.
Final Tester, Visual Check and Reviewer closure waived by explicit owner request.
The intermittent production MCP incident remains an unconfirmed diagnostic follow-up.
Baseline: `b5ee4dd0`. This is a new combined correction scope, counter: 1/3;
ADR005's accepted presentation receipts remain historical and do not qualify
whole-document LaTeX synchronization. Its completion claim omitted that contract.

## Decision and required outcomes

- Note, Markdown and LaTeX are views of one canonical document. Opening LaTeX
  represents the existing document; accepted source edits update that document.
  Unsupported source remains recoverable without losing block identity, nested
  structure, comments, tasks, version checks or another format's content.
- Existing embedded standalone TeX documents remain preserved and independently
  editable; they must not silently replace the rest of a note. The format picker
  must not present an unrelated empty template as the note's source.
- Fix the supplied empty starter's HTML preview failure and retain exact source.
- Diagnose recurring MCP disconnections and correct the demonstrated lifecycle
  defect, preserving OAuth revocation, permission checks and credential secrecy.
- Activity uses the established dialog width/viewport rules.
- Settings sections open focused detail pages via chevron rows, with Back,
  search/deep-link access, close guards, retained drafts and concise content.
- External connected agents and Orbyn Background/Overnight agents occupy separate
  categories. Redesign agent customization as a focused, consistent editor.
- Apply the existing web/desktop and Expo web design system. Finish the complete
  code before one bounded Visual Check of changed flows, then fix findings in
  batches. Native app builds and external provider calls are separate.

## Qualification and delivery

Builder → Tester → Reviewer, maximum3 full rounds. Record exact candidate,
failures, retained evidence and limits in the delivery ledger. Visual checks cover
real synchronization transitions, Settings detail navigation, agent organization
and customization, and Activity geometry on web and Expo. Main delivery follows
accepted source; production deployment remains owner-controlled. No Security scan.

## Implementation boundaries

The canonical typed document remains the persistence format. Whole-document TeX
is a lossless projection for edits within existing plain text and equation
blocks. Markers retain block identity/order; one atomic leaf operation retains
container ownership. Rich blocks, structural changes and arbitrary preambles
are not silently converted. Unsupported edits stay in a recoverable draft;
Note/Markdown remain the paths for rich and structural editing. Whole-document
PDF export is unavailable when rich/container semantics cannot be represented
faithfully. Explicit standalone TeX blocks retain their own full source and PDF
export. Preview compatibility for the historical `\\null` starter does not
rewrite stored source.

Settings navigation owns one active detail per category. Returning with Back
retains mounted forms; search reveals parent details, and one-time credential
recovery guards still prevent departure. Orbyn profiles/schedules/context live
under Assistants. Connected agents separates external apps from Orbyn's own
assistant permissions. Character controls keep a live preview and one focused
option group; Save/Cancel own persistence and draft recovery.

OAuth refresh checks client ownership before replay side effects. Refresh and
revocation share a grant lock. A derived `reconnect_required` response separates
lost/expired credentials from pauses that Restore can recover. No credentials
are reconstructed. Strict refresh replay detection remains enabled: concurrent
refresh or a lost response can still require reauthorization. A successful
read-only live context request on 16 October establishes present reachability,
not the cause or absence of intermittent disconnects. Incident diagnosis still
needs the relevant non-secret audit reason/timing. No new environment variables,
service routes, migrations or credentials are introduced; existing env files
remain valid.

### Owner refinement — 16 October, 15:09

Keep the document header Download as the sole export entry. Remove duplicate
source-pane export/assistant controls and routine explanatory paragraphs. Help
is removed; errors, recovery and meaningful pending work remain visible.
Access-only sign-ins receive a short conditional lifetime notice on consent;
renewable sign-ins do not gain routine extra copy. Refresh capability remains
explicitly requested by the host, never silently upgraded.

### Owner refinements — selection and workspace navigation

Reuse the existing Note selection menu; do not add a second Ask/Explain popup.
Keep it hidden during selection gestures and reveal only after release/settling.
Markdown/LaTeX selections feed the existing header assistant action, with an
explicit quoted excerpt and stale-selection/version guards. Refine and Comment
retain their existing exact Note anchors; no invented anchors or emoji actions.

The main navigation resizes down to its 72px icon rail and back out, with keyboard
resizing and automatic fitting that preserves the preferred width. No separate
main-navigation collapse button. Library uses the same edge-to-edge styling in
browse and document views, with one Library collapse/reopen control. This latest
owner request supersedes the interim removal of every Library collapse control.
Remove the redundant document Back button; Library's All documents remains the
return route. These refinements require final affected-scope qualification.

The owner's final navigation refinement makes the main rail the initial desktop
state, with hover/focus labels and remembered explicit resizing. A versioned
width preference avoids retaining the previous expanded default. The mobile
drawer remains labelled. Library remains a continuous full-height surface with
subtle selected rows and one visibility control.

### Owner refinement — tabbed right workspace panel

Notifications opens beside the current page in the right workspace panel,
including the bell, navigation entry and command paths. Opening the panel does
not replace the main document/chat or create a main navigation tab. Existing
notification actions retain their explicit destinations and permission guards.

The panel supports multiple independently closable tabs, selected-tab keyboard
navigation and resizing. Existing read-only document/task/project peeks share
this panel instead of competing overlays. Tabs retain mounted content while
inactive; private panel state clears on session changes. Desktop uses a
complementary pane, narrow layouts use a focus-contained overlay with Escape
and focus restoration. It reuses Orbyn content and controls; no arbitrary
browser/terminal capability is implied by the Codex reference.

This addition reopens the product freeze after `6e67e82b`. Receipts for that
checkpoint remain valid only for that exact candidate; final Visual Check waits
for the combined implementation and preview-affecting builds.

Final owner geometry corrections preserve the preferred navigation rail when
Alongside/shared chrome opens, remove the secondary pane's inherited navigation
inset, and align primary/secondary tab rows. The split uses a 960px usable main
budget, allowing a narrow third Notifications pane at 1440px. Below the combined
budget the dock becomes a right side sheet; fullscreen is limited to phones.
Opening/selecting dock tabs does not reset split sizing or main navigation.

### Owner delivery decision

After the final outline screenshot, the owner explicitly requested skipping
Tester, Visual Check and Reviewer and proceeding directly to PR and merge.
The active-heading bar now applies only to the heading navigation button, not
its adjacent section menu. No additional qualification is claimed for this last
CSS change. Prior checkpoint receipts and failures remain historical evidence;
the unfinished final rendered pass is waived, not passed. Production deployment
and the intermittent MCP incident are not established by the merge.

### 18 October follow-up — explicit renewable consent and mobile landing

The consent page now offers Stay connected. The user's explicit choice controls
refresh issuance independently of the host's optional offline_access request;
absence of this new field preserves older consent-client behavior. The UI
capability flag hides the choice against older servers. Opting out remains
access-only. This supersedes the earlier host-request-only decision without
changing data scopes, grant deadlines, inactivity/family expiry or replay and
revocation rules. Existing access-only host credentials need one new consent;
current live reachability does not prove which renewal path caused a past prompt.

The public mobile landing page uses neutral supporting text and wrapping header,
actions and preview metadata. Rendered verification and test/review role runs
remain waived under the owner's delivery preference; package/type results are
recorded separately. No environment variables or migrations change.

### 18 October follow-up — brand consistency

Retain the orbit/wordmark; regenerate favicon, install/native/extension icons
and social exports from the current shared palette and bundled font families.
One committed generator owns those exports. Version browser asset references,
keep native masks safe, and use a monochrome macOS tray template. Archive legacy
green cover exports. Metadata supplies the first-party icon without changing
connection authority. See the brand refresh ledger for build evidence and the
unperformed native/cache/host rendering checks.
