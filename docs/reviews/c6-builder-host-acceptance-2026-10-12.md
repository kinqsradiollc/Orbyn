# C6 bounded host evidence — 12 October 2026

## Scope and stop instruction

The owner reports deployed checkout `de83f54b`. Builder used the signed-in
internal browser at the owner's request. The owner subsequently instructed that
this task needs no further visual checking. Browser actions have stopped;
Visual Check, Tester, Reviewer and Stage Tracker have been notified.

This instruction removes further visual work for this task. It does not turn
unperformed interactions or live-provider prerequisites into passes.

## Observed results

- Canonical connection settings show `https://mcp.orbyn.dev/mcp`, using OAuth.
- **Manage app → Refresh tools** is available. Refresh completed with a warning
  naming the private `open_markdown_file` tool as unable to render its widget.
- After refreshing tools, the synthetic document's Orbyn card mounted and
  exposed **Edit a line → Review change → Submit change**. Earlier reports of
  absent controls remain historical; they are superseded for this observed card.
- Review displayed the intended before/after line. Submit reported
  “Change recorded. Refresh before another edit.”
- A fresh canonical fetch confirmed revision **2 → 3**, with the QA line changed
  to `Editable QA line: host review and submit verified.`
- **Refresh revision** then displayed revision 3 and the saved line.

Fixture: `doc:07775a91-a645-433c-930a-c79f9a5c68c4`, titled
`[QA] C6 canonical MCP preview — 2026-10-12`.
Only this synthetic document was edited. No existing personal document,
connector grant, provider permission or security setting was changed.

## Limits and next ownership

- The actual card showed Mermaid source fallback; no diagram-rendering pass.
- The host already displayed **CSP off**. Builder did not change it; enforced
  CSP and safe Mermaid runtime behavior remain unverified.
- UI conflict/draft retention, denied/proposal states and additional host
  interaction checks were not performed before the owner's stop instruction.
- Host uploads were previously deferred by the owner.
- Live managed/BYO readiness remains unverified as recorded in
  [the readiness audit](c6-live-provider-readiness-2026-10-12.md).
- Candidate `29f94942` corrects the named file-launcher visibility descriptor.
  Tester passed canonical 8/8, legacy 16/16 and backend types; Reviewer approved
  main integration in existing round **2/3**.
  This report does not claim that correction is deployed or full C6 is complete.

Builder owns further source corrections; Tester owns affected-suite execution;
Reviewer owns code/test-evidence acceptance. Stage Tracker owns consolidated
status. No additional visual sweep is requested.
