import { useEffect, useRef, useState } from "react";
import type { AssistantProfile } from "@orbyn/core";
import { client } from "../../lib/api";
import { session } from "../../lib/session";
import { useConfirm } from "../../components/Confirm";

type Work = NonNullable<AssistantProfile["work"]>;
/** Current IDs come from the authorized job snapshot, never historical event inference. */
export function CurrentAgentWork({
  work,
  truncated,
  onOpenChat,
  onRefresh,
}: {
  work: Work;
  truncated?: boolean;
  onOpenChat: (id: string) => void;
  onRefresh: () => Promise<void>;
}) {
  const { ask } = useConfirm();
  const mounted = useRef(true);
  const stopLock = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [stopping, setStopping] = useState<string | null>(null);
  const [requested, setRequested] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  const latest = useRef(work);
  latest.current = work;
  const owner = session.binding();
  const current = () => {
    const binding = session.binding();
    return (
      mounted.current &&
      binding.token === owner.token &&
      binding.generation === owner.generation
    );
  };
  const stop = async (id: string) => {
    if (stopLock.current || !current()) return;
    stopLock.current = true;
    setStopping(id);
    try {
      if (
        !(await ask({
          title: "Stop this run?",
          body: "Requests cancellation of this run. Changes already applied remain available for review and undo.",
          confirmLabel: "Stop run",
        })) ||
        !current()
      )
        return;
      const live = latest.current.find((item) => item.job_id === id);
      if (!live || live.cancel_requested) return;
      setError("");
      await client.stopAssistantRun(id);
      if (!current()) return;
      setRequested((previous) => new Set(previous).add(id));
      await onRefresh();
    } catch {
      if (current())
        setError(
          "Couldn’t confirm the stop request. Refresh current work before trying again.",
        );
    } finally {
      stopLock.current = false;
      if (current()) setStopping(null);
    }
  };
  return (
    <section className="agent-current-work" aria-label="Current work">
      <h3>Current work</h3>
      {error && <p role="alert">{error}</p>}
      {!work.length && <p className="muted">No admitted runs.</p>}
      {[...work]
        .sort(
          (a, b) =>
            Number(b.state === "waiting") - Number(a.state === "waiting"),
        )
        .map((item) => (
          <article className="agent-current-row" key={item.job_id}>
            <div>
              <h4>{item.title || "Untitled work"}</h4>
              <p>
                {item.cancel_requested || requested.has(item.job_id)
                  ? "Stop requested · Awaiting confirmation"
                  : item.recovering
                    ? "Recovery pending"
                    : item.state === "waiting"
                      ? "Waiting for you"
                      : item.state === "queued"
                        ? "Queued"
                        : "Running"}
              </p>
              <time dateTime={item.updated_at}>
                {new Date(item.updated_at).toLocaleString()}
              </time>
            </div>
            <div className="agent-current-actions">
              <button
                className="secondary"
                onClick={() => {
                  if (current()) onOpenChat(item.chat_id);
                }}
              >
                {item.state === "waiting" ? "Review decision" : "Open work"}
              </button>
              <button
                className="text-button"
                disabled={
                  !!stopping ||
                  item.cancel_requested ||
                  requested.has(item.job_id)
                }
                onClick={() => void stop(item.job_id)}
              >
                {stopping === item.job_id
                  ? "Requesting stop…"
                  : "Stop this run"}
              </button>
            </div>
          </article>
        ))}
      {truncated && <p className="muted">Showing 20 current runs.</p>}
    </section>
  );
}
