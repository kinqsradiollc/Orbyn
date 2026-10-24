# Worked example: a green lane with no report

Synthetic workflow; this is a source assessment, not a hosted CI run.

**Request:** Review whether REA's selected provider lane can pass without testing
anything. Do not run tests or change files. The supplied workflow invokes a
selector, then a test runner and an aggregation job. The runner is skipped when
selection is empty; the aggregator accepts a missing report.

Trace the relevant changed file through the selector. If that required fixture
should select the lane but does not, the zero-test path and missing-report gate
can combine into a false pass. Identify both owning boundaries; distinguish a
legitimate optional platform skip from a required check silently disappearing.

Recommend a positive selection fixture and a negative gate fixture that removes
the required report. The gate should reject the latter, while preserving explicit
optional skips. This is a verification proposal until executed within scope.
Do not claim that source review reproduced a hosted green run or proved a real
Ghidra provider works.

**Counterexample:** Deleting the flaky assertion or accepting missing reports
would make CI less useful even if it reduced runtime. A historical successful
provider report cannot stand in for an unrun candidate lane.
