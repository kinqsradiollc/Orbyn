import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import { idempotency } from "../lib/idempotency.js";
import {
  createService as createSharedService,
  type ServiceName,
} from "./http-shared.js";

export {
  startService,
  serviceOf,
  validationMessage,
  type ServiceName,
} from "./http-shared.js";

/** Application services retain the shared shell and its required receipt guard.
 * Status imports the shell directly so domain replay checks stay out of its graph. */
export function createService(
  name: ServiceName,
  modules: FastifyPluginAsync[],
): Promise<FastifyInstance> {
  return createSharedService(
    name,
    modules,
    name === "status" ? undefined : idempotency,
  );
}
