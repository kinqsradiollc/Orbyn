# Select tests from the changed contract

Use for requested test design, a regression or a verification plan. Read current
source, fixtures, runners and user exclusions before selecting a boundary. A plan
or this skill does not grant execution authority. Use an existing practical
harness rather than installing a new framework by default.

## Put the observation at its owner

| Changed contract                          | Useful boundary                                                   | What it cannot establish alone              |
| ----------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------- |
| Pure transformation or lifecycle decision | Actual production function with representative and invalid inputs | Serialization, database or UI behavior      |
| External/persisted input                  | Real parser/schema and error result                               | Current authorization at an effect          |
| Transaction, lock or stale write          | Actual supported engine in disposable scope                       | Released writer state or production cutover |
| External protocol adapter                 | Controlled protocol endpoint and bounded failure trace            | Live provider acceptance or account access  |
| User recovery flow                        | Changed interaction and relevant renderer/platform                | Other clients or installed-native behavior  |
| Small document/skill edit                 | Links, metadata, source integrity and relevant helpers            | Live agent improvement or product runtime   |

Assert the invariant: rejected writes preserve stored data, cancellation releases
owned resources, or retries retain one logical operation identity. A helper-call
count or error-string snapshot can pass while the real contract still fails.
Keep ordinary legitimate controls so an overbroad rejection cannot look correct.

## Choose data and failures deliberately

Use representative boundary values, malformed input and one relevant interrupted
path. For concurrency, control the actual conflicting boundary with barriers or
engine conditions where practical. Arbitrary sleeps make timing assumptions;
a mocked private helper can miss the real interleaving.

Keep fixtures isolated by test/worker and register cleanup as resources become
owned. Partial setup failure needs cleanup too. Prefer deterministic clocks,
identifiers and disposable storage when the contract allows them. Do not reset a
shared user's database or delete evidence to make reruns convenient.

Properties and fuzzing suit a stated invariant over many inputs. Pair an invariant
with known examples or an independent oracle: an identity implementation can pass
a round-trip test while doing no useful encoding. Bound runs, retain seeds and
minimized failures, and distinguish exploration from a proof of all inputs.

## Regression and scope

For a reported defect, preserve a failing-before observation at the chosen
boundary, make the correction, then check the same invariant and directly related
controls. If baseline execution is unavailable, say so. Test design may end with
a reviewable plan when execution is excluded.

Do not add tests that duplicate an implementation just to increase counts. Do
not broaden every change to every platform/suite. Use the CI owner's impact
selection for required checks and retain real evidence limits.

[The retry example](../examples/retry-test-plan.md) provides a Python/worker
verification plan without pretending the plan has executed.

Reviewed 24 October 2026 using [Python unittest](https://docs.python.org/3/library/unittest.html),
[pytest cleanup guidance](https://docs.pytest.org/en/stable/how-to/fixtures.html#safe-teardowns)
and [Go fuzzing](https://go.dev/doc/tutorial/fuzz) as concrete framework examples.
This method does not require any of those tools in another stack.
