# Diagnostics with an owned purpose

Start with a question an operator or maintainer must answer: where an operation
stopped, which phase is slow, whether a retry repeated an effect, or why access
was denied. Inspect existing logs/metrics/traces and retention/export policy before
adding instrumentation. No external collector, account or telemetry enablement
follows from this guide.

## Define the evidence contract

For each event or measure, name its producer, operation phase, intended reader,
allowed fields, units, cardinality and retention. Correlation identifiers can
still be sensitive or linkable; use them only under the consumer's policy.
Never attach tokens, bearer URLs, credentials, document contents or full request
bodies merely to make a failure easier to debug.

Prefer bounded event/error categories and route templates over one metric label
per user, item or raw URL. Put a high-cardinality diagnostic in a controlled
appropriate record only when necessary. Do not hash a secret and describe the
result as automatically anonymous or safe to export.

## Distinguish what happened

Track accepted, committed and delivered phases separately where those boundaries
matter. Record outcome and relevant phase timing with units. Account for failures,
retries and cancellation instead of calculating latency only for successes.
Define the denominator and sampling limitations before publishing a rate or percentile.

Keep error handling functional if logging/export fails. Bound queues and buffers,
and assign shutdown/flush ownership; instrumentation must not introduce an
unbounded memory path or change the business transaction's meaning. Avoid logging
one failure at every wrapper unless each record adds a necessary distinct fact.

For a worker timeout, a useful trace can connect request acceptance, durable
operation identity, claim and terminal result. A client timeout plus a server
acceptance event still leaves committed outcome unknown. Resolve that through
the existing operation owner rather than inventing success from a log line.

## Scoped checks and output

When authorized, use synthetic inputs to check redaction, stable error categories,
phase ordering and bounded behavior when an exporter is unavailable. Inspect actual
records without exposing private payloads in the report. Reuse valid evidence
rather than enabling live telemetry to review a documentation change.

Return the question, producer/fields, observed records or proposed schema, policy
limits and missing runtime evidence. Product monitoring, deployment and live
account access retain their own applicable authorization.

Reviewed 24 October 2026 against [OpenTelemetry sensitive-data guidance](https://opentelemetry.io/docs/security/handling-sensitive-data/).
This procedure works with existing local logging; adopting OpenTelemetry is optional.
