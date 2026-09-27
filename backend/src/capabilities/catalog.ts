import {
  agentInstallLinks,
  AGENT_ACCESS_LABELS,
  AGENT_TOOLSETS,
  AGENT_TOOLSET_LABELS,
  DEFAULT_AGENT_LIMITS,
} from "@orbyn/core";
import { SUSPEND_AFTER } from "../modules/mcp-server/limits.js";
import { EXCLUDED, PENDING, COVERED } from "./exclusions.js";
import { registry } from "./index.js";
import { describe, type Capability } from "./registry.js";
import { CONVENTIONS } from "./context.js";
import { GUIDES, RESOURCE_TEMPLATES, templateUri } from "./guides.js";
import { PROMPTS } from "./prompts.js";

/**
 * The published description of Orbyn's MCP server: mcp-catalog.json (a
 * snapshot every change to a tool shows up in) and docs/mcp.md (the page
 * people read), both generated from the registry by
 * `npm run mcp:catalog -w backend` and checked in CI by mcp-catalog.test.ts.
 */

/** Protocol revisions and instructions, passed in to avoid loading the SDK here. */
export type ServerFacts = {
  protocol_versions: string[];
  instructions: string;
  mcp_url: string;
};

const kindOf = (c: Capability) =>
  c.annotations.readOnlyHint
    ? "read"
    : c.annotations.destructiveHint
      ? "destructive"
      : "write";

/**
 * The catalog's version: the date of the last change to any tool's
 * contract. Bump it (and add a CHANGELOG entry) with every change.
 */
export const CATALOG_VERSION = "2026-09-27";

/**
 * How tools change (the versioning and deprecation policy), in the words
 * the developer page and docs/mcp.md use.
 */
export const VERSIONING_POLICY = [
  "Tools only change by adding. A tool is never renamed, an argument never changes its type or becomes required, and an answer only gains fields.",
  "A new argument is always optional, and leaving it out behaves as before.",
  'A tool that is going away is marked "Deprecated:" at the start of its description, with what to use instead, at least 90 days before it is removed. Removals are listed here and in the changelog first.',
  "Error codes and their meaning never change; new codes may be added.",
  "Every change to a tool, resource or prompt shows in docs/mcp-catalog.json, which CI compares with the code, and in this changelog. The catalog's version is the date of its last change.",
];

/** What changed in the MCP server, newest first. */
export const CHANGELOG: { date: string; changes: string[] }[] = [
  {
    date: "2026-09-27",
    changes: [
      "Full power: a connection that may change things now does so directly, deletes, moves and restoring versions included, each with 30 days to undo. Only the ask-first list asks the person first: a teammate's work, inviting or emailing people, publishing, bookings with people they haven't met, team admin, their profile, and more than 50 changes at once. People set each connection (and each space) to full power, ask first or suggest only, and can let it do ask-first items alone.",
      "Asking in the chat: when a change needs the person's yes and the client declares form elicitation (2026-07-28), tools/call answers input_required with one elicitation/create (a yes/no and a message saying what and why). Yes makes the call directly; no or dismissing answers DECLINED or CANCELLED and changes nothing. Otherwise URL mode or the Review inbox, whose push now has Approve and Decline.",
      "list_agent_changes (this connection's changes, with undo until) and undo (one change, or every change of one call) in core. get_context says the connection's trust per space and what asks first.",
    ],
  },
  {
    date: "2026-09-26",
    changes: [
      "One-click install links for Cursor, VS Code, Goose and LM Studio; plugins for Claude Code, Codex and Gemini CLI; server.json for the MCP Registry; optional cards (MCP Apps) for Today, plan previews and proposals, off unless the administrator turns them on.",
      "Live updates: subscriptions/listen (2026-07-28) follows Today, days, pages, projects, tasks, records, templates and views, and the list of recent things, on a stream held by Orbyn's realtime service.",
      "Long jobs: start_import, plan_revision and plans over a week (or more than 25 tasks) become tasks for clients that declare the Tasks extension (tasks/get, tasks/cancel, notifications/tasks); others get the same handle as before. Progress notifications on plans for calls that send a progressToken.",
      "Toolsets: workspace, planner, study, follow-through, teams, bookings (add-on) and files, with 30 tools; 51 tools in all. Chosen on the consent page or in Settings → Connected agents, narrowed per call with X-MCP-Toolsets and X-MCP-Readonly.",
      "get_links (backlinks), save_view and saved views in query, related links in link, starting a project from a template, skipping an occurrence in update_tasks, pages from templates in create_doc.",
      'Resources for guides (orbyn://spec/markdown, orbyn://spec/views, orbyn://guide/planning), days and views; completions from visible titles; eleven prompts; the "orbyn" Agent Skill.',
    ],
  },
  {
    date: "2026-09-24",
    changes: [
      "Changes and the Review inbox: create_tasks, update_tasks, complete_tasks, edit_checklist, plan_schedule, schedule_sessions, reschedule_sessions, create_doc, edit_doc, link, create_project and propose_changes.",
      "Signing in with Orbyn (OAuth 2.1) for Claude, ChatGPT and other clients.",
      "The read tools: get_context, search, fetch, get_today, get_calendar, query, get_project and find_passages; agent keys.",
    ],
  },
];

/** Following changes (subscriptions/listen), for the catalog and docs. */
export const LIVE_FACTS = {
  method: "subscriptions/listen",
  protocol_versions: ["2026-07-28"],
  resources: [
    "orbyn://today",
    "orbyn://day/{date}",
    "orbyn://task/{id}",
    "orbyn://doc/{id}",
    "orbyn://project/{id}",
    "orbyn://record/{id}",
    "orbyn://template/{id}",
    "orbyn://view/{id}",
  ],
  notifications: [
    "notifications/subscriptions/acknowledged",
    "notifications/resources/updated",
    "notifications/resources/list_changed",
    "notifications/tasks",
  ],
  keep_alive_seconds: 25,
  max_minutes: 15,
  streams_per_connection: 3,
};

/** Long jobs as MCP tasks (the Tasks extension). */
export const TASK_FACTS = {
  extension: "io.modelcontextprotocol/tasks",
  tools: ["start_import", "plan_revision", "plan_schedule"],
  methods: ["tasks/get", "tasks/cancel", "tasks/update"],
  kept_minutes: 60,
};

/** Where to report a security problem (also /.well-known/security.txt). */
export const SECURITY_POLICY =
  "Report a security problem to the address in https://orbyn.dev/.well-known/security.txt. Please don't test against other people's accounts or data; we answer within three working days.";

export function buildCatalog(facts: ServerFacts) {
  return {
    version: CATALOG_VERSION,
    server: {
      name: "orbyn",
      title: "Orbyn",
      address: facts.mcp_url,
      protocol_versions: facts.protocol_versions,
      instructions: facts.instructions,
    },
    tools: registry.all.map((c) => {
      const d = describe(c);
      return {
        name: c.name,
        title: c.title,
        description: c.description,
        kind: kindOf(c),
        access: c.access,
        toolset: c.toolset,
        mode: c.mode,
        tier: c.tier,
        ...(c.legacyOnly ? { legacy_only: true } : {}),
        ...(c.jsonText ? { json_text: true } : {}),
        annotations: d.annotations,
        input_schema: d.inputSchema,
        output_schema: d.outputSchema,
      };
    }),
    resources: [
      { uri: "orbyn://today", name: "Today" },
      { uri: "orbyn://me", name: "Who and where" },
      ...Object.entries(GUIDES).map(([uri, g]) => ({
        uri,
        name: g.name,
        public: g.public,
      })),
    ],
    resource_templates: RESOURCE_TEMPLATES.map((t) => ({
      uri_template: templateUri(t.type),
      name: t.name,
      description: t.description,
    })),
    prompts: PROMPTS.map((p) => ({
      name: p.name,
      title: p.title,
      description: p.description,
      arguments: p.arguments.map((a) => ({
        name: a.name,
        required: !!a.required,
        ...(a.complete ? { completes: a.complete } : {}),
      })),
      toolsets: p.needs,
    })),
    toolsets: AGENT_TOOLSETS.map((t) => ({
      name: t,
      title: AGENT_TOOLSET_LABELS[t].name,
      tools: registry.all
        .filter((c) => c.toolset === t && !c.legacyOnly)
        .map((c) => c.name),
    })),
    live: LIVE_FACTS,
    tasks: TASK_FACTS,
    versioning: VERSIONING_POLICY,
    changelog: CHANGELOG,
    routes: {
      covered: Object.keys(COVERED).length,
      excluded: Object.keys(EXCLUDED).length,
      pending: PENDING.length,
    },
  };
}
export type Catalog = ReturnType<typeof buildCatalog>;

type Prop = {
  type?: string | string[];
  description?: string;
  enum?: unknown[];
  const?: unknown;
  format?: string;
  default?: unknown;
  items?: Prop;
  anyOf?: Prop[];
};

const FORMATS: Record<string, string> = {
  uuid: "id",
  "date-time": "ISO 8601 instant",
};

const typeText = (p: Prop): string => {
  if (p.enum) return p.enum.map((v) => `\`${String(v)}\``).join(", ");
  if (p.const !== undefined) return `\`${String(p.const)}\``;
  if (p.anyOf) return p.anyOf.map(typeText).join(" or ");
  if (p.type === "array")
    return `list of ${p.items ? typeText(p.items) : "values"}`;
  if (p.format && FORMATS[p.format]) return FORMATS[p.format];
  return Array.isArray(p.type) ? p.type.join(" or ") : (p.type ?? "any");
};

/**
 * Prose for Markdown: anything with angle brackets (task:<uuid>, the
 * untrusted-content fence) as code, so it shows instead of vanishing as HTML.
 */
const prose = (s: string) =>
  s.replace(
    /<untrusted-content[^>]*>|[^\s`]*<[^>\s]+>[^\s`,.;:]*/g,
    (m) => `\`${m}\``,
  );

/** A table cell: prose, on one line, with its pipes escaped. */
const cell = (s: string) => prose(s).replace(/\|/g, "\\|").replace(/\n/g, " ");

/** docs/mcp.md, from the catalog. */
export function catalogMarkdown(catalog: Catalog): string {
  const tools = catalog.tools.filter((t) => !t.legacy_only);
  const legacy = catalog.tools.filter((t) => t.legacy_only);
  const limits = DEFAULT_AGENT_LIMITS;
  const out: string[] = [
    "# Orbyn for AI agents (MCP)",
    "",
    "<!-- Generated by `npm run mcp:catalog -w backend` from backend/src/capabilities. Edit those, not this file. -->",
    "",
    "Orbyn is a hosted service. Outside AI agents, such as Claude Code, Codex and Cursor, can connect to it over the Model Context Protocol (MCP). An agent sees only what its person can open, in the spaces the connection was given. It uses its own model: Orbyn runs no AI for it.",
    "",
    "## Address",
    "",
    `\`${catalog.server.address}\` (Streamable HTTP, one JSON-RPC message per POST).`,
    "",
    "Older setups that use the web app's `/api/mcp` reach the same server.",
    "",
    "## Signing in",
    "",
    "- **Agent keys.** Make a key in Settings → Connected agents. Choose what it may do and which spaces it sees (Personal and any of your teams). Keys last 30 days unless you choose otherwise, and never more than 365. Send it as `Authorization: Bearer oak_…`. The key is shown once and stored only as a hash. You can revoke it at any time, and each key has its own activity list.",
    `- **Access levels.** ${Object.values(AGENT_ACCESS_LABELS)
      .map((l) => `${l.name}: ${l.blurb}`)
      .join(" ")}`,
    "- **Teams.** In each team, an agent can do no more than its person's role allows. Viewers only read. Team owners and admins can cap agents in their team at suggest or read, or turn them off (only when signed in; a personal API key can't change it). Leaving a team takes it off your agent keys, and joining again doesn't give it back to them.",
    '- **Hide outside content.** A connection can leave out text from outside Orbyn: events from subscribed calendars (shown as busy time), what imported files say, tasks and events sent by email (their titles show as "Task from email" or "Event from email", everywhere they are listed) and what booking guests typed (their events show as "Booking"). The agent sees that something is there, not what it says. Imported pages keep their titles. Without it, that text comes back fenced as untrusted content and labelled with where it came from; a booking guest\'s email address never shows.',
    "- **Personal API keys (`ok_`).** They keep working here as a legacy connection for 90 days from this release. Answers carry `Deprecation` and `Sunset` headers. After that they work only with the REST API and CalDAV.",
    "- **Teams leaving.** Leaving a team, being removed or the team being deleted takes it off every connection (keys and sign-ins); joining again doesn't give it back. The first time any agent uses a team's data, its owners and admins get a notice.",
    "- Agent credentials work only here. The REST API and CalDAV refuse them. An app sign-in (a browser session) is refused here.",
    "",
    "## Signing in with Orbyn (OAuth)",
    "",
    "Claude (claude.ai, Claude Desktop and the Claude apps), ChatGPT and any MCP client that supports OAuth sign in with Orbyn: no key to copy. Orbyn is its own authorization server (OAuth 2.1, public clients with PKCE).",
    "",
    '1. A call with no credential gets `401` with `WWW-Authenticate: Bearer resource_metadata="https://mcp.orbyn.dev/.well-known/oauth-protected-resource/mcp", scope="orbyn:read"`, before any JSON-RPC handling.',
    '2. The protected-resource metadata (RFC 9728) names the resource exactly as `MCP_PUBLIC_URL` and Orbyn\'s issuer (the web app\'s address, `https://orbyn.dev`). The authorization server metadata (RFC 8414) is at `https://orbyn.dev/.well-known/oauth-authorization-server`: `code_challenge_methods_supported` `["S256"]`, `token_endpoint_auth_methods_supported` `["none"]`, `client_id_metadata_document_supported` `true` and `authorization_response_iss_parameter_supported` `true`.',
    "3. **Registration.** Preferred: a client ID metadata document (CIMD). The `client_id` is an https address; Orbyn fetches it (https only, public addresses only, at most 64 KB, 5 s, every redirect checked again, cached by ETag) and its `client_id` must equal the address. Its `redirect_uris` are the only places Orbyn sends codes, matched exactly, except that `http://localhost` and `http://127.0.0.1` ignore the port (RFC 8252). Fallback: dynamic client registration (RFC 7591) at `/api/oauth/register`, when the administrator allows it. It registers public clients only (`token_endpoint_auth_method` is always `none`, whatever is asked), checks `application_type` against the redirect addresses, is limited per address (10 an hour, 20 a day) and across Orbyn (500 an hour), and registrations unused for 7 days are removed. Registered apps are shown as unverified.",
    "4. **Consent** at `https://orbyn.dev/oauth/authorize`. Signed out, you sign in there (two-step and passkeys included) and every parameter stays in the address. The page shows the app's name and the website it comes from (never a logo), where it sends you back (with a warning for this computer), and asks what it may do (See, See and suggest, See and change: See and change is preselected), in which spaces (Personal and each of your teams, with your role; teams whose owners turned agents off can't be chosen), which toolsets besides core, a Bookings add-on, \"Let it notify teammates\" and \"Hide outside content\" (both off), and for how long (30, 90 or 365 days). Granting See and change, or Bookings, needs your password (and two-step code) or a passkey within the last 10 minutes. You get an email and a notice for every new connection. The page can't be framed. A request that doesn't check out (an unknown app, a redirect address it didn't declare, no S256 challenge, another `resource`) is shown as an error and never redirected. Signing in again from the same app updates its one connection.",
    "5. The browser goes back with `code`, `state` and `iss` (RFC 9207). The code lasts 60 seconds and works once; a failed exchange spends it too.",
    "6. `POST /api/oauth/token` (`application/x-www-form-urlencoded`; RFC 6749 errors such as `invalid_grant`, `invalid_request`, `invalid_target`) with `code_verifier`, `redirect_uri`, `client_id` and `resource` gives an access token (`oat_`, 1 hour, only for the MCP address) and a refresh token (`ort_`).",
    "",
    "**Scopes.** `orbyn:read` (the baseline), `orbyn:propose` (includes read), `orbyn:write` (includes propose), `orbyn:bookings` (guests' names and contact details, off by default) and `offline_access` (refresh tokens that keep working). What the connection holds is what you chose on the page, which may be more or less than the app asked for.",
    "",
    "**Refresh.** Refresh tokens rotate on every use, lapse after 30 days unused and never outlive 90 days from sign-in or the connection. Using a spent refresh token again means it was copied: every token from that sign-in is revoked, the connection is paused, and you get an email. A refresh can't widen the scope. `/oauth/` keeps working during maintenance.",
    "",
    '**Step-up.** A connection that signed in, calling a tool it was given too little for, gets `403` with `WWW-Authenticate: Bearer error="insufficient_scope", scope="…", resource_metadata="…"` naming every scope it needs, so its app asks you once. ChatGPT gets the same challenge in the tool result\'s `_meta["mcp/www_authenticate"]`, and every tool lists its scopes as `securitySchemes`.',
    "",
    "**Revocation.** `POST /api/oauth/revoke` (RFC 7009): a refresh token takes every token from its sign-in with it, and a connection left with no way in is disconnected. Connections also end when you disconnect them in Settings → Connected agents, when you reset your password, when an administrator signs you out everywhere, disables or deletes the account, or blocks the app. Every copy of the service hears of it at once (`orbyn_auth`).",
    "",
    "**Administrators** (Admin → Agents) can turn agents off, freeze agent changes, switch app registration off, allow only apps from certain websites, block apps (their connections end at once), set limits and the longest a connection may last, see use by app (people who turned analytics off aren't counted) and end any account's connections (Admin → Users).",
    "",
    "## Protocol",
    "",
    `- Revisions: ${catalog.server.protocol_versions.map((v) => `\`${v}\``).join(", ")}. \`2026-07-28\` is served statelessly, with \`server/discover\`, per-request \`_meta\` and the \`MCP-Protocol-Version\`, \`Mcp-Method\` and \`Mcp-Name\` header checks. A header that disagrees with the body gets \`-32020\`, and an unsupported revision gets \`-32022\` with the supported list. Both answer with HTTP 400.`,
    "- The 2025 revisions start with `initialize`, and `ping` answers. No session id is ever issued.",
    "- `GET` and `DELETE` get `405`. JSON-RPC batches are refused with `400`. Answers are JSON, except a call that asks for progress and `subscriptions/listen`, which are answered as a stream of events.",
    "- Browser pages may call only from claude.ai, chatgpt.com, vscode.dev and insiders.vscode.dev (and the MCP Inspector during local development). Other pages get `403`. Clients that send no `Origin` are fine.",
    "- `tools/list` may be cached for 5 minutes (`ttlMs`, private). Its order is stable.",
    "- `X-MCP-Toolsets` and `X-MCP-Readonly` headers can narrow a connection for one call, but never widen it.",
    "",
    "## Adding Orbyn to an app",
    "",
    "Links that open an app with Orbyn's address filled in (the app then signs in with Orbyn, or asks for an agent key; no key is ever in a link). They are also in Settings → Connected agents.",
    "",
    ...agentInstallLinks(catalog.server.address).map(
      (l) => `- ${l.label}: <${l.href}>`,
    ),
    "- Claude Code, Codex and Gemini CLI: Orbyn's plugins bundle the address and the `orbyn` skill.",
    "",
    "## Cards (MCP Apps)",
    "",
    "When the administrator turns on Admin → Agents → \"Cards in agents\", apps that support MCP Apps can show small cards beside answers: Today (`get_today`), a plan preview with Apply (`plan_schedule`, `plan_revision`; Apply calls `schedule_sessions` through the app) and a proposal to review in Orbyn (`propose_changes`). Tools name their card in `_meta.ui.resourceUri`; the cards are `ui://orbyn/…` resources (`text/html;profile=mcp-app`) with nothing loaded from outside, drawn in Orbyn's colours and following only the app's light or dark mode. Approving still happens only in Orbyn.",
    "",
    "## Live updates",
    "",
    "An agent can follow what changes (MCP `2026-07-28`, `subscriptions/listen`) instead of asking again and again. Send `subscriptions/listen` to the same address with the `Mcp-Method: subscriptions/listen` header; the answer is a stream of events, held by Orbyn's realtime service.",
    "",
    `- \`notifications.resourceSubscriptions\` follows resources: ${LIVE_FACTS.resources.map((r) => `\`${r}\``).join(", ")}. Only what the connection can read now is followed (up to 100); the rest is left out of the acknowledgement, never reported on. Each is checked again before a note: one that was deleted (or a page sent to the Trash) gets one last \`notifications/resources/updated\` (reading it then says it's gone) and is no longer followed; one that can no longer be read (made private, moved out of a space the connection was given) is dropped without a word.`,
    "- `notifications.resourcesListChanged` hears when the list of recent things changes (pages and projects added, moved or renamed).",
    "- `notifications.taskIds` follows the connection's own long jobs (below).",
    "- The stream starts with `notifications/subscriptions/acknowledged`, naming what was agreed. Then `notifications/resources/updated` (read the resource again), `notifications/resources/list_changed` and `notifications/tasks`, gathered for half a second so a burst is one note each. Every note carries the listen request's id as `io.modelcontextprotocol/subscriptionId`. Notes say what moved, never what it says.",
    `- A keep-alive comment every ${LIVE_FACTS.keep_alive_seconds} s. The stream ends with a \`complete\` result after ${LIVE_FACTS.max_minutes} minutes or when the credential ends, whichever is first, when Orbyn restarts, and when the connection's access changes (revoked, paused, a team role changed): open it again. At most ${LIVE_FACTS.streams_per_connection} streams per connection.`,
    "- Tools and prompts don't change while a connection is open, so their lists aren't followed.",
    "",
    "## Long jobs (tasks)",
    "",
    `A client that declares the Tasks extension (\`${TASK_FACTS.extension}\` in the call's \`_meta\` client capabilities, \`2026-07-28\`) gets a task back from \`start_import\`, \`plan_revision\` and \`plan_schedule\` over more than 7 days or 25 tasks, instead of waiting. Other clients get the same handle as before: an import id to check with \`list_imports\`, or a \`plan_token\`.`,
    "",
    "- `tasks/get` with the `taskId` gives its status (`working`, `completed`, `cancelled`, `failed`), a status line and, once completed, the tool's result. Any copy of the service answers.",
    "- An import's task follows the import: while it waits for the file, its status line says where to PUT the bytes; it completes with the page (or with why the file couldn't be imported).",
    "- `tasks/cancel` cancels a task still working (and its import). `tasks/update` isn't used: Orbyn's tasks never wait for input.",
    `- A task is only ever its own connection's, and is kept ${TASK_FACTS.kept_minutes} minutes after it last changed. Follow it on a listen stream with \`taskIds\` to hear \`notifications/tasks\`.`,
    "- Progress: a call with a `progressToken` in its `_meta` (plans) is answered as a stream: `notifications/progress` for each step, then the result.",
    "",
    "## Limits",
    "",
    "Limits count per connection, never per address. Past a limit the answer is `429` with `Retry-After` and a JSON-RPC error (`-32029`).",
    "",
    `A connection that goes over its limits more than ${SUSPEND_AFTER.limited} times, or is refused (\`NOT_FOUND\` or \`FORBIDDEN\`) more than ${SUSPEND_AFTER.denied} times, within ten minutes is paused. It gets \`403\` until its person restores it in Settings → Connected agents.`,
    "",
    "| Limit | Default |",
    "| --- | --- |",
    `| Calls a minute per connection | ${limits.calls_per_minute} |`,
    `| Searches a minute (\`search\`, \`find_passages\`) | ${limits.search_per_minute} |`,
    `| Calls a minute across one person's connections | ${limits.user_per_minute} |`,
    `| Calls in flight at once per connection | ${limits.concurrent} |`,
    `| Calls a day per connection | ${limits.calls_per_day} |`,
    `| Changes a minute / a day per connection | ${limits.writes_per_minute} / ${limits.writes_per_day} |`,
    "",
    "## Errors",
    "",
    "| When | HTTP | JSON-RPC code |",
    "| --- | --- | --- |",
    "| No credential, or one that isn't valid here | 401, with `WWW-Authenticate` | -32001 |",
    "| A disabled account, a suspended connection, a blocked app, or a page not on the list | 403 | -32003 |",
    "| Outside agents switched off by the administrator | 503, with `Retry-After` | -32002 |",
    "| Past a limit | 429, with `Retry-After` | -32029 |",
    "| Maintenance: changes are paused, reads go on | 200 | -32000 |",
    "| Not JSON / not a request / a batch | 400 | -32700 / -32600 |",
    "| `params` that isn't an object, an unknown tool | 200 | -32602 |",
    "| An unknown method | 200 or 404 | -32601 |",
    "",
    "A tool that can't do what was asked answers with `isError: true` and one of these codes, followed by a fix, so the model can correct itself. Invalid arguments come back this way too, and not as protocol errors.",
    "",
    "- `NOT_FOUND`: nothing with that id can be reached from this connection. This is also the answer when something exists but the connection can't see it, so nothing leaks.",
    "- `INVALID`: an argument is wrong. The message names the field.",
    "- `AMBIGUOUS`: several things have that title. The candidates are listed.",
    "- `FORBIDDEN`: the connection can't do this here (its access level, or a tool it lacks).",
    "- `READ_ONLY`: the administrator has paused changes by agents.",
    "- `UNAVAILABLE`: not available to agents yet.",
    "- `INTERNAL`: something went wrong on Orbyn's side. Try again.",
    "",
    "## Ids, links and content",
    "",
    `- ${prose(CONVENTIONS.ids)}`,
    `- ${prose(CONVENTIONS.links)}`,
    `- ${prose(CONVENTIONS.times)}`,
    `- ${prose(CONVENTIONS.content)}`,
    "- `search` and `fetch` follow OpenAI's contract: `search` needs only `query`, `fetch` takes `id`, and their text content is the JSON of the structured content.",
    "- Search is by words, the letters of a title, and recency. No embeddings or AI are used here.",
    "",
    "## Toolsets",
    "",
    "Every connection has the core tools. The others come in toolsets, chosen on the consent page when an app signs in, or in Settings → Connected agents (bookings need the app to ask for them when it signs in). A call can narrow them with `X-MCP-Toolsets` (and to reading with `X-MCP-Readonly`), never widen them.",
    "",
    "| Toolset | What | Tools |",
    "| --- | --- | --- |",
    ...catalog.toolsets.map(
      (t) =>
        `| \`${t.name}\` | ${cell(t.title)} | ${t.tools.map((x) => `\`${x}\``).join(", ")} |`,
    ),
    "",
    "## Tools",
    "",
    "| Tool | Title | Kind | Needs |",
    "| --- | --- | --- | --- |",
    ...tools.map(
      (t) =>
        `| \`${t.name}\` | ${cell(t.title)} | ${t.kind} | ${t.access}, ${t.toolset} |`,
    ),
    "",
  ];
  for (const t of tools) {
    out.push(`### \`${t.name}\``, "", prose(t.description), "");
    const props = Object.entries(
      (t.input_schema.properties ?? {}) as Record<string, Prop>,
    );
    const required = new Set(
      (t.input_schema.required as string[] | undefined) ?? [],
    );
    if (props.length) {
      out.push("| Argument | Type | Notes |", "| --- | --- | --- |");
      for (const [name, p] of props)
        out.push(
          `| \`${name}\`${required.has(name) ? " (required)" : ""} | ${cell(typeText(p))} | ${cell(
            [
              p.description,
              p.default !== undefined
                ? `Default ${JSON.stringify(p.default)}.`
                : "",
            ]
              .filter(Boolean)
              .join(" "),
          )} |`,
        );
      out.push("");
    } else out.push("No arguments.", "");
  }
  out.push(
    "## Resources",
    "",
    "`resources/list` offers Today, who and where, the guides below, the person's favourites and about 30 things changed lately (paged, never the whole workspace). Every read checks permission again; something missing or out of reach is `-32602` either way.",
    "",
    "| Resource | What |",
    "| --- | --- |",
    "| `orbyn://today` | The Today list as Markdown, the same as `get_today`. |",
    "| `orbyn://me` | The same as `get_context`. |",
    ...Object.entries(GUIDES).map(
      ([uri, g]) => `| \`${uri}\` | ${cell(g.description)} |`,
    ),
    ...RESOURCE_TEMPLATES.map(
      (t) => `| \`${templateUri(t.type)}\` | ${cell(t.description)} |`,
    ),
    "",
    "`completion/complete` fills a template's id, or a prompt's project, page, event, team or exam, from titles this connection can see (20 at most, counted as searches).",
    "",
    "## Prompts",
    "",
    "Workflows an agent's prompt menu can offer. Each is plain text naming only Orbyn's tools, and is offered only when the connection has the toolsets it uses.",
    "",
    "| Prompt | What | Arguments |",
    "| --- | --- | --- |",
    ...catalog.prompts.map(
      (p) =>
        `| \`${p.name}\` | ${cell(p.description)} | ${p.arguments.length ? p.arguments.map((a) => `\`${a.name}\`${a.required ? " (required)" : ""}`).join(", ") : "none"} |`,
    ),
    "",
    "The same workflows, the Markdown and view guides and the planning etiquette ship as an Agent Skill for agents that load skills: [`agent-skill/orbyn/SKILL.md`](agent-skill/orbyn/SKILL.md).",
    "",
    "## Older tools",
    "",
    "Personal API keys on the legacy address also get the first endpoint's three tools, unchanged, until they stop working here:",
    "",
    ...legacy.map((t) => `- \`${t.name}\`: ${prose(t.description)}`),
    "",
    "## Versioning and deprecation",
    "",
    ...VERSIONING_POLICY.map((p) => `- ${prose(p)}`),
    "",
    `Catalog version: \`${catalog.version}\`.`,
    "",
    "## Changelog",
    "",
    ...catalog.changelog.flatMap((c) => [
      `### ${c.date}`,
      "",
      ...c.changes.map((x) => `- ${prose(x)}`),
      "",
    ]),
    "## Status and security",
    "",
    "- Whether every part of Orbyn is up: https://orbyn.dev/status.",
    `- ${SECURITY_POLICY}`,
    "- The developer page, with this catalog: https://orbyn.dev/developers/mcp.",
    "",
    `Routes: ${catalog.routes.covered} of the app's signed-in routes are covered by tools, ${catalog.routes.excluded} are never for agents, and ${catalog.routes.pending} are still to come.`,
    "",
  );
  return out.join("\n");
}

/** What each risk tier means for a person, for the annotations audit. */
const TIER_REVIEW: Record<Capability["tier"], string> = {
  R: "Runs directly; changes nothing.",
  W1: "Runs directly; adds only private things (undoable).",
  W2: "Runs directly where the connection may change things (undoable); team pages get suggestions; a suggest-only connection files a proposal.",
  W3: "Deletes, moves and restores: made directly at full power (undoable for 30 days) unless on the ask-first list, which asks the person first; a connection that asks or suggests sends it to the person.",
};

export type AnnotationAudit = {
  name: string;
  title: string;
  toolset: string;
  tier: Capability["tier"];
  annotations: Capability["annotations"];
  review: string;
  issues: string[];
};

/**
 * The annotations audit the directories ask for: every tool's hints next
 * to what it really does (its tier and effects), with anything that
 * disagrees listed as an issue. CI holds the issues at none.
 */
export function auditAnnotations(): AnnotationAudit[] {
  return registry.all
    .filter((c) => !c.legacyOnly)
    .map((c) => {
      const a = c.annotations;
      const issues: string[] = [];
      if (!c.title) issues.push("no title");
      if (a.openWorldHint !== false)
        issues.push("openWorldHint must be false: no tool reaches outside");
      if (c.mode === "read") {
        if (a.readOnlyHint !== true) issues.push("a read must be readOnlyHint");
        if (a.destructiveHint) issues.push("a read can't be destructive");
        if (c.tier !== "R") issues.push("a read is tier R");
      } else {
        if (a.readOnlyHint !== false) issues.push("a change isn't read-only");
        if (c.tier === "R") issues.push("a change needs a write tier");
        if (c.access === "read")
          issues.push("a change needs more than read access");
        if (
          c.effects?.some(
            (e) =>
              e === "email_outside" || e === "publish" || e === "fetch_outside",
          ) &&
          c.tier !== "W3"
        )
          issues.push("outward effects are W3 (the ask-first list decides)");
      }
      return {
        name: c.name,
        title: c.title,
        toolset: c.toolset,
        tier: c.tier,
        annotations: a,
        review: TIER_REVIEW[c.tier],
        issues,
      };
    });
}
