import { agentChannelRoutes } from "../modules/agent-channels/routes.js";
import { teamsChannelRoutes } from "../modules/agent-channels/teams-routes.js";
import { createTeamsActivityRoutes } from "../modules/agent-channels/teams-activity-routes.js";
import { createSlackReplyRoutes } from "../modules/agent-channels/reply-routes.js";
import { chatgptModelRoutes } from "../modules/auth/chatgpt-model-routes.js";
import { systemRoutes } from "../modules/system/routes.js";
import { authRoutes } from "../modules/auth/routes.js";
import { userRoutes } from "../modules/users/routes.js";
import { legalRoutes } from "../modules/legal/routes.js";
import { studyRoutes } from "../modules/study/routes.js";
import { importRoutes } from "../modules/imports/routes.js";
import { originalRoutes } from "../modules/imports/originals.js";
import { inboundRoutes } from "../modules/inbound/routes.js";
import { agentRoutes } from "../modules/agents/routes.js";
import { agentInboxRoutes } from "../modules/agent-inbox/routes.js";
import { agentContextRoutes } from "../modules/agent-context/routes.js";
import { assistantIdeasRoutes } from "../modules/assistant-ideas/routes.js";
import { assistantGoalRoutes } from "../modules/assistant-workspace/goals.js";
import { goalExecutionRoutes } from "../modules/assistant-workspace/goal-executions.js";
import { assistantRoutineRoutes } from "../modules/assistant-workspace/routine-routes.js";
import { overnightRoutes } from "../modules/assistant-workspace/overnight.js";
import { assistantActivityRoutes } from "../modules/assistant-workspace/activity.js";
import { assistantConversationRoutes } from "../modules/assistant-workspace/conversation-routes.js";
import { assistantProfileRoutes } from "../modules/assistant-workspace/profiles.js";
import { assistantBudgetRoutes } from "../modules/assistant-workspace/budgets.js";
import { assistantHandoffRoutes } from "../modules/assistant-workspace/handoffs.js";
import { assistantRulesRoutes } from "../modules/agents/assistant-rules.js";
import { reminderActionRoutes } from "../modules/assistant-workspace/reminder-actions.js";
import { memoryRoutes } from "../modules/memory/routes.js";
import { proposalRoutes } from "../modules/proposals/routes.js";
import { oauthRoutes } from "../modules/oauth/routes.js";
import { appLinkRoutes } from "../modules/app-links/routes.js";
import { davRoutes } from "../modules/dav/routes.js";
import { itemRoutes } from "../modules/items/routes.js";
import { deviceRoutes } from "../modules/devices/routes.js";
import { notificationRoutes } from "../modules/notifications/routes.js";
import { teamRoutes } from "../modules/teams/routes.js";
import { adminRoutes } from "../modules/admin/routes.js";
import { publishingRoutes } from "../modules/social-publishing/routes.js";
import { organizeRoutes } from "../modules/organize/routes.js";
import { docRoutes } from "../modules/documents/routes.js";
import { docContentRoutes } from "../modules/documents/content-routes.js";
import { mentionRoutes } from "../modules/documents/mentions.js";
import { docStructureRoutes } from "../modules/documents/structure.js";
import { docInfoRoutes } from "../modules/documents/info.js";
import { viewRoutes } from "../modules/views/routes.js";
import { captureRoutes } from "../modules/capture/routes.js";
import { searchRoutes } from "../modules/search/routes.js";
import { linkRoutes } from "../modules/links/routes.js";
import { pageFileRoutes } from "../modules/page-files/routes.js";
import { aiDocRoutes } from "../modules/ai/docs.js";
import { folderRoutes } from "../modules/organize/folders.js";
import { developerRoutes } from "../modules/developers/routes.js";
import { projectRoutes } from "../modules/projects/routes.js";
import { workRecordRoutes } from "../modules/work-records/routes.js";
import { plannerRoutes } from "../modules/planner/routes.js";
import { teamPlanningRoutes } from "../modules/teams/planning.js";
import { accessRoutes } from "../modules/access/routes.js";
import { bookingRoutes } from "../modules/booking/routes.js";
import { inviteRoutes } from "../modules/booking/invites.js";
import { profileRoutes } from "../modules/booking/profile.js";
import { rsvpRoutes } from "../modules/items/attendees.js";
import { subscriptionRoutes } from "../modules/planner/subscriptions.js";
import { focusRoutes } from "../modules/focus/routes.js";
import { presenceRoutes } from "../modules/presence/routes.js";
import { teamCapacityRoutes } from "../modules/teams/capacity.js";
import { templateRoutes } from "../modules/templates/routes.js";
import { pageTemplateRoutes } from "../modules/templates/pages.js";
import { followThroughRoutes } from "../modules/followthrough/routes.js";
import { teamChangeRoutes } from "../modules/teams/changes.js";
import { firstRunRoutes } from "../modules/users/first-run.js";
import { publishRoutes } from "../modules/public-pages/routes.js";
import { scopedPublicationRoutes } from "../modules/public-pages/scoped-routes.js";
import { pageImportRoutes } from "../modules/imports/pages.js";
import { prefRoutes } from "../modules/users/prefs.js";
import { homeRoutes } from "../modules/home/routes.js";
import { libraryRoutes } from "../modules/documents/library.js";
import { teamPolicyRoutes } from "../modules/teams/policies.js";
import { clipRoutes } from "../modules/clip/routes.js";
import { legacyDocStreamRoutes } from "../modules/realtime/routes.js";
import { createService } from "./http.js";

/** Ordered route registration owned by the api process. */
export const apiModules = [
  agentChannelRoutes,
  teamsChannelRoutes,
  createTeamsActivityRoutes(),
  createSlackReplyRoutes(),
  chatgptModelRoutes,
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
  assistantIdeasRoutes,
  // Private goals and weekly check-ins for the built-in assistant (Muse M8).
  assistantGoalRoutes,
  goalExecutionRoutes,
  // Scheduled routines and approval scopes for the built-in assistant (Muse M9).
  assistantRoutineRoutes,
  overnightRoutes,
  assistantActivityRoutes,
  assistantConversationRoutes,
  assistantProfileRoutes,
  assistantBudgetRoutes,
  assistantHandoffRoutes,
  assistantRulesRoutes,
  reminderActionRoutes,
  memoryRoutes,
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
  publishingRoutes,
  organizeRoutes,
  docRoutes,
  docContentRoutes,
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
  scopedPublicationRoutes,
  // Markdown and Notion exports into pages (DATA-08).
  pageImportRoutes,
  // Choices that follow the account: Arrange, shortcuts, view choices (D5).
  prefRoutes,
  // Home's goals, routines and reflection panels (W1).
  homeRoutes,
  // Archiving, and moving or tagging several pages at once (D5).
  libraryRoutes,
  // A team's switches for publishing, the assistant and booking (OTH-04).
  teamPolicyRoutes,
  // The Orbyn Clipper browser extension (CAP-02..04).
  clipRoutes,
  // Older apps' live-document path, for ingresses that send only /events
  // to the realtime service.
  legacyDocStreamRoutes,
];

export const buildApiService = () => createService("api", apiModules);
