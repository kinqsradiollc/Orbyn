# U1 acceptance-map documentation review

**Decision: approve.** Reviewed candidate `f999f94b945d20d0cfd6e99320df44da40169e0a` in `/Users/anhdang/.codex/worktrees/c6-next/Orbyn`. Its two-file change adds `docs/reviews/u1-acceptance-map.md` and revises the acceptance section of `skills/orbyn-ui-design/references/design-rules.md`. The checkout was clean at inspection. No runtime changes are included.

The map correctly separates surface discovery, reusable evidence, missing evidence and confirmed defects. The named application/navigation entry points exist. Its inventory is a preparation artifact: it requires component/report provenance before requesting checks and does not claim that route presence or screenshots establish interaction coverage. It preserves existing deferrals, routes rendered checks through Visual Check, and retains the three-round ceiling. It explicitly places U1 execution after full C6 real-host acceptance.

The design-rule changes remove automatic native and enlarged-text audit requirements while retaining readable layout, system font scaling, focus/recovery and source-versus-rendered-evidence distinctions. This is consistent with `AGENT.md`, the current checkpoint workflow and the task-specific exclusions. It does not assert accessibility compliance or turn excluded checks into passes.

No blocking documentation correction is required. Optional clarity improvement: change the matrix header “Required checks” to “Representative checks” so it matches the new preceding explanation that checks are selected for the agreed risk. The explicit precedence and scope language already resolves this wording, so this is not an acceptance gate.

The map reports a public metadata HTTP 404 as an observation, not a diagnosis of deployment/configuration or proof of a product defect. Reviewer did not repeat that network request. Owner deployment remains pending in the handoff; no alternate host or bypass is approved here.

**C6 disposition is unchanged:** the local remediation/code checkpoint remains accepted; full C6 real-host acceptance remains open. This documentation approval permits integration of the reviewed docs under existing integration authorization, but does not start U1 implementation, authorize deployment, waive real-host cases or advance full C6 status.

Review consisted only of documentation/diff inspection and checking the named source paths. No product/test edits, tests, builds, scans, browser or visual checks were performed. Only this report was added.
