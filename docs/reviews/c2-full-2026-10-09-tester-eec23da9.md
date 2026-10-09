# C2/M1 Tester report — eec23da9

Cycle `C2-full-2026-10-08`; formal Tester handoff received 9 October 2026.
Review counter at handoff: **0/3**. This test run does not consume a review round.

## Frozen candidate and scope

- Checkout: `/Users/anhdang/.codex/worktrees/adr-release-qualification/Orbyn`
- Branch: `codex/c2-chatgpt-completion`
- Candidate: `eec23da951f0d4ddfb9e04c735af77ea39d8518b`
- Candidate tree was clean before execution; Tester changed no product or test
  source.
- Scope covered local desktop/phone ChatGPT connectors, backend authority,
  owner-only executor device details, completed-result provenance, and the short
  signup privacy helper. Independent hosted web sign-in is deferred by the user.
- The user reports that native Connect works and declined another live account
  authorization. The disposable fixture previously showed only a desktop
  executor; no phone executor or phone-owned inference is independently verified.

## Tester checks

| Check                                        | Result                                                                                                                                                                                                                                                                      | Evidence                                          |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Workspace typecheck                          | **PASS**, exit 0; built `@orbyn/core` and `@orbyn/api-client`, then typechecked backend, desktop, and mobile.                                                                                                                                                               | `/tmp/orbyn-c2-tester-eec23da9-typecheck.log`     |
| Focused C2 and retained authority tests      | **INCOMPLETE**, exit 1: 559 tests, 461 passed, 98 failed, 0 cancelled/skipped; 64.8 s. Every failure is in `chatgpt-native-sign-in.unit.test.ts` and throws `Unexpected module ./device` in the test VM resolver before assertions.                                         | `/tmp/orbyn-c2-tester-eec23da9-focused.log`       |
| Migration 253 constraint compatibility probe | **PASS**, exit 0. Ran the candidate migration SQL against session-scoped temporary tables initialized with the prior 59-character constraint and legacy-format rows. Both rows remained; 122-character P-256 forms were accepted; invalid 60-character forms were rejected. | `/tmp/orbyn-c2-tester-eec23da9-migration-253.log` |
| Candidate diff hygiene                       | **PASS**: `git diff --check origin/main...HEAD`; candidate HEAD stayed unchanged.                                                                                                                                                                                           | Terminal receipt from this run                    |

The focused suite ran with `TEST_DATABASE_URL` pointed only at the guarded,
in-memory local `orbyn_test` database. It included all `backend/tests/chatgpt-*.test.ts`
files, `provider-provenance.unit.test.ts`, `agenda-private.test.ts`, and
`ai-model-controls.unit.test.ts`. Database cases applied the candidate migrations
before testing. Passing cases include the main inference job-lock ordering
regression, session/owner fencing, Ed25519 and native P-256 enrollment, owner-only
device discovery, and signed completed-result provenance. The migration 253
probe used temporary tables and left no persistent schema or row changes.

### Finding T-1 — native sign-in unit harness cannot execute

All 98 tests in `backend/tests/chatgpt-native-sign-in.unit.test.ts` fail during
fixture loading. Its VM resolver throws at line 631 for the candidate's new local
`./device` import in `mobile/src/lib/chatgpt-local-sign-in.ts:40`. No assertion in
those 98 tests ran, so this is a test-harness coverage failure, not an observed
product assertion failure. Update the test resolver to load or deterministically
stub `./device`, then rerun the 98-test file. Until that coverage runs, Tester
qualification of the native sign-in path is incomplete.

After this run, Builder confirmed the missing resolver as a candidate test
regression and updated the harness, including an assertion for transmitted
device type/name. The revised frozen candidate is retested below.

## Existing Builder evidence and limits

The handoff supplied, but Tester did not rerun, a successful web production
build, signed iOS simulator build, and disposable preview migration. The web
build log includes the existing Vite large-chunk warning. Tester performed no
live account authorization, visual sweep, app launch, native account action, or
Android build. No independent hosted web sign-in, phone executor enrollment, or
phone-owned inference is claimed. Full `npm test` was not run.

**Initial candidate disposition:** workspace typecheck and 461 focused checks
passed on `eec23da9`; 98 native sign-in checks could not execute because of the
resolver defect. The retest on the corrected candidate follows.

## Retest on corrected candidate 9077d923

Builder froze `9077d92391168dfab2493fbbd228ec4959f20801`, parent
`eec23da951f0d4ddfb9e04c735af77ea39d8518b`. Its only source delta is the 10-line
test-harness correction in `backend/tests/chatgpt-native-sign-in.unit.test.ts`:
the VM resolver now supplies a deterministic `./device` label and asserts that
native enrollment sends the expected device type and name. Product source is
unchanged.

| Retest                                      | Result                                                                                                                                                                                                         | Evidence                                           |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Native sign-in unit suite                   | **PASS**, 98/98, zero failures/skips/cancellations; 7.1 s.                                                                                                                                                     | `/tmp/orbyn-c2-tester-9077d923-native-signin.log`  |
| Targeted database and authority regressions | **PASS**, 102/102, zero failures/skips/cancellations; 33.4 s. Includes `agenda-private`, `ai-model-controls`, connection enrollment, executor leases/device discovery, inference broker, and provenance tests. | `/tmp/orbyn-c2-tester-9077d923-db-regressions.log` |

The database retest used a fresh guarded, in-memory `orbyn_test` database and
reapplied the candidate migrations. It passed the Agenda job-lock ordering
regression; legacy Ed25519 and native P-256 enrollment; device-type/name
discovery and ownership; and signed completed-result provenance. The earlier
actual-SQL migration 253 compatibility probe also remains applicable because
the migration and product source are unchanged.

The workspace typecheck from `eec23da9` remains applicable to product source
because `9077d923` changes only the test harness. Tester did not repeat the web
or iOS build. No visual checks, live authorization, app launch, native account
actions, or Android build were performed.

**Retest disposition:** the candidate test regression is resolved and both
targeted test cohorts pass on `9077d923`. This is Tester evidence, not Reviewer
acceptance. Independent hosted web sign-in, phone executor enrollment, and
phone-owned inference are not claimed. No merge or deployment is claimed.
