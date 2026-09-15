import { AlertTriangle } from "lucide-react";
import { dateLabel, type MemberWorkload } from "@orbyn/core";
import { minutesLabel } from "../../lib/planning";

/** The team's tasks that can't get enough time before they're due, soonest first. */
export function AtRiskList({ workload }: { workload: MemberWorkload[] }) {
  const items = workload
    .flatMap((w) => w.at_risk_items ?? [])
    .sort((a, b) => Date.parse(a.due_at) - Date.parse(b.due_at));
  if (!items.length) return null;
  return (
    <div className="team-atrisk">
      <h5>
        <AlertTriangle size={13} aria-hidden="true" /> At-risk tasks
      </h5>
      <ul>
        {items.map((i) => (
          <li key={i.id}>
            <span>
              <strong>{i.title}</strong>
              <small>
                {i.assignee_name} · due {dateLabel(i.due_at)}
              </small>
            </span>
            <span className="team-atrisk-left">
              needs {minutesLabel(i.remaining_minutes)} more
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
