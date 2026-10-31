import { addDays, dayTime, type ProjectDecomposition } from "@orbyn/core";

/** The whole project before its tasks and calendar blocks are saved. */
export function ProjectDraft({ project }: { project: ProjectDecomposition }) {
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
  const titles = new Map(project.tasks.map((task) => [task.id, task.title]));
  // Unplaced already says the deadline is in trouble, so one warning per task.
  const warnings = (id: string) => {
    const blocking = project.unplaced.filter((task) => task.item_id === id);
    return blocking.length
      ? blocking
      : project.at_risk.filter((task) => task.item_id === id);
  };
  return (
    <section
      className="agents-project"
      aria-label="Project and schedule preview"
    >
      <h3 dir="auto">{project.title}</h3>
      {project.summary && <p dir="auto">{project.summary}</p>}
      {project.deadline && (
        <p className="muted small">
          Project deadline: {time(project.deadline)}
        </p>
      )}
      <p className="muted small">
        Creates {project.tasks.length} tasks · {project.days}-day plan ·{" "}
        {project.timezone}
      </p>
      {project.unplaced.length > 0 && (
        <p className="agents-warn">
          {project.unplaced.length}{" "}
          {project.unplaced.length === 1 ? "task cannot" : "tasks cannot"} be
          fully scheduled. They will still be created; plan their remaining work
          separately.
        </p>
      )}
      <ol>
        {project.tasks.map((task) => (
          <li key={task.id}>
            <strong dir="auto">{task.title}</strong>
            <span className="muted small">
              {task.estimate_minutes} min estimated · Due{" "}
              {due(task.due_in_days)}
            </span>
            {task.notes && <p dir="auto">{task.notes}</p>}
            <p className="muted small">
              {task.depends_on.length
                ? `After: ${task.depends_on.map((id) => titles.get(id)).join(", ")}`
                : "No prerequisites"}
            </p>
            <ul>
              {project.blocks
                .filter((block) => block.item_id === task.id)
                .map((block, index) => (
                  <li key={index} className="small">
                    {time(block.start_at)} – {time(block.end_at)} ·{" "}
                    {block.frame_name || "Working hours"}
                  </li>
                ))}
            </ul>
            {warnings(task.id).map((warning, index) => (
              <p key={index} className="agents-warn">
                {warning.reason}
              </p>
            ))}
          </li>
        ))}
      </ol>
    </section>
  );
}
