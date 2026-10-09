# Content-density review — 9 October 2026

**Decision: changes required. Round 1/3.**

Candidate `686eb0a570cfc974d9bd621a629d92ccc2535eab`, branch
`codex/content-density`, checkout `/tmp/orbyn-c2-main-integration`, base
`c778c25fa469a1f85ddb90421b5e7eb8186008d0`.
Inputs: candidate handoff `docs/reviews/content-density-2026-10-09.md` and
Tester report `content-density-test-00098f37-2026-10-09.md` in the
`adr-release-qualification/Orbyn/docs/reviews` checkout.

Reviewed source, changed test assertions and Tester's initial/retest record.
No source edits, tests, builds or visual checks performed. Applied Orbyn UI and
content-design guidance; explicit visual/native-build exclusions take precedence.

## R1 — P2: Keep a refresh path when morning summaries are disabled

Locations: `desktop/src/features/settings/AgendaPrivateSettings.tsx:67` and
`mobile/src/screens/settings/AgendaPrivateSettings.tsx:72`.

The new condition hides Refresh unless permission is already enabled or an error
exists. The corresponding `useAgendaPrivateSettings` hooks only reload on user,
session or their own revision changes; they do not subscribe to sibling provider,
model or connection changes.

Open AI Settings with summaries off and Orbyn selected (or no eligible device).
Then connect/select an eligible desktop and choose ChatGPT in the same Settings
view. The summary section retains its old choice/catalog snapshot, so its switch
stays disabled and its prerequisite message remains stale. The user has no refresh
action there; refreshing the separate model section does not reload this hook.
Closing/reopening Settings becomes necessary. Previously the always-present
Refresh action supplied this recovery path.

Builder: retain a compact refresh action while disabled, or wire a reliable
provider/model/connection invalidation signal into both hooks. Preserve explicit
permission and version checks; do not silently enable summaries after a provider
change. Restore the action as the smallest correction if broader synchronization
is unnecessary for this copy pass.

Tester: on both clients, mount summaries disabled with an ineligible choice,
change the backing choice/catalog to eligible without remounting, then use the
provided recovery path. Assert fresh state enables the switch and enabling sends
the newly reviewed version fields. Also retain error retry and revocation access.
This is a focused state/recovery regression, not a request for visual checks.

## R2 — P3: Keep the completed-request qualifier in usage's empty state

Locations: `desktop/src/features/settings/ChatgptUsage.tsx` (zero
`completed_requests` branch) and `mobile/src/screens/settings/ChatgptUsage.tsx:93`.

“No ChatGPT requests yet” is broader than the measured fact. The endpoint counts
`chatgpt_completed_usage` within its reporting window; failed/interrupted requests
and requests outside that window do not establish that count. A user can have
made requests while this branch says none exist. The old completed-request wording
preserved this distinction.

Builder: use a short accurate state such as “No completed requests recorded.”
Keep the distinction from ChatGPT-wide quota. This is a small copy correction to
batch with R1, not a request to expand usage collection.

Tester: confirm both rendered zero-count states describe recorded completions,
not all attempted requests. Existing populated-count assertions do not inspect
this branch.

## Other assessment and evidence

- All six Tester findings are corrected in the candidate: account-email sender
  condition, scheduled-summary desktop prerequisite, nightly ten-run cap,
  local-OAuth freshness/source warning, usage-test expectation, and built-in
  assistant disconnect limitation. The retention helper preserves batching and
  the meaning of zero.
- The inspected copy retains named embedding-recipient consent and excluded
  spaces, destructive account/page consequences, approval boundaries, server-side
  key handling, private calendar scope, fallback choice and uncertain-result
  handling. User-authored content is not rewritten by the changed call sites.
- Home guide tests now check retained timing, destination and pause conditions
  and disclosure behavior. Usage tests retain large exact counts, missing
  measurements and session isolation. Some connection tests are source-string
  checks; they do not prove every conditional action remains reachable. That is
  why R1 needs a behavior-level regression rather than another copy match.
- Tester reports desktop/mobile typechecks, **82/84** initial focused UI cases
  (two stale usage assertions), **124/124** admin/provider cases, then **6/6**
  usage/consent retest cases on the corrected candidate. The failures remain in
  the record; these cohorts must not be presented as one full-suite run.
  Retest changes are copy plus the matching test expectation. Tester used the
  existing dependency tree via temporary links, subsequently removed; a clean
  dependency installation was not established. These are Tester-reported results,
  not checks executed by Reviewer.
- Database-backed setup failures were outside the requested UI-copy cohort.
  No broad rerun, Visual Check or iOS/Android build is requested. Rendered density,
  native behavior and production deployment remain unverified under the exclusions.

Batch the corrections, obtain scoped Tester receipts and return for closure in
this same round where appropriate. Counter remains **1/3**. No acceptance,
merge, push or deployment is claimed.
