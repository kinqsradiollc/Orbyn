# Maintained-page block contract

## Current implementation

Shared helpers capture selected block IDs and positions in page order, bound to
the current page version. Persisted snapshots contain identities only, not copied
private page text. Duplicate IDs, absent/moved targets, stale versions and writes
outside the saved target set fail. Updates retain untouched block objects and
order; no implicit insert/delete or expansion into human blocks. Input uses the
existing validated document block schema and100-target bound.

Seven focused tests pass in `/tmp/orbyn-maintained-pages-final-focused.log`;
shared package builds and all workspace typechecks pass. This
code is not a runnable maintained-page feature and is not ready for main promotion.

## Required next implementation

1. Persist owner/agent/routine/binding revisions with exact selected block metadata;
   constrain access to the intersection of current user rights, page access,
   assistant grant scope, workspace policy and action rules. A caller-supplied
   snapshot cannot replace the server's saved binding.
2. Capture current binding/consent before provider work; enqueue IDs/revisions,
   not copied document text. Limit model context to authorized source material.
   Recheck permissions, source version and target placement on resume/apply.
3. Apply through document history/comment/file/link checks and conditional saves,
   preserving human blocks. Existing saveDoc also syncs linked task ticks: those
   side effects need scoped task authorization and explicit target fencing.
   Update binding baseline only after a successful agent-owned update; human
   changes invalidate it rather than silently refreshing authority.
4. Add explicit schedule creation, pause/resume, current status and review in both
   clients. Respect separate Background/Overnight runtimes and existing budgets.
5. Add scoped @orbyn comment jobs/replies, edit/delete/retry deduplication and
   private-comment/source restrictions. No external messages without consent.
6. Prove real concurrent saves, deleted/moved blocks, grant/page revocation and
   cross-user/team isolation with real API tests; then full local/CI and signed-in
   web/iOS/Android flows.

Whole A5/C1–C6/M1/D1/U1 remains unfinished. Existing Slack/Discord webhooks do not
complete the retained Slack/Teams OAuth, signed replies or durable outbox scope.
No voice/computer-use product additions, deployment or cleanup.
