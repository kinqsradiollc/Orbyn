import { useEffect, useState } from "react";
import { hoursLabel, type ExperimentEvidence as Evidence } from "@orbyn/core";
import { client } from "../../lib/api";

const pct = (r: number | null) =>
  r === null ? "—" : `${Math.round(r * 100)}%`;

/**
 * An experiment's before and after, from real numbers: the same stretch of
 * days before it began, and while it ran. What it means is still yours.
 */
export function ExperimentEvidence({ id }: { id: string }) {
  const [e, setE] = useState<Evidence | null>(null);
  useEffect(() => {
    client.experimentEvidence(id).then(setE, () => setE(null));
  }, [id]);
  if (!e) return null;
  const rows: [string, string, string][] = [
    ["Plans kept", pct(e.before.kept_rate), pct(e.during.kept_rate)],
    [
      "Focus a week",
      hoursLabel(e.before.focus_minutes_per_week),
      hoursLabel(e.during.focus_minutes_per_week),
    ],
    [
      "Tasks done a week",
      String(e.before.tasks_done_per_week),
      String(e.during.tasks_done_per_week),
    ],
  ];
  return (
    <table className="experiment-evidence">
      <caption className="sr-only">Before and during the experiment</caption>
      <thead>
        <tr>
          <th scope="col" />
          <th scope="col">Before</th>
          <th scope="col">During</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([label, before, during]) => (
          <tr key={label}>
            <th scope="row">{label}</th>
            <td>{before}</td>
            <td>{during}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
