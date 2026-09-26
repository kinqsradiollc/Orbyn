import { z } from "zod";

/**
 * Outside agents (Claude Code, Codex, Cursor, and later claude.ai and
 * ChatGPT) reach Orbyn over MCP through a connection: an agent key made in
 * Settings, or (from phase A2) a sign-in through Orbyn's own consent page.
 * What a connection may do is the person's own access, narrowed by these
 * choices. Shared by the backend (enforcement) and both apps (the Connected
 * agents screens).
 */

/** How much a connection may do: see, see and suggest, or see and change. */
export const AGENT_ACCESS = ["read", "suggest", "write"] as const;
export type AgentAccess = (typeof AGENT_ACCESS)[number];

/** Rank for comparing access levels ("at least suggest"). */
export const AGENT_ACCESS_RANK: Record<AgentAccess, number> = {
  read: 0,
  suggest: 1,
  write: 2,
};

export const AGENT_ACCESS_LABELS: Record<
  AgentAccess,
  { name: string; blurb: string }
> = {
  read: {
    name: "See",
    blurb:
      "Read your tasks, calendar, projects and pages. Only what you can open.",
  },
  suggest: {
    name: "See and suggest",
    blurb: "Every change waits in your Review inbox until you approve it.",
  },
  write: {
    name: "See and change",
    blurb:
      "Creates and edits tasks, sessions and pages directly. Deletes, emails to people and big changes still wait for your review.",
  },
};

/**
 * Groups of tools a connection can turn on. Core is on for every
 * connection; the others arrive with later phases.
 */
export const AGENT_TOOLSETS = [
  "core",
  "workspace",
  "planner",
  "study",
  "followthrough",
  "teams",
  "booking",
  "files",
] as const;
export type AgentToolset = (typeof AGENT_TOOLSETS)[number];

/** How a connection was made: OAuth sign-in, an agent key, or an old API key. */
export const AGENT_GRANT_KINDS = ["oauth", "key", "legacy"] as const;
export type AgentGrantKind = (typeof AGENT_GRANT_KINDS)[number];

/**
 * A team's cap on outside agents, set by its owners and admins. "role"
 * follows each member's own role; the others cap every connection in the
 * team at that level, and "off" hides the team from agents altogether.
 */
export const TEAM_AGENT_ACCESS = ["role", "suggest", "read", "off"] as const;
export type TeamAgentAccess = (typeof TEAM_AGENT_ACCESS)[number];

/**
 * What "Hide outside content" leaves out, in the words every screen uses:
 * the text of things from outside Orbyn. Imported pages keep their titles.
 */
export const AGENT_HIDE_OUTSIDE_TEXT =
  "Leave out text from outside Orbyn: events from subscribed calendars (shown as busy), what imported files say, tasks and events sent by email (shown as “Task from email” or “Event from email”) and what booking guests typed (shown as “Booking”). The agent sees that something is there, not what it says. Imported pages keep their titles.";

/** Agent keys last this long unless another length is picked. */
export const AGENT_KEY_DEFAULT_DAYS = 30;
/** The longest any connection may last (admins can lower it). */
export const AGENT_KEY_MAX_DAYS = 365;
/** Agent keys start with this, so they're told apart from other tokens. */
export const AGENT_KEY_PREFIX = "oak_";

/** Making an agent key in Settings → Connected agents. */
export const agentKeyInput = z
  .object({
    name: z.string().trim().min(1).max(80),
    access: z.enum(AGENT_ACCESS).default("read"),
    /** Whether the agent sees the Personal space. */
    personal: z.boolean().default(true),
    /** Teams it sees, each one the person belongs to. */
    team_ids: z.array(z.uuid()).max(50).default([]),
    toolsets: z.array(z.enum(AGENT_TOOLSETS)).min(1).max(8).default(["core"]),
    expires_in_days: z
      .number()
      .int()
      .min(1)
      .max(AGENT_KEY_MAX_DAYS)
      .default(AGENT_KEY_DEFAULT_DAYS),
    /** Leave out text from outside Orbyn (see AGENT_HIDE_OUTSIDE_TEXT). */
    hide_outside_content: z.boolean().default(false),
  })
  .strict()
  .refine((v) => v.personal || v.team_ids.length > 0, {
    message: "Choose at least one space: Personal or a team.",
    path: ["team_ids"],
  });
export type AgentKeyInput = z.input<typeof agentKeyInput>;

/** One connection, as the Connected agents list shows it. */
export type AgentGrant = {
  id: string;
  kind: AgentGrantKind;
  /** The name given to a key ("MacBook · Codex CLI"), or the app's name. */
  name: string;
  /** The app on the other end, when known ("Claude", "chatgpt.com"). */
  client_name: string;
  /**
   * For apps that signed in: the website the app really comes from (its
   * id's host, "claude.ai"), or where it sends people back for apps that
   * registered themselves. Null for keys.
   */
  client_host: string | null;
  access: AgentAccess;
  personal: boolean;
  /** Teams it sees; null means every team the person is in (old API keys). */
  team_ids: string[] | null;
  /** The teams' names, in the same order, for display. */
  teams: { id: string; name: string }[];
  toolsets: AgentToolset[];
  /** Text from outside Orbyn is left out of what it reads. */
  hide_outside_content: boolean;
  /** The first characters of a key, to recognise it by. */
  prefix: string | null;
  expires_at: string | null;
  last_used_at: string | null;
  /**
   * Set when Orbyn paused it for misbehaving (too many refused or
   * over-the-limit calls); its person can restore it.
   */
  suspended_at: string | null;
  created_at: string;
};

/** A key just made: the secret is in `key`, shown this once. */
export type NewAgentKey = { grant: AgentGrant; key: string };

/** Settings → Connected agents. */
export type AgentsOverview = {
  /** The MCP address to give an agent (from the server, never guessed). */
  mcp_url: string;
  /**
   * Until when old personal API keys still work over MCP, or null once they
   * no longer do.
   */
  legacy_keys_until: string | null;
  grants: AgentGrant[];
};

/** How one call (or a minute of reads) by an agent turned out. */
export const AGENT_OUTCOMES = [
  "ok",
  "denied",
  "error",
  "proposed",
  "suggested",
  "confirmed",
  "limited",
] as const;
export type AgentOutcome = (typeof AGENT_OUTCOMES)[number];

/** A line in a connection's Activity list. */
export type AgentActivity = {
  id: string;
  at: string;
  tool: string;
  outcome: AgentOutcome;
  /** One line in words, never the content itself. */
  summary: string;
  /** Reads are counted per minute, so one line can stand for several calls. */
  calls: number;
  target_ids: string[];
};

/** Limits per connection (and per person across connections). */
export type AgentLimits = {
  calls_per_minute: number;
  search_per_minute: number;
  writes_per_minute: number;
  writes_per_day: number;
  calls_per_day: number;
  /** Calls one connection may have in flight at once. */
  concurrent: number;
  /** Calls per minute across all of one person's connections. */
  user_per_minute: number;
};

export const DEFAULT_AGENT_LIMITS: AgentLimits = {
  calls_per_minute: 120,
  search_per_minute: 30,
  writes_per_minute: 60,
  writes_per_day: 500,
  calls_per_day: 20_000,
  concurrent: 8,
  user_per_minute: 300,
};

/**
 * The system switches for outside agents (Admin), applied within seconds
 * with no deploy: all agents off, writes off, and which apps may connect.
 */
export type AgentSettings = {
  agents_enabled: boolean;
  agents_writes_enabled: boolean;
  dcr_enabled: boolean;
  /** When not empty, only apps from these hosts may connect. */
  allowed_client_hosts: string[];
  /** App ids refused outright ("orbyn-legacy-key" turns old keys off). */
  blocked_client_ids: string[];
  max_grant_days: number;
  agent_limits: AgentLimits;
};

export const DEFAULT_AGENT_SETTINGS: AgentSettings = {
  agents_enabled: true,
  agents_writes_enabled: true,
  dcr_enabled: true,
  allowed_client_hosts: [],
  blocked_client_ids: [],
  max_grant_days: AGENT_KEY_MAX_DAYS,
  agent_limits: DEFAULT_AGENT_LIMITS,
};

/** The client ids agent keys and old API keys connect as, for blocking. */
export const AGENT_KEY_CLIENT_ID = "orbyn-agent-key";
export const LEGACY_KEY_CLIENT_ID = "orbyn-legacy-key";

const limit = (max: number) => z.number().int().min(0).max(max);

/** Admin → changing the agent switches. Every field is optional. */
export const agentSettingsUpdate = z
  .object({
    agents_enabled: z.boolean().optional(),
    agents_writes_enabled: z.boolean().optional(),
    dcr_enabled: z.boolean().optional(),
    allowed_client_hosts: z
      .array(
        z
          .string()
          .trim()
          .toLowerCase()
          .regex(/^[a-z0-9.-]+$/, "Hosts look like claude.ai"),
      )
      .max(50)
      .optional(),
    blocked_client_ids: z
      .array(z.string().trim().min(1).max(500))
      .max(200)
      .optional(),
    max_grant_days: z.number().int().min(1).max(AGENT_KEY_MAX_DAYS).optional(),
    agent_limits: z
      .object({
        calls_per_minute: limit(10_000),
        search_per_minute: limit(10_000),
        writes_per_minute: limit(10_000),
        writes_per_day: limit(1_000_000),
        calls_per_day: limit(10_000_000),
        concurrent: z.number().int().min(1).max(64),
        user_per_minute: limit(100_000),
      })
      .partial()
      .strict()
      .optional(),
  })
  .strict();
export type AgentSettingsUpdate = z.input<typeof agentSettingsUpdate>;

/**
 * Apps in the order Settings offers them. Claude (claude.ai, Claude Desktop
 * and the Claude apps) and ChatGPT connect by signing in with Orbyn
 * (OAuth): no key, Orbyn asks you what they may do. The others send an
 * agent key in a header.
 */
export const AGENT_SETUP_CLIENTS = [
  "claude",
  "chatgpt",
  "claude-code",
  "codex",
  "cursor",
  "other",
] as const;
export type AgentSetupClient = (typeof AGENT_SETUP_CLIENTS)[number];

/** Apps that connect by signing in (OAuth) rather than with a key. */
export const AGENT_SIGN_IN_CLIENTS = [
  "claude",
  "chatgpt",
] as const satisfies readonly AgentSetupClient[];
export const isSignInClient = (c: AgentSetupClient) =>
  (AGENT_SIGN_IN_CLIENTS as readonly string[]).includes(c);

export const AGENT_SETUP_LABELS: Record<AgentSetupClient, string> = {
  claude: "Claude",
  chatgpt: "ChatGPT",
  "claude-code": "Claude Code",
  codex: "Codex",
  cursor: "Cursor",
  other: "Other",
};

/** Where the key is kept in the examples: an environment variable. */
export const AGENT_KEY_ENV = "ORBYN_AGENT_KEY";

/**
 * How to connect one app: a sentence saying where, and the text to paste.
 * `key` fills in a key just made; otherwise the snippet reads it from the
 * ORBYN_AGENT_KEY environment variable, so it never sits in a config file.
 */
export function agentSetup(
  client: AgentSetupClient,
  url: string,
  key?: string,
): { where: string; snippet: string } {
  const secret = key ?? `$${AGENT_KEY_ENV}`;
  switch (client) {
    case "claude":
      return {
        where:
          "In Claude, open Settings → Connectors → Add custom connector, and paste:",
        snippet: url,
      };
    case "chatgpt":
      return {
        where:
          "In ChatGPT, open Settings → Apps & Connectors, create a connector (developer mode), choose OAuth, and paste:",
        snippet: url,
      };
    case "claude-code":
      return {
        where: "In a terminal, run:",
        snippet: `claude mcp add --transport http orbyn ${url} --header "Authorization: Bearer ${secret}"`,
      };
    case "codex":
      return {
        where: key
          ? `Put the key in ${AGENT_KEY_ENV} (export ${AGENT_KEY_ENV}=…), then add this to ~/.codex/config.toml:`
          : `Set ${AGENT_KEY_ENV} to your agent key, then add this to ~/.codex/config.toml:`,
        snippet: `[mcp_servers.orbyn]\nurl = "${url}"\nbearer_token_env_var = "${AGENT_KEY_ENV}"`,
      };
    case "cursor":
      return {
        where: "Add this to ~/.cursor/mcp.json:",
        snippet: JSON.stringify(
          {
            mcpServers: {
              orbyn: {
                url,
                headers: {
                  Authorization: `Bearer ${key ?? `\${env:${AGENT_KEY_ENV}}`}`,
                },
              },
            },
          },
          null,
          2,
        ),
      };
    default:
      return {
        where:
          "Any app that speaks MCP over HTTP (streamable HTTP) and can send a header:",
        snippet: `URL: ${url}\nHeader: Authorization: Bearer ${key ?? "<your agent key>"}`,
      };
  }
}

/** "Expires in 29 days", "Expires tomorrow", "Expired". */
export function agentExpiryText(
  expiresAt: string | null,
  now = new Date(),
): string | null {
  if (!expiresAt) return null;
  const days = Math.ceil((Date.parse(expiresAt) - now.getTime()) / 86_400_000);
  if (days <= 0) return "Expired";
  if (days === 1) return "Expires tomorrow";
  return `Expires in ${days} days`;
}

/** Steps for connecting an app that signs in (no key to make). */
export const AGENT_SIGN_IN_STEPS: Record<
  (typeof AGENT_SIGN_IN_CLIENTS)[number],
  string[]
> = {
  claude: [
    "Add Orbyn as a custom connector with the address above.",
    "Choose Connect. Orbyn opens: sign in, and choose what Claude may do and in which spaces.",
    "Back in Claude, turn Orbyn on in a chat's tools. Change or disconnect it here any time.",
  ],
  chatgpt: [
    "Create a connector with the address above and OAuth as its sign-in.",
    "ChatGPT opens Orbyn: sign in, and choose what ChatGPT may do and in which spaces.",
    "Use Orbyn from a chat. Change or disconnect it here any time.",
  ],
};

// ---- Signing in with Orbyn (OAuth), phase A2 ----

/**
 * The scopes an app can ask for. Read is the baseline; propose includes
 * read ("See and suggest"), write includes propose ("See and change");
 * bookings is an add-on for guests' names and contact details;
 * offline_access lets the app refresh without asking again.
 */
export const OAUTH_SCOPES = [
  "orbyn:read",
  "orbyn:propose",
  "orbyn:write",
  "orbyn:bookings",
  "offline_access",
] as const;
export type OAuthScope = (typeof OAUTH_SCOPES)[number];

/** The scope string a connection holds, from its choices. */
export function grantedScopes(
  access: AgentAccess,
  bookings: boolean,
  offline = false,
): string {
  const scopes = ["orbyn:read"];
  if (AGENT_ACCESS_RANK[access] >= 1) scopes.push("orbyn:propose");
  if (access === "write") scopes.push("orbyn:write");
  if (bookings) scopes.push("orbyn:bookings");
  if (offline) scopes.push("offline_access");
  return scopes.join(" ");
}

/** The access level a scope string asks for (read when it names none). */
export function accessFromScopes(scope: string): AgentAccess {
  const s = new Set(scope.split(/\s+/).filter(Boolean));
  return s.has("orbyn:write")
    ? "write"
    : s.has("orbyn:propose")
      ? "suggest"
      : "read";
}

/** Granting write access (or bookings) needs a password or passkey this recently. */
export const REAUTH_WINDOW_MINUTES = 10;

/** How long a sign-in connection may last, as offered on the consent page. */
export const AGENT_GRANT_DAY_CHOICES = [30, 90, 365] as const;

/** Toolsets a sign-in may add to core, in words, for the consent page. */
export const AGENT_TOOLSET_LABELS: Record<
  AgentToolset,
  { name: string; blurb: string }
> = {
  core: {
    name: "Tasks, calendar, projects and pages",
    blurb: "Always on.",
  },
  workspace: { name: "Folders, tags and lists", blurb: "Organising pages." },
  planner: { name: "Planner", blurb: "Sessions, your usual day and plans." },
  study: { name: "Study", blurb: "Flashcards and reviews." },
  followthrough: {
    name: "Follow-through",
    blurb: "Asks, promises and decisions.",
  },
  teams: { name: "Teams", blurb: "Team members and their time." },
  booking: {
    name: "Bookings",
    blurb:
      "Booking pages, and your guests’ names and contact details. Booking changes email your guests, so they always wait for your review.",
  },
  files: { name: "Files", blurb: "Imported files." },
};

/** The parameters of an authorization request, as an app sends them. */
export const oauthRequest = z.object({
  response_type: z.string().max(40),
  client_id: z.string().min(1).max(2000),
  redirect_uri: z.string().min(1).max(2000),
  code_challenge: z.string().max(200).default(""),
  code_challenge_method: z.string().max(20).default(""),
  state: z.string().max(2000).optional(),
  scope: z.string().max(1000).default(""),
  resource: z.string().max(2000).optional(),
});
export type OAuthRequest = z.input<typeof oauthRequest>;

/** A team on the consent page: your role and its owners' cap on agents. */
export type OAuthTeamChoice = {
  id: string;
  name: string;
  role: string;
  agent_access: TeamAgentAccess;
};

/** What the consent page shows for a request (GET /oauth/authorize/check). */
export type OAuthCheck = {
  client: {
    id: string;
    /** The app's own name, from its description; never a logo. */
    name: string;
    /** The website it really comes from ("claude.ai"). */
    host: string;
    /** Whether Orbyn checked where it comes from (its id is its website). */
    verified: boolean;
    /** Where it sends you back: a host, or "this computer". */
    redirect_host: string;
    /** It sends you back to an app on this computer. */
    redirect_local: boolean;
  };
  /** What the app asked for, as an access level. */
  requested_access: AgentAccess;
  requested_bookings: boolean;
  /** Null when not signed in: the page asks you to sign in first. */
  account: {
    name: string;
    email: string;
    teams: OAuthTeamChoice[];
    /** Until when this session counts as just signed in (ISO), or null. */
    reauth_until: string | null;
    two_factor: boolean;
    passkeys: number;
    /** Your existing connection with this app, when there is one. */
    existing: AgentGrant | null;
    max_grant_days: number;
  } | null;
};

/** Allowing a request on the consent page (POST /oauth/authorize). */
export const oauthConsentInput = z
  .object({
    request: oauthRequest,
    access: z.enum(AGENT_ACCESS),
    personal: z.boolean().default(true),
    team_ids: z.array(z.uuid()).max(50).default([]),
    /** Optional toolsets besides core (and booking, which needs `bookings`). */
    toolsets: z.array(z.enum(AGENT_TOOLSETS)).max(8).default([]),
    bookings: z.boolean().default(false),
    notify_teammates: z.boolean().default(false),
    hide_outside_content: z.boolean().default(false),
    expires_in_days: z
      .number()
      .int()
      .min(1)
      .max(AGENT_KEY_MAX_DAYS)
      .default(90),
  })
  .strict()
  .refine((v) => v.personal || v.team_ids.length > 0, {
    message: "Choose at least one space: Personal or a team.",
    path: ["team_ids"],
  });
export type OAuthConsentInput = z.input<typeof oauthConsentInput>;

/** Where the browser goes next: back to the app, with a code or an error. */
export type OAuthRedirect = { redirect_to: string };

/**
 * Confirming it's you without signing in again (POST /me/reauth): the
 * password (and a two-step code when it's on), or a passkey.
 */
export const reauthInput = z.union([
  z
    .object({
      password: z.string().min(1).max(128),
      code: z.string().trim().max(20).optional(),
    })
    .strict(),
  z
    .object({
      handle: z.string().min(1).max(100),
      response: z.record(z.string(), z.unknown()),
    })
    .strict(),
]);
export type ReauthInput = z.input<typeof reauthInput>;

/** Sent back when re-authentication worked. */
export type Reauthenticated = { reauth_until: string };

/** The team policies, in words. */
export const TEAM_AGENT_ACCESS_LABELS: Record<
  TeamAgentAccess,
  { name: string; blurb: string }
> = {
  role: {
    name: "Follow each member’s role",
    blurb:
      "Agents can do what their person can in this team. Viewers’ agents only read.",
  },
  suggest: {
    name: "Read and suggest",
    blurb: "Agents read, and every change they want waits for review.",
  },
  read: { name: "Read only", blurb: "Agents can read, never change." },
  off: {
    name: "Off",
    blurb: "Outside agents can’t see or change anything in this team.",
  },
};

/** Team settings → Outside agents. */
export type TeamAgentsView = {
  agent_access: TeamAgentAccess;
  /** When an outside agent first used this team's data, or null. */
  first_used_at: string | null;
  /**
   * Members' connections that can reach this team, by name and app only
   * (owners and admins; null for others).
   */
  connections:
    | {
        member: string;
        app: string;
        kind: AgentGrantKind;
        last_used_at: string | null;
      }[]
    | null;
};

/** Admin → Agents: an app that signed in, and how many use it. */
export type AdminAgentClient = {
  id: string;
  kind: "cimd" | "dcr";
  name: string;
  host: string;
  blocked: boolean;
  connections: number;
  created_at: string;
  last_used_at: string | null;
};

/** Admin → Agents: usage by app over a period (people who opted out of analytics aren't counted). */
export type AdminAgentUsage = {
  days: number;
  apps: {
    app: string;
    kind: AgentGrantKind;
    connections: number;
    people: number;
    calls: number;
    writes: number;
    denied: number;
    limited: number;
  }[];
};

/** One of an account's agent connections, for Admin → Users. */
export type AdminAgentGrant = Pick<
  AgentGrant,
  | "id"
  | "kind"
  | "name"
  | "client_name"
  | "client_host"
  | "access"
  | "expires_at"
  | "last_used_at"
  | "suspended_at"
  | "created_at"
>;
