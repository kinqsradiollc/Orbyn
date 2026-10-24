# Worked example: evidence is blocked

Synthetic exercise. A source review identifies an object-read handler whose
visible path checks sign-in but does not show tenant membership. A middleware
binding and deployment route configuration are outside the supplied source.
No independent verifier or isolated execution tool is available.

The lead records the candidate's actor, input object ID, intended tenant boundary
and inspected files. It inventories the missing middleware/route control instead
of assuming it is absent. The coverage unit remains blocked. The candidate is
`needs_validation`, with no severity, and names the exact missing control evidence
and a bounded dummy-tenant validation plan. A source observation is not a completed
independently verified audit.

The report states the source revision and inspected scope, the missing independent
role and execution capabilities, and the incomplete coverage. It requests the
specific owner-supplied evidence needed; it does not test a production tenant,
create a scanner run, or change the handler. If later source proves a tenant guard
on the reachable route, reject or revise the candidate and retain its earlier
receipt instead of quietly deleting the failed hypothesis.

The bundled validators can check record consistency only. Their success cannot
prove that middleware is absent, a data boundary was crossed, or a reviewer was
independent. This document plans evidence; it represents no performed target audit.
