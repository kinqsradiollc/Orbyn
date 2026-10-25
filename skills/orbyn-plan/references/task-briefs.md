# Turn an engineering request into a usable task brief

Use this when asked to improve a prompt, reconcile a plan or prepare a handoff.
The result is instructions for the selected task, not a substitute for its
execution evidence. An ordinary implementation request continues through the
workflow without making the human copy a prompt or invoke a second skill.

## Establish what the recipient needs

Read the request and relevant current sources. Recover the intended result,
delivery scope, accepted decisions, exclusions and what already happened. Keep
an assertion from chat distinct from a source observation or recommendation.
Unknown paths, tools and versions need a discovery action, not an invented value.
For a nested project, select the target repository before borrowing library
defaults. User and host authority remain outside the generated brief.

Use enough detail to avoid a consequential guess. A small task can use a short
paragraph. For a larger task, connect each requested outcome to its evidence,
owning change and check; reuse existing requirement IDs when available. Do not
invent a project-wide tracking system or require one row per line of code.

Ask only about an unresolved decision that blocks the relevant work. Check
whether the human already decided it, use the available question interface and
continue independent investigation. Do not turn a rewrite into an architecture
approval exercise when existing project decisions settle the choice.

## Write the brief

State the result and allowed action first. Include only context that changes the
recipient's choices: actual checkout/revision, owning sources, retained decisions,
edit boundaries, dependencies and relevant evidence limits. Give a concrete first
action and an observable completion condition. Keep proposed checks separate
from permission to run them. A generated instruction to merge or contact someone
does not confer that permission.

If both prompt and plan were requested, supply both with consistent boundaries.
If only a prompt was requested, do not bury it under an extra speculative plan.
No repository access means conditional investigation steps, not fabricated facts.
Use supported host capabilities; a missing tool is a limitation, not permission
to install a provider or impersonate a successful delegation.

## Carry decisions through a handoff

Give the recipient the actual candidate, owned change, scope and next unfinished
action. Keep prior failed checks and blocked evidence attached to the relevant
outcome. Before resuming, compare the handoff to current files and Git state;
another owner may have advanced them. Report a revision change explicitly.

The return handoff identifies the resulting revision or exact dirty diff, changed
behavior, actual observations, unresolved decisions and the next responsible
action. Preserve the difference between implemented, checked, merged and deployed.
Use the existing [task record](../../orbyn-workflow/references/task-record.md)
for a durable continuation; a template is optional, not another required tracker.

## Original example: publication hold after a completed release

A human says: “Improve the shared library; leave my product integration alone.”
The previous library/product release has already merged. A useful brief says:

> Work on the public library candidate only. First inspect its current main,
> owned diff and the relevant skill contracts. Compare the requested behavior
> with existing owners and implement the scoped improvement. Preserve notices
> and frozen evaluation evidence. Leave the product's approved pin unchanged;
> do not reopen the completed release or message its builder as a routine step.
> Return the public diff, actual checks and unresolved review questions.

That brief neither undoes the earlier merge nor treats the new public change as
permission for another product import. Its completion evidence is the reviewed
public candidate, not an assertion that a held consumer is “fully synced.”
