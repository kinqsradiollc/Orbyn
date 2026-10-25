# Bounded discovery and impact mapping

Use this method for an unfamiliar subsystem or a change whose reach is uncertain.
A small known edit needs only the relevant path, not a repository-wide inventory.

## Find the executed path

1. Pin the question, checkout/revision and observable boundary: command, route,
   public symbol, failing test, event or user action. Start with bounded file/symbol
   searches and the owning package's manifests and instructions.
2. Follow callers and effects through source, configuration, registration and
   generated interfaces. Inspect build/package dependency queries when available;
   distinguish declared dependencies from runtime-loaded plugins, reflection,
   feature flags, job schedules and deployment wiring.
3. For generated code, find the schema/template and generator invocation before
   editing output. For events or jobs, identify producer, durable queue/topic,
   consumer registration, retry/dead-letter behavior and the result owner.
4. Stop when the relevant path and affected contract are explained and the next
   decision is supported. Time-box uncertain branches; record the unresolved edge
   and discriminating observation. Expand only if a missing edge can change the
   diagnosis, compatibility or validation scope. Do not read every matching file.

Keep a compact task-local map in the existing plan or notes when it is useful:

| Contract / edge | Evidence at revision | Implementation owner | Review / operational owner | Consumers and deployed versions | Unknown / next check |
| --- | --- | --- | --- | --- | --- |
| Example event schema → delayed worker | schema + registration + deployment config | event package | existing OWNERS / service catalog | current producer, older worker image | inspect rollout inventory before removal |

Use actual source anchors and query commands, not guessed team names. Mark an
owner or deployed version unknown if evidence is unavailable. A directory owner,
required reviewer and on-call operator may differ; assigning an agent changes
none of those responsibilities. Follow consumer rules for contacting people.

## Bound the blast radius

Check relevant direct and reverse edges: source callers, generated clients,
configuration, build targets, background jobs, events, stored data, supported
released clients and external consumers. A text search finding no callers is
insufficient for dynamic registration or published APIs. Ask the existing build
system for affected targets and record its limitations; use the
[CI method](../../orbyn-ci-design/references/affected-targets.md) for selection.

Cache this map only for the task. Revisit edges when the base revision, public
contract, generator, runtime configuration or deployment inventory changes.
Retain unknowns at handoff instead of treating the map as an authoritative catalog.

## Failure and stopping condition

A schema rename compiles locally, but an older worker still consumes serialized
messages. Trace its registered consumer and released image; verify mixed-version
behavior or retain compatibility until deployment evidence permits retirement.
Stop with the evidenced path, affected boundary and required next check. If runtime
access is absent, report a source-derived map, not complete deployed coverage.
