import type { ProjectActivity } from "./projects.js";

/** Summarize project changes since the viewer last opened it. */
export function projectReentry(events: ProjectActivity[]) {
  return {
    total: events.length,
    completedTasks: events.filter(
      (event) =>
        event.entity_type === "task" &&
        event.after_state?.status === "done" &&
        event.before_state?.status !== "done",
    ).length,
    changedRecords: events.filter((event) => event.entity_type === "record")
      .length,
    newNotes: events.filter((event) => event.kind === "note_added").length,
    recent: events.slice(0, 3).map((event) => event.summary),
  };
}
