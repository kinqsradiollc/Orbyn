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
