---
name: orbyn-skill-creator
description: "Create, refine, merge or retire Orbyn repository skills while keeping task routing, technology boundaries, host discovery and documentation consistent."
---

# Maintain Orbyn skills

Read [AGENTS.md](../../AGENTS.md), [skill system](../../docs/agents/skill-system.md),
[stack boundaries](../../docs/agents/stack.md) and [documentation ownership](../../docs/agents/documentation.md).
Inspect nearby skills before editing. Prefer improving the existing owner over
creating a second skill that attracts the same requests.

Route from the user’s natural-language request. Complete authorized ownership,
authoring, migration, registration and validation steps without asking the user
to invoke separate skills. Helper flags are an execution contract for the agent;
they are not mandatory manual homework for the user.

## Choose the owner before authoring

Classify the request using the [company/repository skill boundary](../orbyn-setup/references/project-skills.md).
Consumer conventions and local adaptations belong in that consuming checkout's
`project-skills/<company-or-repo>/<namespaced-skill>/`, with discovery links for
both hosts. Inspect existing local skills, preserve credits/assets and repair
references when migrating them within authorized scope. Keep these skills out of
the shared catalog, public manifest and upstream lock. A library improvement must
be explicitly in public contribution scope; never infer permission from generic
wording or copy company material into the shared skill tree.

The shared authoring steps below apply to library-owned skills. For local skills,
use the ownership guide's registration/check path and the consumer's policy.

## Define a useful contract

Write the trigger, expected input, result and boundaries. Identify the applicable
stack and role, the skills this one genuinely depends on, and its handoff. Use
`orbyn-research` for unknown host/specification behavior; do not assume tools from
another product exist here. Make examples realistic to Orbyn's architecture.

Keep essential choices in `SKILL.md`; put conditional templates or deep guidance
in linked references. Do not duplicate model/session/permission policy in every
skill. Name Orbyn-specific entrypoints `orbyn-*`; descriptive generic principles
can retain meaningful names. Keep third-party attribution in source/provenance
records, never as an inherited active agent identity.

Keep essential instructions and required references usable from disk under the
[offline contract](../orbyn-setup/references/offline.md). Bundle licensed, pinned
source text when it is needed; keep attribution/update URLs and source hashes.
For sources without redistribution permission, author the needed explanation
independently and label the remaining evidence limits.

## Author and integrate

Use a matching folder/name with lowercase letters, digits and hyphens (under 64
characters), and concise `name`/`description` frontmatter. Keep the description on one line
for the repository catalog generator. Describe actual routing,
not a catchall. Include only resources needed to perform the task. Do not add
placeholder folders, mandatory panels or a new approval flow without a reason.

Register the skill in `skills/catalog.json` with its category and maintainer-facing
routing relationship. Update the owning task route in the workflow/system guide
when needed. Use `python3 scripts/sync-agent-skills.py --write` to refresh the
catalog index and host links; review its diff. Never overwrite unrelated host
settings or install global skills/MCP providers as part of repository authoring.

For a rename or retirement, migrate incoming links and discovery paths first.
Keep source-to-local attribution maps correct; do not delete provenance to hide
an import. Update affected documentation and remove obsolete competing guidance.

## Validate the whole path

Run `python3 scripts/check-agent-assets.py` and
`python3 scripts/sync-agent-skills.py --check`. Check a few realistic routing cases:
expected trigger, adjacent task that should not trigger, missing tools/evidence,
and the downstream handoff. Check references and role/stack boundaries. Metadata
and routing inspection are static evidence, not proof of live model behavior.

Use an available host skill validator for frontmatter when present. Execute new
helper scripts in disposable scope and inspect their outputs. A live skill trial,
external effect or product test still needs applicable authorization. Avoid a
paid model panel just to validate documentation. Report checks actually performed,
remaining behavior gaps, changed files and local/committed delivery state.

## Maintain the public contract

Treat the shared library as an upstream dependency of consuming projects. Keep private product policy and source outside public contributions. A useful skill change alters a decision or supplies a reusable artifact, not just vocabulary. Check expected and adjacent routing cases, then reconcile the catalog and consumer pin through the documented contribution path.

For external skill freshness and source comparisons, use
[upstream review](../orbyn-upstream-review/SKILL.md). Keep downloaded research in
ignored `orbyn-references/`, preserve existing local references and adopt selected
improvements into the owning skill. Do not replace our adaptations with an
upstream collection or advance an import pin after a review-only change.

## Evaluate a change

Use the [evaluation guide](references/evaluations.md) and its versioned suite for
positive, adjacent, no-skill and outcome cases. Update a case when its contract
changes; do not change frozen criteria after observing a held-out result.
`python3 skills/orbyn-skill-creator/scripts/evaluate.py validate` checks the suite.
Prepared or incomplete trials remain unverified. Helper fixtures test the tooling;
only captured, reviewed host trials provide evidence of skill behavior. Record
baseline and candidate results separately before claiming an improvement.

## Audit completeness without inflating the catalog

For a full sweep, inventory every catalog entry and its local support files.
Record its input, useful result, failure boundary, execution owner and actual
evidence; distinguish a focused principle from a complete workflow. Essential
execution must work from the local method rather than a link to a missing skill.
Add concrete operational guidance where a short summary loses the method, and
retain concise entrypoints when their linked resources supply it.

Keep only canonical entrypoints named `SKILL.md`. Bundled upstream entrypoint
text uses `SOURCE.md`, retaining original `source_path`, bytes, hashes and notices
in the snapshot record. Historical mentions inside that text are source data,
not installed skills or permission to fetch them. Validate recursive discovery,
related catalog owners, local files and Markdown heading fragments.

Maintained Orbyn guidance can be independently written while earlier derived
material retains its provenance. New wording, a renamed title or extra length
does not justify deleting attribution or asserting exclusive origin. Describe
original additions and retained lineage separately. A full audit is not complete
qualification when optional adapters or live behavior remain unverified.

Before a shared edit, inspect relevant open PR heads/bases and the consumer lock.
Reuse the owned shared candidate for related corrections and serialize shared
writes with the consumer owner. Follow the [release handoff](../orbyn-upstream-review/references/release-handoff.md):
finish authorized dependency merges, pin the actual merged public SHA and verify
both repos' final state. An unmerged candidate is not current public `main`.
