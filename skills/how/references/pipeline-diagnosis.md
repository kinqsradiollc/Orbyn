# Diagnose a pipeline cluster at the owning boundary

Use after the [CI owner](../../orbyn-ci-design/references/bulk-failures.md) establishes
the expected matrix and failure inventory. A list of a thousand failures may have
several causes; a common error string does not prove one cause. Keep artifact,
configuration, suite, environment, instance, attempt and original evidence attached.

Choose a representative discriminating observation from each material cluster,
plus a passing control and exceptions that could falsify the hypothesis. Inspect
setup/dependency failures before assigning hundreds of downstream assertion bugs.
Trace the first relevant boundary using current source and authorized environment
facts. Separate application regression, test defect, stale expectation, input/data
drift, service/runner failure, concurrency/isolation and unknown. These are working
hypotheses, not classifications inferred from a keyword such as “timeout”.

For example, if only integration suites fail on one instance with connection
errors while unit suites pass, inspect that instance's dependency readiness and
configuration. A controlled healthy/unhealthy comparison can support the cause;
the error message alone cannot. If both configurations fail the same negative-total
assertion at the changed source boundary, reproduce the calculation independently.
One investigation need not fix every test individually.

Follow [reproduction](reproduction.md), preserving actual selected counts and
failing-before evidence. Keep source/configuration changes distinct. After a
supported fix, run the focused regression and affected cluster, then hand back
the project's required broader checks for the new candidate. Do not claim that a
representative test proves the entire cluster or environment passed.

Bound retries and exploration. Retain contradictions and unresolved groups in
the consumer's task record; ask only for consequential missing information or
authority, while continuing independent work. Hand confirmed cause, owning path,
regression, actual revision and remaining gaps to the workflow. Never erase
evidence or alter the CI gate solely because diagnosis is difficult.
