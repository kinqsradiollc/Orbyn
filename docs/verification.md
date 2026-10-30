# Verification

Verification is scoped to the current task and candidate. Follow
[contribution guide](../CONTRIBUTING.md), [development](development.md) and the user's
requested checks. This guide is not a record of a previously qualified release.

## Select evidence

| Change                            | Relevant evidence when authorized                                        | Limit                                               |
| --------------------------------- | ------------------------------------------------------------------------ | --------------------------------------------------- |
| Docs or CI helpers                | Paths/links, schema parsing, import hashes and disposable CI fixtures    | Static checks do not prove a model run              |
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

## Deterministic fixtures

Provider tests that mock `fetch` must use the explicit
`backend/tests/provider-transport-fixture.ts` bridge when exercising the guarded
provider adapters. The bridge refuses an unstubbed network call; production keeps
its validated DNS and pinned sockets. Database tests must dynamically import the
bridge after `setup.js` finishes, so configuration is captured from the guarded
test database. UI callback fixtures must supply current session, mount and request
ownership dependencies and exercise changes after dispatch.

## Record the result

Name the branch/revision or dirty diff, command, exit outcome, relevant output and
known limits. Preserve failed attempts. Distinguish self-review from independent
review, and local changes from committed/pushed/merged/deployed work. Use a scoped
work record only when it helps a future handoff; do not recreate historical ADR
queues as an active acceptance checklist.

## Substantial workspace UI changes

For a substantial redesign, record one scoped acceptance receipt for the changed
candidate: find and act on representative work; cancel and return with drafts and
focus intact; fail and recover without duplicate effects; inspect a relevant
narrow layout and both themes. Use synthetic content and existing guarded fixture
owners where possible. Include a bounded compatibility pass showing existing
routes and object links remain reachable. Source/type/build checks support but do
not replace rendered interaction evidence. Report unperformed native checks and
unavailable build/feature identities explicitly. This does not authorize real
user-data changes, provider calls, tests excluded above or a whole-app sweep.
