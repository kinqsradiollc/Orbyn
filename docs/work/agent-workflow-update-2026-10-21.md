# Agent workflow and model routing update

## Scope and ownership

The requested outcome is a lead-owned workflow matching the pinned upstream's
lead/delegate/review/verify mechanics, while retaining Orbyn model tiers,
standard processing, bounded concurrency and explicit delivery authority.
Source checkout is `/Users/anhdang/Documents/Github/Orbyn`, branch
`codex/agent-workflows`. Existing unrelated commits on this shared branch are
outside this change; staging uses an explicit task-owned file list.

The lead owns policy, host configuration, model sync tooling and integrated
verification. One native `orbyn-agent` Engineer owned workflow/playbook and related
skill edits. It completed without recursive delegation. The lead inspected those
artifacts and integrated the policy and generated-format changes.

## Contract and upstream correspondence

Pinned source: `tools/pstack/skills/poteto-mode/SKILL.md` and its playbooks.
Upstream snapshots and attribution are unchanged.

| Mechanic                                                                                                     | Owning Orbyn guidance                                              |
| ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| Lead grounds scope and design, delegates substantial execution                                               | `AGENTS.md`, `docs/agents/coordination.md`, workflow lead contract |
| Throughput checkpoint identifies prerequisites, independent outputs, shared state and smallest decomposition | Workflow lead contract and feature/bug-fix/refactoring playbooks   |
| Named scoped delegates receive file ownership, checks and stopping conditions                                | Coordination, roles and both hosts' agent definitions              |
| Lead reads actual artifacts/diffs and evidence, routes fixes to the same owner                               | Coordination, delivery, review and affected playbooks              |
| Lead performs proportional authorized verification before delivery                                           | Delivery and workflow verification contract                        |
| Architecture and bounded alternatives feed implementation                                                    | `architect`, `arena`, feature playbook                             |
| Substantial investigations and migrations delegate owned slices                                              | `how`, `why`, investigation and `figure-it-out`                    |

Orbyn deliberately preserves the user's constraints over upstream defaults:
Sol/medium and Luna/high for Codex; Opus/medium and Sonnet/medium for Claude;
Astra/Fable only by explicit human selection; no Fast/Priority/Ultrafast;
at most two active children; no recursive child/session creation; new sidebar
chats only on explicit human request; no automatic external messages or PRs;
no product tests without authorization; at most three full requested independent
qualification rounds. A small clear task stays direct. A child implements its
owned slice directly and its parent provides review separation. An unavailable
named agent is reported, never hidden behind a generic or CLI model substitute.
Additional independent verifier/reviewer roles remain optional; lead review is
mandatory for substantial work.

## Model updates

`docs/agents/models.json` is the shared human-editable provider registry.
`python3 scripts/sync-agent-models.py --write` synchronizes both hosts and the
policy table while preserving unrelated settings. `--check` detects drift.
`scripts/check-agent-assets.py` delegates model validation to that single source.
The generated table is stable under the repository's Markdown formatter.

Read `docs/work/agent-runtime-verification-2026-10-21.md` for actual named
Sol/medium and Luna/high runtime evidence. Effective delegate processing speed
and Claude runtime selection remain unverified. The historical config writer
has not been identified; drift detection and repair are not a root-cause claim.

## Verification

- `python3 scripts/sync-agent-models.py --check`: passed.
- `python3 scripts/check-agent-assets.py`: passed, including all pinned imports,
  local links, 45 skills, both host discovery trees and model registry consistency.
- `python3 scripts/sync-agent-skills.py --check`: passed.
- Scoped Prettier formatting and `git diff --check`: passed.
- Disposable model-sync behavior checks cover reset repair, unrelated settings,
  both-provider updates, idempotence and rejection of accelerated processing.
- No application builds, app tests, security scans, native UI checks or live
  provider probes are part of this instructions/configuration change.

Round 1 of the read-only review found two model-sync defects: regex edits could
change unrelated TOML multiline instructions, and raw Claude descriptions could
produce invalid or truncated YAML. The Engineer added parsed semantic
preservation guards and conservative YAML metadata validation before any writes.
Disposable regressions confirmed fail-closed behavior for model/effort/section
examples and colon/hash descriptions, with all seven destinations unchanged.
These were batched corrections in the same review round; no counter reset.

Final lead inspection and known-finding closure precede the scoped commit. Commit, push and remote identity are reported by the lead after execution;
this record is not a claim of merge, deployment or runtime qualification.
