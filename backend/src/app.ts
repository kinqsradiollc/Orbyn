import { systemRoutes } from "./modules/system/routes.js";
import type { FastifyPluginAsync } from "fastify";
import { createService } from "./services/http.js";
import { authRoutes } from "./modules/auth/routes.js";
import { userRoutes } from "./modules/users/routes.js";
import { itemRoutes } from "./modules/items/routes.js";
import { deviceRoutes } from "./modules/devices/routes.js";
import { notificationRoutes } from "./modules/notifications/routes.js";
import { aiRoutes } from "./modules/ai/routes.js";
import { aiAdminRoutes } from "./modules/ai/admin.js";
import { teamRoutes } from "./modules/teams/routes.js";
import { adminRoutes } from "./modules/admin/routes.js";
import { statusRoutes } from "./modules/status/routes.js";
import { organizeRoutes } from "./modules/organize/routes.js";
import { plannerRoutes } from "./modules/planner/routes.js";
import { teamPlanningRoutes } from "./modules/teams/planning.js";
import { accessRoutes } from "./modules/access/routes.js";
import { bookingRoutes } from "./modules/booking/routes.js";

/**
 * Which route modules each service owns. The gateway sends each path to the
 * service that owns it (gateway/nginx.conf); keep the two in step.
 */
export const serviceModules: Record<
  "api" | "ai" | "status",
  FastifyPluginAsync[]
> = {
  /** Accounts, items, teams, devices, notifications, and the admin console. */
  api: [
    systemRoutes,
    authRoutes,
    userRoutes,
    itemRoutes,
    deviceRoutes,
    notificationRoutes,
    teamRoutes,
    adminRoutes,
    organizeRoutes,
    plannerRoutes,
    teamPlanningRoutes,
    accessRoutes,
    bookingRoutes,
  ],
  /** The assistant (chat, applying proposals) and admin provider settings. */
  ai: [aiRoutes, aiAdminRoutes],
  /** The public status report. */
  status: [statusRoutes],
};

export const buildApiService = () => createService("api", serviceModules.api);
export const buildAiService = () => createService("ai", serviceModules.ai);
export const buildStatusService = () =>
  createService("status", serviceModules.status);

/** Every module in one process: tests and quick local development. */
export const buildApp = () =>
  createService("all", [
    ...serviceModules.api,
    ...serviceModules.ai,
    ...serviceModules.status,
  ]);
