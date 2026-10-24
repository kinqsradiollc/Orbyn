# Shared skills and the public engineering library

The upstream owner is
[Orbyn Fullstack Engineering Skills](https://github.com/kinqsradio/orbyn-fullstack-skills),
maintained by Anh Dang under the Orbyn Engineering brand. This private application
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
It needs no model calls, product builds or cross-repository write credentials.
It catches local drift, not the existence of newer public commits. CI enforcement
also depends on merging this integration and requiring the check in the private
repository's branch policy. The initial addition does not change that policy.

Updating the sync helper itself is an explicit tooling change; compare it with
the public source and run its focused tests before replacing the local trusted copy.
Neither the lock nor CI authorizes public publication, merges or production changes.
