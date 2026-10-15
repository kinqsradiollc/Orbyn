import { useEffect, useRef, useState } from "react";
import type { ProjectCheckpoint, ProjectSnapshot } from "@orbyn/core";
import { client } from "../../lib/api";
import { Select } from "../../components/Select";

/** A read-only look at the planning state after a selected project change. */
export function ProjectTimeMachine(
  props: Parameters<typeof TimeMachineBody>[0],
) {
  return <TimeMachineBody key={props.projectId} {...props} />;
}

function TimeMachineBody({
  projectId,
  report,
}: {
  projectId: string;
  report: (error: unknown) => void;
}) {
  const request = useRef(0);
  const paging = useRef(false);
  const [retry, setRetry] = useState(0);
  const [failed, setFailed] = useState<"list" | "snapshot" | "older" | null>(
    null,
  );
  const [ready, setReady] = useState(false);
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
    setFailed(null);
    setReady(false);
    client
      .projectCheckpoints(projectId)
      .then((rows) => {
        if (!active) return;
        setCheckpoints(rows);
        setMore(rows.length === 100);
        setReady(true);
      })
      .catch((reason) => {
        if (active) {
          setFailed("list");
          report(reason);
        }
      });
    return () => {
      active = false;
      request.current++;
    };
  }, [projectId, retry]); // eslint-disable-line react-hooks/exhaustive-deps

  const choose = async (order: string) => {
    const epoch = ++request.current;
    setSelected(order);
    setSnapshot(null);
    setFailed(null);
    if (!order) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const next = await client.projectSnapshot(projectId, order);
      if (epoch === request.current) setSnapshot(next);
    } catch (reason) {
      if (epoch === request.current) {
        setFailed("snapshot");
        report(reason);
      }
    } finally {
      if (epoch === request.current) setLoading(false);
    }
  };

  const loadOlder = async () => {
    const cursor = checkpoints.at(-1)?.event_order;
    if (!cursor || paging.current) return;
    paging.current = true;
    const epoch = request.current;
    setLoading(true);
    setFailed(null);
    try {
      const older = await client.projectCheckpoints(projectId, cursor);
      if (epoch !== request.current) return;
      setCheckpoints((current) => [...current, ...older]);
      setMore(older.length === 100);
    } catch (error) {
      if (epoch === request.current) {
        setFailed("older");
        report(error);
      }
    } finally {
      paging.current = false;
      if (epoch === request.current) setLoading(false);
    }
  };

  return (
    <section className="project-time-machine" aria-label="Project time machine">
      <div className="project-time-machine-head">
        <div>
          <h4>Past state</h4>
          <p className="muted">Read-only. Notes include titles only.</p>
        </div>
        <Select
          disabled={!ready || paging.current}
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
      {failed && (
        <p role="alert">
          Couldn't load past state.{" "}
          <button
            className="text-button"
            disabled={loading}
            onClick={() =>
              failed === "list"
                ? setRetry((value) => value + 1)
                : failed === "snapshot"
                  ? void choose(selected)
                  : void loadOlder()
            }
          >
            Retry
          </button>
        </p>
      )}
      {!ready && !failed && (
        <p className="muted" role="status">
          Loading changes…
        </p>
      )}
      {ready && !checkpoints.length && <p className="muted">No changes yet.</p>}
      {loading && (
        <p className="muted" role="status">
          Loading past state…
        </p>
      )}
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
      {ready && more && (
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
