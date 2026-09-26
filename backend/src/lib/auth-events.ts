import pg from "pg";
import { env } from "../config/env.js";

/**
 * Changes to who may act for whom (the orbyn_auth channel): an agent
 * connection revoked or paused, a person signed out everywhere or deleted,
 * an app blocked, a team's agent policy changed. Every copy of the mcp
 * service listens, so what it holds for a credential is dropped within a
 * moment of the change on any copy. (Every call re-reads the connection
 * from the database anyway; this clears what is kept between calls.)
 */

export const AUTH_CHANNEL = "orbyn_auth";

export type AuthChange = {
  grants?: string[];
  users?: string[];
  clients?: string[];
  teams?: string[];
  reason: string;
};

type Handler = (change: AuthChange) => void;

const handlers = new Set<Handler>();

/** Runs `fn` for every change heard on this copy. Returns a way to stop. */
export function onAuthChange(fn: Handler): () => void {
  handlers.add(fn);
  return () => handlers.delete(fn);
}

/** Hands a change to this copy's handlers (the listener, and tests). */
export function dispatchAuthChange(change: AuthChange) {
  for (const fn of handlers) {
    try {
      fn(change);
    } catch {
      // One handler's trouble never keeps the others from hearing it.
    }
  }
}

let client: pg.Client | null = null;
let users = 0;

/**
 * Listens on the channel while anything on this copy needs it (the mcp
 * routes start it when ready and stop it when closing). Reconnects after a
 * dropped connection on the next start.
 */
export async function listenAuthChanges(
  log: (err: unknown) => void,
): Promise<() => Promise<void>> {
  users++;
  if (!client) {
    const next = new pg.Client({
      connectionString: env.DATABASE_LISTEN_URL || env.DATABASE_URL,
    });
    next.on("notification", (message) => {
      if (message.channel !== AUTH_CHANNEL || !message.payload) return;
      try {
        dispatchAuthChange(JSON.parse(message.payload) as AuthChange);
      } catch {
        // Not ours, or cut short: nothing to clear.
      }
    });
    next.on("error", (err) => {
      log(err);
      if (client === next) client = null;
    });
    client = next;
    try {
      await next.connect();
      await next.query(`LISTEN ${AUTH_CHANNEL}`);
      // Listening never keeps a process alive by itself: the service's own
      // server does that, and a script or test that never closes can exit.
      (
        next as unknown as { connection?: { stream?: { unref?: () => void } } }
      ).connection?.stream?.unref?.();
    } catch (err) {
      log(err);
      if (client === next) client = null;
      await next.end().catch(() => {});
    }
  }
  let stopped = false;
  return async () => {
    if (stopped) return;
    stopped = true;
    users--;
    if (users > 0 || !client) return;
    const done = client;
    client = null;
    await done.end().catch(() => {});
  };
}
