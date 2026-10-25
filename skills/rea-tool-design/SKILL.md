---
name: rea-tool-design
description: "Design REA tools or CLI/MCP contracts when modifying the vendored REA project; not ordinary Orbyn API work."
---

# Design a REA tool contract

Use this local method for REA tooling itself. Ordinary APIs belong to
[backend design](../orbyn-backend-design/SKILL.md); unsettled ownership belongs to
[architect](../architect/SKILL.md). Read the target checkout's instructions and
nearest existing contracts from disk. Source, docs and a connected catalog can
represent different revisions; record which supports each decision.

## Choose the boundary

State the analyst question, target identity, expected facts, allowed effects and
nearest existing operation. Extend an operation when intent and semantics match;
add one for a distinct outcome or authority boundary. Prefer provider-neutral
public concepts while reporting provider-specific availability and limitations.
Do not combine unrelated inspect, mutate and runtime modes just to reduce tool count.

Use inspection for object facts, discovery for candidates, tracing for supported
relationships and comparison for explicit paired observations. Compose a workflow
only when repeated use demonstrates a join that can preserve choices, evidence
and unknowns. A new cache, orchestration language or mandatory multi-call plan
needs an actual requirement existing primitives cannot satisfy.

## Specify the contract before implementation

Define strict inputs, target/admission identity, meaningful options, output fields,
coverage and errors. Keep observed, derived and inferred relationships distinct.
Unknown coverage is not an empty complete result; complete static direct edges do
not establish all runtime edges. Keep the requested answer and provenance usable
inline, with supported summaries/paging for large facts and access to full evidence.
Use the shared [evidence contract](../reverse-engineer-anything/references/evidence-and-recovery.md)
for summary-versus-dossier composition and integrity failures.

Declare process, filesystem, network, UI and mutation effects. Identify resource
owners and transitions: admission, readiness, active work, cancellation, observed
exit and verified release. A launch handle is not readiness; process exit does
not prove output closure. Attach ownership does not imply permission to kill the
target. Retain partial results and the primary diagnostic if cleanup fails; bind
recovery to unresolved owners and block conflicting replacement work. Shared
producers need independently cancellable waits and an explicit final-owner cleanup.

Keep provider interpretation in its owning layer. CLI and MCP should reuse the
same application semantics and typed errors rather than reparsing raw reports.
Review actual generated catalog/schema ownership in the target before edits;
do not hand-edit generated files to hide drift or invent unavailable capabilities.

## Deliver within scope

For design-only work, return the proposed input/result, effects, state/error model,
closest alternative, compatibility migration and verification plan. For authorized
implementation, migrate affected consumers and generated contracts together.
Choose checks at real trust, integrity, cancellation and cleanup boundaries;
mock-provider coverage and live-engine evidence remain separate.

See the [worked example](references/worked-example.md) and
[source record](../reverse-engineer-anything/references/source-record.md). No runtime
installation, source-pin change, publication or model configuration follows from
this skill; follow the user's scope and existing project policy.
