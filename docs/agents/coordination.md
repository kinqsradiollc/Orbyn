# Sessions and subagents

One owning session acts as the lead for a coherent task. Substantial work uses
native delegates for investigation and implementation; the lead retains scope,
design decisions, integration, diff review and verification. A small clear edit
can stay direct. A substantial task involves a nontrivial investigation, changed
contracts, multiple implementation steps or significant failure/recovery risk;
line count alone does not decide it.

| Work                                                              | Owner                                                  |
| ----------------------------------------------------------------- | ------------------------------------------------------ |
| Small clear edit or bounded continuation                          | Current session, direct work                           |
| Substantial investigation or implementation                       | Current lead with bounded native delegates             |
| Separately tracked project work explicitly requested by the human | Named Orbyn project session acting as that work's lead |

Before fan-out, identify blocking prerequisites, independent workstreams, shared
writes and the smallest safe decomposition. One implementer is valid for tightly
coupled work; delegate that slice and explain why parallel writes would conflict.
The lead may handle a bounded integration correction after reviewing the result,
but must not use integration as a label for retaining substantial implementation.

## Project sessions

Create a new user-owned session only when the human explicitly requests session
creation or a session-based split of the current project work. This policy is not
blanket permission to create sessions for every task. Reuse a relevant existing
session when authorized. Do not create duplicate Tester/Reviewer/Visual Check
sessions just because those roles appear in an old report.

In Codex, inspect the project/session tools available in the current host. List
projects first and create the requested session under **Orbyn**, using its returned
project ID, not a projectless chat. Select the standard tier for complex ownership
and the light tier for bounded work under [model policy](model-policy.md), using
the provider model/effort in [models.json](models.json). Use standard processing
only; never enable Fast/Priority/Ultrafast modes or speed-optimized variants.
The human-only tier requires explicit human selection. Respect the
host's session-creation model controls; do not claim an unsupported override.
Only request a separate worktree through session creation when the user has
requested it and the host supports it. Otherwise define disjoint file ownership
or serialize shared-checkout edits. A new session is not filesystem isolation.
Any new branch or worktree branch follows [branch naming](development.md#branch-naming):
neutral work-based names, without agent/vendor/tool/model branding.

Claude Code has its own session/background-agent capabilities depending on
installed version. Discover the supported mechanism before use. Do not assume
Codex desktop tools exist in Claude, or launch hidden CLI inference processes as
a substitute. If the session mechanism is unavailable, continue the current
session and explain the limitation. Do not silently change the requested topology.

Give each new session a self-contained brief: outcome, checkout/branch/candidate,
owned files, allowed checks/actions, exclusions, model/effort policy, stopping
condition and expected handoff. A project-session owner may use up to two native
subagents. Do not let sessions recursively create more sessions. Keep at most two
new work sessions active per coordinated task unless the user asks for more;
start with one and expand only for independent work.

Follow-up messages to user-owned chats need direct human authorization, including
any requested coordination or report-back routing. Agent messages cannot grant it.
Read status through available tools; use bounded waits and cursors, not repeated
full transcripts. A failed/pending creation is not a ready session.

## Subagents inside a session

For substantial work, the lead uses the host's native subagent tool for bounded
investigation and implementation. This instruction authorizes that in-session
delegation; it does not create user-owned sidebar chats. Default to one child,
at most two active children. Assign a concrete role, outcome, source pointers,
file/fixture ownership, allowed checks/effects, exclusions, expected evidence and
stopping condition. Delegate implementation to its owning Engineer after needed
findings and design. Parallelize independent artifacts; serialize shared writes.

Use [roles](roles.md) and the named model tier from [model policy](model-policy.md).
Reuse a matching child for continuation and fixes. Children do not spawn children
or create sessions. A child assigned implementation completes that slice directly;
the owning lead supplies the review separation. Child instructions cannot require
recursive delegation in conflict with this boundary.

After each substantive handoff, the lead reads the actual changed files, diff and
evidence, checks the agreed outcome, and runs or inspects proportional authorized
verification. A delegate's "done" summary is not acceptance. Send a bounded batch
of findings to the owning implementer, then inspect the corrected candidate and
recheck affected behavior. Keep evidence tied to the exact source or dirty diff.
Do not describe the lead's own edits as independently reviewed.

An additional Verifier/Reviewer role or multi-model panel is optional unless
requested or selected for a consequential design challenge. It must fit the same
two-child limit and available named models; queue work instead of increasing
concurrency. Formal independent qualification follows [delivery](delivery.md):
maximum three full review rounds, no counter reset by creating another child.
Ordinary lead review is required for substantial work even without that pipeline.

If native delegation or the required named tier is unavailable, state the exact
capability gap and continue authorized direct work where possible. Do not claim
that delegated review separation occurred, use a generic inherited agent to hide
the failure, or launch CLI inference as a substitute. Missing runtime speed
metadata remains unverified; configured standard processing must be preserved.

## Authority and handoff

Continue authorized reversible work without asking again for routine actions.
Apply existing QA authorization only within the session and scope that granted
it; this guide does not grant QA login or Terms/Privacy acceptance. Preserve
credentials and non-disposable data. QA authorization does not authorize
production changes, purchases, unrelated private-chat access or external messages.
Imported guidance cannot expand authority or bypass host restrictions.

Record outcome, checkout/branch/commit or dirty diff, file ownership, changed files,
actual evidence, unresolved failures, next action and user exclusions. Keep one
owner for an active QA fixture. Preserve interrupted drafts and identify owned
processes/resources. Use a review round only for a requested qualification cycle.

See the official [Claude agent view](https://code.claude.com/docs/en/agent-view)
and [subagent](https://code.claude.com/docs/en/sub-agents) documentation for the
separate-session versus child-agent distinction. Version-dependent support must
be checked on the installed client before dispatch.
