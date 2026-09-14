import { pool } from "../db/pool.js";
import { closeEmail } from "./channels/email.js";
import { deliverOne } from "./delivery.js";
import { enqueue } from "./scheduler.js";

const CYCLE_MS = 10000;
const MAX_DELIVERIES_PER_CYCLE = 100;

/** Scheduler + delivery loop. Stops cleanly on SIGINT/SIGTERM. */
export async function runWorker() {
  let stopping = false;
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, () => {
      stopping = true;
    });
  while (!stopping) {
    try {
      // Heartbeat for the status page: the reminder service has no HTTP port.
      await pool.query(
        "INSERT INTO service_heartbeats(service,last_seen_at) VALUES('notifier',now()) ON CONFLICT (service) DO UPDATE SET last_seen_at=now()",
      );
      await enqueue();
      for (let i = 0; i < MAX_DELIVERIES_PER_CYCLE && !stopping; i++)
        if (!(await deliverOne())) break;
    } catch (error) {
      console.error(
        "Worker cycle failed",
        error instanceof Error ? error.message : "unknown",
      );
    }
    if (!stopping)
      await new Promise((resolve) => setTimeout(resolve, CYCLE_MS));
  }
  await pool.end();
  closeEmail();
}
