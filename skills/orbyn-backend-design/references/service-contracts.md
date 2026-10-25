# Production service contracts

Use the consuming stack, transport and persistence owners. This local checklist
extends the effect contract; it does not mandate REST, a queue, a database or a
new service. Select only the concerns changed by the task.

## Bound the request and the work it can cause

Validate shape, size and semantic constraints before expensive effects. Bound
page size, batch count, response bytes, recursion and external concurrency where
the caller can influence them. Parse once at the trust boundary, and retain
current resource/tenant authority at the committed effect. A valid cursor or ID
is not an access token.

For HTTP, give success and failures deliberate method/status/content semantics.
Do not turn a denied or stale write into a successful empty result. Keep public
errors stable enough for recovery without returning stack traces, SQL text or
credentials. Preserve API compatibility rather than standardizing every error
into a new envelope during an unrelated fix.

## Make repeated and concurrent calls explicit

Define an operation key, its principal/scope, payload-equivalence rule, retention
and response behavior before using it for a nontrivial external effect. Reuse
a key only for the same logical operation. Define pending/unknown completion and
how an existing receipt is reconciled; a timeout does not prove non-execution.

HTTP idempotency concerns intended effects, not identical responses or exactly-once
remote execution. A method name or a database transaction cannot establish the
behavior of an external provider. Retry only the classified failure under a
bounded attempt/deadline policy; honor relevant provider guidance when verified.
Cancellation stops only effects whose contract supports it.

For shared updates, make the freshness condition part of the actual write. Use
constraints, conditional updates or the engine's isolation/locking contract as
needed. Released consumers and multiple active writers need explicit compatibility.

## Return a predictable collection

Choose a stable ordering and tie-breaker. Bind pagination to the query/filter
meaning and version; treat incoming cursors as untrusted data. Apply current
authorization on every page. State whether results are a snapshot or a changing
collection and what inserts/deletions can do between pages.

Do not materialize an unbounded dataset to apply a limit in the client. Select
indexes from the actual workload and representative plans. Database migrations
and writer cutover remain with their existing owner.

[The cursor example](../examples/cursor-page.md) makes the tie-breaker and scope
checks concrete. [Observability](observability.md) supplies useful diagnostics
without logging request payloads.

## Deliverable and evidence

Return input/result/error contracts, bound values with their reason, retry and
concurrency behavior, affected callers and actual checks. Relevant cases include
a legitimate request, denied scope, malformed/oversized input, stale update and
an interrupted/repeated effect. Run only the cases required by the change and
authorized scope. A stub cannot qualify a live provider or production database.

Reviewed 24 October 2026 against [HTTP semantics](https://www.rfc-editor.org/rfc/rfc9110.html#section-9.2.2),
[OWASP REST guidance](https://cheatsheetseries.owasp.org/cheatsheets/REST_Security_Cheat_Sheet.html)
and [PostgreSQL plan guidance](https://www.postgresql.org/docs/18/using-explain.html).
The local procedure is original; use the actual target versions and existing policy.
