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
    /**
     * Leave out text from outside Orbyn (subscribed calendars, imported
     * files, emails and booking answers): the agent sees that something is
     * there, not what it says.
     */
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

/** Apps that connect with an agent key, in the order Settings offers them. */
export const AGENT_SETUP_CLIENTS = [
  "claude-code",
  "codex",
  "cursor",
  "other",
] as const;
export type AgentSetupClient = (typeof AGENT_SETUP_CLIENTS)[number];

/** Apps that connect by signing in (phase A2): shown, but not yet working. */
export const AGENT_SOON_CLIENTS = ["claude.ai", "ChatGPT"] as const;

export const AGENT_SETUP_LABELS: Record<AgentSetupClient, string> = {
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
