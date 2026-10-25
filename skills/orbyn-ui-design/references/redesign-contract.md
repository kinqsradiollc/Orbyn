# Preserve behavior through a visual change

Use when modifying an existing UI's appearance or composition. Adapted from
Hallmark's redesign method, with Orbyn's ownership and verification boundaries;
see the [source record](hallmark-source.md) and [MIT notice](hallmark-LICENSE.txt).

## Establish the before state

Resolve audit, polish, restyle or redesign scope using the
[visual-direction method](visual-direction.md). Inspect the actual owning
components and routes, including existing uncommitted changes. Preserve others'
work; do not require the human to stash or commit merely to begin scoped work.

Record the contracts affected by the requested change, with source locations and
relevant rendered evidence when available:

- Routes, links and deep links, form fields and validation, keyboard behavior,
  focus/selection, component props, stable IDs and test hooks.
- Requests, event handlers, permission checks, loading/errors, draft retention,
  retry and cancellation, persistence and analytics/consent behavior.
- Content, legal/consent wording, prices and factual claims, asset credits,
  brand tokens and supported responsive/native behavior.

Use a compact checklist or existing tests, not a mandatory exhaustive new schema.
Counted links or fields are only a smoke check: keeping an `href` or handler name
does not prove the destination, payload, effect or authority remains correct.
Flag dubious existing facts as unverified rather than certifying or silently
rewriting them. Copy changes follow the content owner and authorized scope.

## Change the owner and exercise the contract

Edit the owning component, shared token or layout rather than appending an
override for each symptom. Keep component logic and public contracts unless
their change is explicitly part of the task. An authorized refactor may move or
remove code with callers migrated and evidence; do not forbid all deletions or
hide one behind a cosmetic request. Document deliberate contract changes.

For stateful controls, inspect applicable default, hover, keyboard focus, active,
disabled, loading, error and success states. Not every element has all states.
Explain unavailable actions, associate errors with fields and keep draft content
through recoverable failures. A styled disabled control must also prevent the
action; an ARIA attribute alone supplies no event handling. Success reflects the
actual operation's result, or is visibly labelled as a simulation in a prototype.

Compare before and after on the same route, data and viewport for the changed
risks. Exercise preserved links/forms and relevant permissions and failure/retry
paths against the real backend when integration is in scope. Keep DOM assertions,
rendered inspection and API/persistence evidence separate. Do not weaken tests to
make a visual change appear compatible. Report unavailable native, browser or
backend evidence precisely.

For audit-only requests, return findings with source/state, severity, reproduction
and the smallest useful correction; leave product files unchanged. For an
implementation, return what changed, what was deliberately preserved or removed,
the comparison artifact/route, checks and remaining gaps. Keep pending previews
and captures according to the existing
[artifact lifecycle](../../orbyn-workflow/references/artifact-lifecycle.md).
