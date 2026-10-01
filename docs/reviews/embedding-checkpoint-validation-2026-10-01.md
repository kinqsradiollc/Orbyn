# Independent embeddings — frozen checkpoint validation

## Scope and location

Validated source: `bcae42974db83a1af846959aa4cc958ac9f28dea`, branch
`codex/devday-model-catalog`, workspace
`/Users/anhdang/.codex/worktrees/devday-model-catalog/Orbyn`.
The source stayed unchanged throughout this run. Plugin development proceeded
in its separate managed worktree, not in this checkout.

This branch contains local Docs heading/fence parity, the settings redesign and
independent embedding schema/setup/worker/client controls. These changes are
not yet integrated into main. Production main remains at Azure validation
checkpoint `4f56b8d`; committed local work is not a deployed feature.

## Evidence

- Complete stock-Postgres suite: **1,978 passed**, zero failed or skipped.
  Marked database: `orbyn_embedding_full_20261001_test`, loopback port 55434.
  Log: `/tmp/orbyn-embedding-stable-full-tests.log`.
- Nine explicit pgvector API/service tests passed, including recipient/model
  replacement, dimensions, consent/revision conflicts, queue/document races,
  project/team keep-out changes, stale legacy writes and 401/403/400/429.
- Ten actual-source web/mobile control tests passed with controlled hooks and
  integration stubs. These cover payloads, acceptance resets, conflict refresh,
  recipient/progress rendering and unavailable-status labels.
- Workspace typechecks and production build passed; the final mobile typecheck
  also passed after the last status-copy change.
- A stock fixture restored onto the pgvector test server passed the explicit
  later-extension-installation test. Its scope and version-transfer details are
  recorded in the [provider audit](embedding-provider-audit-2026-10-01.md).

An earlier run passed 1,968 checks, but began before the progress changes and new
control-test file. The stable 1,978-test run supersedes that limited evidence.

## Remaining integration gates

1. Actual browser and mobile preview interaction/layout checks. Controlled
   component tests do not prove rendered layout or native behavior.
2. Publish the revised privacy text with the appropriate agreement version.
3. Validate the migration/service rollout: stop old measure processes, migrate,
   deploy new API/worker/client binaries, then validate and accept a provider.
   Existing consent is intentionally cleared; old unfenced workers cannot run
   alongside re-enabled independent embedding configuration.
4. Verify the exact combined main tree after integration, including the existing
   `202_doc_updates.sql` changes absent from this implementation baseline.

This is a tested local checkpoint, not completion of the broader ADR. ChatGPT
inference/host acceptance, plugin service/OAuth wiring, remaining Docs parity,
maintained/published pages, channel integrations and other retained requirements
remain governed by `devday-2026-implementation-review.md`.
