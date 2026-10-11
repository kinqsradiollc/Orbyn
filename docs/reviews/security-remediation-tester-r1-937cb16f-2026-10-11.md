# C6 Tester results — 937cb16f round-1 correction — 11 October 2026

## Candidate and scope

- Frozen source: `937cb16f14ef3f67eadc72293466a52836c5c71b` (`fix: keep retired credential keys read-only and seed SSE baseline`), parent `027b699329fbd8ce5e783123a39c5d45daec0d12`.
- Branch: `codex/c6-file-viewer`.
- Test checkout: `/tmp/orbyn-c6-r1-937cb16f`, detached at the frozen commit and clean after the run.
- Scope: same-round retest of the corrected authenticated CRDT SSE fixture and retired-key behavior, plus the secret database and upgrade suites and backend typecheck. Review counter remains **1/3**.
- No product or test source was edited.

The previous `dc094b4b` fresh-database fixture failure remains recorded in the [earlier Tester report](security-remediation-tester-r1-2026-10-11.md). This candidate seeds a baseline update and uses its returned sequence; its pass does not erase the prior failed attempt.

## Environment and commands

All database work used the fresh disposable PostgreSQL database `orbyn_c6_r1_937cb16f_20261011_test` on `orbyn-postgres-test-1` at `127.0.0.1:55434`. Before and after testing it reported `orbyn.environment='test'`; it had 226 migrations through `266_oauth_consent_generation.sql`. After verifying there were no other database connections, I dropped only this database and confirmed it was absent. The temporary `node_modules` symlink used to run the checkout was removed; the detached source worktree is clean.

- `DATABASE_URL=<marked disposable database> TEST_DATABASE_URL=<same database> npm run migrate -w backend` — exit 0.
- `npm run typecheck -w backend` — exit 0.
- Each focused suite ran as a separate serial process with `NODE_ENV=test` and `TEST_DATABASE_URL=<marked disposable database>`, using `tsx --test --test-concurrency=1` from the repository root.
- Per-file logs are in `/tmp/orbyn-c6-r1-937cb16f-tests/`.

## Focused results

| File                                 | Passed | Failed | Skipped |                        Exit |
| ------------------------------------ | -----: | -----: | ------: | --------------------------: |
| `security-live-revocation.test.ts`   |      2 |      0 |       0 |                           0 |
| `security-secret-retirement.test.ts` |      1 |      0 |       0 |                           0 |
| `secrets-db.test.ts`                 |      2 |      0 |       0 |                           0 |
| `security-secret-upgrade.test.ts`    |      1 |      0 |       0 |                           0 |
| **Total**                            |  **6** |  **0** |   **0** | **all four files exited 0** |

The authenticated SSE test received the seeded baseline-following CRDT parcel, then passed the session-revocation check: the revoked reader received no later parcel and its stream closed, while the authorized reader remained open and received the update. The retired-key test confirmed that decrypting orphaned legacy ciphertext rejects without recreating `credentials_key`, while legitimate local encryption can still create and use its key. The secret database and upgrade controls also passed.

## Retained source-equivalent evidence

Compared with `dc094b4b`, the only changed code/test paths are `backend/src/lib/secrets.ts`, `backend/tests/security-live-revocation.test.ts`, and the new `backend/tests/security-secret-retirement.test.ts`; other changes in the delta are documentation. `backend/src/modules/oauth`, `backend/tests/oauth.test.ts`, `backend/tests/security-deploy-cutover.test.ts`, `scripts/deploy.sh`, the Compose/env inputs, env-example checker, client paths, and Kubernetes manifests are unchanged. The OAuth modules do not import or call the modified secret helper.

Accordingly, the prior **33/33 OAuth** receipt on `dc094b4b` remains applicable; its log includes both consent-interleaving cases. The prior **2/2 deploy-cutover** result and Compose configuration, deploy preflight, env-example parity, and 19-manifest YAML checks also remain applicable. These are retained receipts, not added to the new 6/6 total. Their exact commands and limits remain in the [prior report](security-remediation-tester-r1-2026-10-11.md).

## Limits and next step

This is focused local qualification. No live production cutover, deployment, external OAuth/provider host, visual/native check, merge, or push was performed; full C6 external-host gates remain open. The corrected SR-E1 local live-revocation and OAuth evidence and the focused SR-R1 tests are ready for same-round Reviewer assessment. No Reviewer approval or formal finding closure is claimed here.
