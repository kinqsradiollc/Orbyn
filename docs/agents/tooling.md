# Repository skills and upstream tools

Orbyn keeps active guidance in `skills/`. Both `.agents/skills` and `.claude/skills`
contain relative links to individual skill folders, so both hosts read one source. Hosts that do not follow
symlinks can read the paths in [the index](../../skills/README.md) directly. A new
session may be needed for skill discovery; files alone do not add tools to a live
session. No global client settings or MCP registration are changed by this migration.

## Complete upstream sources

| Project | Permanent source | Snapshot |
| --- | --- | --- |
| pstack | [tools/pstack](../../tools/pstack/README.md) | `74dd2291e8e37b12fd6dc49b2acbd655c6bdaf12`, plugin 0.9.0 |
| REA | [tools/rea](../../tools/rea/README.md) | `ccc7da309d7db385d5c6d73b0a3a8e093be33504`, package 6.7.0 |

All tracked files are preserved, including scripts, tests, docs, provider adapters,
plugin metadata, licenses and original skills. Nested `.git` histories, generated
outputs, installed dependencies and local caches are not copied. Five optional
REA submodules retain exact pins in the root `.gitmodules` and git index. They were
uninitialized in the source checkout; they remain uninitialized until needed.
The [manifest](../../tools/upstream-manifest.json) records every imported file hash,
executable bit and submodule revision. See [notices](../../tools/THIRD_PARTY_NOTICES.md).

The snapshots are source material. Use Orbyn's maintained skills for day-to-day work;
upstream Cursor model defaults, automatic ticket/chat writes and mandatory panel
reviews do not apply globally. Scope REA development skills to REA itself.
Do not reformat upstream snapshots or insert Orbyn product code into them.

## Use REA deliberately

Use [reverse-engineer-anything](../../skills/reverse-engineer-anything/SKILL.md)
for packaged/native/runtime questions. The source tree alone does not install
Hopper, Ghidra, IDA, JADX or a connected MCP server. Discover actual available
capabilities before claiming them. Source-only investigations need none of them.

For an explicitly requested local REA build, use its `.nvmrc`, `packageManager`
and lockfile. REA's toolchain differs from Orbyn's. From `tools/rea`, run
`HUSKY=0 npm ci` and then `npm run build:cached` when installation/build is in
scope. `HUSKY=0` prevents the vendored package's prepare step from installing
hooks into Orbyn. Check its current scripts before running them. Do not add REA
to Orbyn's npm workspaces or production containers just to make skills available.

Use the built local CLI (`node tools/rea/scripts/rea.mjs`) for a pinned-version
setup/doctor when needed. Check `--help` first. Scope any setup to the current
client and inspect its dry run. Obtain missing authorization for config writes,
provider installation or target execution; existing authorization remains valid.
Do not run `npx ...@latest` as a substitute for this pinned source without an
explicit update decision. Host/browser restrictions apply to REA too.

Optional providers can be initialized individually from the repository root:
`git submodule update --init --recursive -- tools/rea/third_party/<provider>`.
Only run for the provider required by the task. Preserve its own license and
prerequisites. Fetching source is not installing or qualifying that provider.

## Updating and checking

Keep source snapshots and Orbyn skills separate. The
[adaptation map](../../tools/skill-adaptations.json) records provenance after local
renames; source names are not host agent or workflow identities. For an update, pin a new
upstream commit, inspect the upstream diff and licenses, migrate all tracked
files and gitlink pins, then regenerate the manifest from those source bytes.
Do not edit hashes to hide a local change. Explain intentional patches separately.

Run `python3 scripts/check-agent-assets.py` to check local discovery, relative
links in authored guidance, upstream file integrity, pins and absence of active
`openSrc` dependencies. This is a document/import check, not runtime qualification
of REA, native engines or the agent behavior itself. Historical upstream docs keep
their original external references and may describe unavailable tools.

`openSrc/` is no longer needed for these imported projects. Other material there,
including `macro`, is outside this migration and must be considered separately
before deleting the directory. The user's CV and PDF were also copied to
`/Users/anhdang/Documents/Resume`; the originals were retained.

## Planning and UI research

See the [research record](../../tools/research/workflow-design.md) for the adopted
planning/UI ideas and host-specific assumptions intentionally excluded. The active
planner and skill creator use Orbyn names and current stack boundaries.
