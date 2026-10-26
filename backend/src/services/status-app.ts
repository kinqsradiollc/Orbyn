import { statusRoutes } from "../modules/status/routes.js";
import { createService } from "./http.js";

/** Ordered route registration owned by the status process. */
export const statusModules = [statusRoutes];

export const buildStatusService = () => createService("status", statusModules);
