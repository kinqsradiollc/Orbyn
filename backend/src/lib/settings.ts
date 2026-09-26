import {
  DEFAULT_AGENT_SETTINGS,
  DEFAULT_LEGAL_VERSION,
  type AgentSettings,
  compareLegalVersions,
  defaultLegalSettings,
  type Announcement,
  type LegalSettings,
  type Maintenance,
  type SystemSettingKey,
  type SystemSettingsView,
} from "@orbyn/core";
import { env } from "../config/env.js";
import { pool } from "../db/pool.js";
import { decryptSecret } from "./secrets.js";

/** Settings admins can change in the app. */
export const SETTING_KEYS: SystemSettingKey[] = [
  "cors_origins",
  "rate_limit_per_minute",
  "notifier_concurrency",
  "status_interval_ms",
  "smtp",
];

/**
 * The switches for outside agents (MCP), kept in system_settings under
 * these keys and changed in Admin (PUT /admin/agents). Like everything
 * here they apply within 10 seconds on every copy, with no deploy:
 * agents_enabled off stops every agent (kill switch L4 without the gateway),
 * agents_writes_enabled off freezes their changes (L3), blocked_client_ids
 * and allowed_client_hosts refuse apps (L2).
 */
export const AGENT_SETTING_KEYS = [
  "agents_enabled",
  "agents_writes_enabled",
  "dcr_enabled",
  "allowed_client_hosts",
  "blocked_client_ids",
  "max_grant_days",
  "agent_limits",
  "mcp_apps_enabled",
] as const satisfies readonly (keyof AgentSettings)[];

type Smtp = {
  host: string;
  port: number;
  user: string;
  secure: boolean;
  from: string;
  /** Encrypted when saved in the app; the .env password is used otherwise. */
  password_encrypted: string | null;
  from_env: boolean;
};

export type LiveSettings = {
  cors_origins: string[];
  rate_limit_per_minute: number;
  notifier_concurrency: number;
  status_interval_ms: number;
  smtp: Smtp;
  maintenance: Maintenance;
  /** A notice admins show everyone, in every app, until cleared or `until`. */
  announcement: Announcement;
  /** Who runs the service and the current Terms and Privacy Policy. */
  legal: LegalSettings;
  /** Switches and limits for outside agents (see AGENT_SETTING_KEYS). */
  agents: AgentSettings;
  /** Until when old personal API keys still work over MCP (ISO), if set. */
  legacy_keys_until: string | null;
  sources: Record<SystemSettingKey, "database" | "environment">;
  updated_at: string | null;
};

/** How long an instance trusts its copy before re-reading the database. */
const TTL_MS = 10_000;

function fromEnvironment(): LiveSettings {
  return {
    cors_origins: env.CORS_ORIGINS.split(",")
      .map((o) => o.trim())
      .filter(Boolean),
    rate_limit_per_minute: env.RATE_LIMIT_PER_MINUTE,
    notifier_concurrency: env.NOTIFIER_CONCURRENCY,
    status_interval_ms: env.STATUS_INTERVAL_MS,
    smtp: {
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      user: env.SMTP_USER,
      secure: env.SMTP_SECURE === "true",
      from: env.SMTP_FROM,
      password_encrypted: null,
      from_env: true,
    },
    maintenance: { enabled: false, message: "", until: null, updated_at: null },
    announcement: { message: "", tone: "info", until: null, updated_at: null },
    legal: defaultLegalSettings(),
    agents: {
      ...DEFAULT_AGENT_SETTINGS,
      agent_limits: { ...DEFAULT_AGENT_SETTINGS.agent_limits },
    },
    legacy_keys_until: null,
    sources: Object.fromEntries(
      SETTING_KEYS.map((k) => [k, "environment"]),
    ) as LiveSettings["sources"],
    updated_at: null,
  };
}

let current = fromEnvironment();
let loadedAt = 0;
let loading: Promise<LiveSettings> | null = null;

async function load(): Promise<LiveSettings> {
  const { rows } = await pool.query<{
    key: string;
    value: Record<string, unknown> | unknown;
    updated_at: Date;
  }>("SELECT key, value, updated_at FROM system_settings");
  const next = fromEnvironment();
  let latest: Date | null = null;
  for (const row of rows) {
    if (row.key === "announcement") {
      const a = row.value as Partial<Announcement>;
      next.announcement = {
        message: a.message ?? "",
        tone: a.tone === "warning" ? "warning" : "info",
        until: a.until ?? null,
        updated_at: row.updated_at.toISOString(),
      };
      continue;
    }
    if (row.key === "legal") {
      const l = row.value as Partial<LegalSettings>;
      const d = defaultLegalSettings();
      next.legal = {
        ...d,
        ...l,
        terms: { ...d.terms, ...l.terms },
        privacy: { ...d.privacy, ...l.privacy },
      };
      // A document still on Orbyn's starting text is at least the version
      // that text ships as, so an update to it asks everyone again.
      for (const doc of ["terms", "privacy"] as const)
        if (
          !next.legal[doc].body &&
          compareLegalVersions(next.legal[doc].version, DEFAULT_LEGAL_VERSION) <
            0
        )
          next.legal[doc] = {
            ...next.legal[doc],
            version: DEFAULT_LEGAL_VERSION,
          };
      continue;
    }
    if ((AGENT_SETTING_KEYS as readonly string[]).includes(row.key)) {
      const key = row.key as (typeof AGENT_SETTING_KEYS)[number];
      if (key === "agent_limits")
        next.agents.agent_limits = {
          ...next.agents.agent_limits,
          ...(row.value as Partial<AgentSettings["agent_limits"]>),
        };
      else (next.agents as Record<string, unknown>)[key] = row.value;
      continue;
    }
    if (row.key === "agents_legacy_keys_until") {
      next.legacy_keys_until = typeof row.value === "string" ? row.value : null;
      continue;
    }
    if (row.key === "maintenance") {
      const m = row.value as Partial<Maintenance>;
      next.maintenance = {
        enabled: !!m.enabled,
        message: m.message ?? "",
        until: m.until ?? null,
        updated_at: row.updated_at.toISOString(),
      };
      continue;
    }
    const key = row.key as SystemSettingKey;
    if (!SETTING_KEYS.includes(key)) continue;
    if (key === "smtp")
      next.smtp = {
        ...next.smtp,
        ...(row.value as Partial<Smtp>),
        from_env: false,
      };
    else (next as Record<string, unknown>)[key] = row.value;
    next.sources[key] = "database";
    if (!latest || row.updated_at > latest) latest = row.updated_at;
  }
  next.updated_at = latest?.toISOString() ?? null;
  if (!rows.some((r) => r.key === "agents_legacy_keys_until"))
    next.legacy_keys_until = await legacyKeysUntil();
  return next;
}

/**
 * Old personal API keys' last day on MCP when no setting says otherwise:
 * 90 days after the agent-access migration ran here, so clearing the
 * settings (Admin → System) never cuts them off early or keeps them on.
 */
async function legacyKeysUntil(): Promise<string | null> {
  const row = (
    await pool.query<{ until: Date }>(
      `SELECT applied_at + interval '90 days' AS until FROM migrations
        WHERE name LIKE '%\\_agent\\_access.sql' ORDER BY applied_at LIMIT 1`,
    )
  ).rows[0];
  return row ? row.until.toISOString() : null;
}

/** Current settings, re-read from the database at most every 10 seconds. */
export async function settings(): Promise<LiveSettings> {
  if (Date.now() - loadedAt < TTL_MS) return current;
  loading ??= load()
    .then((s) => {
      current = s;
      loadedAt = Date.now();
      return s;
    })
    .catch(() => {
      // Database not ready (or not migrated yet): keep the last copy and
      // try again shortly.
      loadedAt = Date.now() - TTL_MS + 2_000;
      return current;
    })
    .finally(() => {
      loading = null;
    });
  return loading;
}

/**
 * The last loaded settings without waiting, for hot paths such as CORS and
 * rate limits. Refreshes in the background when stale.
 */
export function cachedSettings(): LiveSettings {
  if (Date.now() - loadedAt >= TTL_MS) void settings();
  return current;
}

/** Makes this instance re-read on next use (other instances follow within 10 s). */
export function invalidateSettings() {
  loadedAt = 0;
}

/** The SMTP password in use: the saved one, or the .env one when not saved. */
export async function smtpPassword(s: LiveSettings): Promise<string> {
  if (s.smtp.from_env) return env.SMTP_PASSWORD;
  return s.smtp.password_encrypted
    ? decryptSecret(s.smtp.password_encrypted)
    : "";
}

/** What admins see: never the password, only whether one is saved. */
export function settingsView(s: LiveSettings): SystemSettingsView {
  const { password_encrypted, from_env, ...smtp } = s.smtp;
  return {
    settings: {
      cors_origins: s.cors_origins,
      rate_limit_per_minute: s.rate_limit_per_minute,
      notifier_concurrency: s.notifier_concurrency,
      status_interval_ms: s.status_interval_ms,
      smtp: {
        ...smtp,
        has_password: from_env ? !!env.SMTP_PASSWORD : !!password_encrypted,
      },
    },
    sources: s.sources,
    updated_at: s.updated_at,
  };
}
