# Orbyn audit protocol

This is the local execution and evidence contract for
[orbyn-security-audit](../SKILL.md). The agent performs the authorized phases
from the ordinary audit request; no additional skill invocation is required.
Read only relevant source and threat boundaries. Installing or editing this
workflow does not authorize a target audit.

## 1. Define a reproducible scope

Record target path, source revision, dirty files, requested paths, exclusions,
permitted tools/execution, output location, roles and hard budget in
`run-metadata.json`. Keep target source read-only and use a new owned output
directory outside it unless the user explicitly selected an ignored location.
Record unavailable tools and source; do not silently widen scope or change models.
The lead alone owns shared metadata, coverage, findings and reports. Each worker
has its own scratch directory; no worker writes another worker’s files.

Map entry points, lower-trust principals/inputs, authority, durable effects,
external dependencies and existing controls in `architecture.md`. Mark missing
middleware, deployment or provider evidence as unknown rather than assuming it
is absent. Use the [boundary guide](threat-boundaries.md) to select relevant
checks; irrelevant layers need no new investigation stage.

## 2. Track actual coverage

`coverage-ledger.json` is an array of units. Each unit records a stable identity
from canonical surface/boundary/subsystem/attack-class references, starting
paths, selected/excluded check blocks and reasons, prior status, attempts, wave,
assigned agent, reviewed paths, local checks, result fingerprints and unresolved
facts. The bundled ledger validator defines exact fields and constraints; its
`canonicalCoverageId` export derives IDs consistently from canonical references.
Use this contract instead of inventing a parallel ledger format.

| State | Meaning |
| --- | --- |
| `planned` / `in_progress` | Assigned or underway; no completed coverage claim |
| `covered` | Specific reviewed source/checks support the recorded boundary conclusion |
| `candidate` | A source-grounded possible violation awaits disposition |
| `blocked` / `deferred` | Missing evidence/capability or budget prevents completion |
| `not_applicable` / `out_of_scope` | Reasoned exclusion, with its scope basis retained |

Preserve prior attempts and fingerprints. Source changes invalidate relevant
prior conclusions until rechecked. A search hit, tool success or assigned agent
is not inspected coverage. Validate the ledger when created and after changes.
Reserve capacity for independent verification and a final coverage review before
hunting; stop taking new units when that reserve would exceed the user’s budget.

## 3. Investigate a boundary hypothesis

Trace accepted input through propagation to the effect/control. Record actual
file/line anchors and the actor, resource, intended invariant and possible result.
Consider controls on the entire reachable path and try a concrete counterexample
to the hypothesis. Deduplicate by root cause/boundary, not by title. Retain rejected
leads and exact blockers. Avoid anchoring a new pass on earlier confirmed examples.

Static inspection is read-only. Target-controlled execution requires explicit
authority and an OS-enforced sandbox with external networking disabled, an empty
allowlisted environment, read-only target/toolchain, isolated scratch writes and
bounded CPU, memory, processes, disk, output size and wall time. Allow isolated
loopback only for the bounded local fixture. Use dummy principals and secrets;
never expose credentials, host sockets, another role’s data or production services.
Do not install dependencies or bypass unavailable isolation. Continue source work
and mark the missing decisive result when those controls cannot be enforced.

## 4. Challenge candidates independently

Give each unique candidate to a fresh permitted verifier on the same source.
The verifier attempts to disprove reachability, actor authority, missing controls
and claimed consequence. A second pass by the author is not independent evidence.
Record the role/model, reviewed source, actual checks and observed result. If
independent roles are unavailable, keep the run incomplete and return preliminary
observations. Do not relabel unverified work to make the report appear complete.

Use distinct scratch roots. Target-controlled processes must finish before any
result is retained. Promote only allowlisted, size-bounded regular single-link
files using no-follow directory-relative handles, with identity/type/size checked
before and after reading and exclusive no-follow destination creation. Never
recursively copy untrusted scratch or promote links, devices, sockets, FIFOs,
changing files or archives. If those controls are unavailable, do not retain that
artifact as decisive execution evidence; record the blocker. Retain only minimum
non-secret evidence and never copy the ambient environment.

## 5. Reconcile records

`findings.json` is an array conforming to the local
[record schema](upstream/audit-records/report-schema.json). Preserve stable
fingerprints across verdict changes and include the required source traces,
evidence, validation/rejection rationale and unresolved facts.

| Verdict | Evidence and priority |
| --- | --- |
| `confirmed` | A real reachable boundary failure with independently demonstrated consequence; severity limited to that consequence |
| `needs_validation` | A specific source-grounded hypothesis with an exact unresolved fact and safe validation plan; no severity |
| `rejected` | A disproved hypothesis with its reason and retained source evidence |

An unsupported best-practice preference, guessed deployment setting or absent
second defense is not a confirmed vulnerability. Missing verification capacity
means incomplete work, not an invented finding verdict. Fresh record review checks
source anchors and consistency before prose is derived. Material replacement of
a claim needs another independent review within the actual budget.

The agent invokes the validators for authorized artifacts from this directory:

```sh
node upstream/audit-records/validate-findings.cjs /path/to/owned-audit/findings.json
node upstream/audit-records/validate-coverage-ledger.cjs /path/to/owned-audit/coverage-ledger.json
```

Node and the record helpers must be available locally; no download is implied.
Helper success proves structure/consistency only, never source truth, runtime
consequence or independence. Preserve required helper license/provenance metadata.

## 6. Deliver the actual result

Derive `REPORT.md`, `FINDINGS-DETAIL.md` and `NEEDS-VALIDATION.md` from the reviewed
records and ledger. State source/scope, actual checks, confirmed results, rejected
leads, blockers, deferred coverage and smallest proposed fixes at their owning
boundary. Keep prose and JSON consistent and retain prior failed receipts.
Set run status to complete only when scoped coverage and independent validation
are finished and both validators pass. Otherwise record incomplete status, exact
reason, affected candidates/units and next evidence needed. A finite audit cannot
promise exhaustive absence of vulnerabilities.

Remediation, live checks, issue publication, messages and hosted scanner runs
remain separately authorized effects. Return the local result without requiring
the human to invoke another workflow merely to finish report generation.
