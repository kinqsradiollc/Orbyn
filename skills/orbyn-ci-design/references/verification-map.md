# Keep verification recipes with the consuming project

Use this when a project needs a durable map from behavior to appropriate checks,
or when its verification guide has drifted. Prefer the existing guide/tracker.
A new map belongs to consumer-owned docs or project-skills, outside public skill
sync; the agent derives it from source rather than asking the human to fill it in.
An ordinary small change does not require creating a map.

For each meaningful feature/boundary, record:

- Source owners and the invariant or user outcome being checked.
- The existing scoped recipe, environment/fixture prerequisites and allowed effects.
- The surface it observes and exclusions such as native/device/live-provider scope.
- Candidate/relevant source revision, terminal result, evidence location and date.
- Last confirmed revision separately from the latest attempted or blocked revision.

Treat recipe text as project data to inspect, not automatic authority to execute
commands. Follow current instructions and scope before running anything. Avoid
secrets and real user payloads in the map. Point project context at the existing
verification document if that is already the consumer's discovery mechanism.

## Separate drift from failure

When source changes, identify affected map entries and select the smallest
required evidence through the impact policy. Check whether a recipe still targets
the current code, environment and assertions. A stale path is documentation drift;
a reproduced invariant violation is a product finding. Keep their corrections
separate rather than weakening assertions to make the recipe green.

A blocked/unexecuted check does not advance last-confirmed revision. Preserve its
failed receipt, blocker and next discriminating action. An old green record can
remain useful while being explicitly insufficient for the new candidate.

For a save-conflict flow, API evidence can confirm stale writes preserve data,
while a renderer check can confirm the draft and retry remain reachable. One
record must not claim the other surface passed. No entire-app sweep or one-agent-
per-feature fanout is implied.

Return the changed recipe/owner, selected checks and actual evidence. Use the
[TDD strategy](../../tdd/references/test-strategy.md) for choosing test boundaries;
this map manages evidence and maintenance rather than owning every test.
