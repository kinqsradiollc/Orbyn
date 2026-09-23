import { estimateModelOf, type EstimateModel } from "@orbyn/core";
import type { Queryable as Db } from "../../db/pool.js";
import { loadDurations } from "./learning.js";

/**
 * How long the person's finished tasks really took against what they
 * planned, overall, per tag and per list (see learnDurations in @orbyn/core).
 * A ratio of 1.4 means "you take about 40% longer than you estimate".
 */
export async function loadEstimateModel(
  db: Db,
  userId: string,
  applied: boolean,
): Promise<EstimateModel> {
  return estimateModelOf(await loadDurations(db, userId), applied);
}
