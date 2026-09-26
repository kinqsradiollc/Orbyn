import type { CSSProperties } from "react";
import { CONCEPT_ICON } from "../../app/concept-icons";

/**
 * Small, real pieces of the product for the home page, drawn with the app's
 * own shapes rather than decoration: the planner filling a week, and a page
 * with the [[ link picker open. Both are pictures (aria-hidden, described by
 * their figure's label), and hold still when reduced motion is asked for.
 */

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];

/** Hours 9–16 as rows; each block is [day, start hour, length, kind, title]. */
const BLOCKS: [number, number, number, "busy" | "session", string][] = [
  [0, 9, 1, "busy", "Lecture"],
  [0, 11, 2, "session", "Methods"],
  [1, 10, 1, "busy", "Tutor"],
  [1, 13, 2, "session", "Experiments"],
  [2, 9, 2, "session", "Reading"],
  [2, 14, 1, "busy", "Team retro"],
  [3, 12, 1, "busy", "Lab"],
  [3, 14, 2, "session", "Methods"],
  [4, 9, 1, "session", "Review"],
  [4, 11, 1, "busy", "Office"],
];

/** The planner fills the free time around meetings, one session at a time. */
export function WeekDemo() {
  let session = 0;
  return (
    <figure
      className="home-demo home-week-demo"
      aria-label="The planner placing work sessions in the free time around meetings"
    >
      <div className="home-week-grid" aria-hidden="true">
        {DAYS.map((d, n) => (
          <span key={d} className="home-week-day" style={{ gridColumn: n + 1 }}>
            {d}
          </span>
        ))}
        {BLOCKS.map(([day, start, hours, kind, title]) => (
          <span
            key={`${day}-${start}`}
            className={`home-week-block is-${kind}`}
            style={
              {
                gridColumn: day + 1,
                gridRow: `${start - 7} / span ${hours}`,
                "--i": kind === "session" ? session++ : 0,
              } as CSSProperties
            }
          >
            {title}
          </span>
        ))}
      </div>
      <figcaption>
        Meetings stay put; sessions fill the time around them.
      </figcaption>
    </figure>
  );
}

const PICKS = [
  { icon: CONCEPT_ICON.page, title: "Lab setup", hint: "Page" },
  { icon: CONCEPT_ICON.task, title: "Lab report", hint: "Task · due Fri" },
  { icon: CONCEPT_ICON.project, title: "Physics lab", hint: "Project" },
];

/** A page line with the [[ picker open: pages, tasks and projects alike. */
export function LinkDemo() {
  return (
    <figure
      className="home-demo home-link-demo"
      aria-label="Typing two square brackets in a page to link a page, a task or a project"
    >
      <div aria-hidden="true">
        <p className="home-link-line">
          Bring the lenses from <span className="home-link-typed">[[Lab</span>
          <span className="home-link-caret" />
        </p>
        <ul className="home-link-picker">
          {PICKS.map(({ icon: Icon, title, hint }, n) => (
            <li key={title} className={n === 0 ? "is-active" : ""}>
              <Icon size={14} />
              <strong>{title}</strong>
              <small>{hint}</small>
            </li>
          ))}
        </ul>
      </div>
      <figcaption>Link a page, a task or a project as you write.</figcaption>
    </figure>
  );
}
