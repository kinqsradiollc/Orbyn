# Evaluate a skill change

The [case suite](../evals/cases.json) contains routing requests, adjacent non-triggers
and artifact tasks. The [tool](../scripts/evaluate.py) validates cases, prepares
task inputs, grades recorded observations and compares matched runs. It does not
call a model, execute arbitrary artifacts, access accounts or infer a host's model.

## Three kinds of evidence

1. Static validation establishes that cases, skill references and rubrics are coherent.
2. Disposable fixture tests establish that tooling catches missing evidence,
   wrong routes, forbidden effects and malformed records. Fixtures are synthetic.
3. Recorded agent trials establish observations about a particular candidate,
   host/model and task. Human review remains necessary for prose, design and
   architecture quality. A transcript is evidence to inspect, not a trusted claim
   that its author performed every stated action.

Never present fixture scores as agent performance. A real run requires supported,
authorized host execution. Record the full host version, model, effort/processing
and relevant tool configuration in the `host` and `model` provenance strings.
Keep those strings equal for paired comparisons; use a fresh context and the same
fixtures, capabilities and task scope for each condition. Keep user/system policy
constant. Register only the intended skill selection; check that a baseline has
not inherited the candidate through global discovery or conversation history.

## Prepare and collect

From a library or pinned consumer checkout, select the committed revision:

```sh
python3 skills/orbyn-skill-creator/scripts/evaluate.py validate
python3 skills/orbyn-skill-creator/scripts/evaluate.py prepare --output /tmp/skills-candidate --revision FULL_40_CHARACTER_COMMIT --host HOST_VERSION_AND_TOOL_CONFIG --model MODEL_EFFORT_AND_PROCESSING --condition candidate --trials 3
```

The output directory must be new. `tasks.json` contains requests without expected
routes or grading rubrics. `run.json` starts with every trial `not_run`. Give each
request to the authorized host, capture its visible transcript/tool events and
save resulting artifacts inside that run directory. Do not collect hidden reasoning.
Use `--split holdout` only after revising against the development cases; freeze the
candidate before looking at held-out results. The public split prevents accidental
reuse, not deliberate access to answers. Authors must not tune against it.

An observer fills each result from actual evidence:

- `status`: `completed` includes unsuccessful attempts; unfinished work stays `not_run`.
- `selected_skills`: canonical skills actually read; do not infer selection from prose.
- `actions`: observed categories, including `write`, `write_product`, `test`,
  `publish`, `deploy`, `merge`, `message` when applicable. `write_product` means
  modifying application source; writing the requested answer artifact is `write`.
- `transcript`: relative UTF-8 transcript filename; `artifacts`: relative UTF-8
  output filenames. Evidence must remain inside the run directory (2 MiB per file).
- `reviewer`: the person or supported reviewing agent that inspected the trial.
- `rubric`: for each criterion in the suite, record `status` (`pass`, `fail`,
  `unverified`) and an exact `evidence` excerpt for a pass/fail decision. Include
  enough transcript context to support a finding about an omission. A matching
  excerpt only establishes provenance, not the correctness of the review.
- `duration_ms` and `total_tokens`: observed integers, or `null` when unavailable.
  Never estimate missing usage as zero. Do not invent host identity or measurements.

```sh
python3 skills/orbyn-skill-creator/scripts/evaluate.py grade /tmp/skills-candidate/run.json
python3 skills/orbyn-skill-creator/scripts/evaluate.py compare --baseline /tmp/skills-baseline/run.json --candidate /tmp/skills-candidate/run.json
```

Grade returns exit 1 for failed or unverified trials and exit 2 for invalid evidence.
It records evidence hashes, missing trials and observed metrics. Routing and outcome
judgments stay separate: an outcome task can succeed without selecting the expected
skill. Comparison requires a complete matched case/trial set, suite hash and host/model
configuration. Fixture runs cannot enter a benchmark comparison. Review individual
failures and run variation; a small score change is not general improvement.

## CI and contributions

Ordinary PR CI runs static case validation and fixture tests without model calls or
secrets. Run live trials explicitly on a reviewed revision using an available host;
retain their evidence outside the shared distribution unless it is synthetic or
reviewed for publication. Add only the public task, rubric and a concise result
summary to a contribution. Never give untrusted PR code a model key merely to grade it.

Choose code-based checks for executable behavior, and calibrated human or model
review for subjective outcomes. Do not grade only output keywords, require a single
wording, or accept a task's own success assertion as proof. Extend helpers with an
actual failing input/output boundary when their behavior changes.

This workflow is independently authored. Design references are
[Anthropic's skill creator](https://github.com/anthropics/skills/blob/main/skills/skill-creator/SKILL.md),
[agent evaluation guidance](https://www.anthropic.com/research/demystifying-evals-for-ai-agents)
and [SkillsBench](https://arxiv.org/abs/2602.12670v4). No evaluator code was imported.
