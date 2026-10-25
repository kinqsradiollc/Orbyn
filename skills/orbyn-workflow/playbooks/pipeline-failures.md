# Bulk failures through release verification

Use when asked to diagnose a large CI failure set, repair a multi-suite pipeline
or establish readiness across test/release environments. Follow current consumer
instructions and authorized effects. The agent selects owners from the task;
do not ask the human to invoke each skill, collect every report or fill a hashmap.

1. Use [CI bulk analysis](../../orbyn-ci-design/references/bulk-failures.md) to
   collect and validate the full required matrix and attempts. Preserve missing
   reports and invalid newest runs as blockers. Limit readable summaries, not
   the inventory. Keep raw/indexed evidence outside shared skill exports.
2. Use [how's diagnosis](../../how/references/pipeline-diagnosis.md) for
   evidence-backed shared causes, then [TDD](../../tdd/SKILL.md) for meaningful
   regressions and controls. Prioritize impact and shared dependencies; avoid
   one worker per failing test or loading all logs into every agent context.
3. Fix within the owning source/configuration boundary. Retain unrelated work
   and original failures. Re-analyze the corrected candidate with appropriate
   broader checks; a targeted pass does not prove every suite passed.
4. Use [release verification](../../orbyn-ci-design/references/release-verification.md)
   for complete current evidence and the actual artifact. Follow existing authority
   for a requested next effect. Evidence-ready, merged and deployed remain distinct.

Use [bounded PR iteration](pr-iteration.md) when feedback/publication is in scope
and its commit/push gate before delivery. End with confirmed causes/corrections,
full counts and unresolved blockers, not blame or a promise of zero future failures.
