import {
  Boxes,
  CalendarDays,
  FileText,
  GraduationCap,
  ListTodo,
  Newspaper,
  type LucideIcon,
} from "lucide-react";
import type { Concept } from "@orbyn/core";

/**
 * One icon per idea (`CONCEPT_ICONS` in @orbyn/core): a page is always
 * FileText, a project Boxes, a task ListTodo, an event CalendarDays, the
 * agenda Newspaper and study GraduationCap — in the sidebar, ⌘K, link pills,
 * starred lists and empty states alike. A task's tick box is its state, not
 * its icon, so rows that can be ticked still draw a circle.
 */
export const CONCEPT_ICON: Record<Concept, LucideIcon> = {
  page: FileText,
  project: Boxes,
  task: ListTodo,
  event: CalendarDays,
  agenda: Newspaper,
  study: GraduationCap,
};
