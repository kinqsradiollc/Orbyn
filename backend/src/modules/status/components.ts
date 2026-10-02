import { env } from "../../config/env.js";
import { pool } from "../../db/pool.js";

export type Probe = { ok: boolean; latency_ms: number | null };

/** Something the status page reports on, and how to check it. */
export type Component = {
  id: string;
  name: string;
  description: string;
  probe: () => Promise<Probe>;
};

const PROBE_TIMEOUT_MS = 5000;
/** The reminder service beats every ~10s; allow a few missed cycles. */
const HEARTBEAT_MAX_AGE_MS = 90_000;

async function http(url: string): Promise<Probe> {
  const start = Date.now();
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    return { ok: response.ok, latency_ms: Date.now() - start };
  } catch {
    return { ok: false, latency_ms: null };
  }
}

async function database(): Promise<Probe> {
  const start = Date.now();
  try {
    await pool.query("SELECT 1");
    return { ok: true, latency_ms: Date.now() - start };
  } catch {
    return { ok: false, latency_ms: null };
  }
}

function heartbeat(service: string) {
  return async (): Promise<Probe> => {
    try {
      const row = (
        await pool.query<{ age_ms: string }>(
          "SELECT extract(epoch FROM now() - last_seen_at) * 1000 AS age_ms FROM service_heartbeats WHERE service=$1",
          [service],
        )
      ).rows[0];
      return {
        ok: !!row && Number(row.age_ms) <= HEARTBEAT_MAX_AGE_MS,
        latency_ms: null,
      };
    } catch {
      return { ok: false, latency_ms: null };
    }
  };
}

/** In single-process mode the API and AI live in this process. */
const self = () => `http://127.0.0.1:${env.PORT}`;

/** Components in display order. The gateway is listed only when configured. */
export function components(): Component[] {
  const list: Component[] = [];
  if (env.STATUS_GATEWAY_URL)
    list.push({
      id: "gateway",
      name: "Website and gateway",
      description: "The web app and the entry point for every request.",
      probe: () => http(env.STATUS_GATEWAY_URL + "/health"),
    });
  list.push(
    {
      id: "api",
      name: "Planner",
      description: "Accounts, tasks, events, and teams.",
      probe: () => http((env.STATUS_API_URL || self()) + "/health"),
    },
    {
      id: "ai",
      name: "AI assistant",
      description: "Summaries and suggested changes to your plans.",
      probe: () => http((env.STATUS_AI_URL || self()) + "/health"),
    },
    {
      id: "assistant-background",
      name: "Background agents",
      description:
        "Tasks, ideas, goals and routines running in the background.",
      probe: heartbeat("assistant-background"),
    },
    {
      id: "assistant-overnight",
      name: "Overnight",
      description: "Scheduled overnight work and its morning review.",
      probe: heartbeat("assistant-overnight"),
    },
    {
      id: "realtime",
      name: "Live updates",
      description: "Changes, presence and focus reaching your other devices.",
      probe: () => http((env.STATUS_REALTIME_URL || self()) + "/health"),
    },
    {
      id: "mcp",
      name: "Agent connections",
      description:
        "The MCP address AI agents such as Claude Code, Codex and Cursor connect to.",
      probe: () => http((env.STATUS_MCP_URL || self()) + "/health"),
    },
    {
      id: "notifier",
      name: "Reminders",
      description: "In-app, email, and push reminders.",
      probe: heartbeat("notifier"),
    },
    {
      id: "converter",
      name: "Document import",
      description: "Turning uploaded PDFs, Word files and photos into pages.",
      probe: heartbeat("converter"),
    },
    {
      id: "database",
      name: "Data storage",
      description: "Where your plans are kept.",
      probe: database,
    },
  );
  return list;
}
