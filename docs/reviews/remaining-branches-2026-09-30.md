# Remaining branch review — 30 September 2026

Read-only source/history review against main `7f81aaf`. No feature code was changed or tests rerun for this review.

## Assistant/admin branches

- `feature/assistant-admin-sweeper-signin`: adds assistant workspace tools and prioritization guards, request tracing and admin analytics, account controls, retention sweeper, mobile admin views, project drafting, focus-session continuity, authorization/UI fixes, and persistent browser sign-in with sliding session expiry.
- `feature/follow-through-and-ui-polish`: includes the same changes, plus the earlier follow-through/realtime/UI feature commit (already patch-equivalent to main).

**Both branch-tip trees exactly equal merged commit `6d9aecb`** (`git diff --quiet` exits 0 for each). Their individual commits differ from the combined merged commit, which is why `git cherry` marked them unique. No missing branch-tip changes were found. Both branches are redundant with main's historical implementation; they were retained under the requested review rule.

## `muse/m2-memory`

Older work-in-progress for private Memory and Agent notes: migration 164, source-linked topic facts, memory tools and forgetting, conversation extraction worker, named-agent updates, Review proposals, desktop/mobile libraries, API contracts and privacy documentation. Main includes the completed implementation in `13408f9` and subsequent improvements.

The draft differs from completed `13408f9` in 19 files (80 insertions and 134 deletions when moving from completed implementation to draft). Notable differences:

- Moves OpenAI profile metadata onto `get_context`, adding account id/name and making `get_profile` a legacy alias. Main currently keeps the explicit profile tool with a stable hashed profile id. This is a contract/design difference, not a proven missing feature.
- Uses `websearch_to_tsquery` and a full-query title match for recall. Main uses any-word matching and topic-title recognition, which better accommodates conversational queries.
- Omits the five-attempt extraction queue cutoff that main retains.
- Omits the personal/unprojected scope restriction in the legacy profile-to-Memory migration.
- Removes 51 lines of Memory tests and changes capability coverage, catalog text, tests and a small CSS rule. These draft changes are not a reason to replace the completed implementation.

**Recommendation:** do not merge this stale draft wholesale. Retain it until deciding whether the profile-tool design difference warrants a separately scoped change. Existing current-main Memory improvements and access protections should remain.

## Cleanup record

- Deleted 62 local branches whose histories are merged or whose patches are equivalent to main.
- Kept main and the three branches reviewed above.
- Kept both extra worktree directories, detached at their existing commits; local files remain intact.
- Verified recovery bundle: `.codex-cleanup-backups/2026-09-30/all-refs.bundle`. The earlier local-file backup was interrupted before deletion; no worktree files were deleted.
- 47 remote branches were classified as merged or patch-equivalent. Automatic approval review blocked remote deletion pending explicit authorization. No remote branches were deleted.
