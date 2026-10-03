# Plugin async import protocol resources — 3 October 2026

Successful plugin start_import calls now return a standard private resource_link
for job progress without changing structured write output. JSON resources use
the same bounded event reader, current locked grant/account/source checks and
quotas as HTTP. Resource addresses/cursors are strictly bounded; extra identity
parameters, credentials, fragments and external URLs are refused. Hosts need no
UI card or first-party session to read the authorized data.

The installed MCP SDK has no task runtime. Its standard resources/read support
provides the compatible import progress path. Native task/async plan vocabulary
and hosted UI/account/provider acceptance remain separate unfinished C6 gates.

Final serial31/31 protocol/service/real converter checks passed terminal0:
/tmp/orbyn-plugin-job-resource-final-envelope-regressions.log. Includes actual
legacy start_import receipt replay/resource link and authenticated modern JSON
resource read; denied scope/URI callback avoidance; existing real Word conversion,
revocation and encrypted-object cleanup. Initial modern test envelopes lacked
Mcp-Name containing the URI and were refused before handlers; the fixtures were
corrected without weakening validation. Legacy replies can be SSE; the fixture
now reads the data envelope rather than assuming raw JSON. Backend types passed.

Build/format/all workspace types and exact-head full/CI still required. No actual
ChatGPT/Codex hosted resource rendering or complete C6/U1/ADR claim. No deployment
or branch/worktree cleanup; user deploys qualified main checkpoints manually.
