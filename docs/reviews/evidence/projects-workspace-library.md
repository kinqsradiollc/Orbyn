# Projects workspace library — 3 October 2026

Web/Electron project collection changes from large repeated cards to bounded
rows: title/summary/workspace beside progress/count/deadline, stacking on narrow
screens. Metadata wraps. Search uses the already-authorized project list and
shared normalized matching across names, summaries, workspace, status and aliases;
all words match, order and object identity remain. No new server access or
permission expansion. Empty-library and no-match states are separate.

Mobile gets the same collection search/count/workspace/summary and shorter empty
copy; library query remains separate from search inside an opened project. The
extra introductory slogan is removed. Existing template/create/open/new-tab,
long-press/accessibility management and project detail flows are retained.

Fourteen helper/wiring/layout/type-scale checks passed terminal0 in
/tmp/orbyn-projects-library-regressions.log. Workspace types46276 and production
build94590 terminated0. These checks do not establish rendered geometry or
complete project interactions; web visuals are user-reviewed, native screenshot/
keyboard/large-text/both-theme/persistence acceptance remains open. Full U1 and
C1–C6/M1/D1 scope remains required; this is a collection increment only.

Based on current main5fc74f85; original Home profiles branch preserved. No main
merge/deployment/cleanup for this candidate. Final formatting and committed-head
full/CI required before promotion.
