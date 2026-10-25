# Design across ownership and release boundaries

Use this for consequential cross-module or cross-service changes. Keep a bounded
change bounded: the goal is a justified contract and delivery route, not a new
platform or a complete organizational inventory.

## State constraints before choosing mechanisms

Identify the user/system outcome and the existing contract. Where material, name
workload shape, peak versus typical demand, latency target, availability, consistency,
capacity/cost limit, recovery objective and data retention. Label each value as
measured, required or assumed; do not invent numbers to fill a template. Compare
the current design/no-change option with the smallest plausible alternatives.
State the evidence that would reverse the choice. Use `arena` for a consequential
unresolved comparison, not every interface.

Use the [impact map](../../how/references/impact-map.md) to separate implementation
ownership from required review, release coordination and operational ownership.
Preserve existing team boundaries and approval rules. Define public interfaces,
allowed dependency directions, generated outputs and consumers outside the checkout.
Record unknown deployment or consumer state explicitly.

## Make large changes resumable

An atomic local edit is appropriate when every caller and effect is controlled in
one compatible release. Otherwise use staged units:

1. Define the target invariant and temporary compatibility contract, including
   who owns it and the evidence needed to retire it. Distinguish source API changes
   from durable data/wire changes; use `orbyn-data-migration` for the latter.
2. Pilot one representative slice through generation, build, tests and the real
   integration seam. Include a failure or old/new coexistence control.
3. For mechanical repetition, consider a codemod with bounded scope, deterministic
   output, a dry-run diff and a no-change second run. Separate generated files from
   source-of-truth edits. Do not automate an unsettled semantic decision.
4. Migrate in reviewable batches aligned to dependency and ownership boundaries.
   Record completed/pending/blocked consumers and base revisions in the existing
   task record. Preserve partial progress, make retries safe and recheck drift
   before applying a stale batch. Never overwrite another team's intervening work.
5. Retire old paths only with evidence covering known callers, generated artifacts,
   supported deployed versions and external compatibility commitments. When an
   external consumer cannot be verified, keep the boundary and state that retirement
   remains incomplete; do not claim completion from a clean local search.

A release-independent SDK migration may require dual support while applications
upgrade. A private helper with all callers in one build often does not. Choose the
smallest compatibility period that meets the real deployment contract; avoid both
permanent accidental dual APIs and forced breaking cutovers.

## Evidence and handoff

Return owner/interface decisions, relevant quantitative assumptions, rejected
alternative, pilot result, ordered batches, recovery and retirement criteria.
Source/code migration progress, deployed adoption and retired compatibility are
separate states. A design-only request ends at this proposal.

Further primary context: [Software Engineering at Google, large-scale changes](https://abseil.io/resources/swe-book/html/ch22.html).
This method is independently authored; the link is background, not a required download.

## Durable-transition handoff

When data or wire formats change, include the migration owner's
[writer boundary](../../orbyn-data-migration/references/writer-cutover.md) in the
proposal itself: which deployed/direct/replay writers can still act, where their
writes are admitted or rejected, and what evidence precedes incompatible conversion.
A phase list without that enforcement is incomplete. An internal rename in one
release need not acquire a production migration ceremony.
