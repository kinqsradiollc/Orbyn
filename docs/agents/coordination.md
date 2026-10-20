# Sessions and subagents

Use one session for a coherent task. For substantial work the user wants tracked
separately, prefer a named project session with its own outcome and ownership.
That session may use bounded subagents for supporting questions. These are two
levels of coordination, not interchangeable names for the same tool.

| Work | Owner |
| --- | --- |
| Small edit or tightly coupled change | Current session |
| Separately tracked implementation, investigation or qualification requested by the user | Named project session |
| Bounded search, comparison or review supporting that session | Native subagent inside that session |

## Project sessions

Create a new user-owned session only when the human explicitly requests session
creation or a session-based split of the current project work. This policy is not
blanket permission to create sessions for every task. Reuse a relevant existing
session when authorized. Do not create duplicate Tester/Reviewer/Visual Check
sessions just because those roles appear in an old report.

In Codex, inspect the project/session tools available in the current host. List
projects first and create the requested session under **Orbyn**, using its returned
project ID, not a projectless chat. Use the configured Sol/medium default; when
explicitly selecting a model under the user's preference, use `gpt-6.1-sol` and
`medium`. Only request a separate worktree through session creation when the user
has requested it and the host supports it. Otherwise define disjoint file ownership
or serialize shared-checkout edits. A new session is not filesystem isolation.

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

Use the current host's native subagent tool for bounded supporting work. Default
to one child, at most two active children per session. Pass a short brief and file
pointers rather than the full conversation. Assign disjoint writes; serialize
shared state. Children report to their owning session and do not spawn children
or create user sessions. The owner inspects and integrates returned artifacts.
Apply [model policy](model-policy.md) to every level; no automatic model panels.

Use [Orbyn roles](roles.md) and `orbyn-agent`; preserve the assigned role's reads
and effects in the brief. Independent verification and review are optional unless
requested. Those assignments follow [delivery](delivery.md), with the same frozen
candidate and a maximum of three full review rounds. Role names are not existing
chat identities; do not route work to old named chats without authorization.

## Authority and handoff

Continue authorized reversible work without asking again for routine actions.
Existing local QA authorization includes QA login and local Terms/Privacy
acceptance; preserve credentials and non-disposable data. This does not authorize
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
