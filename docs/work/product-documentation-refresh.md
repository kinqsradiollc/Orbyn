# Product documentation refresh — 24 October 2026

## Scope and source

Documentation audit based on merged main `28b0c227`. Product source, package
scripts, Compose definitions and current shared schemas define the contracts.
Concurrent skills releases and upstream-maintenance work have separate ownership;
this change does not update their pins, policy, host settings or imported assets.

## Corrections

- GitHub's empty description now summarizes tasks, calendars, projects, documents,
  Assistant, Background/Overnight and the three client targets.
- README and documentation index cover the current product and link to Assistant,
  document architecture, MCP and Admin Publishing. The overview no longer treats
  every assistant action as the legacy proposal-only path or claims unqualified
  million-user capacity/stateless file storage.
- Setup uses current Compose service names, optional profiles and separate worker
  entry points. Provider credentials in Admin are distinguished from environment
  service settings. Node/npm guidance follows workspace engines and the lockfile.
- The Assistant guide and API reference cover retained feed, source Details,
  excerpts, question answers, read cursors and admission controls. Rollout remains
  explicitly opt-in; documentation changes do not enable it.
- Deployment and two implementation records distinguish merged delivery from
  historical in-progress evidence. Original historical qualification notes remain.
- Plugin documentation describes the mounted consent/broker/worker contract,
  replacing contradictory earlier-stage claims that the endpoint is absent.
  Actual host/provider/native qualification remains separate.

## Public project and creator follow-up

The human authorized publishing Anh Dang's University of Melbourne student
identity, LinkedIn profile and personal/Orbyn email addresses in the product
README. Contribution guidance distinguishes Orbyn's canonical maintained
repository skillset from the portable public fullstack library. No root product
license was present in source and GitHub reported no detected license; application
license selection is pending the human's decision. Component notices are preserved.

## Document checks

- Relative Markdown path/anchor check across README, `docs/**/*.md` and deployment
  README files: 43 files, 268 links including this receipt, zero unresolved links.
  Application route examples are treated as application links, not local files.
- Scoped Prettier and `git diff --check` passed. Workspace scripts, service names,
  conversation routes and schema bounds were compared with their owning source.
- Generated MCP catalog/OpenAPI assets were retained. This update changes the
  prose reference, not the generated/public automation contract or tool registry.
- The primary checkout's tracked tree/index remain clean; its three local audit
  documents and 18 LinkedIn output/source files remain outside this worktree.

No application tests, builds, deployment, provider calls or installed-native
checks were run for this documentation-only change. The check does not establish
an exhaustive semantic audit of every endpoint or verify external documentation
URLs. Current deployment settings must still be inspected on the target server.

## Delivery

GitHub description updated. The documentation candidate uses
`docs/current-product-reference` in the sibling documentation worktree and is
reviewed through its separate PR. GitHub records the current commit/check/merge
state. No application deployment or conversation rollout follows from this work.
