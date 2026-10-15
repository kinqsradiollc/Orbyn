# ADR 003 — final bounded visual batch

Prepared against product/test freeze `90305ece`; later documentation commits do
not change that runtime. **Not yet dispatched:** wait for the finite Tester batch
and code-review findings to settle. Orbyn Visual Check owns browser execution and
writes `docs/reviews/adr-003-final-visual.md`. Builder fixes reproduced findings
and requests only affected rechecks. Review counter stays 1/3.

## Runtime and evidence

- Shared web: `http://127.0.0.1:5174/app` from the candidate worktree.
- Mobile client: Expo web `http://127.0.0.1:8083`, same candidate API at 8008.
- Confirm actual process cwd/ref/API provenance and CSS viewport before checking.
  Tester owns QA until it hands the fixture back. No parallel fixture mutations.
- Protected QA credentials: `/private/tmp/orbyn-u1-final-visual-handoff.txt`.
  Use locally; do not print credentials or screenshot populated password fields.
- Local QA login/Terms/Privacy, synthetic fixtures and recoverable edits have
  standing owner authorization. Existing tool/site restrictions remain binding.
- Use permitted browser controls. Do not switch browser/port to bypass a Block.
- Record size/theme/ref/action/observed outcome and screenshot path for each case.
  Inspect the screenshots, density and task completion. DOM bounds alone are not
  visual acceptance. Record blocked/failed/untested accurately.

Use wide 1440×900, medium 900×800 and narrow 320×740 for shared web. Expo uses
390×844 plus a 320px narrow check and one 900px sheet/editor adaptation. Distribute
light/dark across cases; do not multiply every case by every size/theme.

## Cases — one representative batch

| Case | Shared web | Expo web | Success and recovery to observe |
| --- | --- | --- | --- |
| Navigation and typography | Wide dark, then 320 light | 320 light | Brand alignment, no repeated location or lane destinations, one collapse control, account menu, readable phone fields, long labels and reachable actions |
| Sidebar and paired tabs | Wide dark; 900 and 320 fallback | Platform sheet navigation only | Drag/cancel, keyboard bounds, reload persistence; independent pane drafts/scroll. On Second at 900/320, visible nav/search targets Second, repeated search retains query, First work remains. Keyboard return and failed-save departure keep the draft. Confirm real editor shortcuts do not mutate hidden/other pane or a dialog field. |
| Chat/Work | Wide new chat → Work; 320 active chat | 390 dark new/active and project history | Composer initially centered, Chat/Work same height, grows only to four lines then internally scrolls. Work stays in assistant, selects project; open/rename/pin history. Background/Overnight accessible inside chat with distinct controls; no extra sidebar destinations. Long response and connection device metadata legible. |
| Activity | Account dialog, medium light | Account sheet, narrow dark | Period totals/grid/details, unavailable history vs zero, full daily values and close/focus return |
| Normal note | Wide dark with comment/assistant decision | 390 light | Read/edit, selection, normal assistant proposal, fixed-size scrolling comment field, action reachability and draft retention |
| Markdown/equations | Wide split then 320 source toggle | 900 split then 390 source toggle | Source and rendered equations, retained edits/disclosure when width changes, hide/show source, assistant proposal access |
| Standalone LaTeX | Wide split and actual PDF page | 390 then medium | Exact source retained, compile, visibly inspect embedded PDF page (not only Download/HTTP 200), hide/show source and zoom/disclosure preservation; malformed source keeps draft/last PDF with useful error |
| Tasks/Agenda/Focus | Medium task edit/cancel/error and focus completion | 390 task/focus | Compact lists, no alert popups, usable edit sheet, retained input on error, focus completion feedback |
| Calendar | Wide event/block edit | Narrow day/block edit | Toolbar priorities, date selection, details/controls fit; cancel does not discard unrelated work |
| Projects/Docs library | Medium creation/detail and document departure | Narrow project creation/library | Clear hierarchy, compact actions, search/empty/long title, project chats, failed-save leave stays owned |
| Views | Medium table/filter/cell edit | Narrow filter/table/edit | Full value reachable, usable filter/picker, pending cell dismissal lock, saved vs refresh-failed state and Retry remain clear |
| Teams | Wide team planning and medium controls | Narrow team/week and retry | Compact rows, long names, no overlap; pending save owner and failed read retain context |
| Settings/connections/Admin | Medium dark editor; 320 open long picker | Narrow light focused editor/picker | Search/scroll/select last option in long collection, full selected value, connection failure/Retry, consent/consequences, keyboard focus/cancel; no huge disclosure hover fill |
| Secondary families | Browse Study, Lists, Memory/Agent notes, Notifications/Review at medium | One narrow sheet from these families | Shared rows, headings, empty/loading/recovery fit; no hidden actions or nested-card crowding. Source inventory supplies broader coverage, not a claim of every rendered screen. |
| Auth/public/booking | 320 light consent/login and public booking | Expo auth/consent, 390 dark | Required choices and material consequences visible; submit/validation/close usable, no overflow. Public booking recipient/timezone and confirmation clear. |

Tester may supply deterministic proposal/failure/team/View evidence. Visual still
checks the resulting UI and actual interactions above; no live paid provider is
required for synthetic acceptance fixtures. Do not infer native behavior, live
host integration, production deployment or unperformed failure paths from this
batch. Stop after these cases and report concrete findings.
