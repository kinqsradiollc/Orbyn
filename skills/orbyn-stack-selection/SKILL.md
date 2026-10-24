---
name: orbyn-stack-selection
description: "Choose or reassess a language, framework, database, runtime, hosting or build-versus-buy option from project constraints and current primary evidence. Produce a decision with operating and migration costs; ordinary implementation keeps the established stack."
---

# Select technology for this project

Use for an explicit technology recommendation, greenfield design, replacement
proposal or a demonstrated mismatch in the current stack. Read the consuming
project's instructions and [stack map](../../docs/agents/stack.md), then use
[how](../how/SKILL.md) to establish what already exists. A routine feature or a
popular new release does not require a new stack decision.

## Ground the decision

Record the user outcome, present architecture, actual team/tooling knowledge,
deployment targets and measurable constraints. Identify hard requirements first:
platform/offline support, data residency, license policy, consistency, accessibility,
latency/throughput budgets, reliability/recovery, integration and support lifetime.
Separate requirements from assumptions and preferences. Existing code is evidence
and migration cost, not an automatic veto on better alternatives.

Use the local [decision record](references/decision-record.md). For a small choice,
a few populated rows are enough; do not manufacture an ADR ceremony. Resolve a
consequential missing constraint with the human while continuing independent
research. Do not ask the human to invoke each research or architecture skill.

## Compare a bounded set

Usually compare the existing/default option and one or two credible alternatives.
Use [research](../orbyn-research/SKILL.md) for current official documentation,
source, release/support status, deployment limits, licensing and relevant advisory
evidence. Popularity and vendor claims do not establish fit or measured performance.
Raw clones belong in ignored reference storage under
[upstream review](../orbyn-upstream-review/SKILL.md); do not execute downloaded
installers/hooks merely to read their source.

Disqualify options that violate hard requirements before scoring preferences.
Compare the complete path: client/runtime, API, persistence, identity, background
work, deployment, observability and maintenance. Mark absent layers inapplicable;
adding a queue or Kubernetes requires a concrete need. Include managed versus
self-managed operations and build versus buy where relevant, including exit/data
export and ongoing ownership. Do not select a language solely from file counts.

Use a small criteria matrix with evidence and confidence. Weights can make an
explicit trade-off readable; do not invent precise scores for unknown costs or
let a weighted total override a failed hard constraint. The
[workload prompts](references/workload-prompts.md) identify questions to check,
not a ranked menu of universally best products.

## Think through three horizons

1. **Delivery now:** supported versions, team learning, dependencies, interfaces,
   data ownership and the smallest useful implementation.
2. **Operation next:** expected workload, capacity/latency budget, incidents,
   backup/restore, upgrades, security ownership and recurring total cost.
3. **Change later:** API/data portability, migration/rollback or roll-forward,
   compatibility windows, offboarding and a concrete trigger to revisit the choice.

Do not build speculative scale infrastructure for the third horizon. Identify the
future constraint and keep a proportionate seam or exit path today.

## Resolve uncertainty and hand off

Prefer the cheapest observation that could change the recommendation. A documented
limit may settle it; a benchmark needs comparable workload/hardware/versions and
correct completed work. Run a bounded disposable spike only within authorized
scope. Record what was actually measured versus assumed or documented. Never use
an external production account, subscription or paid provider simply because an
option appears in a comparison.

Return a recommended option, reasons tied to requirements, rejected alternatives,
material unknowns, validation evidence and a revisit trigger. Include a fallback
if a critical assumption fails. Offline work uses the local guidance and project
pins: label support/pricing/advisory freshness unverified and keep any decision
that depends on it provisional. A moving URL is not proof of the installed version.

Hand the decision to [architect](../architect/SKILL.md) for contracts, to
[orbyn-plan](../orbyn-plan/SKILL.md) for sequencing, and to the actual
[language guide](../language-best-practices/SKILL.md), backend, migration, UI and CI
owners for implementation. A recommendation or spike is not permission for a
rewrite, dependency rollout, public release or deployment. Preserve a request for
research/review only as a reviewable decision; do not implement the candidate.

See the [synthetic decision](examples/offline-service.md) for a complete small case.
