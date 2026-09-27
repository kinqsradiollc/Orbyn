import { TRASH_DAYS } from "@orbyn/core";
import { pool } from "../db/pool.js";

/**
 * The sweeper: what Orbyn keeps, for how long, and the job that clears the
 * rest, so tables that only ever grow (traces, probes, finished reminders,
 * expired sign-in links) don't fill the database.
 *
 * Every rule deletes in slices of a few thousand rows, so a large backlog
 * never holds a long lock or a long transaction. The worker runs it hourly
 * under an advisory lock (one copy sweeps; the others skip), and admins can
 * run it at once and change how long each kind of record is kept. Records
 * people made themselves — page history, a project's timeline — are kept
 * forever unless an admin chooses otherwise.
 */

export type SweepRule = {
  key: string;
  label: string;
  /** What is kept, in plain words, for the admin console. */
  detail: string;
  table: string;
  /** SQL condition for rows to remove; `$1` is the retention in days. */
  where: string;
  /** Days kept by default; 0 keeps them forever. */
  days: number;
  /** Whether admins can change it (expired links and sessions always go). */
  configurable: boolean;
  /** The shortest an admin may set, so traces useful for support stay. */
  min?: number;
};

const olderThan = (column: string) =>
  `${column} < now() - make_interval(days => $1::int)`;

export const SWEEP_RULES: SweepRule[] = [
  {
    key: "request_log",
    label: "Request traces",
    detail: "Each request the services answered (Admin → Requests).",
    table: "request_log",
    where: olderThan("at"),
    days: 7,
    configurable: true,
    min: 1,
  },
  {
    key: "request_daily",
    label: "Daily traffic",
    detail: "Requests per service and route per day.",
    table: "request_daily",
    where: "day < current_date - $1::int",
    days: 400,
    configurable: true,
    min: 30,
  },
  {
    key: "daily_activity",
    label: "Daily activity",
    detail: "Who was active each day, for analytics.",
    table: "daily_activity",
    where: "day < current_date - $1::int",
    days: 400,
    configurable: true,
    min: 30,
  },
  {
    key: "status_checks",
    label: "Status checks",
    detail: "The status page's probe results.",
    table: "status_checks",
    where: olderThan("checked_at"),
    days: 90,
    configurable: true,
    min: 7,
  },
  {
    key: "notifications",
    label: "Finished reminders",
    detail: "Reminders already sent, cancelled or failed.",
    table: "notifications",
    where: `${olderThan("created_at")} AND state IN ('sent', 'cancelled', 'failed')`,
    days: 90,
    configurable: true,
    min: 7,
  },
  {
    key: "item_deadline_moves",
    label: "Task deadline changes",
    detail:
      "Earlier deadlines kept briefly so affected sessions can be noticed.",
    table: "item_deadline_moves",
    where: olderThan("created_at"),
    days: 7,
    configurable: true,
    min: 2,
  },
  {
    key: "webhook_deliveries",
    label: "Webhook deliveries",
    detail: "Webhook calls that have finished, delivered or not.",
    table: "webhook_deliveries",
    where: `${olderThan("created_at")} AND state <> 'pending'`,
    days: 30,
    configurable: true,
    min: 1,
  },
  {
    key: "deleted_items",
    label: "Deletion records",
    detail: "What apps need to hear an item was deleted while they were away.",
    table: "deleted_items",
    where: olderThan("deleted_at"),
    days: 90,
    configurable: true,
    min: 30,
  },
  {
    key: "plans",
    label: "Plan drafts",
    detail: "Proposed day plans that expired without being applied.",
    table: "plans",
    where: `NOT applied AND ${olderThan("expires_at")}`,
    days: 7,
    configurable: true,
    min: 1,
  },
  {
    key: "presence",
    label: "Old presence",
    detail: "Devices not seen in a while.",
    table: "presence",
    where: olderThan("seen_at"),
    days: 30,
    configurable: true,
    min: 1,
  },
  {
    key: "recent_opens",
    label: "Recently opened",
    detail: "What each person opened lately, for the quick switcher.",
    table: "recent_opens",
    where: olderThan("opened_at"),
    days: 90,
    configurable: true,
    min: 7,
  },
  {
    // Links are kept in step by triggers (migration 111); this clears any a
    // page or task left behind when it was removed some other way.
    key: "object_links",
    label: "Links between things",
    detail:
      'The index behind "Linked here": links whose page or task no longer exists.',
    table: "object_links",
    where: `(source_kind = 'doc' AND NOT EXISTS
               (SELECT 1 FROM docs WHERE docs.id = object_links.source_id))
         OR (source_kind = 'task' AND NOT EXISTS
               (SELECT 1 FROM items WHERE items.id = object_links.source_id))`,
    days: 0,
    configurable: false,
  },
  {
    // Pictures and files in pages (EDT-01): a file no page shows any more,
    // once its page was deleted for good or 30 days after its last line
    // went (time for undo and history), and uploads that never arrived.
    // page_file_refs (migrations 114, 115) knows which pages show a file. The
    // file store deletes the bytes of rows that are gone.
    key: "page_files",
    label: "Pictures and files in pages",
    detail:
      "Files no page shows any more (30 days after their line was removed, or once their page is deleted for good), and uploads that never finished.",
    table: "page_files",
    where: `(status <> 'ready' AND created_at < now() - interval '1 day')
         OR (NOT EXISTS (SELECT 1 FROM page_file_refs r
                          WHERE r.file_id = page_files.id)
             AND (doc_id IS NULL
               OR coalesce(unused_since, created_at)
                    < now() - interval '30 days'))`,
    days: 0,
    configurable: false,
  },
  {
    key: "audit_log",
    label: "Audit log",
    detail: "Admin and security actions.",
    table: "audit_log",
    where: olderThan("created_at"),
    days: 730,
    configurable: true,
    min: 90,
  },
  {
    key: "study_reviews",
    label: "Study review history",
    detail: "Each card rating, for streaks and weak spots.",
    table: "study_reviews",
    where: olderThan("at"),
    days: 400,
    configurable: true,
    min: 90,
  },
  {
    key: "imports",
    label: "Imported files",
    detail:
      "The record of each file imported into Docs (its name and outcome). The files themselves are deleted within a day.",
    table: "imports",
    where: `${olderThan("created_at")} AND status IN ('ready', 'failed', 'cancelled')`,
    days: 30,
    configurable: true,
    min: 1,
  },
  {
    key: "doc_versions",
    label: "Page history",
    detail: "Earlier versions of pages. Kept forever unless you choose.",
    table: "doc_versions",
    where: olderThan("created_at"),
    days: 0,
    configurable: true,
    min: 30,
  },
  {
    key: "project_activity",
    label: "Project timelines",
    detail: "What changed in each project. Kept forever unless you choose.",
    table: "project_activity",
    where: olderThan("created_at"),
    days: 0,
    configurable: true,
    min: 30,
  },
  {
    key: "agent_activity",
    label: "Agent activity",
    detail:
      "What each connected AI agent did (Settings → Connected agents → Activity).",
    table: "agent_activity",
    where: olderThan("at"),
    days: 180,
    configurable: true,
    min: 30,
  },
  {
    key: "agent_usage_daily",
    label: "Agent usage",
    detail: "Calls per connected agent per day, for its daily limits.",
    table: "agent_usage_daily",
    where: "day < current_date - $1::int",
    days: 90,
    configurable: true,
    min: 7,
  },
  // Ended agent connections themselves are kept (a row each): project
  // timelines and page history name the agent through them.
  // Always cleared: nothing reads these once they have expired.
  {
    key: "agent_tokens",
    label: "Expired agent credentials",
    detail:
      "Agent keys and sign-in tokens a month past their expiry (the connection says it expired until then).",
    table: "agent_tokens",
    where: "expires_at < now() - interval '30 days'",
    days: 0,
    configurable: false,
  },
  {
    key: "oauth_codes",
    label: "Agent sign-in codes",
    detail: "One-time codes from agent sign-ins, past their expiry.",
    table: "oauth_codes",
    where: "expires_at < now()",
    days: 0,
    configurable: false,
  },
  {
    key: "oauth_client_assertions",
    label: "Agent sign-in key proofs",
    detail:
      "Which signed assertions apps that sign in with a key have used, past their expiry.",
    table: "oauth_client_assertions",
    where: "expires_at < now()",
    days: 0,
    configurable: false,
  },
  {
    key: "agent_grants",
    label: "Unfinished agent sign-ins",
    detail:
      "Agent sign-ins that were allowed but never finished by the app, after a day.",
    table: "agent_grants",
    where: `kind = 'oauth' AND authorized_at IS NULL
      AND created_at < now() - interval '1 day'`,
    days: 0,
    configurable: false,
  },
  {
    key: "mcp_request_state",
    label: "Agent request seals",
    detail: "Single-use handles and replay records for agent calls.",
    table: "mcp_request_state",
    where: "expires_at < now()",
    days: 0,
    configurable: false,
  },
  {
    key: "mcp_tasks",
    label: "Agents' long jobs",
    detail:
      "The state of imports and large plans outside agents asked after (MCP tasks), an hour after they were last touched.",
    table: "mcp_tasks",
    where: "expires_at < now()",
    days: 0,
    configurable: false,
  },
  {
    key: "oauth_clients",
    label: "Unused registered apps",
    detail:
      "Apps that registered for agent sign-in themselves and weren't used for a week.",
    table: "oauth_clients",
    where: `kind = 'dcr' AND coalesce(last_used_at, created_at) < now() - interval '7 days'
      AND NOT EXISTS (SELECT 1 FROM agent_grants g
                       WHERE g.client_id = oauth_clients.id AND g.revoked_at IS NULL)`,
    days: 0,
    configurable: false,
  },
  {
    key: "project_history_access",
    label: "Unused project history access",
    detail: "Access metadata whose project history has been removed.",
    table: "project_history_access",
    where:
      "NOT EXISTS (SELECT 1 FROM project_activity a WHERE a.entity_type = project_history_access.entity_type AND a.entity_id = project_history_access.entity_id)",
    days: 0,
    configurable: false,
  },
  {
    key: "sessions",
    label: "Expired sessions",
    detail: "Sign-ins past their expiry.",
    table: "sessions",
    where: "expires_at < now()",
    days: 0,
    configurable: false,
  },
  {
    key: "external_reminders",
    label: "Sent calendar reminders",
    detail: "Which subscribed events were already reminded, once they're past.",
    table: "external_reminders",
    where: "starts_at < now() - interval '2 days'",
    days: 0,
    configurable: false,
  },
  {
    key: "doc_trash",
    label: "Pages in Trash",
    detail: `Deleted pages, once they have been in Trash for ${TRASH_DAYS} days. Their history and comments go with them.`,
    table: "docs",
    where: `deleted_at IS NOT NULL AND deleted_at < now() - interval '${TRASH_DAYS} days'`,
    days: 0,
    configurable: false,
  },
  {
    key: "study_exams",
    label: "Past exams",
    detail: "Which pages you revised for an exam, a month after it.",
    table: "study_exams",
    where: "starts_at < now() - interval '30 days'",
    days: 0,
    configurable: false,
  },
  {
    key: "email_tokens",
    label: "Expired email links",
    detail: "Verification and reset links past their expiry.",
    table: "email_tokens",
    where: "expires_at < now()",
    days: 0,
    configurable: false,
  },
  {
    key: "webauthn_challenges",
    label: "Passkey challenges",
    detail: "One-time passkey challenges past their expiry.",
    table: "webauthn_challenges",
    where: "expires_at < now()",
    days: 0,
    configurable: false,
  },
  {
    key: "proposals",
    label: "Proposals",
    detail:
      "Changes the assistant proposed, a day after they lapse; what outside agents proposed, 30 days after it was decided or expired (the Review inbox shows the last week).",
    table: "proposals",
    where: `(source = 'assistant' AND expires_at < now() - interval '1 day')
      OR (source = 'agent'
          AND coalesce(decided_at, expires_at) < now() - interval '30 days')`,
    days: 0,
    configurable: false,
  },
  {
    key: "ai_jobs",
    label: "Assistant jobs",
    detail: "Finished assistant turns, once their answer was read.",
    table: "ai_jobs",
    where: "created_at < now() - interval '1 day'",
    days: 0,
    configurable: false,
  },
  {
    key: "project_chats",
    label: "Saved project chats",
    detail:
      "Chats with the assistant about a project, a year after they were last used.",
    table: "project_chats",
    where: olderThan("updated_at"),
    days: 365,
    configurable: true,
    min: 30,
  },
  {
    key: "idempotency_keys",
    label: "Replay keys",
    detail: "Keys that stop an offline change from happening twice.",
    table: "idempotency_keys",
    where: "created_at < now() - interval '24 hours'",
    days: 0,
    configurable: false,
  },
  {
    key: "team_changes",
    label: "Recent changes",
    detail:
      "Who changed which team page or task, for each team's Recent changes.",
    table: "team_changes",
    where: olderThan("at"),
    days: 90,
    configurable: true,
    min: 14,
  },
];

const SLICE = 5000;
/** At most this many slices per rule per run, so one run stays short. */
const MAX_SLICES = 40;
const LOCK = 786_242;

export type Retention = Record<string, number>;
export type SweepResult = {
  at: string;
  took_ms: number;
  removed: Record<string, number>;
  /** A rule that failed, and why; the rest still ran. */
  errors: Record<string, string>;
};

/** Days kept for each configurable rule: the admin's choice, else the default. */
export async function retention(): Promise<Retention> {
  const saved = (
    await pool.query<{ value: Retention }>(
      "SELECT value FROM system_settings WHERE key = 'retention'",
    )
  ).rows[0]?.value;
  return Object.fromEntries(
    SWEEP_RULES.filter((r) => r.configurable).map((r) => [
      r.key,
      typeof saved?.[r.key] === "number" ? saved[r.key] : r.days,
    ]),
  );
}

export async function lastSweep(): Promise<SweepResult | null> {
  return (
    (
      await pool.query<{ value: SweepResult }>(
        "SELECT value FROM system_settings WHERE key = 'sweep_last'",
      )
    ).rows[0]?.value ?? null
  );
}

/**
 * Run every rule once. Returns null when another copy is already sweeping.
 * A rule whose table doesn't exist yet (an older database) is skipped.
 */
export async function runSweep(): Promise<SweepResult | null> {
  const lock = await pool.connect();
  try {
    const got = (
      await lock.query<{ ok: boolean }>(
        "SELECT pg_try_advisory_lock($1) AS ok",
        [LOCK],
      )
    ).rows[0].ok;
    if (!got) return null;
    try {
      const started = Date.now();
      const days = await retention();
      const removed: Record<string, number> = {};
      const errors: Record<string, string> = {};
      for (const rule of SWEEP_RULES) {
        const keep = rule.configurable ? days[rule.key] : 0;
        if (rule.configurable && !(keep > 0)) continue;
        let total = 0;
        try {
          for (let i = 0; i < MAX_SLICES; i++) {
            const res = await pool.query(
              `DELETE FROM ${rule.table} WHERE ctid IN (
                 SELECT ctid FROM ${rule.table} WHERE ${rule.where} LIMIT ${SLICE})`,
              rule.where.includes("$1") ? [keep] : [],
            );
            total += res.rowCount ?? 0;
            if ((res.rowCount ?? 0) < SLICE) break;
          }
          removed[rule.key] = total;
        } catch (error) {
          const code = (error as { code?: string }).code;
          if (code !== "42P01")
            errors[rule.key] = (error as Error).message.slice(0, 200);
        }
      }
      const result: SweepResult = {
        at: new Date().toISOString(),
        took_ms: Date.now() - started,
        removed,
        errors,
      };
      await pool.query(
        `INSERT INTO system_settings (key, value, updated_at)
           VALUES ('sweep_last', $1, now())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
        [JSON.stringify(result)],
      );
      return result;
    } finally {
      await lock.query("SELECT pg_advisory_unlock($1)", [LOCK]);
    }
  } finally {
    lock.release();
  }
}
