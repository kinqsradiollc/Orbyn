import { getCalendar } from "./calendar-view.js";
import { getContext } from "./context.js";
import { fetchCapability } from "./fetch.js";
import { addTask, getAgenda, searchItems } from "./legacy.js";
import { getProject } from "./project.js";
import { query } from "./query.js";
import { Registry } from "./registry.js";
import { getLinks } from "./links.js";
import { saveView } from "./views.js";
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
  // Links and saved views (phase A4).
  getLinks,
  saveView,
]);

export { Registry };
