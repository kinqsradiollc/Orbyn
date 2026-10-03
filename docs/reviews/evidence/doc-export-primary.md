# Export primary-read qualification — 3 October 2026

Frozen8b48b1de full local suite: **2,209/2,209 passed**, zero failures, skips or
cancellations, exit0,520675ms. Dedicated marked database; full log
`/tmp/orbyn-export-primary-8b48b1de-full-tests.log`. Session43323 is terminal.

Actual-handler replica regression checks21/21 and combined export API/client
checks39/39 pass. All workspace types, production builds and full formatting
pass in `/tmp/orbyn-export-primary-final-{types,build,format}.log`.

The file and legacy Markdown routes use primary reads for document revision,
visibility, linked task state and link visibility even when the file transport
omits read-after-write headers. Permission filtering precedes version comparison.
A stale replica cannot supply a revision match or obsolete access.

Reconcile mainb00c736 before promotion, preserving both appended ADR notes.
That main checkpoint contains public Home examples (PR157 all four CI jobs pass).
Re-run combined current checks and exact-head CI; the frozen result above does
not establish full qualification after later code changes.

This backend change serves both clients and existing external file callers.
It does not implement rendered PDF diagrams/math or satisfy complete D1/U1.
No deployment or repository cleanup is established by these results.
