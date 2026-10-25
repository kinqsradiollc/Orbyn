# Evaluation

Define the behavior question, representative cases, independent grading and budget before running an authorized evaluation. Pin candidates and inputs. Blind labels where practical. Record failures, variance and limits; do not tune and score on the same examples while claiming general improvement. Model calls require scope and available tools.

Use the parent [workflow](../SKILL.md) and repository scope.

Use the [recorded-trial evaluator](../../orbyn-skill-creator/references/evaluations.md)
for this library's routing and outcome cases. Validate the suite, prepare a frozen
run, capture authorized host evidence, then grade it. Incomplete runs stay
unverified; deterministic CI fixtures are not a model benchmark.

For requested contribution execution, use the
[local execution lab](../../orbyn-skill-creator/references/contribution-execution.md)
and preserve actual reproduction, patch, Git, review and exact-head check evidence.
Keep blocked layouts and revised experiments separate; a scenario answer does
not substitute for the requested executable outcome.
