import type { FastifyInstance } from "fastify";
import {
  focusCurrentInput,
  focusSessionInput,
  focusSummaryQuery,
  type FocusCurrent,
  type FocusSummary,
} from "@orbyn/core";
import { pool, reader, transaction } from "../../db/pool.js";
import { authenticate } from "../../lib/auth.js";
import {
  clearFocus,
  currentFocus,
  focusSummary,
  logFocusSession,
  setFocus,
} from "./service.js";

/**
 * Focus sessions. Each finished or cut-short phase is kept once (its id is
 * made on the device, so a retry is the same record), work minutes are logged
 * to the task, and the phase running now is shared with your other devices.
 */
export async function focusRoutes(app: FastifyInstance) {
  app.post("/focus/sessions", async (r, reply) => {
    const u = await authenticate(r);
    const d = focusSessionInput.parse(r.body);
    const result = await transaction((db) => logFocusSession(db, u, d));
    reply.code(result.fresh ? 201 : 200);
    return { session: result.session, item: result.item };
  });

  app.get("/focus/summary", async (r): Promise<FocusSummary> => {
    const u = await authenticate(r);
    const q = focusSummaryQuery.parse(r.query);
    return focusSummary(reader(r.headers), u.id, q);
  });

  // What's running now, so the phone shows the session the laptop started.
  app.get("/focus/current", async (r): Promise<FocusCurrent | null> => {
    const u = await authenticate(r);
    return currentFocus(u.id);
  });

  app.put("/focus/current", async (r): Promise<FocusCurrent> => {
    const u = await authenticate(r);
    const d = focusCurrentInput.parse(r.body);
    return setFocus(pool, u, d);
  });

  app.delete("/focus/current", async (r, reply) => {
    const u = await authenticate(r);
    await clearFocus(pool, u.id);
    reply.code(204);
  });
}
