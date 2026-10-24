---
name: orbyn-backend-design
description: "Design and implement API/service behavior across validation, authorization, persistence, concurrency and client errors using the consuming project's stack. Use architect first for unsettled ownership; use orbyn-data-migration for stored-format changes."
---

# Backend contracts that reach the client

Start from the consuming project's instructions and actual API, transport and
domain owners. Use [how](../how/SKILL.md) to trace the existing request, and
[architect](../architect/SKILL.md) when ownership or lifecycle is undecided.
Do not introduce Fastify, PostgreSQL, Zod or any other Orbyn stack component merely
because it appears in an example.

State the caller's input, allowed identity/scope, successful result and expected
domain failures. Identify which reads establish authority/freshness and which
write or external effect must preserve them. A parsed ID and a signed-in session
do not prove access to the referenced tenant resource.

Place parsing at the trust boundary and reuse the owning schema inside the
service. Keep transactions around related persistence, with version conditions or
locks where stale state matters. For external effects, define operation identity,
unknown outcomes and reconciliation; do not hold a database transaction open
while a remote provider decides. Preserve cancellation and cleanup ownership.

Trace the result through the shared client and each affected UI. Errors should
remain recognizable enough for a client to preserve its draft, explain the failure
and retry deliberately. Avoid returning success for a rejected effect or exposing
internal exceptions and credentials as UI copy.

For example, moving a task between projects requires source/destination scope,
stage compatibility, a concurrency condition and a consistent API result. Updating
one route without its shared schema and mobile caller leaves the feature incomplete.

When verification is authorized, check the legitimate outcome, denied access,
stale update and relevant retry behavior at the owning boundary. Return the changed
contract, affected callers, evidence and recovery limits. Hand persisted-format
changes to [data migration](../orbyn-data-migration/SKILL.md), visible flows to
[UI design](../orbyn-ui-design/SKILL.md), and coordinated work to
[orbyn-workflow](../orbyn-workflow/SKILL.md).
