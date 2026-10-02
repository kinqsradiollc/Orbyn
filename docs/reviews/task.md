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

- Main86ccd4f8: publication renderer PR166 merged after exact2a46a360 full
  local2,318/2,318 and all CI37073694699. Media PR164 merged as43812305 after
  exact88024f64 full2,298/2,298/all CI37071640135. Earlier PDF/image/HTML
  checkpoints remain merged. Root user files preserved; no deployment.
- Home profiles: assistant-runtime-integration/Orbyn, codex/home-agent-profiles,
  exact692cc0f8, draft PR165. Fresh local session70210 and CI37074275504 live.
  Log `/tmp/orbyn-home-profiles-692cc0f8-full-tests.log`.
  Previous64534482 local2,298/2,299 and CI37071883926 failed generated route
  catalog (248 vs249 private exclusions), now regenerated. Current focused32/32
  and all workspace types/build/format pass. Must integrate new main86 after this
  frozen run before final combined qualification. Native human sign-in pending.
- Current character/Orbyn now owns codex/docs-diagram-readability: local565032d3
  plus main86 merge. Larger Gantt bars/text/ticks and repeated-date suppression;
  final scoped16 checks pass with actual PDF font/bounds/spacing assertions.
  Synthetic current screenshot `evidence/gantt-readable.png` inspected. Combined
  focused/full local/CI qualification still pending. Existing media branch retained.
- assistant-work-ownership/Orbyn retains qualified publication-renderer2a46a360;
  clean. No further runtime changes there.

## Native QA state

Home UI source (unchanged by692 catalog/media integration) serves Expo Go at port8087 and test API8027, isolated marked
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

## Current ChatGPT model settings candidate

Checkout codex/chatgpt-model-settings is a scoped extraction on main110, preserving4f/e7 and the two untracked settings previews. Owned executor discovery, shared remote state, settings UI on both clients, and remote default refresh before private inference are implemented. Combined67/67, all workspace types/build and owned formatting pass. Full formatting flags only preserved user preview; not staged/edited. Exact-head full/CI and authenticated executor/native/editor/UI acceptance remain required. Markdown89c3 has local2353/allCI success but native/editor acceptance remains open. Home5a and embed79fa full/CI remain live. Full C1-C6/M1/D1/U1 goal retained; no deploy/release/cleanup.
