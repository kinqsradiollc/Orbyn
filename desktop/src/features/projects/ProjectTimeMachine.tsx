import { useEffect, useState } from "react";
import type { ProjectCheckpoint, ProjectSnapshot } from "@orbyn/core";
import { client } from "../../lib/api";
import { Select } from "../../components/Select";

/** A read-only look at the planning state after a selected project change. */
export function ProjectTimeMachine({
  projectId,
  report,
}: {
  projectId: string;
  report: (error: unknown) => void;
}) {
  const [checkpoints, setCheckpoints] = useState<ProjectCheckpoint[]>([]);
  const [selected, setSelected] = useState("");
  const [snapshot, setSnapshot] = useState<ProjectSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [more, setMore] = useState(true);

  useEffect(() => {
    let active = true;
    setCheckpoints([]);
    setSelected("");
    setSnapshot(null);
    setMore(true);
    client
      .projectCheckpoints(projectId)
      .then((rows) => {
        if (!active) return;
        setCheckpoints(rows);
        setMore(rows.length === 100);
      })
      .catch(report);
    return () => {
      active = false;
    };
  }, [projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  const choose = async (order: string) => {
    setSelected(order);
    setSnapshot(null);
    if (!order) return;
    setLoading(true);
    try {
      setSnapshot(await client.projectSnapshot(projectId, order));
    } catch (error) {
      report(error);
    } finally {
      setLoading(false);
    }
  };

  const loadOlder = async () => {
    const cursor = checkpoints.at(-1)?.event_order;
    if (!cursor) return;
    setLoading(true);
    try {
      const older = await client.projectCheckpoints(projectId, cursor);
      setCheckpoints((current) => [...current, ...older]);
      setMore(older.length === 100);
    } catch (error) {
      report(error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="project-time-machine" aria-label="Project time machine">
      <div className="project-time-machine-head">
        <div>
          <h4>See the project then</h4>
          <p className="muted">
            A read-only view after any change. Notes show titles, not their
            contents.
          </p>
        </div>
        <Select
          aria-label="Choose a project change"
          value={selected}
          onChange={(event) => void choose(event.target.value)}
        >
          <option value="">Choose a change</option>
          {checkpoints.map((point) => (
            <option key={point.event_order} value={point.event_order}>
              {new Date(point.created_at).toLocaleString([], {
                dateStyle: "medium",
                timeStyle: "short",
              })}{" "}
              · {point.summary}
            </option>
          ))}
        </Select>
      </div>
      {loading && <p className="muted">Loading past state…</p>}
      {snapshot && (
        <div className="project-snapshot">
          <div className="project-snapshot-title">
            <strong>{snapshot.project.name}</strong>
            <span className="muted">
              {new Date(snapshot.created_at).toLocaleString([], {
                dateStyle: "medium",
                timeStyle: "short",
              })}
            </span>
          </div>
          {snapshot.project.summary && <p>{snapshot.project.summary}</p>}
          <p className="muted">
            {snapshot.project.status.replace("_", " ")} ·{" "}
            {snapshot.tasks.length} task
            {snapshot.tasks.length === 1 ? "" : "s"} · {snapshot.notes.length}{" "}
            note{snapshot.notes.length === 1 ? "" : "s"} ·{" "}
            {snapshot.records.length} record
            {snapshot.records.length === 1 ? "" : "s"}
          </p>
          {!!snapshot.stages.length && (
            <div>
              <h5>Stages</h5>
              <p>{snapshot.stages.map((stage) => stage.name).join(" → ")}</p>
            </div>
          )}
          {!!snapshot.tasks.length && (
            <div>
              <h5>Tasks</h5>
              <ul>
                {snapshot.tasks.map((task) => (
                  <li key={task.id}>
                    {task.title}{" "}
                    <span className="muted">
                      · {task.status.replace("_", " ")}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {!!snapshot.notes.length && (
            <div>
              <h5>Notes</h5>
              <ul>
                {snapshot.notes.map((note) => (
                  <li key={note.id}>{note.title || "Untitled"}</li>
                ))}
              </ul>
            </div>
          )}
          {!!snapshot.records.length && (
            <div>
              <h5>Decisions & commitments</h5>
              <ul>
                {snapshot.records.map((record) => (
                  <li key={record.id}>
                    {record.title}{" "}
                    <span className="muted">
                      · {record.status.replace("_", " ")}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
      {more && (
        <button
          className="text-button"
          disabled={loading}
          onClick={() => void loadOlder()}
        >
          Load earlier changes
        </button>
      )}
    </section>
  );
}
