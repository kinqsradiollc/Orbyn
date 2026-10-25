# Design a service that can be operated

Use when a new service, material workload change or reliability requirement is
in scope. Reuse the team's existing design and runbook. Resolve only consequential
unknowns; do not require a production-readiness document for a local label edit.

Start with the person's critical journey and what counts as a correct result.
Choose a measurable indicator, denominator, observation window and target with the
product/operational owner. Availability of an HTTP endpoint may miss late jobs,
incorrect results or lost updates. Mark targets as required, measured or unresolved;
do not invent an SLO, SLA or error budget. Link the target to an action when its
budget is exhausted, following existing service policy.

Record normal and burst demand, payload/retention growth and concurrency. Identify
the limiting resource and dependency quota; estimate capacity with stated units
and assumptions, then validate the consequential assumption. Define queue bounds,
backpressure/admission, deadlines, retry budgets and degraded behavior for dependency
failure. Include restore time/data-loss objectives and reconciliation of effects.
Use the existing [performance method](../../orbyn-workflow/playbooks/perf-issue.md)
for measurements; do not call a capacity estimate a benchmark.

Name the operator, alert route, diagnostic access and recovery procedure. Connect
privacy/data classification to retention/deletion, backup restoration and diagnostic
fields. Avoid sensitive payload logs and unbounded metric labels. Use
[backend contracts](../../orbyn-backend-design/references/service-contracts.md) and
[observability](../../orbyn-backend-design/references/observability.md) for mechanisms.
Security review follows the task's actual authority; this method starts no scan.

Deliver the changed operating contract, unresolved go/no-go conditions and a
representative load/failure/recovery rehearsal. Distinguish design, test environment
and deployed observations. Hand progressive exposure to the
[rollout owner](../../orbyn-ci-design/references/rollout-recovery.md).

Example: a fast export endpoint queues jobs that never complete under bursts.
Measure completed, correct exports and queue age; constrain admission and retry
amplification, define a recovery owner and rehearse dependency loss. Returning
202 quickly does not establish the user's reliability target.

Primary background: [Google SRE implementing SLOs](https://sre.google/workbook/implementing-slos/).
The procedure is independently written and remains usable offline.
