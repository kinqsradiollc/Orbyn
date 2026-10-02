# Rendered PDF service candidate

### Rendered PDF service candidate — 3 October 2026

The export API now sends its authorized, primary-read HTML snapshot to a separate
PDF process. Requests use an independent HMAC key, signed body digest, one-minute
window and replay protection. Authentication and a bounded reservation precede
body parsing, including requests with query strings. The renderer has no database
or provider credentials. Work is capped at 1–4 concurrent jobs, 20 MiB input,
24 MiB output and a 35-second request deadline; cancellation closes owned browser
processes. Errors return no partial PDF and there is no plain-writer fallback.

Before delivery, the API checks access and revision on primary again: revoked or
deleted pages return 404 and changed pages return 409. Docker has a dedicated PDF
image, nonroot user, enabled Chromium sandbox, dropped capabilities, read-only
root and private temporary storage. Kubernetes additionally requires the documented
node seccomp profile; Kubernetes runtime qualification remains open.

Evidence before final commit: 45 actual export/primary/service checks passed;
9 current client/service checks pass after the query-string authentication fix.
Sandboxed Linux container fixtures rendered all ten Mermaid families and math
into an 11-page tagged PDF. That container image predates the latest service
authentication change and is not exact-head production qualification. Fresh all
workspace typechecks, production builds and formatting pass. Full current-head
suite, exact image/CI and real native export/publication acceptance remain open.

Public Home PR159 passed 2,209 local tests and all four exact-head CI jobs and
merged to main as bdc4035b. Its Muse/Dots references and concrete agent workflow
copy are retained. Broader source head0044a294 passed 2,474 tests. Neither result
qualifies this new renderer integration. Full ADR remains active; no deployment.
