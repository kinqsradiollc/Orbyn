# Verification

Verification is scoped to the current task and candidate. Follow
[delivery](agents/delivery.md), [development](agents/development.md) and the user's
requested checks. This guide is not a record of a previously qualified release.

## Select evidence

| Change                            | Relevant evidence when authorized                                        | Limit                                               |
| --------------------------------- | ------------------------------------------------------------------------ | --------------------------------------------------- |
| Docs, skills or host config       | Paths/links, schema parsing, import hashes, expected discovery structure | Static checks do not prove a model run              |
| Shared types and application code | Workspace types, focused behavior tests, affected callers                | A build alone does not prove behavior               |
| Database/API boundary             | Guarded disposable DB, authority/conflict/retry cases                    | No real user database or secrets                    |
| UI                                | Changed flows at actual pane widths, focus/selection/recovery            | Web preview does not establish native behavior      |
| Provider or OAuth integration     | Deterministic fixtures and separately authorized live lifecycle evidence | Mocks do not prove provider renewal or availability |
| Deployment                        | Requested target, migration/recovery plan and observed service state     | A local commit or image is not deployment           |

Do not add or run tests unless requested or required by higher-priority session
instructions. When allowed, inspect the owning package script; the default backend
suite selects `tests/*.test.ts` and does not run every `.integration.ts` file.
Database tests require `TEST_DATABASE_URL`, a database ending in `_test`, and the
`orbyn.environment='test'` marker. See [setup](setup.md#4-tests).

For agent asset changes, `python3 scripts/check-agent-assets.py` checks source
integrity, host links/defaults and documentation references. It starts no model,
server, browser or application tests. Host runtime discovery needs separate
observation; report it explicitly if it was not exercised.

## Record the result

Name the branch/revision or dirty diff, command, exit outcome, relevant output and
known limits. Preserve failed attempts. Distinguish self-review from independent
review, and local changes from committed/pushed/merged/deployed work. Use a scoped
work record only when it helps a future handoff; do not recreate historical ADR
queues as an active acceptance checklist.
