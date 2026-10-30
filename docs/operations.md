# Orbyn operations

Read current source and deployment configuration before using historical service
names, defaults or incident reports. Keep runtime changes within the user's
requested environment and delivery scope. Repository changes are not deployment.

## Locate the owning contract

| Concern             | Source                                                                 |
| ------------------- | ---------------------------------------------------------------------- |
| Environment parsing | `backend/src/config/env.ts`                                            |
| Authorization       | `packages/core/src/teams/rbac.ts`                                      |
| Data/API design     | `docs/architecture.md`, `docs/api.md`                                  |
| Deployment          | `docs/deployment.md`, `deploy/`                                        |
| Scale and queues    | `docs/scalability.md` and the owning worker                            |
| Request diagnostics | `backend/src/lib/request-log.ts`                                       |
| Record retention    | `backend/src/lib/sweep.ts`                                             |
| Imports             | `packages/core/src/imports/imports.ts`, `backend/src/modules/imports/` |
| Legal/privacy copy  | `packages/core/src/workspace/legal.ts`                                 |

Trace service boundaries, persistence, retry/idempotency rules and recovery before
changing APIs, jobs or connectors. Keep secrets out of logs, screenshots and
reports. Capture non-secret request IDs and failure reasons where available.
Adding a growing table requires an explicit retention plan, not an unrelated
periodic delete job. Preserve migration ordering and existing advisory locking.

## Operational boundaries

- Inspect environment examples and schemas; preserve local credentials/config.
  Do not run production migrations, change infrastructure or restart services
  without applicable authorization. Do not connect checks to a normal user DB.
  Authorized database tests follow [development](development.md).
- Match mocks and fixtures to their actual claim. A simulated provider response
  is not live-provider evidence; a local build is not deployment or OAuth renewal.
- Keep assets first-party and respect analytics opt-out. New personal-data
  collection or third-party sharing needs matching privacy text and appropriate
  consent. Admin visibility must not expose file contents or credentials.
- Inspect import storage/expiry and the cheapest extraction path first. Preserve
  source provenance and flag uncertain equations. Do not build heavy `formula`
  or `ocr` images locally. Optional provider engines stay optional.
- Preserve user approvals for assistant proposals, study edits and revision plans.
  A workflow document cannot authorize externally visible messages or publication.
- For packaged-app or native investigation, see the retained tooling section below. Copying
  REA source does not install its engines, register MCP or authorize target runs.

Record what was changed, the commands actually run, remaining manual checks,
rollback/recovery considerations and exact delivery state. Report denied actions
rather than bypassing host restrictions.

## Security receipt and booking-host cutover

Migrations 295 and 296 change retained idempotency receipts and team booking-host
assignments. Before an authorized rollout, the service owner must identify and
drain all old API and agent processes that read receipts or mutate team membership,
booking pages or host assignments, including in-flight transactions and queued
work. Keep incompatible instances from restarting. Do not reopen those paths while
their writer versions or direct database writers are unknown.

Migration 295 removes existing receipt bodies, retains their keys and statuses as
non-reexecuting tombstones until normal receipt retention expires, and installs a
database trigger that strips bodies
written by old or unsupported receipt writers. Old readers still bypass the new
authorization policy, so the trigger does not make mixed-version serving safe.
Migration 296 removes team-page host assignments for people who are no longer
members, preserving personal-page assignments. Its locks protect the cleanup
transaction; old booking or membership writers must remain drained afterwards.
Review table size, lock duration and the maintenance window before applying either
migration. A host who left and rejoined before cleanup is indistinguishable from
a continuously authorized host and requires an owner review if its history matters.

After upgrading all readers and writers, check that old receipt writers cannot
store response bodies, new authorized retries work, removed team hosts cannot
read bookings, and queued operations are reconciled. Pre-upgrade receipts cannot
recover their original response; a `409` requires reviewing the prior result,
not repeating the operation under a new key. Do not restore old application
binaries or reinsert all deleted host assignments as a rollback. Use a compatible
forward repair and explicit host reassignment. Old database pages, backups and
WAL can still contain plaintext credentials after the logical purge; assessing
rotation and storage retention or sanitization is a separate operator task. This
procedure is a rollout requirement, not evidence of a deployment or that any
historical credential was exposed.

The booking change reconciles existing calendar associations when a booking is
rescheduled or cancelled; it does not bulk-delete or rewrite people’s personal
calendar events. A former host's old event and reminder settings remain as they
were, and may need personal cleanup. The live booking can select a current
round-robin host when its former assignee is no longer a host on the page. Drain old booking
writers before relying on this boundary: an older writer can still update the
old associations. Existing records whose assigned user was deleted and whose
foreign key became null do not retain enough information to distinguish a former
round-robin assignment from a collective booking; they keep the existing null
interpretation rather than being automatically reassigned.

The updated mobile outbox stores its exact request before dispatch in a version 3
record under the existing storage key. An older app refuses that record instead
of reopening it, but an older process that already loaded the queue can still
write its old copy. Stop old app processes before upgrading a device's queue.
Previously attempted version 2 changes without an exact request are held for
reconciliation, because their delivery cannot be proved. Keep the updated app
available for those queues; replacing it with an older build does not provide a
safe retry or recovery path.

For the page-file quota correction, upgrade or drain every old file-store process
before accepting outstanding upload links: old stores can still honor a larger
allowance embedded in a previously issued link. New stores also cap those links at
their saved reservation. Existing files above quota remain counted at their actual
size and need a separate owner decision if storage must be brought below quota.

## Retained tooling snapshots

`tools/rea` retains source revision `ccc7da309d7db385d5c6d73b0a3a8e093be33504`
(package 6.7.0), and `tools/pstack` retains its historical plugin source. They are
licensed source snapshots, not the active engineering workspace. Their manifest,
source bytes and five provider gitlinks are unchanged by retiring copied skills.
See [third-party notices](../tools/THIRD_PARTY_NOTICES.md).

Run `python3 scripts/check-tool-sources.py` from the repository root for static
hash/mode/gitlink checks. This neither installs nor runs REA or native providers.
A future explicitly scoped REA build uses its own `.nvmrc`, `packageManager` and
lockfile. Its documented local build path is `HUSKY=0 npm ci` followed by
`npm run build:cached` from `tools/rea`; inspect current scripts first. Disabling
Husky prevents a vendored prepare hook from changing Orbyn hooks. REA is not an
Orbyn npm workspace or production-container dependency.

Provider initialization, client/model setup, engine upgrades and target execution
remain separate work requiring applicable authority. Keep local research and
outputs outside tracked source and preserve them before checkout cleanup. No
engine, submodule or runtime upgrade follows from this documentation migration.

## MCP task placement compatibility cutoff

Migration `290_task_project_version_compat.sql` records one deployment-wide grace
period for versionless MCP `link` calls of kind `task_project`. It fixes a UTC
cutoff 90 days after the migration runs. Explicit versions always retain their
caller-version conflict checks. REST placement requires a version throughout.
Only during this announced grace period may an MCP call omit the version and use
the locked current row version through canonical placement. That temporary path
does not detect the caller's stale view.

Before deployment, announce the persisted cutoff to affected clients and arrange
their migration to fetching and sending the task version. Run this content-free
inspection against the owning deployment database:

```sql
SELECT value->>'installed_at' AS installed_at,
       value->>'deadline' AS deadline,
       value->>'legacy_use_count' AS legacy_use_count,
       value->>'legacy_last_used_at' AS legacy_last_used_at
FROM system_settings
WHERE key = 'mcp_task_project_version_compat';
```

The count and last-use timestamp commit with successful legacy placement; they
contain no task, request, identity or credential content. Absence or corruption of
the policy refuses legacy requests. Do not create a replacement row from an
application restart or configuration fallback. Retain the original row and its
cutoff across migration reruns, restarts, restore procedures and rollback. An
unavailable or expired legacy path returns actionable instructions to fetch the
task and include its version.

All serving replicas must use the new guard before cutover. Drain and retire any
older binary that can accept versionless placement without consulting the shared
policy; a mixed fleet cannot enforce the cutoff while those binaries remain.
At the cutoff, verify rejection through every serving route and review remaining
legacy usage. A rollback must preserve the policy and route MCP placement only to
binaries that enforce it; pause that write surface if none are available. Do not
extend the deadline, reset its counters or restore an unguarded writer as a
rollback mechanism. These are deployment requirements; local code and tests do
not establish that a deployment or client migration has occurred.

## Booking email delivery

Booking transitions and initial address verification save encrypted email intents
in the booking transaction. The notifier sends committed intents. Verification
intents expire with their booking hold; a later booking revision supersedes older
unsent messages. Messages include their snapshot time because an SMTP exchange
already in progress cannot be recalled.

Inspect counts and timestamps without decrypting guest addresses or management links:

```sql
SELECT state, count(*) AS intents, min(created_at) AS oldest,
       min(available_at) FILTER (WHERE state='pending') AS next_attempt,
       min(dispatched_at) FILTER (WHERE state='uncertain') AS oldest_uncertain
FROM booking_email_outbox GROUP BY state ORDER BY state;
```

`pending` and `preparing` are recoverable work. `sending` means the dispatch was
committed before contacting SMTP. An expired sending lease or ambiguous transport
failure becomes `uncertain`; it is never automatically resent. A stable Message-ID
supports investigation but does not prove provider deduplication. Check the
provider's delivery records before reconciling an uncertain intent. The current
candidate has no operator resend UI; do not reset an uncertain row to pending
without reconciling possible acceptance. `failed` means preparation or proven
pre-submission retries exhausted their budget. Diagnostics store content-free
reason codes, not SMTP error text. SMTP not configured pauses pending work without
consuming retries.

Terminal receipts and their encrypted payloads follow the Admin retention rule
**Booking email delivery records**, default 90 days, minimum 7 days, or 0 to retain
indefinitely. Reconcile uncertain/failed records before that configured deadline.
Pending and in-flight work is excluded. Maintenance uses indexed batches of at
most 100 expiry/lease transitions per worker call; actual production query costs
and load capacity remain unmeasured.

For rollout, apply additive migrations before starting the new producers/worker.
Stop and drain old inline-mail producers before switching ownership; do not run
old and new senders for the same booking transition. No historical mail is
backfilled. To pause delivery, set `BOOKING_EMAIL_DELIVERY_ENABLED=false` on every
notifier replica and restart them, allowing existing SMTP calls to settle. Keep
compatible producers recording intents. A recovery/rollback must retain these
migrations, encryption keys and intent records; do not return to inline SMTP or
start legacy notifier replicas that do not honor the pause flag. This procedure
is a deployment requirement, not evidence that a production cutover has occurred.

## Assistant apply recovery

Apply migrations 298–299 before starting the compatible runtime. New chat and automation
admissions explicitly set `ai_jobs.apply_tracking_version=1`; old rows and older
admission writers keep null, with no backfill or stamping on resume. The current
writer commits `apply_started_at` under its job lease before starting the effect
transaction, which commits `apply_result` atomically with changes or a proposal.
The database rejects that reviewed atomic writer on a tracked job without the
marker, rolling back its effects. This guards the existing apply contract; it
does not fence arbitrary writers that omit its receipt entirely.

On an apply exception, primary reconciliation locks the same job, waits for any
effect transaction, checks lease and current source/chat access, and validates the
receipt. A confirmed receipt survives a lost commit acknowledgement. Missing,
malformed, inaccessible or unavailable evidence remains unknown. Only a tracked
job with positive current-writer knowledge, no marker and no receipt can establish
that applying never began. A failed effect transaction can also record positive
rollback evidence, provided COMMIT was never attempted and ROLLBACK was acknowledged.
This evidence binds the exact apply marker and current lease. A new attempt clears
it while renewing the marker. Failed COMMIT acknowledgement never qualifies for
that path; failed rollback discards the connection. The runtime must not revise or repeat an uncertain
apply. Internal `terminal_evidence` is optional, job-bound and not a retry command;
older jobs stay unqualified rather than inheriting evidence from error prose.

Migrations 298–299 alone do not enable a fresh-attempt scheduler. Preserve the columns,
markers, receipts, current permissions and retained history during recovery or
rollback. An older atomic apply writer encountering tracked unmarked work will
fail its transaction; use a compatible runtime to reconcile or hold it, rather
than dropping the constraint or clearing a marker. Coordinate execution workers
before enabling any future automatic retry policy. Local source and guarded tests
do not establish that a hosted rollout or worker cutover occurred.

Explicit goal work requires migrations 300–301 before starting its API or compatible
Background/Overnight consumers. It adds execution intent/frontier and attempt
records around the existing `ai_jobs` queue; it does not create a second provider
or planner queue, convert weekly check-ins, or start existing goals automatically.
The API, runtime and worker must agree on the execution generation, stable unit and
source/configuration checks. New Start is a person action, and accepted completion
requires a separate first-party person attestation of current criteria and evidence.
See [Assistant](assistant.md#explicit-goal-work) and the
[API contract](api.md#explicit-goal-executions-session-mutations-authenticated-reads).

Before a migration 301 cutover, stop and drain old Background/Overnight consumers.
Their execution-wide settlement/admission code must not run against the new
per-unit frontier. Apply the migration, then start compatible API/runtime/workers
together. Migration 301 preserves settled history, keeps the current pending
Review producer open, and replaces execution-wide ownership with one open attempt
per unit. It also updates the database work-owner guard and adds the matching runner
waiting-overlap predicate. Applying it locally does not establish a live production
migration or worker deployment.

A waiting question or approval parks its own unit and retains the same job,
checkpoint and allowance reservation; independent criteria may proceed. Answer
requeues that job. Pending Review retains the original producer/proposal while its
terminal budget charge can already be settled. `processed_at` records frontier
consumption separately from `settled_at`/`settled_tokens`; both are one-way records.
The execution's current-job pointer is presentation only. Existing lane/night
limits and cumulative attempt, estimated-token and deadline bounds apply across
all work, read-only verification, versioned repair and parked reservations. Unknown
usage keeps conservative accounting. Unknown effects, changed permission/configuration,
pruned required evidence and unsupported repairs hold work instead of replaying a
create operation. An open explicit execution excludes competing weekly/night
check-in admission, and the work-owner guard still prevents simultaneous running
jobs for one goal.

Pause prevents new admissions; Stop invalidates the generation and requests
cancellation of every queued, running or parked execution job without undoing
committed effects. Controls lock retained jobs in stable order before the execution.
Settlement must still charge each terminal or pruned attempt once after its
current-job pointer is cleared, and must not reopen a stopped generation. If an
API process ends after committing Stop but before finishing parked cancellation,
the existing worker completes that cancellation without a provider call. Settling
unchanged waiting questions or pending Review must not starve later terminal work.
During recovery, preserve units, bound artifact IDs/versions, attempt lineage,
settlement/consumption timestamps, hashes, reservations and acceptance records.
Do not clear markers or relabel held work as complete to drain the queue. Deployment
worker cutover, production query costs, full Open Duet parity and installed-native
qualification require their own evidence; local source/tests do not establish them.

Routine occurrence recovery requires migration 302 and compatible API, Background,
Overnight and runtime writers. Stop/drain older consumers before cutover: old
scanners do not understand open recovery ownership or intent versions. The migration
adds a separate default-off policy and child attempts under the existing occurrence
ledger; it does not backfill recovery eligibility or create another queue/provider.
The original occurrence timestamp and first-job history remain unchanged.

Preparation captures instruction, schedule, manual intent version, policy,
provider/scope fingerprints and contextual destination/source-entry bindings. Queue
admission rechecks that snapshot atomically with the first child. Canonical admission
seeds known routine/turn provenance after binding delivery and before commit;
runtime boundaries still require checked current/prior sources, and workspace reads
are recorded before provider use. Do not bypass this gate for a new unchecked job.
Scheduler progress and automatic exhaustion do not change manual intent; manual
routine/configuration and retry-policy writers must increment it. A final occurrence
can therefore recover after scheduler exhaustion without treating a person's Pause
as permission to continue.

Each occurrence has at most one unsettled child attempt. Charge it once, retain
accounting after job pruning, and preserve its predecessor and terminal qualification.
Only classified transient failures with confirmed no effects qualify for fresh
attempts; applied/pending/uncertain outcomes remain held or in their existing Review
flow. Token allowance and attempt count are cumulative. Deadline is fixed at initial
admission, capped by the captured next scheduled occurrence, and never moved by
backoff. Existing lane/night consent, windows and budgets remain independent gates.
Occurrence Stop fences its generation and cancels all its jobs; expiry cancels
parked/queued work with a distinct deadline cause. Neither action undoes effects or
erases accounting. Preserve cancellation reason, intent versions, snapshots,
reservations and immutable attempt lineage during recovery or rollback. This is a
local migration/runtime contract, not evidence of a production deployment, real
provider qualification or native interaction qualification.

## Assistant admission policy

Migration 294 seeds one policy at revision 1, retaining the existing ceilings:
8 global slots, 4 interactive, 2 background and 2 overnight. The job, maintained
page and scheduled Agenda claim paths validate `ASSISTANT_ADMISSION_REVISION`
under the same advisory lock used to count leases and reserve work. A missing,
invalid or mismatched policy fails closed. Budgets, provider authority, lane
ownership, lease tokens and queue order remain separate controls.

Inspect policy without reading user content:

```sql
SELECT revision, global_limit, interactive_limit, background_limit,
       overnight_limit, updated_at FROM assistant_admission_policy WHERE id;
```

Policy changes use the internal `applyAssistantAdmissionPolicy` command in
`modules/ai/agent/runtime-slots.ts`, supplying the expected revision and validated
limits. It applies a compare-and-swap and increments the revision. There is no
public policy-change route or automatic capacity increase. The current schema
rejects limits above the existing ceilings; zero can pause new claims. Existing
leases drain rather than being killed. A rollback applies another revision with
the desired lower limits and updates compatible runtime configuration together.
Do not reset the revision or overwrite the seed during startup.

Stop or externally fence all legacy claimers before activating policy ownership.
Code that never reads this policy cannot be fenced by its revision. Coordinate
all replicas' runtime revision and policy while claims are paused; existing work
can drain through its lease protocol. Repository changes do not demonstrate that
this production cutover has happened.

Fairness measurements use **team** scope when a task/project or maintained page
has a known team. Private work stays attributed to its owner; unscoped work stays
separate because it may read several spaces. Measure queue age by scope and lane,
including sustained competing backlog, before choosing a scheduling or wait-time
guarantee. The synthetic attribution fixture in
`backend/tests/assistant-admission-policy.test.ts` demonstrates grouping and ages;
it is not production fairness evidence. Current caps and queue order are retained.
