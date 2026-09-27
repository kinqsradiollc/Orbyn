import {
  agentInstallLinks,
  AGENT_ACCESS_LABELS,
  AGENT_TOOLSETS,
  AGENT_TOOLSET_LABELS,
  DEFAULT_AGENT_LIMITS,
} from "@orbyn/core";
import {
  HEAVY_PER_MINUTE,
  SUSPEND_AFTER,
} from "../modules/mcp-server/limits.js";
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
      "Your named agent and its Memory (Muse M1–M2), 62 tools: update_agent (core) changes the name and persona of the person's Orbyn agent (default Orbyn), with undo; get_context returns it as agent. manage_memory (core) lists, reads, remembers and forgets the person's private Memory notes (one note per topic, each fact with where it was learned), the same notes Orbyn's own agent learns on its own; Memory is personal only, and projects kept out of AI are never used. The About me page is the first Memory note. Agent notes (things the agent made) are ordinary pages whose kind fetch shows. The 60-tool cap is lifted.",
      "Proven end to end (H9), still 60 tools: scenario tests play an MCP client through each flow (a lecture into notes, cards, tasks and a first review; research into a sourced brief; a project kickoff; quiz and exam prep; the inbox loop; each trust level; a big job's push and digest). From them: schedule_sessions takes a project plan's plan_token (it was refused); sessions go on the calendar directly at full power, team tasks' too, up to 50 at once (a connection that asks or suggests still asks); plan_schedule says it plans the person's tasks (a team's once assigned to them), and says so when nothing needs time; create_tasks puts a task in its project's space when team is left out; save_source lines take doc:<id>#<anchor> (as apply_plan's \"$notes.lines.x\" gives them); a mention's next tools include get_history (the comment to reply to); append_doc parts hold up to 2,000 lines, and more is refused in words. Agents' plans (plan_schedule, schedule_sessions) and get_follow_through's notices leave out projects kept out of AI (and notices about teams the connection wasn't given). apply_plan and add_file count as heavy calls (10 a minute) besides changes; add_file's 500 MB a day answers LIMITED with retry_after. The server's instructions say the workflow: you do the thinking, one apply_plan, practice first, what asks first. The docs list the limits for heavy calls, files and long pages, and every error code.",
      "Agents start warm (H8), still 60 tools: get_context also returns the person's \"About me for agents\" page (profile: Orbyn Markdown with line anchors, trimmed to about 6,000 characters with a link to the rest), its learning profile in fields (card_style, cards, session_minutes, study_times), the instructions for each space the connection reaches (Personal, and each team it is given), the standing rules, and since: what changed since the connection last spoke (its last call before a gap of half an hour): new inbox items, tasks the person added and finished, pages they edited, sessions they moved, changes by teammates and other agents where it reaches, questions and suggestions waiting, and the newest few with links. create_doc kind \"profile\" makes the page (one per person; asked again, the one there is), edited with edit_doc like any page. organize \"instructions\" (id: personal or a team; value: the words) changes a space's instructions: Personal's directly (undo), a team's asked first (team admin). get_study's queue is sized to the person's session length and puts their card style first; plan_revision and update_study exam.plan take their session length and study times when minutes aren't given; the study_session, lecture_to_notes and exam_prep prompts carry the learning profile. get_context's and get_today's answer schemas use plain strings for enums and drop repeated descriptions (the same answers, fewer tokens).",
      "You always know what happened (H7), still 60 tools: every change's done entries carry app_url (the phone app's orbyn:// link) beside url (the web app's), apply_plan's steps too, and add_file and save_source answer with url and app_url of the page; each change's summary ends with its links in words. An object-or-null in an answer's schema is written type [\"object\", \"null\"] (the same meaning, fewer tokens). The person sees \"via <agent>\" on a task's updates, comments and suggestions, Recent changes (shown even with their own hidden), notices a change caused and the page an agent last wrote (agenda pages too); gets one notice and push when a job (one apply_plan, or calls from one connection under two minutes apart) makes more than 20 changes; and a \"What your agents did\" section in the morning digest. Both can be turned off in Settings; agents can't turn them off. Connected agents lists changes by job with Undo per change and per job.",
      'Every feature, no gaps (H6b), still 60 tools: organize takes page changes (aliases: other names; fold; link_mention; extract: lines to a new page, linked where they were; merge: into another page, this one to Trash; remove_source), your own fields (create_field, change_field, set_field on pages and projects; deleting one is propose_changes delete what "field") and running a team, always asked first (create_team, rename_team, invite, remove_member, set_role, meeting_budget; the Review inbox action team.admin; deleting a team and its agent policy stay people only). update_project adds, changes, fills and removes milestones (removing is a delete: what "milestone" in propose_changes too) and keeps a project out of AI (assistant "off"; "on" always asks the person, and its proposal doesn\'t name the project to the agent). get_project lists milestones. save_view pins a view in the sidebar (pin) and returns a saved view\'s rows as CSV text (export "csv", in csv). get_history lists "recent" (opened and changed lately), "trash" and a team\'s recent changes ("changes" or team:<id>). propose_changes restore_doc brings a page back from Trash (emptying it stays the person\'s). fetch shows a page\'s Info (other names, tags, links here, versions, folds, fields with ids) and a project\'s fields. add_file takes project (a new page in it holding the file). update_planner_settings subscribe with id changes a subscribed calendar (link, name, colour, kind, busy, shown) or refreshes it (refresh). Every change is undoable except a new team and keeping a project out of AI. Every command in Orbyn\'s command list maps to a tool or a written reason.',
      "Every feature, no gaps (H6a), by extending tools (no new ones): create_tasks and update_tasks take alerts, colour, web links, busy or free and a meeting link; update_tasks also status, all-day, targets (target_value, current_value, value_unit), a repeat change or stop (rrule, null), a new parent or top level (parent, null; cycles refused), and scope this or following with occurrence for one occurrence of a repeating item or it and later ones (one occurrence's change can be undone). edit_checklist moves steps (move: id, position). reschedule_sessions pins, unpins, duplicates, rolls forward, starts and checks in sessions (outcome done, more with more_minutes, or skipped), attributed to the agent, with undo. update_planner_settings changes every planner setting (time zone, extra time zones, calendar sets, pinned teammates, default alerts, planner notices, buffer scope, travel padding, counting sessions as spent, session reminders, digest emails), keep_originals, and subscribes to a calendar by link (Orbyn fetches it after its public-address check) or unsubscribes; get_work_patterns lists subscribed calendars (never their links) and gives each unfinished session's id and whether it was checked in. create_doc kind agenda writes a day's agenda page from the calendar (today's again, keeping Notes). ack_inbox takes notices (ids or \"all\") and marks the person's in-app notices read: mark_notifications_read is folded into it and no longer listed, but still answers when called. Answer schemas no longer repeat additionalProperties: false on every object.",
      'One call, whole job (H5): apply_plan (core) takes up to 50 steps of write tools ({id, tool, args}: create_doc, append_doc with finish, edit_doc, create_tasks, update_tasks, complete_tasks, edit_checklist, create_project, update_project, link, organize, tasks_from_doc, comment_on_doc, update_study, schedule_sessions, save_source, save_record, add_progress). Every step is checked first (tool, access, schema, spaces, $refs only to earlier steps) and a wrong plan is refused whole with a report per step. Arguments may use earlier results ("$notes.id", ".uri", ".ids", ".lines.<anchor>", "$proj.stages[0].id", or "{$notes.uri}" inside words). The steps run in one transaction, all or nothing; anything on the ask-first list (or a connection that asks or suggests) asks once for the whole plan: in the chat, by URL, or as one Review inbox proposal that makes the whole plan when approved. Every step is recorded with one job id: undo({job}) takes the plan back. client_ref applies to the whole plan. New prompts: lecture_to_notes, research_brief, exam_prep and meeting_to_actions (the agent does the thinking and applies it with one apply_plan call). client_ref\'s description is shorter.',
      "Study from anything, practice first (no AI of Orbyn's: the agent writes and judges, Orbyn stores and schedules). update_study cards adds question/answer, cloze and picture cards to a page's Cards section or a new deck, each linked to the notes line it came from (from: doc:<id>#<anchor>, kept as a [src: …](orbyn://doc/…#…) link on the card's line); undo removes them. get_study queue now quizzes in practice order (cards marked needs work, then the ones most often answered again, then due, then new; decks interleaved), answers hidden, with left_today; get_study card gives one card's answer once the person has tried; get_study explain returns the person's own notes lines and cards with answers on a topic or cards so the agent can judge an explanation, and update_study needs_work records one that fell short. get_study lists what the person keeps getting wrong (wrong) and each card's source (from) and picture. update_study exam names or changes an exam (title, date, pages, target), and exam.plan books its revision sessions in the same call.",
      "Full power: a connection that may change things now does so directly, deletes, moves and restoring versions included, each with 30 days to undo. Only the ask-first list asks the person first: a teammate's work, inviting or emailing people, publishing, bookings with people they haven't met, team admin, their profile, and more than 50 changes at once. People set each connection (and each space) to full power, ask first or suggest only, and can let it do ask-first items alone.",
      "Asking in the chat: when a change needs the person's yes and the client declares form elicitation (2026-07-28), tools/call answers input_required with one elicitation/create (a yes/no and a message saying what and why). Yes makes the call directly; no or dismissing answers DECLINED or CANCELLED and changes nothing. Otherwise URL mode or the Review inbox, whose push now has Approve and Decline.",
      "list_agent_changes (this connection's changes, with undo until) and undo (one change, or every change of one call) in core. get_context says the connection's trust per space and what asks first.",
      "Everything routes to your agent: each connection has an inbox (booking requests, mentions and comments, invites, deadlines at risk, finished imports, study due and exams near, tasks from email, review decisions, teammates' asks, answers to its questions), only for spaces it reaches, never kept-out projects, kept 14 days. get_inbox (not dealt with first, with refs, suggested tools and the person's standing rules) and ack_inbox (done, snooze, dismiss with a note) in core. The resource orbyn://inbox; following it with subscriptions/listen tells the agent at once. People mute kinds per connection and can set a signed wake-up address that gets only a count and a link, at most every 5 minutes.",
      "ask_person in core: a question with up to 5 choices (or yes/no), an optional default and expiry (24 h). Answered in the chat with a one-field form when the client declares form elicitation; otherwise a card in Orbyn and a push (Approve/Decline for yes/no), and the answer, default or expiry arrives as an answer item in get_inbox. question_id looks up its status.",
      "Write pages like a person: one documented Orbyn Markdown dialect (orbyn://spec/markdown) for every kind of line: callouts, tables, footnotes, highlights and strikes, mermaid diagrams, embeds (orbyn-embed), live lists (orbyn-list), pictures and files by orbyn://file/<id> (only ones the person can already read), study-card lines. create_doc and edit_doc store them as real blocks and read [[Page]], [[Page#Heading]] and [[#Heading]] as links; fetch returns pages in the same dialect with every line's anchor, nested lists indented, so reading and writing back changes nothing.",
      "edit_doc sections by heading words or anchor: replace_section, append_to_section, delete_section and move_section (a section runs to the next heading as big or bigger). Anchors written in the Markdown are kept (new ones may be named); all or none, version-checked and undoable; team pages keep suggestions (a deleted section's lines struck through) or go to review.",
      "The agent reads, Orbyn keeps the result (H2): append_doc (workspace) takes long Orbyn Markdown in parts (up to 512 KB each, 2 MB in all; a draft per connection, parts in any order, a part number sent again replaces it, each checked as it arrives) and makes the page on finish: true, all or nothing (finish sent again answers the same); over 60 KB it becomes linked pages. Unfinished drafts go a day after their last part.",
      "Source lines: [src: Lecture 5 slides, slide 12] in a line says where it came from, drawn as a small chip on the web and phone and kept exactly (orbyn://spec/markdown). save_source (study) keeps a web source the agent read (https address, title, quote, day read, author, site) once per address per space, linked to a page and its lines; the page's Info lists it under Sources, fetch names a page's sources and opens source:<id> (the quote fenced as outside content). Orbyn never opens the address.",
      "add_file (files): a file in the call (base64, up to 25 MB, 500 MB a person a day, error code LIMITED past it or past the person's space) as a picture or file line on a page, or kept as the page's original. PDF, Word, PowerPoint, pictures and text, typed from the bytes; stored in Orbyn's own file store; undo removes it. MCP requests may now be up to 36 MB.",
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
      "The read tools: get_context, search, fetch, get_today, get_calendar, query, get_project, find_passages and get_profile; agent keys.",
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
    "Claude (claude.ai, Claude Desktop and the Claude apps), ChatGPT and any MCP client that supports OAuth sign in with Orbyn: no key to copy. Orbyn is its own authorization server (OAuth 2.1 with PKCE for every app: public clients, or apps that sign a key assertion).",
    "",
    '1. A call with no credential gets `401` with `WWW-Authenticate: Bearer resource_metadata="https://mcp.orbyn.dev/.well-known/oauth-protected-resource/mcp", scope="orbyn:read"`, before any JSON-RPC handling.',
    '2. The protected-resource metadata (RFC 9728) names the resource exactly as `MCP_PUBLIC_URL` and Orbyn\'s issuer (the web app\'s address, `https://orbyn.dev`). The authorization server metadata (RFC 8414) is at `https://orbyn.dev/.well-known/oauth-authorization-server`: `code_challenge_methods_supported` `["S256"]`, `token_endpoint_auth_methods_supported` `["none", "private_key_jwt"]`, `token_endpoint_auth_signing_alg_values_supported` `["RS256", "PS256", "ES256"]`, `client_id_metadata_document_supported` `true` and `authorization_response_iss_parameter_supported` `true`.',
    "3. **Registration.** Preferred: a client ID metadata document (CIMD). The `client_id` is an https address; Orbyn fetches it (https only, public addresses only, at most 64 KB, 5 s, every redirect checked again, cached by ETag) and its `client_id` must equal the address. Its `redirect_uris` are the only places Orbyn sends codes, matched exactly, except that `http://localhost` and `http://127.0.0.1` ignore the port (RFC 8252). Fallback: dynamic client registration (RFC 7591) at `/api/oauth/register`, when the administrator allows it. It registers public clients only (`token_endpoint_auth_method` is always `none`, whatever is asked), checks `application_type` against the redirect addresses, is limited per address (10 an hour, 20 a day) and across Orbyn (500 an hour), and registrations unused for 7 days are removed. Registered apps are shown as unverified.",
    "   **How the app proves itself.** A CIMD document's `token_endpoint_auth_method` is `none` (a public app; the default) or `private_key_jwt`, with its public keys in `jwks` or at `jwks_uri` (fetched like the document: https only, public addresses only, 64 KB, 5 s, redirects checked again, cached by ETag; read again at most once a minute when an unknown key appears). Such an app sends `client_assertion_type=urn:ietf:params:oauth:client-assertion-type:jwt-bearer` and a `client_assertion` with every code exchange and refresh (RFC 7523): signed RS256, PS256 or ES256 (never `none` or HS*), `iss` and `sub` its `client_id`, `aud` the token endpoint (`https://orbyn.dev/api/oauth/token`; the issuer is accepted too, either with or without a final slash), `exp` at most an hour away, and a `jti` that works once. Anything else is `401 invalid_client`. Orbyn never issues client secrets: a document declaring `client_secret_basic` or `client_secret_post` is served as a public app (any secret sent is ignored), and any other method is refused, naming it. PKCE is required either way.",
    "4. **Consent** at `https://orbyn.dev/oauth/authorize`. Signed out, you sign in there (two-step and passkeys included) and every parameter stays in the address. The page shows the app's name and the website it comes from (never a logo), where it sends you back (with a warning for this computer), and asks what it may do (See, See and suggest, See and change: See and change is preselected), in which spaces (Personal and each of your teams, with your role; teams whose owners turned agents off can't be chosen), which toolsets besides core, a Bookings add-on, \"Let it notify teammates\" and \"Hide outside content\" (both off), and for how long (30, 90 or 365 days). Granting See and change, or Bookings, needs your password (and two-step code) or a passkey within the last 10 minutes. You get an email and a notice for every new connection. The page can't be framed. A request that doesn't check out (an unknown app, a redirect address it didn't declare, no S256 challenge, another `resource`) is shown as an error and never redirected. Signing in again from the same app updates its one connection.",
    "5. The browser goes back with `code`, `state` and `iss` (RFC 9207). The code lasts 60 seconds and works once; a failed exchange spends it too.",
    "6. `POST /api/oauth/token` (`application/x-www-form-urlencoded`; RFC 6749 errors such as `invalid_grant`, `invalid_request`, `invalid_target`) with `code_verifier`, `redirect_uri`, `client_id` (or only the assertion's `sub`) and `resource` (the MCP address, with or without a final slash, or its origin when it is `/mcp` at the root of its host) gives an access token (`oat_`, 1 hour, only for the MCP address) and a refresh token (`ort_`).",
    "",
    "**Scopes.** `orbyn:read` (the baseline), `orbyn:propose` (includes read), `orbyn:write` (includes propose), `orbyn:bookings` (guests' names and contact details, off by default) and `offline_access` (refresh tokens that keep working). What the connection holds is what you chose on the page, which may be more or less than the app asked for.",
    "",
    "**Refresh.** Refresh tokens rotate on every use, lapse after 30 days unused and never outlive 90 days from sign-in or the connection. Using a spent refresh token again means it was copied: every token from that sign-in is revoked, the connection is paused, and you get an email. A refresh can't widen the scope. `/oauth/` keeps working during maintenance.",
    "",
    '**Step-up.** A connection that signed in, calling a tool it was given too little for, gets `403` with `WWW-Authenticate: Bearer error="insufficient_scope", scope="…", resource_metadata="…"` naming every scope it needs, so its app asks you once. ChatGPT gets the same challenge in the tool result\'s `_meta["mcp/www_authenticate"]`, and every tool lists its scopes as `securitySchemes`.',
    "",
    '**Which account.** `get_profile` carries `_meta["openai/profile"]`: ChatGPT calls it right after linking to tell connected accounts apart. It returns an opaque id that never changes for the account (across refreshes and reconnections) and the person\'s name, nothing else.',
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
    `| Heavy calls a minute per connection (\`what_if\`, \`apply_plan\`, \`add_file\`; a heavy change is a change too) | ${HEAVY_PER_MINUTE} |`,
    '| Files an agent sends (`add_file`) | 25 MB a file (`INVALID` over it); 500 MB a day per person (`LIMITED`, with `retry_after` in `_meta["orbyn/data"]`) |',
    "| A long page (`append_doc`) | 512 KB and 2,000 lines a part; 2 MB a page (`INVALID` over it) |",
    "",
    "Past a minute's or a day's limit, the error's `data.retry_after` and the `Retry-After` header say how many seconds to wait: until the oldest call in the minute leaves it, or until the next day (UTC).",
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
    "- `VERSION_CONFLICT`: it changed since it was read. Read it again and retry with its version.",
    "- `STALE`: a plan, undo or review no longer matches how things are now. Preview or read again.",
    "- `DECLINED` / `CANCELLED`: the person said no to the question in the chat, or dismissed it. Nothing was changed.",
    "- `LIMITED`: a person's daily or space limit is reached (files a day, space for pages' files or originals).",
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
