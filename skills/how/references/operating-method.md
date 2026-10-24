# Build a source trace that answers the question

Select the smallest observable entrypoint: a route, button handler, CLI command or worker claim. Resolve its actual registration and caller before following symbols with similar names. Read relevant configuration and types along with implementation.

Keep a compact trace: entrypoint → validation/authority → state owner → effect → result consumer. For each edge retain a file/symbol anchor and whether it is statically established or observed at runtime. For background work, include acceptance persistence, claim ownership, terminal result delivery and cancellation cleanup.

Investigate one concrete failure path beside the normal path. For an edit that disappears, follow version values through request parsing, conditional write and response handling; do not infer that a rerender caused the loss just because it is visible last.

Return the direct answer and the anchors needed to verify it. Name an unresolved dynamic import, deployment setting or unavailable runtime rather than inventing the missing edge. Historical motivation belongs to the history owner; source tracing does not establish an author's intent.
