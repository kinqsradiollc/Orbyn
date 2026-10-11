# C6 unified MCP candidate

Builder: Orbyn Builder. Checkout: `/Users/anhdang/.codex/worktrees/c6-next/Orbyn`.
Branch: `codex/c6-file-viewer`. Base: `e5bdc161`.
New scope implements ADR 002. This is not merged/deployed or real-host accepted.
The existing accepted local C6 round 1/3 remains closed; the expanded scope needs
Test → Reviewer round 2/3, without resetting that counter.

## Implemented scope

| Area                | Candidate behavior                                                                                                                             |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Canonical protocol  | `/mcp` retains existing tools, tasks, prompts, resources, step-up and text fallback                                                            |
| Host surfaces       | Shared Today/sidebar, host Markdown file editor and scoped mentions on `/mcp`; UI opt-in remains separate                                      |
| Result families     | Shared compact read/search, receipt/history/Undo, proposal/review and progress/status card; no mutation on render                              |
| Orbyn Docs          | Shared Markdown rendering, bounded sandboxed local Mermaid; source retained if unsupported; no external assets                                 |
| Document edits      | Explicit anchored-line diff then version-checked `edit_doc`; existing proposal/review rules apply; draft/id retained on failed/uncertain saves |
| Workspace inference | OAuth-only request/status tools plus canonical auxiliaries; separate owner provider/model/allowance consent; no plan token use                 |
| Worker/receipts     | Same isolated worker and durable grants/receipts; exact recipient revalidated at enqueue/claim/dispatch/results; no uncertain replay           |
| Compatibility       | Existing `/plugin` route/discovery/refresh and grants remain; opposite audience refused; no credential/receipt transfer                        |
| Deployment          | Gateway `/mcp/*` auxiliaries to private worker; deploy starts it for profile, legacy URL or canonical AI flag                                  |
| Environment         | Server `MCP_WORKSPACE_AI_ENABLED=false` default; all existing private env values preserved; clients have no new secret/URL                     |
| Rollback            | Keep consolidation image, turn canonical AI off; preserve receipts/reservations and legacy services; no destructive schema                     |

Native app builds and separate shared desktop UI checks remain excluded.
Kubernetes has no integration worker manifest and is not qualified by this scope.
Host extensions remain host-dependent. UI opt-out gives ordinary tool results;
unsupported diagrams/file metadata retain source/read-only behavior.

## Builder preparation

Backend typechecking, changed-file formatting, env template coverage and shell
syntax are development checks, not formal acceptance. Intermediate type errors
were fixed before freeze. Tester must record exact candidate, commands and results.

## Formal qualification scope

- New `unified-mcp.unit.test.ts`: canonical tools/opt-out, file bounds, document
  HTML/anchors/read-only hint, script syntax and separate cursor identity/switch.
- Changed plugin auth/launch unit suites: exact MCP versus plugin recipients.
- Plugin inference runtime suite: existing lifecycle plus fresh canonical owner
  consent, wrong-recipient refusal, paused dispatch/readable queued receipt,
  actual inert HTTP adapter once, idempotent receipt and result read.
- Existing plugin UI/protocol/tool-input/job cursor/import/producer/provider
  permission suites; retain prior failures and test only relevant source changes.
- OAuth recipient/reconnect and MCP directory/tools/resource contracts; existing
  permission, elicitation, task, revocation and source visibility checks remain.
- Backend and affected web/mobile types, env coverage, shell/Compose/gateway config.
- One bounded Visual Check request on the frozen candidate for document card,
  anchor edit/conflict/review and narrow layout. Do not repeat unrelated screens.

No Codex Security scan. No automatic vendor/live-host mutation. Production host
acceptance follows approved main merge and owner deployment, then a new explicit
`/mcp` connection. Existing `/plugin` Today evidence does not qualify this path.
