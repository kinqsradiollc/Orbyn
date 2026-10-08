# Orbyn — Contributor Instructions

Canonical entry point for contributors and agent sessions. Read only the guides
needed for your role and task; linked rules apply to that work.

## Always

- Read [development](docs/agents/development.md) before changing code and
  [coordination](docs/agents/coordination.md) when collaborating.
- Complete the **agreed delivery scope → Test → Review**. Builder owns source;
  Tester executes checks; Reviewer assesses code quality and test evidence,
  then gives Builder actionable correction guidance.
- Maximum **3 full review rounds**; earlier approval is allowed. Preserve the
  counter and batch fixes. Match verification to the change and agreed scope.
- Preserve unrelated work. Record implementation, evidence and delivery separately.
- Use web preview for shared web/desktop UI and **Expo web** for mobile UI.
  Separate desktop-app checks, iOS builds and Android-specific verification
  require an explicit user request; browser results do not prove native behavior.
- Visual checks go through **Orbyn Visual Check**, only for a concrete bounded
  risk or explicit request. Reuse valid evidence; no automatic sweep per edit.
- Local QA sign-ins have standing user permission, including the Terms/Privacy
  acceptance shown by Orbyn's login. This covers disposable test accounts across
  local web and Expo origins; do not ask again for each preview. See coordination.

## Task guides

| Work                             | Read                                                                                                  |
| -------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Implementation                   | [Development](docs/agents/development.md)                                                             |
| Roles and handoffs               | [Coordination](docs/agents/coordination.md), [delivery workflow](docs/reviews/checkpoint-workflow.md) |
| Code and test-evidence review    | [Reviewer guide](docs/agents/review.md)                                                               |
| Product UI or copy               | [UI/UX](docs/agents/ui-ux.md), linked design/content skills                                           |
| Services, privacy and deployment | [Operations](docs/agents/operations.md)                                                               |
| Progress reporting               | [Tracker guide](docs/reviews/stage-tracker-guide.md)                                                  |

Keep task plans, active status and historical exceptions in task records, not in
these universal rules. Direct user scope and pause instructions take precedence.
