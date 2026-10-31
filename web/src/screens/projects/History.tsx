import {
  activityOriginLabel,
  type Item,
  type ProjectActivity,
  type ProjectCheckpoint,
  type ProjectSnapshot,
} from "@orbyn/core";
import { useEffect, useRef, useState } from "react";
import { useResource } from "../../lib/resource";
import { navigate } from "../../lib/router";
import { client } from "../../lib/session";
import { Button, ErrorNotice, Loading, SelectBox } from "../../ui/kit";
import { tasks } from "../shared-task";

const FIELDS: Record<string, string> = {
  name: "Name",
  summary: "Summary",
  status: "Status",
  deadline: "Deadline",
  title: "Title",
  due_at: "Due date",
  progress: "Progress",
  stage_id: "Stage",
  version: "Document version",
  position: "Order",
  start_at: "Starts",
  due_on: "Date",
  done: "Done",
  assistant_off: "Assistant",
};

function valueText(key: string, value: unknown) {
  if (value === null || value === undefined || value === "") return "Not set";
  if (key === "progress") return `${value}%`;
  if (key === "assistant_off") return value ? "Kept out" : "Can read it";
  if (key === "done") return value ? "Yes" : "No";
  if (key === "due_on")
    return new Date(`${String(value)}T12:00:00`).toLocaleDateString([], {
      dateStyle: "medium",
    });
  if (key === "deadline" || key === "due_at" || key === "start_at") {
    const date = new Date(String(value));
    if (!Number.isNaN(date.getTime()))
      return date.toLocaleString([], {
        dateStyle: "medium",
        timeStyle: "short",
      });
  }
  if (key === "stage_id") return "Stage changed";
  return String(value);
}

function diff(event: ProjectActivity) {
  const before = event.before_state ?? {};
  const after = event.after_state ?? {};
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter(
      (key) =>
        FIELDS[key] &&
        !(before[key] == null && after[key] == null) &&
        before[key] !== after[key],
    )
    .map((key) => ({
      label: FIELDS[key],
      from: valueText(key, before[key]),
      to: valueText(key, after[key]),
    }));
}

/** A read-only look at the planning state after a chosen change. */
function PastState({ projectId }: { projectId: string }) {
  const request = useRef(0);
  const list = useResource(
    () => client.projectCheckpoints(projectId),
    [projectId],
  );
  const [older, setOlder] = useState<ProjectCheckpoint[]>([]);
  const [more, setMore] = useState(true);
  const [selected, setSelected] = useState("");
  const [snapshot, setSnapshot] = useState<ProjectSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState<"snapshot" | "older" | null>(null);
  const points = [...(list.data ?? []), ...older];
  useEffect(() => {
    if (list.data) setMore(list.data.length === 100);
  }, [list.data]);
  const choose = async (order: string) => {
    const epoch = ++request.current;
    setSelected(order);
    setSnapshot(null);
    setFailed(null);
    if (!order) return setLoading(false);
    setLoading(true);
    try {
      const next = await client.projectSnapshot(projectId, order);
      if (epoch === request.current) setSnapshot(next);
    } catch {
      if (epoch === request.current) setFailed("snapshot");
    } finally {
      if (epoch === request.current) setLoading(false);
    }
  };
  const loadOlder = async () => {
    const cursor = points.at(-1)?.event_order;
    if (!cursor || loading) return;
    setLoading(true);
    setFailed(null);
    try {
      const rows = await client.projectCheckpoints(projectId, cursor);
      setOlder((all) => [...all, ...rows]);
      setMore(rows.length === 100);
    } catch {
      setFailed("older");
    } finally {
      setLoading(false);
    }
  };
  const when = (iso: string) =>
    new Date(iso).toLocaleString([], {
      dateStyle: "medium",
      timeStyle: "short",
    });
  return (
    <section className="pj-past" aria-label="Project time machine">
      <div className="pj-block-head">
        <div>
          <h3>Past state</h3>
          <p className="muted small">Read-only. Notes include titles only.</p>
        </div>
        <SelectBox
          aria-label="Choose a project change"
          disabled={!list.data}
          value={selected}
          onChange={(event) => void choose(event.target.value)}
        >
          <option value="">Choose a change</option>
          {points.map((p) => (
            <option key={p.event_order} value={p.event_order}>
              {when(p.created_at)} · {p.summary}
            </option>
          ))}
        </SelectBox>
      </div>
      {list.error && (
        <ErrorNotice message={list.error} onRetry={() => void list.reload()} />
      )}
      {failed && (
        <ErrorNotice
          message="Couldn't load past state."
          onRetry={() =>
            void (failed === "snapshot" ? choose(selected) : loadOlder())
          }
        />
      )}
      {loading && <Loading label="Loading past state" />}
      {list.data && !points.length && (
        <p className="muted small">No changes yet.</p>
      )}
      {snapshot && (
        <div className="pj-snapshot">
          <p>
            <strong dir="auto">{snapshot.project.name}</strong>{" "}
            <span className="muted small">{when(snapshot.created_at)}</span>
          </p>
          {snapshot.project.summary && (
            <p dir="auto">{snapshot.project.summary}</p>
          )}
          <p className="muted small">
            {snapshot.project.status.replace("_", " ")} ·{" "}
            {snapshot.tasks.length} task
            {snapshot.tasks.length === 1 ? "" : "s"} · {snapshot.notes.length}{" "}
            note
            {snapshot.notes.length === 1 ? "" : "s"} · {snapshot.records.length}{" "}
            record
            {snapshot.records.length === 1 ? "" : "s"}
          </p>
          {!!snapshot.stages.length && (
            <p dir="auto">{snapshot.stages.map((s) => s.name).join(" → ")}</p>
          )}
          {!!snapshot.tasks.length && (
            <ul>
              {snapshot.tasks.map((t) => (
                <li key={t.id} dir="auto">
                  {t.title}{" "}
                  <span className="muted">· {t.status.replace("_", " ")}</span>
                </li>
              ))}
            </ul>
          )}
          {!!snapshot.notes.length && (
            <ul>
              {snapshot.notes.map((n) => (
                <li key={n.id} dir="auto">
                  {n.title || "Untitled"}
                </li>
              ))}
            </ul>
          )}
          {!!snapshot.records.length && (
            <ul>
              {snapshot.records.map((r) => (
                <li key={r.id} dir="auto">
                  {r.title}{" "}
                  <span className="muted">· {r.status.replace("_", " ")}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {list.data && more && points.length > 0 && (
        <Button
          variant="ghost"
          disabled={loading}
          onClick={() => void loadOlder()}
        >
          Load earlier changes
        </Button>
      )}
    </section>
  );
}

export function History({
  projectId,
  items,
  lastSeen,
  sourceId,
}: {
  projectId: string;
  items: Item[];
  lastSeen: string | null;
  sourceId: string | null;
}) {
  const activity = useResource(
    () => client.projectActivity(projectId),
    [projectId],
  );
  const rows = activity.data;
  const fresh =
    lastSeen && rows ? rows.filter((e) => e.created_at > lastSeen).length : 0;
  return (
    <section className="pj-history" aria-labelledby="pj-history-title">
      <header className="pj-block-head">
        <div>
          <h3 id="pj-history-title">Project history</h3>
          <p className="muted small">
            Changes to the project, its tasks, and its notes in one place.
          </p>
        </div>
        <Button onClick={() => void activity.reload()}>Refresh</Button>
      </header>
      <PastState projectId={projectId} />
      {activity.error && (
        <ErrorNotice
          message={activity.error}
          onRetry={() => void activity.reload()}
        />
      )}
      {activity.loading && !rows && <Loading label="Loading project history" />}
      {rows?.length === 0 && <p className="muted small">No changes yet.</p>}
      {rows && rows.length > 0 && (
        <>
          {lastSeen && (
            <p className="small" role="status">
              <strong>{fresh}</strong>{" "}
              {fresh === 1
                ? "change since your last visit"
                : "changes since your last visit"}
            </p>
          )}
          <ol>
            {rows.map((event) => {
              const changes = diff(event);
              const related =
                event.entity_type === "task" || event.entity_type === "session"
                  ? items.find((i) => i.id === event.entity_id)
                  : undefined;
              const origin = activityOriginLabel(event);
              return (
                <li
                  key={event.id}
                  className={event.id === sourceId ? "is-focus" : undefined}
                  ref={
                    event.id === sourceId
                      ? (el) => el?.scrollIntoView({ block: "center" })
                      : undefined
                  }
                >
                  <div className="pj-history-top">
                    <strong dir="auto">{event.summary}</strong>
                    <time dateTime={event.created_at}>
                      {new Date(event.created_at).toLocaleString([], {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                    </time>
                  </div>
                  <small className="muted">
                    {event.actor_name ?? "Workspace activity"}
                    {origin ? ` · ${origin}` : ""}
                    {event.entity_type === "session"
                      ? " · only you see your sessions"
                      : ""}
                  </small>
                  {!!changes.length && (
                    <ul className="pj-diff">
                      {changes.map((c) => (
                        <li key={c.label}>
                          <span>{c.label}</span> <span>{c.from}</span>{" "}
                          <span aria-hidden="true">→</span>{" "}
                          <strong>{c.to}</strong>
                        </li>
                      ))}
                    </ul>
                  )}
                  {related && (
                    <Button variant="ghost" onClick={() => tasks.open(related)}>
                      Open task
                    </Button>
                  )}
                  {event.entity_type === "note" && event.entity_id && (
                    <Button
                      variant="ghost"
                      onClick={() => navigate(`/app/doc/${event.entity_id}`)}
                    >
                      Open note
                    </Button>
                  )}
                </li>
              );
            })}
          </ol>
        </>
      )}
    </section>
  );
}
