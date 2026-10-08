# Orbyn — Agent Instructions

Canonical entry point for all Orbyn agents. Read the guides required for your
role/task; their instructions are part of these rules.

## Always

- Read [development rules](docs/agents/development.md) before changing code.
- Read [roles and coordination](docs/agents/coordination.md) for all session work.
- Complete the **whole ADR checkpoint → Test → Review**. Builder owns source;
  Tester executes tests; Reviewer inspects code/evidence without coding or tests.
- Maximum **3 counted review rounds**, with earlier approval allowed. Preserve
  the counter; batch findings rather than handing off individual fixes.
- **Use web preview to qualify the shared web/desktop UI.** Do not require
  separate desktop-app visual, packaging or runtime checks unless the user
  explicitly requests them again. This is scope, not proof of native integrations.
- Preserve unrelated work. Record exact source, evidence and delivery separately.
- **Do not build iOS or perform Android-specific verification unless the user
  requests it again.** These are removed from C1 acceptance by the user's
  8 October instruction. Shared mobile source and mobile-browser parity remain.

## Task guides

| Work | Read |
| --- | --- |
| Product UI or copy | [UI/UX rules](docs/agents/ui-ux.md), linked design/content skills |
| Services, privacy, imports, deployment | [Operations](docs/agents/operations.md) |
| Checkpoint delivery | [Workflow](docs/reviews/checkpoint-workflow.md), [execution order](docs/reviews/adr-execution-order.md) |
| Stage reporting | [Tracker guide](docs/reviews/stage-tracker-guide.md), [current state](docs/reviews/adr-current-state.md) |

Use **Expo web** for mobile visual checks (the mobile app renderer, usually port 8083);
record it as mobile-browser evidence, not native verification.

Visual checks are on demand, through **Orbyn Visual Check**, for a concrete
bounded risk. Reuse valid evidence; no automatic sweep per edit or checkpoint.
