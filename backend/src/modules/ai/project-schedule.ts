import { addDays, dayTime } from "@orbyn/core";
import {
  schedule,
  type SchedulerInput,
  type SchedulerResult,
} from "../planner/scheduler.js";
import type { ProjectDraft } from "./project-draft.js";

/**
 * Schedule a validated, topologically ordered draft without creating any items.
 * Each dependent starts after every prerequisite's last session. A partially
 * placed prerequisite cannot release its dependents. Independent work still
 * uses earlier gaps, and the normal engine owns frame filters, breaks and DST.
 */
export function scheduleProjectDraft(
  draft: ProjectDraft,
  input: Omit<SchedulerInput, "tasks" | "pinned">,
): SchedulerResult {
  const result = schedule({ ...input, tasks: [] });
  const busy = [...input.busy];
  const completion = new Map<string, number>();
  const pause = { none: 0, light: 5, normal: 10, intense: 15 }[
    input.breakLevel
  ];
  for (const task of draft.tasks) {
    // Due at the end of the requested local day, not an arbitrary 9am start.
    const due = dayTime(
      addDays(input.days[0], task.due_in_days + 1),
      0,
      input.timezone,
    ).toISOString();
    if (task.depends_on.some((id) => !completion.has(id))) {
      result.unplaced.push({
        item_id: task.id,
        title: task.title,
        due_at: due,
        reason: "A prerequisite could not be fully scheduled.",
      });
      continue;
    }
    const earliest = Math.max(
      input.now.getTime(),
      ...task.depends_on.map((id) => completion.get(id)!),
    );
    const placed = schedule({
      ...input,
      busy,
      now: new Date(earliest),
      tasks: [
        {
          id: task.id,
          title: task.title,
          priority: "medium",
          status: "todo",
          due_at: due,
          estimate_minutes: task.estimate_minutes,
          spent_minutes: 0,
          scheduled_minutes: 0,
          list_id: null,
          tag_ids: [],
          team_id: null,
        },
      ],
    });
    result.blocks.push(...placed.blocks);
    result.unplaced.push(...placed.unplaced);
    result.at_risk.push(...placed.at_risk);
    result.planned_minutes += placed.planned_minutes;
    for (const block of placed.blocks) {
      const end = Date.parse(block.end_at);
      const minutes = (end - Date.parse(block.start_at)) / 60000;
      busy.push({
        start_at: block.start_at,
        end_at: new Date(
          end + (minutes >= 45 ? pause * 60000 : 0),
        ).toISOString(),
      });
    }
    if (!placed.unplaced.length && placed.blocks.length)
      completion.set(
        task.id,
        Math.max(...placed.blocks.map((b) => Date.parse(b.end_at))),
      );
  }
  result.blocks.sort((a, b) => a.start_at.localeCompare(b.start_at));
  return result;
}
