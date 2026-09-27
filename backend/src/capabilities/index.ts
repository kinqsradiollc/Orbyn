import { getCalendar } from "./calendar-view.js";
import { getContext } from "./context.js";
import { listAgentChanges, undoCapability } from "./changes.js";
import { ackInbox, askPerson, getInbox } from "./inbox.js";
import { applyPlan } from "./plan.js";
import { fetchCapability } from "./fetch.js";
import { addTask, getAgenda, searchItems } from "./legacy.js";
import { getProject } from "./project.js";
import { query } from "./query.js";
import { Registry } from "./registry.js";
import { getLinks } from "./links.js";
import { saveView } from "./views.js";
import {
  commentOnDoc,
  getHistory,
  organize,
  resolveSuggestions,
  saveTemplate,
  tasksFromDoc,
  updateProjectCapability,
} from "./workspace.js";
import {
  getWorkPatterns,
  logFocus,
  manageRoutines,
  setFocusTimer,
  updatePlannerSettings,
  whatIfCapability,
} from "./planner.js";
import { getStudy, planRevisionCapability, updateStudy } from "./study.js";
import {
  addProgress,
  answerAsk,
  getFollowThrough,
  markNotificationsReadCapability,
  saveRecord,
} from "./followthrough.js";
import { findTime, getTeam } from "./teams.js";
import { bookingActionCapability, getBookings } from "./booking.js";
import {
  cancelImportCapability,
  importTasks,
  listImports,
  startImportCapability,
} from "./files.js";
import { findPassages, search } from "./search.js";
import { getToday } from "./today.js";
import {
  completeTasks,
  createTasks,
  editChecklist,
  updateTasks,
} from "./write-tasks.js";
import {
  planSchedule,
  rescheduleSessions,
  scheduleSessions,
} from "./write-sessions.js";
import { createDocCapability, editDoc } from "./write-docs.js";
import { appendDoc } from "./long-docs.js";
import { saveSource } from "./citations.js";
import { addFile } from "./agent-files.js";
import {
  createProjectCapability,
  link,
  proposeChanges,
} from "./write-links.js";

/**
 * Every capability, in the order tools/list gives them. The order is part
 * of the contract (clients cache the list), so new tools go at the end of
 * their group and names never change.
 */
export const registry = new Registry([
  // Core reads (phase A1).
  getContext,
  search,
  fetchCapability,
  getToday,
  getCalendar,
  query,
  getProject,
  findPassages,
  // The first endpoint's tools, for old personal API keys only.
  searchItems,
  addTask,
  getAgenda,
  // Changes and the Review inbox (phase A3).
  createTasks,
  updateTasks,
  completeTasks,
  editChecklist,
  planSchedule,
  scheduleSessions,
  rescheduleSessions,
  createDocCapability,
  editDoc,
  link,
  createProjectCapability,
  proposeChanges,
  // Links (phase A4): the core toolset's 21st tool.
  getLinks,
  // Agent 2 (H1): what this connection changed, and taking it back.
  listAgentChanges,
  undoCapability,
  // Agent 2 (H0): everything routes to your agent, and asking the person.
  getInbox,
  ackInbox,
  askPerson,
  // Agent 2 (H5): one call, whole job.
  applyPlan,
  // The workspace toolset (A4-A5).
  saveView,
  updateProjectCapability,
  getHistory,
  saveTemplate,
  organize,
  commentOnDoc,
  resolveSuggestions,
  tasksFromDoc,
  // Agent 2 (H2): long pages in parts.
  appendDoc,
  // The planner toolset (A5).
  getWorkPatterns,
  whatIfCapability,
  logFocus,
  setFocusTimer,
  manageRoutines,
  updatePlannerSettings,
  // The study toolset (A5).
  getStudy,
  updateStudy,
  planRevisionCapability,
  // Agent 2 (H2): sources the agent read.
  saveSource,
  // The follow-through toolset (A5).
  getFollowThrough,
  addProgress,
  answerAsk,
  saveRecord,
  markNotificationsReadCapability,
  // The teams toolset (A5).
  getTeam,
  findTime,
  // The booking add-on (A5).
  getBookings,
  bookingActionCapability,
  // The files toolset (A5).
  listImports,
  startImportCapability,
  cancelImportCapability,
  importTasks,
  // Agent 2 (H2): files the agent sends.
  addFile,
]);

export { Registry };
