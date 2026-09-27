import { getCalendar } from "./calendar-view.js";
import { getContext, getProfile } from "./context.js";
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
  // Who this connection is, for OpenAI's account labels (openai/profile).
  getProfile,
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
  // The workspace toolset (A4-A5).
  saveView,
  updateProjectCapability,
  getHistory,
  saveTemplate,
  organize,
  commentOnDoc,
  resolveSuggestions,
  tasksFromDoc,
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
]);

export { Registry };
