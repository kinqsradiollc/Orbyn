import { addDays, dayTime } from "@orbyn/core";
import type { ProjectDecomposition } from "@orbyn/core";
import "./project-draft-review.css";

/** Review the entire project before its tasks and calendar blocks are saved. */
export function ProjectDraftReview({
  project,
}: {
  project: ProjectDecomposition;
}) {
  const time = (iso: string) =>
    new Date(iso).toLocaleString(undefined, {
      timeZone: project.timezone,
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  const due = (days: number) =>
    new Date(
      dayTime(
        addDays(project.start_date, days + 1),
        0,
        project.timezone,
      ).getTime() - 1,
    ).toLocaleDateString(undefined, {
      timeZone: project.timezone,
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  const titles = new Map(project.tasks.map((t) => [t.id, t.title]));
  /**
   * The scheduler reports a task it could not fit as BOTH unplaced and at risk
   * ("A partial placement still helps"), which reads as two contradictory
   * warnings once they sit under the same subtask. Unplaced is the stronger
   * statement and already implies the deadline is in trouble, so at-risk is
   * shown only for tasks that were actually scheduled.
   */
  const warnings = (id: string) => {
    const blocking = project.unplaced.filter((t) => t.item_id === id);
    return blocking.length
      ? blocking
      : project.at_risk.filter((t) => t.item_id === id);
  };
  return (
    <section
      className="project-draft-review"
      aria-label="Project and schedule preview"
    >
      <h3>{project.title}</h3>
      {project.summary && <p>{project.summary}</p>}
      {project.deadline && (
        <p className="muted">Project deadline: {time(project.deadline)}</p>
      )}
      <p className="muted">
        Creates a project with {project.tasks.length} tasks. Times are in{" "}
        {project.timezone}. Review covers {project.days} days.
      </p>
      {project.unplaced.length > 0 && (
        <p className="project-draft-warning">
          {project.unplaced.length}{" "}
          {project.unplaced.length === 1 ? "task cannot" : "tasks cannot"} be
          fully scheduled. They will still be created; their unscheduled work
          needs another plan.
        </p>
      )}
      <ol>
        {project.tasks.map((task) => (
          <li key={task.id}>
            <strong>{task.title}</strong>
            <span className="muted">
              {task.estimate_minutes} min estimated · Due{" "}
              {due(task.due_in_days)}
            </span>
            {task.notes && <p>{task.notes}</p>}
            <p className="muted">
              {task.depends_on.length
                ? `After: ${task.depends_on.map((id) => titles.get(id)).join(", ")}`
                : "No prerequisites"}
            </p>
            <ul>
              {project.blocks
                .filter((b) => b.item_id === task.id)
                .map((b, i) => (
                  <li key={i}>
                    {time(b.start_at)} – {time(b.end_at)} ·{" "}
                    {b.frame_name || "Working hours"}
                  </li>
                ))}
            </ul>
            {warnings(task.id).map((t, i) => (
              <p className="project-draft-warning" key={i}>
                {t.reason}
              </p>
            ))}
          </li>
        ))}
      </ol>
    </section>
  );
}
