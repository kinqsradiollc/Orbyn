# Shared skills and the public engineering library

The upstream owner is
[Orbyn Fullstack Engineering Skills](https://github.com/kinqsradio/orbyn-fullstack-skills),
maintained by Anh Dang under the Orbyn Engineering brand. This application
consumes the managed `skills/` content at the full revision and hashes in
`skills/upstream-lock.json`. Product-specific root policy, project guides, runtime
source, credentials and work records stay in this repository.

## Edit here, contribute publicly

1. Make the shared skill change in this checkout, using synthetic examples that
   can be public. Keep private product guidance in its existing owning guide.
2. Update a clean public-library clone and create a contribution branch there.
3. Preview and explicitly apply the skill-only export:

```sh
python3 scripts/sync-public-skills.py export --root . --upstream /path/to/orbyn-fullstack-skills
python3 scripts/sync-public-skills.py export --root . --upstream /path/to/orbyn-fullstack-skills --write
```

The tool compares the old consumer pin, local files and public files; conflicting
edits stop before mutation. Only cataloged skill content and the skill index/catalog
cross the boundary. No commit, push or PR happens automatically. Review the actual
diff for private content even when the path allowlist passes.

4. Run the public contribution checks, push its contribution branch and open a PR
   using the public template. Preserve licenses and update public provenance for
   newly adapted material. External contributors use public forks and never need
   access to this product repository.
5. After merge, check out the reviewed public revision. If this checkout already
   matches its content, record the pin; otherwise reconcile local edits and pull:

```sh
python3 scripts/sync-public-skills.py pin --root . --upstream /path/to/orbyn-fullstack-skills
# Or, for an update from the current unchanged pin:
python3 scripts/sync-public-skills.py pull --root . --upstream /path/to/orbyn-fullstack-skills
python3 scripts/sync-agent-skills.py --write
python3 scripts/sync-public-skills.py check --root .
```

The full public tree remains the source of shared skills; this copy is not a
second independent upstream. A local experiment can differ temporarily, but
the scoped CI check fails until it is contributed/reconciled with a public pin.
Regenerate host links after changes; remove retired generated links explicitly
if the generator reports them. Keep the existing local host Git exclusions intact.

## CI and limits

`.github/workflows/skills-upstream.yml` checks content against the committed lock
and a read-only checkout of that exact revision from the canonical public repo.
It compares the public manifest as data without executing public helper code.
It also validates the project context pointers and versioned evaluation cases
using the reviewed, vendored helpers in this checkout. It needs no model calls,
product builds or cross-repository write credentials.
It catches local drift, not the existence of newer public commits. CI enforcement
also depends on merging this integration and requiring the check in this
repository's branch policy. The initial addition does not change that policy.

Updating the sync helper itself is an explicit tooling change; compare it with
the public source and run its focused tests before replacing the local trusted copy.
Neither the lock nor CI authorizes public publication, merges or production changes.

## First quality milestone

The shared tree includes additive presets, project customization guidance, five
worked examples and a 22-case evaluation suite. Fresh external installs default
to the 10-skill core; Orbyn retains all 50 existing discovery links. Preset
selection does not change models or remove installed skills. Membership lives in
`skills/orbyn-setup/assets/presets.json`; installation tooling belongs to the public
library, while the vendored context and evaluation helpers work in this checkout.

[Project context](../../.agents/orbyn-context.json) points to Orbyn's current
instructions, stack, design, verification and owners. The
[design profile](design-profile.md) preserves Orbyn's product-specific conventions
separately from the portable UI method. Both files belong to this consumer and
stay outside the sync/export allowlist. Existing guides remain authoritative.

```sh
python3 skills/orbyn-setup/scripts/project_context.py check --project .
python3 skills/orbyn-skill-creator/scripts/evaluate.py validate
```

The [evaluation guide](../../skills/orbyn-skill-creator/references/evaluations.md)
describes preparing and grading recorded host trials. CI checks the suite's
structure; public-library CI tests its helpers with synthetic fixtures. Neither
is evidence of improved Codex/Claude behavior. Missing host trials remain
unverified and require supported, authorized execution to collect.

The [23 October Codex evaluation](https://github.com/kinqsradio/orbyn-fullstack-skills/blob/49509d4b134d879923806feae10a849fc259fbc8/docs/evaluations/2026-10-23-codex.md)
compares the previous library with the revised milestone: routing improved from
16/17 to 17/17, while both versions passed 5/5 reviewed design/content cases.
The corrected shared-schema route passed three candidate observations. The
evaluated skill revision is `7503c67f625dd6385dd5fd5d5518d05d22c58bb6`; the lock
pins `49509d4b134d879923806feae10a849fc259fbc8`, the merged public revision with the same managed skill distribution. The public
squash merge changed commit identity without changing the reviewed file tree. Earlier failed/incomplete
attempts are retained. These bounded synthetic trials do not qualify Orbyn app
behavior or Claude runtime behavior; Claude was excluded at the user's request.

The public milestone merged through [library PR #3](https://github.com/kinqsradio/orbyn-fullstack-skills/pull/3).
[Initial integration #224](https://github.com/kinqsradiollc/Orbyn/pull/224) merged
before the consumer follow-up [#227](https://github.com/kinqsradiollc/Orbyn/pull/227).
The lock records the merged public revision. After any future public merge changes
a commit identity, adopt that reviewed revision and rerun sync checks before
merging the consumer update. No merge occurs automatically.
