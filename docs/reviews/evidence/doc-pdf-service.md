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

### Renderer replay, deployment and full-suite integration — 3 October 2026

- Original renderer6f43fc92 full local suite is terminal: 2,484/2,485 pass, one failure in richer-pages.test.ts. Its PDF test lacked renderer configuration and correctly received503. No passing full-suite claim for this head.
- Replay fix4e8d2452 was reproduced first: a future-dated signature executed twice while still valid. Retain its nonce through timestamp+window; the new regression rejects the replay409 and expired request401. Current10 focused service/client checks and backend types pass. Its independent frozen full suite remains live, session34170; it retains the older rich-page fixture and must not be treated as final qualification.
- New candidate adds actual private renderer fixtures to both export and rich-page integration suites. The rich-page PDF is read as PDF text and checked for callouts, table values, footnotes and captions. All50 current export/rich-page/service/deployment focused checks pass.
- Deployment now validates an independent DOC_PDF_KEY and starts/rolls PDF before API. Documented PDF_REPLICAS and initial setup secret generation. Actual --check tests use a fake Docker executable, prove configuration-only commands, and reject missing keys without exposing keys. Container/Kubernetes manifest guards pass. No deployment performed.
- Current source checkout mobile typecheck found stale/inconsistent installed React/WebView types. This is not a pass. Rerun all workspace qualification in the integration checkout with its completed clean npm ci and matching new candidate head; CI also independently installs the lockfile.
- Preserve both ADR/handoff histories; all conflict markers resolved. DraftPR160 is stacked on the broad Docs source candidate; do not promote either wholesale. Exact full local/CI and production image qualification are still required, plus real native sharing/publication and remaining full ADR gates.
