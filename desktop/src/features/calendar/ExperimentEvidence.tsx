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
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let alive = true;
    setE(null);
    setError("");
    client.experimentEvidence(id).then(
      (next) => {
        if (alive) setE(next);
      },
      (reason) => {
        if (alive)
          setError(
            reason instanceof Error
              ? reason.message
              : "Couldn't load evidence.",
          );
      },
    );
    return () => {
      alive = false;
    };
  }, [id, version]);
  if (error)
    return (
      <div className="error" role="alert">
        {error}
        <button
          type="button"
          className="text-button"
          onClick={() => setVersion((n) => n + 1)}
        >
          Retry
        </button>
      </div>
    );
  if (!e)
    return (
      <p className="muted" role="status">
        Loading evidence…
      </p>
    );
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
