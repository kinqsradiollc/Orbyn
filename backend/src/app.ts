import { systemRoutes } from "./modules/system/routes.js";
import type { FastifyPluginAsync } from "fastify";
import { createService } from "./services/http.js";
import { authRoutes } from "./modules/auth/routes.js";
import { userRoutes } from "./modules/users/routes.js";
import { inboundRoutes } from "./modules/inbound/routes.js";
import { mcpServerRoutes } from "./modules/mcp-server/routes.js";
import { agentRoutes } from "./modules/agents/routes.js";
import { agentInboxRoutes } from "./modules/agent-inbox/routes.js";
import { agentContextRoutes } from "./modules/agent-context/routes.js";
import { proposalRoutes } from "./modules/proposals/routes.js";
import { oauthRoutes } from "./modules/oauth/routes.js";
import { davRoutes } from "./modules/dav/routes.js";
import { itemRoutes } from "./modules/items/routes.js";
import { deviceRoutes } from "./modules/devices/routes.js";
import { notificationRoutes } from "./modules/notifications/routes.js";
import { aiRoutes } from "./modules/ai/routes.js";
import { aiAdminRoutes } from "./modules/ai/admin.js";
import { teamRoutes } from "./modules/teams/routes.js";
import { adminRoutes } from "./modules/admin/routes.js";
import { statusRoutes } from "./modules/status/routes.js";
import { organizeRoutes } from "./modules/organize/routes.js";
import { docRoutes } from "./modules/docs/routes.js";
import { docStructureRoutes } from "./modules/docs/structure.js";
import { docInfoRoutes } from "./modules/docs/info.js";
import { viewRoutes } from "./modules/views/routes.js";
import { searchRoutes } from "./modules/search/routes.js";
import { linkRoutes } from "./modules/links/routes.js";
import { appLinkRoutes } from "./modules/app-links/routes.js";
import { aiDocRoutes } from "./modules/ai/docs.js";
import { folderRoutes } from "./modules/organize/folders.js";
import { developerRoutes } from "./modules/developers/routes.js";
import { projectRoutes } from "./modules/projects/routes.js";
import { workRecordRoutes } from "./modules/work-records/routes.js";
import { plannerRoutes } from "./modules/planner/routes.js";
import { teamPlanningRoutes } from "./modules/teams/planning.js";
import { accessRoutes } from "./modules/access/routes.js";
import { bookingRoutes } from "./modules/booking/routes.js";
import { inviteRoutes } from "./modules/booking/invites.js";
import { profileRoutes } from "./modules/booking/profile.js";
import { rsvpRoutes } from "./modules/items/attendees.js";
import { subscriptionRoutes } from "./modules/planner/subscriptions.js";
import { focusRoutes } from "./modules/focus/routes.js";
import { teamCapacityRoutes } from "./modules/teams/capacity.js";
import { templateRoutes } from "./modules/templates/routes.js";
import { pageTemplateRoutes } from "./modules/templates/pages.js";
import { followThroughRoutes } from "./modules/followthrough/routes.js";
import {
  legacyDocStreamRoutes,
  realtimeRoutes,
} from "./modules/realtime/routes.js";
import { presenceRoutes } from "./modules/presence/routes.js";
import { legalRoutes } from "./modules/legal/routes.js";
import { studyRoutes } from "./modules/study/routes.js";
import { aiStudyRoutes } from "./modules/ai/study.js";
import { projectChatRoutes } from "./modules/ai/chats.js";
import { mentionRoutes } from "./modules/docs/mentions.js";
import { originalRoutes } from "./modules/imports/originals.js";
import { importRoutes } from "./modules/imports/routes.js";
import { filesRoutes } from "./modules/imports/store.js";
import { pageFileRoutes } from "./modules/page-files/routes.js";
import { pageFileStoreRoutes } from "./modules/page-files/store-routes.js";
import { captureRoutes } from "./modules/capture/routes.js";
import { mcpListenRoutes } from "./modules/mcp-server/listen.js";
import { teamChangeRoutes } from "./modules/teams/changes.js";
import { firstRunRoutes } from "./modules/users/first-run.js";
import { publishRoutes } from "./modules/publish/routes.js";
import { pageImportRoutes } from "./modules/imports/pages.js";
import { aiCaptureRoutes } from "./modules/ai/capture.js";
import { aiRecordingRoutes } from "./modules/ai/recording.js";
import { prefRoutes } from "./modules/users/prefs.js";
import { libraryRoutes } from "./modules/docs/library.js";
import { teamPolicyRoutes } from "./modules/teams/policies.js";
import { clipRoutes } from "./modules/clip/routes.js";

/**
 * Which route modules each service owns. The gateway sends each path to the
 * service that owns it (gateway/nginx.conf); keep the two in step.
 */
export const serviceModules: Record<
  "api" | "ai" | "status" | "realtime" | "files" | "mcp",
  FastifyPluginAsync[]
> = {
  /** Accounts, items, teams, devices, notifications, and the admin console. */
  api: [
    systemRoutes,
    authRoutes,
    userRoutes,
    legalRoutes,
    studyRoutes,
    importRoutes,
    originalRoutes,
    inboundRoutes,
    agentRoutes,
    // Agents' inboxes: what each connection hears, its wake-up address,
    // standing rules, and answering agents' questions (H0).
    agentInboxRoutes,
    agentContextRoutes,
    // The Review inbox: approving what the assistant and outside agents
    // propose, and undoing what agents changed.
    proposalRoutes,
    // Signing in with Orbyn for outside agents (OAuth): the authorization
    // server, its metadata and the consent page's routes.
    oauthRoutes,
    // The files phones check to open the web app's links in the app.
    appLinkRoutes,
    davRoutes,
    itemRoutes,
    deviceRoutes,
    notificationRoutes,
    teamRoutes,
    adminRoutes,
    organizeRoutes,
    docRoutes,
    mentionRoutes,
    // Sections to embed, line names, moving and merging pages, folds.
    docStructureRoutes,
    // A page's Info panel in one request.
    docInfoRoutes,
    // Saved views and your own fields on pages and projects.
    viewRoutes,
    captureRoutes,
    searchRoutes,
    // Links between things: the link picker, pills and "Linked here".
    linkRoutes,
    // Pictures and files in pages: upload and read links, space used.
    pageFileRoutes,
    aiDocRoutes,
    folderRoutes,
    developerRoutes,
    projectRoutes,
    workRecordRoutes,
    plannerRoutes,
    teamPlanningRoutes,
    accessRoutes,
    bookingRoutes,
    inviteRoutes,
    profileRoutes,
    rsvpRoutes,
    subscriptionRoutes,
    focusRoutes,
    presenceRoutes,
    teamCapacityRoutes,
    templateRoutes,
    pageTemplateRoutes,
    followThroughRoutes,
    // Recent changes per team (SHR-02).
    teamChangeRoutes,
    // The guided first run (DSN-02).
    firstRunRoutes,
    // Pages and folders on the web (SHR-05), and /p/<slug> itself.
    publishRoutes,
    // Markdown and Notion exports into pages (DATA-08).
    pageImportRoutes,
    // Choices that follow the account: Arrange, shortcuts, view choices (D5).
    prefRoutes,
    // Archiving, and moving or tagging several pages at once (D5).
    libraryRoutes,
    // A team's switches for publishing, the assistant and booking (OTH-04).
    teamPolicyRoutes,
    // The Orbyn Clipper browser extension (CAP-02..04).
    clipRoutes,
    // Older apps' live-document path, for ingresses that send only /events
    // to the realtime service.
    legacyDocStreamRoutes,
  ],
  /** The assistant (chat, applying proposals) and admin provider settings. */
  ai: [
    aiRoutes,
    aiAdminRoutes,
    aiStudyRoutes,
    projectChatRoutes,
    aiCaptureRoutes,
    // A recording's summary and action items (CAP-10).
    aiRecordingRoutes,
  ],
  /** The public status report. */
  status: [statusRoutes],
  /**
   * Long-lived streams: live news for the apps and live documents. Scaled on
   * open connections, apart from the API, which scales on requests.
   */
  realtime: [
    realtimeRoutes,
    legacyDocStreamRoutes,
    // Agents following Orbyn (MCP subscriptions/listen): the gateway sends
    // a POST /mcp whose Mcp-Method is subscriptions/listen here.
    mcpListenRoutes,
  ],
  /**
   * The file store: uploads for importing into Docs, held encrypted until
   * the converter has read them, and never longer than a day; and pictures
   * and files in pages, kept encrypted for as long as their page. It holds
   * upload streams, so it runs apart from the API.
   */
  files: [filesRoutes, pageFileStoreRoutes],
  /**
   * The MCP address for outside agents: stateless, short calls, scaled on
   * requests (MCP_REPLICAS). /api/mcp on the web app reaches it too.
   */
  mcp: [mcpServerRoutes],
};

export const buildApiService = () => createService("api", serviceModules.api);
export const buildAiService = () => createService("ai", serviceModules.ai);
export const buildStatusService = () =>
  createService("status", serviceModules.status);
export const buildRealtimeService = () =>
  createService("realtime", serviceModules.realtime);
export const buildFilesService = () =>
  createService("files", serviceModules.files);
export const buildMcpService = () => createService("mcp", serviceModules.mcp);

/**
 * Every module in one process: tests and quick local development. `first`
 * plugins register before the modules (the route inventory test uses one to
 * hook every route as it is added).
 */
export const buildApp = (first: FastifyPluginAsync[] = []) =>
  createService("all", [
    ...first,
    ...serviceModules.api,
    ...serviceModules.ai,
    ...serviceModules.status,
    ...serviceModules.files,
    ...serviceModules.mcp,
    realtimeRoutes,
  ]);
