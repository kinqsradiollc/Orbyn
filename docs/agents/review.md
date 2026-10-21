# Review

Review the actual requested artifact and its surrounding contracts. State the
candidate revision or working diff and intended outcome. Use
[interrogate](../../skills/interrogate/SKILL.md) for deliberate adversarial review;
additional reviewers are optional and follow the same named-agent and concurrency
boundaries as other delegation. The owning lead always reviews substantial
delegated work against the actual diff and evidence.

## Evaluate the change

- Correctness: trace inputs, state changes and observable results, including the
  meaningful failure/recovery cases and the full agreed scope.
- Authority: inspect authentication, ownership, tenant isolation, consent,
  validation, secret handling and effects at their real boundaries.
- Design: inspect data ownership, dependency direction, duplicated interpretation,
  lifecycle cleanup, concurrency, retries and unnecessary complexity.
- Evidence: read assertions as well as results. Check candidate applicability,
  fixture realism, terminal completion and the limits of mocks or static analysis.
- Experience: apply [UI/UX](ui-ux.md) for affected flows, respecting the authorized
  platforms and finite visual scope. Code inspection does not establish layout.

Do not turn preferences, hypothetical redesigns or unrelated cleanup into blockers.
One concrete reproducible finding is stronger than several agents agreeing on a
speculation. Treat automated comments as claims to investigate.

## Findings and decision

Each actionable finding needs a priority, location, failing scenario, impact,
expected contract, correction direction and useful verification case. Separate
confirmed defects, evidence gaps and optional improvements. Explain dismissals
when resolving a supplied finding. Batch related corrections.

For an assigned independent review, write approve, changes required or evidence
pending against the frozen candidate. The reviewer owns reports only; the engineer owns
fixes and the verifier owns execution. Maximum three full rounds; early approval is
valid. Closure of known fixes can finish the same round without restarting it.

For ordinary lead review, distinguish the delegate's implementation from any
lead-owned edits. Lead-owned edits remain self-reviewed unless a separate reviewer
actually inspected them. Record checks excluded by the
user as unverified. Acceptance, merge, push and deployment remain separate facts.
See [delivery](delivery.md).
