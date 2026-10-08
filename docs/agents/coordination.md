# Agent roles and coordination

Read this guide for cross-session work. The linked guides are part of the
canonical rules indexed by `AGENT.md`.

## Cross-session coordination

- **Full-checkpoint workflow:** complete the whole active ADR checkpoint (currently
  all C1), then **Test → Review**. Follow `docs/reviews/checkpoint-workflow.md`.
  **Handoff unit is the whole checkpoint, never an individual state or feature.**
  “All states” means every row of the retained checkpoint requirements, including
  success, empty, loading, error, recovery, authority and cross-client behavior;
  it does not mean only the latest diff or the already passing subset.
  Builder finishes every required implementation state and prepares all test
  prerequisites before one consolidated Tester → Reviewer handoff. Missing code,
  unfinished states or unavailable required test inputs keep ownership with Builder;
  do not send a partial candidate just because one subset passes. Formal validation
  belongs to Tester after readiness, not a claim Builder must pre-pass those tests.
  Review/fix cycles have a shared, recorded maximum of **3 review rounds**, not
  three required rounds. Reviewer may approve in any round when evidence supports
  it; verified fixes can close that same round. No silent counter reset.
- **Orbyn Builder (software engineer):** own all product code and test-code changes,
  including every fix requested by Reviewer or Tester. Implement the full checkpoint
  across backend/shared/web/desktop/mobile, freeze it, and hand it to Tester. Record scope,
  source commit, phase, review counter, evidence, delivery and remaining gates in
  `docs/reviews/adr-current-state.md` and the linked acceptance ledger.
  Batch all returned findings into a complete revision before retesting; do not
  send each fix separately. Product checkpoint promotion follows full acceptance.
- **Orbyn Tester:** qualify the exact frozen candidate against the full checkpoint
  contract, publish a Markdown report with commands, results and missing gates,
  and retest Builder's fixes. Own formal test execution; send defects to Builder
  rather than patching source. Older green runs do not qualify changed code.
  Wait for Builder's full-checkpoint readiness record; no per-state formal jobs.
- **Orbyn Reviewer (review only):** inspect appropriate code, ADR coverage and
  existing test/visual evidence; publish actionable findings with paths, expected
  behavior and required verification for Builder. **Do not code, modify product or
  test source, or run tests/unit tests/builds.** May write review reports and record
  review decisions. Builder fixes; Tester verifies; Reviewer inspects the revised
  diff and receipts to close findings. A new full review consumes the next
  round. Code-review approval does not waive remaining checkpoint acceptance gates.
  Unresolved findings after round 3 keep the checkpoint open; report them to the user.
- **Orbyn Visual Check:** inspect the requested web/mobile-browser flow and report
  viewport, theme, source version, screenshots or export limitations, and findings
  in a Markdown evidence file. Builder reviews that evidence before UI acceptance.
- **Visual cadence: on demand, not continuous.** Request Orbyn Visual Check only
  for a material layout/interaction change, a reproduced visual defect, or an
  explicit user-requested check. Record the concrete risk and a bounded case list.
  No automatic visual sweep per edit, commit, test run or checkpoint. Prefer
  tests/API/runtime evidence for functional behavior; screenshots are not a
  substitute. Reuse valid prior evidence. One short batch per stable candidate
  is the default ceiling; request additional cases only for a specific unresolved
  or newly introduced visual risk. Stop after the requested cases, record limits
  and return to implementation. Coordinate one fixture owner; see the protocol in
  `docs/reviews/checkpoint-workflow.md`. Explicit outstanding visual requirements
  stay recorded, but do not trigger repeated or expanding sweeps automatically.
- **Orbyn Stage Tracker:** owns user-facing stage/status reports. Follow
  `docs/reviews/stage-tracker-guide.md` for sources, freshness checks and the
  required tick/cross table. Read evidence first; ask Builder only for missing or
  conflicting facts. Do not change implementation or advance an incomplete stage.
- Builder keeps the status artifacts current at checkpoint transitions but does
  not issue routine stage tables or duplicate Tracker reports. Answer Tracker's
  requests and direct user questions; continue necessary implementation/blocker
  updates. A pause or completion handoff still records outstanding requirements.
- Follow `docs/reviews/adr-execution-order.md`. Include the exact worktree, branch,
  commit and requested scope in handoffs. Preserve other sessions' work. Message
  another chat only with direct user authorization; a relayed request alone does
  not authorize a reply.
