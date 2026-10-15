# ADR 003 — Product UI/UX redesign

Status: accepted direction; implementation in progress. Owner direction: 12 October 2026.

## Decision

Rebuild Orbyn's web/shared desktop and mobile interface around compact navigation,
neutral surfaces, a restrained blue accent, readable text and one clear main task.
Use the supplied ChatGPT and Codex screenshots as interaction and density references.
Keep Orbyn's product identity and existing capabilities.

This is the new U1 redesign delivery. Previous platform checkpoints are closed under
their recorded acceptance scope; their explicit follow-ups remain in the archive.

## Design contract

- Main content uses a calm, bounded work column; task and document canvases can expand.
- Settings and short edits use owned modals/sheets with clear dismissal and draft preservation.
- Navigation, menus and selection controls have concise labels, clear selected states and keyboard access.
- Routine settings use grouped rows. Explanations appear only when needed for a decision;
  optional detail uses named disclosure. Preserve consent, costs and destructive consequences.
- Use neutral light/dark surfaces and shared semantic colors. User-selected tag/calendar colors remain.
- Remove ornamental entrances, stagger and hover lifts; retain useful progress and brief state feedback.
- Reflow at actual available width; narrow screens show one secondary panel at a time.
- Web input text remains at least 16px on phones to avoid focus zoom. Touch targets remain reachable.
- Preserve user content, permissions, provider/fallback contracts, drafts, cancellation and recovery.

## Whole delivery scope

| Area                       | Required redesign                                                          |
| -------------------------- | -------------------------------------------------------------------------- |
| Foundation                 | Shared palette, text, spacing, motion, controls and selections             |
| Shell                      | Navigation, top bar, search, notifications and responsive panel ownership  |
| Assistant/Home             | Compact composer, useful suggestions, readable results and device metadata |
| Tasks/Calendar/Focus       | Scannable lists, restrained toolbars, detail/edit overlays                 |
| Projects/Docs/Browse       | Clear hierarchy, document canvas, compact actions and library navigation   |
| Settings/Admin/Connections | Grouped controls, short copy, clear connection and usage states            |
| Auth/public                | Consistent forms, consent and public content hierarchy                     |
| Mobile                     | Expo web parity, touch-first sheets and compact navigation                 |

## Acceptance

Complete all code before one stable-candidate Test → Review handoff (maximum three
review rounds). Request Visual Check at the end for affected web and Expo web flows,
covering 320px, medium and wide windows, light/dark, open selectors and overlays.
Visual findings are fixed and rechecked only in their affected flows. Native builds
are excluded unless explicitly requested. Record each area and evidence in the
[delivery ledger](../reviews/ui-ux-redesign.md); do not equate token changes with a full redesign.

## Scope refinement — 13 October 2026

Owner's supplied screenshots further define the same delivery, not a separate checkpoint:

- One navigation collapse control, owned by the top bar; the sidebar footer holds
  one account trigger with a compact menu for Settings and sign out.
- Add a personal Activity destination with completed tasks, recorded focus time
  and active days. Use a daily activity grid and concise period totals where
  historical records support them. Define timezone, period and event counting;
  never substitute AI tokens, estimates or invented streaks for planner activity.
- Settings connection collections use searchable compact rows, bounded list
  presentation and focused detail/edit screens. Preserve complete values,
  pagination/recovery, permissions and separate provider/MCP identities.
- A preference has one disclosure chevron and one value control. Avoid duplicate
  collapse actions and nested wrappers; retain clear labels and keyboard access.
- Account menus and activity views follow the same web/Expo parity and final
  full-candidate verification flow. No per-edit visual sweep is added.

Activity runtime acceptance, connection detail restructuring and the Settings disclosure
inspection remain required; the screenshots are design
references, not verified Orbyn behavior.

### Personal Activity data contract

Activity is a private account dialog/sheet, reachable from the web account menu
and mobile Account settings. Offer 30, 90 and 365 day periods, concise totals and
an activity grid with accessible daily details. It is not a public profile.

Task completion history records actual non-done → done task transitions through
`mutate`, including recurring occurrences. It begins with migration 267; no
historical dates are guessed. Days before recording began show an unavailable
completion value, rather than a false zero. Focus minutes come from work sessions
and belong to their start day. Active days have either a recorded completion or
positive recorded focus minutes. Connected-agent work for the account is included.

The authenticated summary uses the account timezone, bounds its period, returns
no titles/content, and rechecks current item visibility. Deletion removes linked
completion records; snapshot restoration preserves their original timestamps.
Personal exports include personal completion history. No configuration variable
or additional service is required; the existing API service owns the endpoint.
Migration/runtime and rendered acceptance remain required before delivery.

## Chat workspace refinement — 13 October

Use the supplied Codex chat/sidebar reference for a compact chat workspace:
a centered readable conversation and quiet header. New conversations center the
composer with a short greeting above and suggestions below; active conversations
dock it at the bottom. Chat and Work start at the same compact input height, grow
to four lines, then scroll internally. Keep full messages and meaningful approval/progress states.
Background and Overnight appear beside ordinary chats, with their configured
names and a clear lane label. Opening their work must preserve separate execution,
scheduling, permission and approval contracts. Web keeps the chat navigation
beside the agent work; mobile uses its existing drawer and focused sheets.
This extends the current full redesign scope; it is not a separate delivery.

### Chat, Work and paired tabs

Chat and Work are modes within the chat workspace. Work chooses a project beside
the composer; it does not redirect to Projects. Project conversations keep their
saved history, pin and rename controls. Existing sweep timing and pinned exemptions
remain unchanged. Project details also expose New chat and Chats.

Paired tabs must support two independent working panes, with separate selection,
scroll and drafts, clear focus/close controls and a single-pane narrow fallback.
Global navigation and shortcuts must target the focused pane. The primary workspace
uses one header row for its navigation toggle, tabs and shared actions. Header
actions condense using measured pane width; paired panes keep separate tab and
focus ownership. Do not duplicate
a shared controller or weaken application framing protections to simulate this.
Implementation and complete-candidate verification remain open.

### Document editing refinement — 13 October

The owner requests normal note editing and a source editing option with a side-by-side
rendered view, including a control to hide the source pane. Assistant support must
remain available in both editing modes. Page comment boxes must not be manually
resizable; longer text scrolls within the control.

The owner confirms **all three modes**: normal notes, Markdown source beside the
rendered note (including equations), and standalone LaTeX beside compiled PDF.
Source panes are hideable; assistant edits remain reviewable proposals in each
mode. Standalone TeX must retain exact source and revisions without replacing
existing note content. Compilation runs in a private bounded service; source,
compiler and rendered-interaction acceptance require evidence before delivery.


### Navigation refinement — 14 October

Background and Overnight belong inside the Orbyn chat workspace. Do not repeat
them as primary sidebar destinations. Preserve their conversations, runtime
controls and existing links.

The owner's screenshots show the location repeated above the active tab, wide
tab pills and a misaligned wordmark. Let tabs own the location when visible;
use content-sized tabs with full accessible names and reachable actions.
Expanded navigation must resize by pointer and keyboard, remember its chosen
width, preserve a usable working pane and retain the compact/narrow fallback.
Verify drag/cancel, keyboard bounds, reload persistence, brand alignment and
paired-pane containment in the complete-candidate acceptance batch.

### Pointer feedback refinement — 14 October

The owner rejects the large grey hover fill on Settings disclosure headings.
Keep those headings neutral; use only a subtle chevron change for pointer feedback,
retain visible keyboard focus, and distinguish hover from an actual selected state.

### Macro layout reference — 14 October

The owner's local Macro reference informs explicit pane ownership, stable content
lifetime, actual-pane-width adaptation and priority-based tool collapse. Keep
Orbyn's shared planner and pane-scoped controllers. Hidden panes retain their
work while yielding focus and shortcuts; pane switching restores a connected,
visible last-focused child, with a safe container fallback.

Navigation and repeated search must target the focused visible pane without
resetting the existing query or draft. Temporary dialogs retain input ownership
until dismissal. Use container rules first for secondary tool collapse; add
measurement and expansion hysteresis only where intrinsic content needs it.
These are implementation refinements within the existing React/Expo delivery. Constrained source dialogs show one
editing/preview surface while retaining the requested split preference for wider
space. Source edits update renderer requests without remounting presentation
state; zoom, disclosure and drafts belong to the stable content owner.

The [Macro source report](../reviews/macro-layout-reference-2026-10-14.md)
records source evidence and tradeoffs. Macro's native stack is not proof of
narrow-browser behavior. Retain Orbyn's cancellation, permission, provider and
semantic-theme contracts. Source inspection does not qualify rendered or native
behavior; the complete-candidate handoff must verify focus, independent drafts,
search reuse, hidden-pane shortcuts and narrow/paired document tools.

### Document source and common Note preview — 15 October

Note is the rendered document for all three editing choices. Markdown and LaTeX
open inline beside that Note output; source can be hidden without leaving the
page. Remove the nested Source/Split/Preview navigation and source modal from the
normal editing path. Keep Note, Markdown and LaTeX directly discoverable in both
legacy and structured editors on web and mobile. Opening source from Read enters
Edit for a writer; Suggest and reader authority remain unchanged.

One document/account owns the compiled PDF across presentation changes. Saved
LaTeX automatically updates after a 1.2-second debounce, with at least four seconds
between automatic starts. New edits cancel stale requests. Preserve the last
valid PDF during changes and failures; show a nearby Retry only on failure.
The authenticated preview API retains revision and permission rechecks and allows
20 requests per minute. Readers do not gain compilation authority. Native PDF
opening remains distinct from the embedded browser preview. Assistant proposals
continue to require acceptance in every format.

## Final visual corrections — 15 October 2026

Note remains the common rendered output for Markdown and standalone LaTeX. Use
an app-owned, offline PDF.js viewer with page/zoom controls and readable page text
so embedded rendering does not depend on the host browser's PDF plugin. Source
controls stay grouped at the top; preview errors have one visible recovery area
in Note. Wrapped document titles resize with the available pane.

Focus renders at the viewport root, independently of the scrolled working pane.
Agent notes has one screen heading. Newly created booking pages use the shared
blue accent; explicitly saved booking branding is preserved. These corrections
remain subject to the existing affected Test → Review and final visual gate.

### Mobile Connections correction

Connections opens with folded service groups rather than a continuous form.
Agent preferences use named nested groups. After first opening, folding retains
form state; active requests prevent folding or closing their owner. Permission
and sharing decisions remain visible inside the relevant task. Compiler launchers
must retain an init process so repeated previews cannot exhaust process capacity.
