# Current implementation handoff — 3 October 2026

## Scope

Continue `docs/adr/001-devday-agent-platform.md` under the full acceptance contract
in `docs/reviews/devday-2026-implementation-review.md` (C1–C6/M1/D1/U1). The goal is
active and incomplete. Every web/desktop feature needs mobile parity. Preserve
concurrent character work and root user files. Ready qualified commits/main
integration/push are authorized; deploy, release and cleanup have not occurred.
Voice/computer-use product features and the speculative Decisions adapter remain
excluded. No subagents are authorized.

## Latest Home direction

The user wants personal-agent responsibilities inspired by Muse/Dots, with useful
content and restrained styling on both public and signed-in Home. Primary sources
rechecked: [Muse design](https://introducing.muse.ai/) and
[Dots tasks and memory](https://learn.chatgpt.com/docs/dots/tasks-and-memory).
Use visible work/activity, concrete requests, reviewable results, scheduled work
and clear decisions. Preserve Orbyn's palette and all character presets. Do not
invent live presence or claim imported browser/computer/messaging capabilities.

Public Home is merged through PR159 (`bdc4035b`): the shared agent guide gives a
project-notes-to-checklist example for Background and a queued-research example
for Overnight. Each has a request, three steps, review destination and stopping
condition. The signed-in web/native components and separate permission-filtered
profiles remain in `codex/docs-source-preview` (`e7b018db`) and must be promoted
through a scoped qualified candidate. Reflection/collaboration are required by
the ADR but must not be presented as fully shipped based on Home copy.

Web UI visual acceptance is delegated to the user's test server for this
increment. Do not bypass the saved denied localhost browser permission using
another port, Chrome/native access or CDP. Offline private Chrome is restricted
to synthetic export rendering. Native Terms acceptance requires the human.

## Main and candidates

- Main `/Users/anhdang/Documents/Github/Orbyn`: `192cb475`, PR162 merged.
  PDF PR161 and image PR162 passed their exact full local/all-CI qualification.
  Image head `30b496aa` passed 2,269/2,269 and all CI37064382202.
  Root `mobile/app.json` and unrelated untracked files are preserved.
- HTML `/Users/anhdang/.codex/worktrees/assistant-work-ownership/Orbyn`,
  `codex/docs-rendered-html`: `a7d2764f`, draft PR163. Parent `82a06733`
  failed local 2,276/2,277 and CI37066687318 on the same missing private-renderer
  fixture in link-privacy. Repaired fixture retains the actual privacy assertions;
  all 18 focused checks pass, backend typecheck/format pass. Full local session
  76575 and CI37068507160 are live; do not edit its runtime while they run.
  Logs `/tmp/orbyn-html-a7d2764f-full-tests.log`,
  `/tmp/orbyn-html-privacy-repair.log`.
- Publication media `/Users/anhdang/.codex/worktrees/character/Orbyn`,
  `codex/docs-publication-media`: based on `82a06733`, current candidate owns only
  scoped publication routes/helper/tests/evidence. Actual old signed public URL
  returned bytes after unpublish; new publication-scoped URLs check current
  authority before and after loading. Original signed bearer links retain their
  original TTL. See `evidence/publication-media.md`. Full qualification is pending.
- Broader Docs/source/profile/UI changes remain on preserved branches. Do not
  merge `codex/docs-source-preview`, `codex/docs-rendered-pdf` or model lineage
  wholesale. `devday-2026-plan` retains dirty changes; model catalog retains two
  untracked settings previews; plugin acceptance remains open. No cleanup.

## Next actions

1. Media focused checks now pass 39/39 after correcting the byte-budget fixture;
   finish current typecheck, commit and push. Full local/all-CI qualification
   remains required. Preserve failed attempts as evidence.
2. Observe HTML full local and CI to terminal results. Merge only the qualified
   exact head after verifying fresh unchanged main/base, then fast-forward main
   without changing user files. Reconcile the media candidate with that parent.
3. Qualify media on the exact reconciled head; remaining publication diagram
   rendering and post-render page-authority fences need separate implementation.
   Never enable renderer networking or weaken password-form/publication CSP.
4. Promote signed-in Home/profile web/native parity through a scoped candidate.
   Continue complete Docs/editor/navigation/sharing, model/executor/plugin,
   reflection/collaboration and whole-app U1 acceptance; no narrow export
   checkpoint satisfies the complete goal.

Docker remains user-controlled. Read-only inspection and owned disposable test
work are allowed; no Docker Desktop restart. `.env.production` values must never
be printed. Disk remains limited; check before large builds.
