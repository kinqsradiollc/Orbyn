# ADR 006 — Document consistency, connection recovery and focused Settings

Status: implementation in progress. Owner request: 16 October 2026.
Baseline: `b5ee4dd0`. This is a new combined correction scope, counter0/3;
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
