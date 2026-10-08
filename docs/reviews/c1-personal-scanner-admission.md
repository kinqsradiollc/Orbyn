# C1 personal scanner admission

Updated 8 October 2026. C1 remains open.

## Scope

Goals, ideas, routines, delegated tasks and Overnight previously resolved the
workspace provider before looking for eligible owners. A configured personal
ChatGPT connection therefore could not enqueue work when managed AI was unset.
Five real database reproductions failed before the change and passed afterward.

Each scanner now filters by the owner's provider choice before its batch limit
and claims. A personal connection does not require managed AI or a live executor
lease to queue durable work. Missing bindings require explicit fallback and a
configured enabled managed provider/model. An absent choice uses managed AI.
Explicit `ai: null` still disables new admission; injected test providers retain
their existing override behavior.

Admission checks selection metadata, not credentials. Invalid managed credentials
are validated by dispatch rather than breaking the entire scanner before it
reaches unrelated personal owners. No vendor request or credential decryption is
performed by this predicate. Existing captured provider/model authority checks
remain mandatory at dispatch; admission is not execution authorization.

Task exhaustion/project-exclusion cleanup now runs even when managed AI is unset,
unless the scan is explicitly disabled. It returns exhausted/kept-out tasks to the
owner, without starting inference. Overnight expiry/notice cleanup is unchanged.

## Evidence

| Check | Result |
| --- | --- |
| Original five scanner reproductions | 0/5 before; 5/5 after |
| Expanded scanner tests | 22/22 |
| Scanner, existing worker, admission and managed authority cohort | 98/98; exit 0; no skips/cancellations |
| Backend typecheck | Passed |
| Diff whitespace | Passed |
| Full backend regression | Pending frozen candidate |
| Main delivery | Pending |

Focused log: `/tmp/orbyn-c1-scanner-admission-v3-focused-20261008.log`.
The cohort verifies all five personal/offline/disabled/unavailable cases,
explicit fallback metadata, managed disabled/empty selection, and a mixed-owner
routine batch with an unavailable earlier owner whose schedule stays untouched.
Existing worker tests cover source guards, retry/claims and Overnight behavior.
No external model call, new UI or production deployment is claimed.

Remaining C1 acceptance includes broader entrypoint/recovery and connection
matrices, live provider/cache and embedding qualification, error/overflow usage,
and enlarged-text/native acceptance. This checkpoint does not complete C1.
