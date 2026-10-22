# Evaluation

Define the behavior question, representative cases, independent grading and budget before running an authorized evaluation. Pin candidates and inputs. Blind labels where practical. Record failures, variance and limits; do not tune and score on the same examples while claiming general improvement. Model calls require scope and available tools.

Use the parent [workflow](../SKILL.md) and repository scope.

Use the [recorded-trial evaluator](../../orbyn-skill-creator/references/evaluations.md)
for this library's routing and outcome cases. Validate the suite, prepare a frozen
run, capture authorized host evidence, then grade it. Incomplete runs stay
unverified; deterministic CI fixtures are not a model benchmark.
