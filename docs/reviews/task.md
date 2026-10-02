# Current implementation handoff — 3 October 2026

## Scope and boundaries

Complete `docs/adr/001-devday-agent-platform.md` under the full acceptance contract
`docs/reviews/devday-2026-implementation-review.md` C1–C6/M1/D1/U1. Goal active and
incomplete. Every web/desktop feature needs mobile parity. Preserve root user
files and concurrent character work. Qualified main commits/merges/push are
authorized; no deploy/tag/release or cleanup. No subagents. Exclude voice and
computer-use product features and speculative Decisions adapter.

Home: concrete Muse/Dots-inspired workflows, all character presets, distinct
Background and Overnight profiles, honest activity/results/stopping states.
Primary sources: [Muse](https://introducing.muse.ai/) and
[Dots](https://learn.chatgpt.com/docs/dots/tasks-and-memory). Do not claim imported
computer/messaging capabilities or permanent active presence. Reflection and
collaboration remain required, not proven shipped by Home copy.

Web Home visual acceptance is delegated to the user's test server for this
increment. Do not bypass denied localhost web permission through different
ports, Chrome/native access or CDP. Offline private Chrome is only for synthetic
exports. Native Terms acceptance requires the human. Docker stays user-controlled.

## Main and qualification

- Main: `012d16e8`, HTML PR163 merged after exact `a7d2764f` full local
  2,277/2,277 and all CI37068507160. PDF PR161 and picture PR162 are also merged.
  No deployment. Root `mobile/app.json` and unrelated untracked files preserved.
- Publication media: `character/Orbyn`, branch `codex/docs-publication-media`,
  exact `88024f64`, draft PR164 against main. CI37071640135 passed all jobs.
  Fresh full local session77084, log
  `/tmp/orbyn-publication-media-88024f64-full-tests.log`, still running.
  First `edeb63a5` full local 2,297/2,298 and CI37069676634 failed the PUBLIC
  route inventory; classified the scoped route without changing ratchets or
  security assertions. Repair focused27/27, backend types/build/format passed.
- Home profiles: `assistant-runtime-integration/Orbyn`,
  `codex/home-agent-profiles`, exact `64534482`, draft PR165 against main.
  Fresh full local session98447 and CI37071883926 still running. Log
  `/tmp/orbyn-home-profiles-64534482-full-tests.log`.
  First `22f2e1b8` full local2,298/2,299 and CI37070166479 failed private-route
  inventory; classified profiles as people_only, preserving actual auth checks.
  Repair focused14/14; earlier scoped group22/22. All workspace types/build/format
  pass. Native current-head visual/interaction and Android acceptance remain open.
- Publication renderer: current `assistant-work-ownership/Orbyn`,
  `codex/docs-publication-renderer`, local commits `a8727afa` plus merge `d951353c`
  importing media inventory repair. Only diagram sources enter private Chromium;
  inert diagrams retain source, and current publication/page/links/media/folder
  authority is fenced after rendering. Combined actual integration/units/existing
  publication checks38/38 pass; workspace types pass. Build/format live.
  Full local/current-head CI not yet run. Evidence `evidence/publication-renderer.md`.

## Native QA state

Current Home source serves Expo Go at port8087 and test API8027, isolated marked
owned database recorded in `/tmp/orbyn-native-home-64534482-db.txt`. Metro needed
IPv4-first resolution to serve the simulator. Old cached build and old nonexistent
QA database are excluded from evidence. Current source reaches native sign-in.
Disposable test credentials are prepared, but final Sign in says it accepts Terms:
user has been asked to perform that action. Do not accept or inject agreement
state. Session credentials remain in a private temporary file, never in docs/logs.

## Preserved candidates and remaining work

- `codex/docs-source-preview` e7b018db / draft PR153: broad source/editor/UI/models/
  reflection/handoff candidate; extract and qualify scoped changes, no broad merge.
- `codex/docs-rendered-pdf` a039f271 / draft PR160: preserve combined candidate;
  previous CI font-test failure is not qualifying evidence; main PDF fixes are merged.
- `codex/pdf-deployment`501b4c09 and dirty devday plan/executor work preserved.
- model-catalog4f223040 plus two untracked settings previews and plugin-boundary
  a74ad26a remain acceptance candidates.

Finish ChatGPT credential-owning executor model catalog/defaults and separate
plugin integration, all Docs/editor/CommonMark/GFM/math/Mermaid/reference/source
preview/navigation/Word/native sharing/export/publication security acceptance,
whole-app UI parity and real screenshots/interactions, bounded durable Background/
Overnight collaboration and consented reflection. Gantt label presentation remains
known. Types/Expo export or synthetic component tests are not native delivery.

## Next actions

Observe fresh full suites and all current-head CI to terminal. Merge only qualified
exact heads against fresh main; preserve failures. Finish native Home/profile
interactions after human sign-in. Commit and attach a scoped publication-renderer
PR, then full current-head qualification before promotion. Reconcile parent/main
without conflicts. Continue all C1–C6/M1/D1/U1 gates; no premature goal completion
or cleanup. Disk is low: check before large builds, do not reinstall dependencies.
