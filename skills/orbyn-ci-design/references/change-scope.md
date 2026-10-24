# Proportional verification and deployment

Choose checks by changed behavior, trust boundary and affected consumers, not by
line count. A one-line authorization or schema change can require wider evidence
than a large prose edit. The agent makes this assessment from the actual diff;
the human need not invoke a separate skill or waive routine checks repeatedly.

| Change | Local evidence | Published CI / delivery |
| --- | --- | --- |
| Typo, inert comment or presentation-only prose, with no command/contract change | Inspect the diff; use relevant formatting/links if affected | No application build/test or deployment. Local-only work can end without a hosted run. Preserve any required merge status for a published change. |
| Skill instructions, routing, ownership or project policy | Catalog, links, source/license integrity, expected and adjacent task cases | Focused skill/source/sync checks; no live model/provider or whole-app suite solely for prose. |
| Executable helper | Relevant failure/recovery fixtures plus the checks it owns | Run the helper's meaningful tests; avoid unrelated product builds. |
| Runtime code, API/schema/data, dependencies, build inputs or CI policy | Trace callers/effects and choose affected contract checks | Run affected application checks. Shared or uncertain effects select broader checks. |
| Deployment or production change | Verify the actual candidate, target, recovery and authority | Separate explicit promotion policy; green CI alone grants no deployment authority. |

These are decisions about evidence, not labels that prove a change harmless.
Markdown used as a runtime template, executable documentation, generated inputs
or a comment whose tool consumes it is not automatically cosmetic. Inspect actual
callers and project conventions. Retain failed results; do not add a path filter
just to conceal an observed failure or call skipped tests passing.

## Encode a conservative fast path

Prefer a small known docs/skills allowlist with full checks for anything unmapped
before attempting a complex per-package dependency graph. The consuming project
owns the map. Root dependencies, shared code, CI definitions and the classifier
itself need broad checks. Check every changed path, including deleted paths and
both sides of renames. Use complete Git changes at exact revisions; incomplete
pagination, an unavailable base or an unknown path must not silently select the
lightweight lane. PR comparisons use their merge base; a push compares the exact
before/after revisions across the entire push.

Keep an always-triggered required result. Do not skip a required workflow with
top-level path filters or a skip-CI commit marker: GitHub can leave its status
pending. Conditional application jobs can intentionally skip, while the final
gate still runs and rejects classifier errors, missing decisions, cancellation,
failures or an unexpectedly skipped selected job. Check the configured required
status names before changing them; YAML alone does not apply branch protection.
Support an explicit full-run option for diagnosis. A green small lane is evidence
for that lane, not proof that every application test ran.

The portable [scope helper](../scripts/ci_scope.py) accepts a project-owned JSON
policy with `schema_version: 1`, string lists `docs_files`, `docs_prefixes`,
`skills_files`, `skills_prefixes`, `deployment_files`, `deployment_prefixes` and
`application_jobs`. File entries are exact relative paths; prefixes end in `/`.
No shell, globs or commands are evaluated. Documentation prefixes admit only
Markdown/reStructuredText/text files; skill ownership takes precedence. Unknown
paths run the application lane, and unavailable change evidence also disables
automatic deployment. The helper's own scripts and `.github/` always take the
broad lane. The final gate requires the complete configured application-job list.

Test docs-only, skills-only, helper, runtime/shared dependency, rename/deletion,
mixed, unknown and missing-base cases, plus classifier failure and every selected
job's failed/cancelled/skipped result. Run the real proposed workflow as well;
fixture decisions do not establish hosted execution or branch protection.

## Keep CD separate

A documentation/skill-only success must not automatically redeploy the product.
For automated deployment, require the existing authorized promotion setting,
successful checks, trusted canonical push event and a runtime-change decision
bound to the exact candidate. Unknown changes may justify broader CI while still
requiring a deliberate deployment decision. An explicit manual deployment remains
a separate authorized operation.

If a follow-up workflow consumes a scope artifact, restrict its originating
repository/event/head and validate its schema and exact revision. Treat it only
as data; never execute downloaded artifact code or PR code with deployment
secrets. Missing/mismatched evidence blocks automatic promotion. Do not infer the
whole push from only its last commit. Preserve current secret/environment and
production authorization controls.

Official behavior checked 24 October 2026:
[required and skipped checks](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks),
[job dependencies and always-running gates](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-jobs),
[workflow-run security boundary](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_run).
