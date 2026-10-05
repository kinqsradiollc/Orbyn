import { setTimeout as delay } from "node:timers/promises";

/** Retry only a fully rolled-back migration transaction, never an individual statement. */
export async function retryMigrationTransaction(
  operation: () => Promise<void>,
  options: {
    wait?: (milliseconds: number) => Promise<unknown>;
    report?: (attempt: number, error: unknown) => void;
  } = {},
): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await operation();
      return;
    } catch (error) {
      if ((error as { code?: string } | null)?.code !== "40P01" || attempt >= 3)
        throw error;
      options.report?.(attempt, error);
      await (options.wait ?? delay)(attempt * 250);
    }
  }
}
