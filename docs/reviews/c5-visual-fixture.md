# C5 visual reply fixture receipt

Date: 11 October 2026 (Australia/Melbourne). Candidate: `dc75c780b69d01aa4baa0b9eac8317c67f62ea60` on `codex/c5-pages-publication`.

**Status:** the single synthetic waiting-reply fixture was consumed by Orbyn Visual Check. The reply was posted and confirmed visible after reopening the page. Do not post it again or seed a second proposal.

## Fixture identity

- Isolated database: `orbyn_c5_visual_test` on port `55438`; marker `orbyn.environment=test`.
- Page: `d1dfea97-fd4c-48e1-bb4d-c89d51c85b66`, “C5 Visual Fixture — Pending reply and pause/rebind”.
- Reply block: `reply-source`; schedule block: `schedule-source`; private context block: `unselected-private`.
- Schedule binding: `e608461f-40a9-4757-b500-2c4313a16abc`, still unpaused on page version 1.
- Parent comment: `2e9b682e-a9de-4637-95c8-c8de92772e5a`.
- Request comment: `c8d332a3-1cbc-45c3-aa4c-d7045dc0b1b1`; scoped binding: `d6e788f4-3b7a-498a-b4b2-8cef5cbc4745`.
- Run: `4c7c4aab-8b42-4162-ac94-70e5e63229b1`; original waiting decision: `bbcc0b41-e6e6-405b-b27f-94abf5557f39`.

The proposal text was “Synthetic local-mock proposal: compare the selected notes, then choose one next action.” It was produced by one ephemeral loopback-only mock request, not a live model call. Visual Check confirmed the run reached `done`, the reply was linked to the source request as a nested reply, and it appeared in the selected-line thread after reopening the page. The existing Visual report records the refresh/reopen behavior as `C5-VIS-001`.

Visual exercised schedule creation and pause/rebind on its separate “C5 update lifecycle fixture” page; it did not need to mutate this reply page's schedule binding.

The initial seed script restored the prior provider selection after staging. Although a captured-identity guard was expected to make the card stale, Visual's actual Post reply action succeeded; the observed UI/API result is the evidence to retain. No second run was created.

## Current resource state

The prior selection is restored to `provider_id=NULL` and an empty model. The seed process is no longer running, so its ephemeral mock listener is closed. The page, account and isolated database remain owned by Visual Check until that session completes cleanup. No credentials or connection strings are recorded here.

Related evidence: [C5 bounded visual report](c5-visual-report.md) and [C5 Tester qualification report](c5-test-report.md).

## Corrected candidate fixture — 82dee01b, 11 October 2026

Visual Check owns an isolated `_test` database on port 55438. A separate
synthetic page `c230ff14-e1b8-453e-9f99-71e44a2ac2cb` has selected block
`bmv32t7wfcl4kn1`. The original two comment bindings became stale after a
human page edit; normal queueing returned HTTP 409 before creating a run.
One attempted child reply was unscoped (`block_id=NULL`) and was excluded.
These outcomes were retained; no binding snapshot was rewritten.

Visual Check created two fresh direct line comments through its authenticated UI.
Builder verified their exact IDs, the test database marker, due bindings and
selected source, then used `queueMaintainedPageRun` and
`processMaintainedPageRun` through normal services. The sole provider call was
to Visual Check's owned loopback mock on `127.0.0.1:57785`; no live provider or
direct database write was used. Both runs were saved waiting for human review:

| Comment | Binding | Run | Waiting decision |
| --- | --- | --- | --- |
| `4f7d3a4d-287d-4031-872a-29fa62271e08` | `60079d49-8a99-4327-bfed-7fc4cbe8195a` | `b64524c2-7b02-42fa-8d70-bbdf7e941648` | `fff0a2a6-f149-4346-8693-296b3a2947d1` |
| `3a816be4-7638-4ae6-a301-e7bb7aa63ba8` | `6436ebb3-2e3d-43ae-9b68-0f24c1b57c82` | `7481caef-072a-4ee4-9908-ac10b02b430a` | `dab8fbfe-630a-4306-9d63-f764d31077a9` |

Visual Check retains fixture write ownership for the two post decisions and
cross-client observation. The worker exited after staging and did not post or
edit the page. Its temporary seed script stays outside the repository.
