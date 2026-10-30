import { useEffect, useRef, useState } from "react";
import {
  assistantPageReviewStateLabel,
  type AssistantProfile,
  type AssistantPageReviewRun,
} from "@orbyn/core";
import { client } from "../../lib/api";
import { session } from "../../lib/session";
import { useConfirm } from "../../components/Confirm";
export function PageAgentWork({
  runs,
  truncated,
  onOpenPage,
  onRefresh,
}: {
  runs: NonNullable<AssistantProfile["page_runs"]>;
  truncated?: boolean;
  onOpenPage?: (id: string) => void;
  onRefresh: () => Promise<void>;
}) {
  const { ask } = useConfirm(),
    mounted = useRef(true),
    locked = useRef(false),
    latest = useRef(runs),
    owner = useRef(session.binding()).current;
  latest.current = runs;
  const [stopping, setStopping] = useState<string | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const current = () => {
    const b = session.binding();
    return (
      mounted.current &&
      b.token === owner.token &&
      b.generation === owner.generation
    );
  };
  const stop = async (id: string) => {
    if (locked.current || !current()) return;
    locked.current = true;
    setStopping(id);
    try {
      if (
        !(await ask({
          title: "Stop this page run?",
          body: "Stops this run and discards its unapplied proposal. The routine schedule and changes already saved are kept.",
          confirmLabel: "Stop run",
        })) ||
        !current()
      )
        return;
      const run = latest.current.find(
        (r) =>
          r.id === id && ["queued", "running", "waiting"].includes(r.state),
      );
      if (!run) return;
      setError("");
      const result = await client.stopPageMaintenanceRun(run.doc_id, run.id);
      if (!current()) return;
      setNotice(
        result.stopped
          ? "This run was stopped. Its schedule is unchanged."
          : "The run already ended. Its saved result is unchanged.",
      );
      await onRefresh();
    } catch {
      if (current())
        setError(
          "Couldn’t confirm the stop. Refresh page work before trying again.",
        );
    } finally {
      locked.current = false;
      if (current()) setStopping(null);
    }
  };
  if (!runs.length) return null;
  const active = runs.filter(
      (run) => !["done", "cancelled"].includes(run.state),
    ),
    history = runs.filter((run) => !active.includes(run));
  const row = (run: AssistantPageReviewRun) => (
    <article key={run.id} className="agent-current-row">
      <div>
        <h4>{run.title}</h4>
        <p>
          {run.work_kind === "comment_reply" ? "Comment reply" : "Page update"}{" "}
          · {assistantPageReviewStateLabel(run)}
        </p>
        <time dateTime={run.updated_at}>
          {new Date(run.updated_at).toLocaleString()}
        </time>
      </div>
      <div className="agent-current-actions">
        {onOpenPage && (
          <button
            className="secondary"
            onClick={() => {
              if (current()) onOpenPage(run.doc_id);
            }}
          >
            {run.state === "waiting" ? "Review in page" : "Open page"}
          </button>
        )}
        {["queued", "running", "waiting"].includes(run.state) && (
          <button
            className="text-button"
            disabled={!!stopping}
            onClick={() => void stop(run.id)}
          >
            {stopping === run.id ? "Stopping…" : "Stop this page run"}
          </button>
        )}
      </div>
    </article>
  );
  return (
    <section className="agent-current-work" aria-label="Page work">
      <h3>Page work</h3>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {active.map(row)}
      {history.length > 0 && (
        <details className="agent-result-history">
          <summary>Finished page work · latest {history.length}</summary>
          {history.map(row)}
        </details>
      )}
      {truncated && (
        <p className="muted">
          More page runs are available in each page’s update history.
        </p>
      )}
    </section>
  );
}
