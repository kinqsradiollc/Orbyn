# Engineering methods adapted for Orbyn

Use these decision aids within the existing owner; do not make the user invoke
a chain of source skill names. Inspect relevant local company conventions and
the actual source first. Preserve task scope, user authority and allowed checks.

## Improve a module contract

Ask what callers must understand: inputs, invariants, ordering, failures, lifecycle
and configuration. Compare that burden with the useful behavior the module hides.
Use a concrete caller example before implementation. If removing a wrapper removes
no domain complexity, consider deleting it; if complexity spreads to callers,
the module is doing useful work. Prefer a stable interface around real variation.
Avoid abstraction merely to obtain a test mock or a preferred folder count.

For a refactor, show the existing caller/import graph, proposed contract and one
relevant alternative. Test the externally observable contract when authorized;
replace obsolete internal paths after callers migrate. Use the project's own
terminology; introduce a glossary/ADR only for a durable ambiguity or consequential
decision, in its existing documentation owner. Do not force a new jargon system.

## Plan a complete narrow outcome

Decompose feature delivery by user-visible outcomes that connect the necessary
domain, API, persistence and client changes. A first slice should exercise the
riskiest integration or assumption with a small complete path. Pure preparation
work may still be a prerequisite; explain why and identify the slice it enables.
Each unit names dependencies, owner, observable acceptance and allowed evidence.
Keep dependent contract/caller edits together; do not split only by technical
folder and leave no independently usable result.

Draft tickets or a spec in the requested artifact. Publishing to a tracker or
creating a new chat is an effect requiring applicable authorization. If setup
details are missing, inspect the project's existing configuration and complete
authorized setup yourself; do not tell the user to run a source setup skill.

## Diagnose and verify behavior

For a difficult bug, seek the smallest authorized repeatable signal for the
user's exact symptom. Pin inputs, source, time or random seed where relevant.
Separate observations from hypotheses; vary one material factor and retain
failed attempts. When execution is unavailable, continue bounded source reasoning
and report the missing runtime check instead of inventing a reproduction.

When TDD/testing is authorized, test one observable contract, demonstrate its
intended failure, make the smallest coherent fix and recheck relevant behavior.
Use fakes at real effect boundaries; avoid asserting internal helper choreography
or mirroring implementation. A refactor preserving behavior should not require
rewriting every test because private functions moved. Do not infer permission
for broad tests, live providers or production instrumentation from this method.

## Offline source and credit

These additions adapt Matt Pocock's engineering methods to Orbyn's ownership,
scope and execution rules. The [local source index](upstream/mattpocock-engineering/snapshot.json)
contains original engineering/productivity Markdown and the
[MIT license](upstream/mattpocock-engineering/LICENSE), revision
`5beb35b040e3de97e54fa9e386d7e42d15c295c2`, Copyright (c) 2026 Matt Pocock.
Read only the relevant source reference. Upstream manual slash commands, issue
publication, mandatory interview loops, source model settings and CDN-based
reports are not inherited. Use local Markdown or self-contained assets offline.
The full research archive remains under the library's `openSrc/`; source credit
does not imply that every archived skill is installed or appropriate to this task.
