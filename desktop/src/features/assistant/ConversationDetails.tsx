import { useEffect, useState } from "react";
import type {
  AssistantConversationDetails,
  AssistantSource,
} from "@orbyn/core";
import { X } from "lucide-react";
import { client } from "../../lib/api";
import { session } from "../../lib/session";

export function ConversationDetails({
  destinationId,
  entryId,
  revision,
  modal,
  onClose,
  onSource,
  onWork,
  onActivity,
  onRefresh,
}: {
  destinationId: string;
  entryId: string;
  revision: string;
  modal: boolean;
  onClose: () => void;
  onRefresh: () => void;
  onSource?: (source: AssistantSource) => void;
  onWork: (id: string) => void;
  onActivity: (lane: "background" | "overnight") => void;
}) {
  const [result, setResult] = useState<AssistantConversationDetails | null>(
    null,
  );
  const [error, setError] = useState(false);
  useEffect(() => {
    const owner = session.get(),
      controller = new AbortController();
    setResult(null);
    setError(false);
    void client
      .assistantConversationDetails(destinationId, entryId, controller.signal)
      .then(
        (value) => {
          if (!controller.signal.aborted && session.get() === owner)
            setResult(value);
        },
        () => {
          if (!controller.signal.aborted && session.get() === owner)
            setError(true);
        },
      );
    return () => controller.abort();
  }, [destinationId, entryId, revision]);
  const [stopping, setStopping] = useState(false);
  const [stopError, setStopError] = useState(false);
  const entry = result?.entry;
  return (
    <aside
      className="ai-upcoming ai-message-details"
      role={modal ? "dialog" : "complementary"}
      aria-modal={modal || undefined}
      aria-label="Message details"
    >
      <header className="ai-details-head">
        <h2>Details</h2>
        <button
          type="button"
          className="icon-button"
          aria-label="Close details"
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </header>
      {error ? (
        <p role="alert">
          This message is no longer available. Close details and refresh the
          conversation.
        </p>
      ) : !entry ? (
        <p role="status">Loading details…</p>
      ) : (
        <div className="ai-details-content">
          <dl>
            <dt>Delivered</dt>
            <dd>{new Date(entry.created_at).toLocaleString()}</dd>
            {entry.kind === "update" && entry.completed_at && (
              <>
                <dt>Completed</dt>
                <dd>{new Date(entry.completed_at).toLocaleString()}</dd>
              </>
            )}
          </dl>
          {entry.kind === "update" && (
            <>
              {entry.night_runs?.map((run) => (
                <section key={`${run.work.kind}:${run.work.id}`}>
                  <strong>
                    {run.state === "done"
                      ? "Finished"
                      : run.state === "waiting"
                        ? "Needs you"
                        : run.state === "failed"
                          ? "Couldn’t finish"
                          : run.state === "cancelled"
                            ? "Stopped"
                            : "Working"}
                  </strong>
                  <p className="ai-update-text">{run.text}</p>
                </section>
              ))}
              <button
                type="button"
                className="text-button"
                onClick={() =>
                  entry.execution_chat_id
                    ? onWork(entry.execution_chat_id)
                    : onActivity(entry.lane)
                }
              >
                {entry.execution_chat_id ? "View work" : "View activity"}
              </button>
            </>
          )}
          {entry.kind === "update" &&
            entry.work.kind === "job" &&
            entry.event === "question" &&
            entry.actionable !== false && (
              <button
                type="button"
                className="text-button danger"
                disabled={stopping}
                onClick={() => {
                  setStopping(true);
                  setStopError(false);
                  void client
                    .stopAssistantRun(entry.work.id)
                    .then(onRefresh, () => setStopError(true))
                    .finally(() => setStopping(false));
                }}
              >
                Stop work
              </button>
            )}
          {stopError && <p role="alert">Couldn’t stop this work. Try again.</p>}
          {!!result?.sources.length && (
            <section>
              <h3>Sources</h3>
              {result.sources.map((source) => (
                <button
                  key={`${source.kind}:${source.id}`}
                  type="button"
                  className="text-button"
                  disabled={!onSource || source.kind === "project"}
                  onClick={() => {
                    if (source.kind === "doc")
                      onSource?.({
                        doc_id: source.id,
                        block_id: null,
                        title: source.title,
                        quote: "",
                      });
                    else if (source.kind === "task")
                      onSource?.({
                        kind: "task",
                        id: source.id,
                        title: source.title,
                        quote: "",
                      });
                  }}
                >
                  {source.title}
                </button>
              ))}
            </section>
          )}
        </div>
      )}
    </aside>
  );
}
