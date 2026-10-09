import { scanMaintainedPages } from "../worker/maintained-page-scan.js";
import { claimMaintainedPageWork } from "../worker/maintained-pages.js";
import { claimScheduledAgendaWork } from "../worker/agenda-summaries.js";
import { pool } from "../db/pool.js";
import { startAssistantRunner } from "../modules/ai/agent/runner.js";
import {
  dispatchAssistantHandoff,
  settleAssistantHandoff,
} from "../modules/assistant-workspace/handoffs.js";
import { createService } from "./http.js";

/** A private health endpoint and one isolated automation consumer per process. */
export async function buildAssistantWorker(lane: "background" | "overnight") {
  const service = `assistant-${lane}` as const;
  const app = await createService(service, []);
  let stop: (() => Promise<void>) | undefined;
  let lastTick = 0;
  let lastHeartbeat = 0;
  let lastPageScan = 0;
  let preferAgenda = true;
  app.get("/ready", async (_request, reply) => {
    if (!lastTick || Date.now() - lastTick > 30_000)
      return reply.code(503).send({ ok: false });
    await pool.query("SELECT 1");
    return { ok: true };
  });
  app.addHook("onReady", async () => {
    stop = startAssistantRunner(app.log, {
      lane,
      claimScopedWork: async () => {
        if (lane !== "background")
          return claimMaintainedPageWork(app.log, lane);
        preferAgenda = !preferAgenda;
        return preferAgenda
          ? ((await claimScheduledAgendaWork(app.log)) ??
              (await claimMaintainedPageWork(app.log, lane)))
          : ((await claimMaintainedPageWork(app.log, lane)) ??
              (await claimScheduledAgendaWork(app.log)));
      },
      onTick: async () => {
        const now = Date.now();
        await settleAssistantHandoff(lane);
        await dispatchAssistantHandoff(lane);
        if (now - lastHeartbeat >= 10_000) {
          await pool.query(
            `INSERT INTO service_heartbeats(service, last_seen_at) VALUES($1, now())
             ON CONFLICT (service) DO UPDATE SET last_seen_at = now()`,
            [service],
          );
          lastHeartbeat = now;
        }
        lastTick = now;
        if (lane === "background" && now - lastPageScan >= 60_000) {
          lastPageScan = now;
          await scanMaintainedPages(new Date(now));
        }
      },
    });
  });
  app.addHook("onClose", async () => {
    lastTick = 0;
    await stop?.();
  });
  return app;
}
