import { useState } from "react";
import type { AssistantConversationEntry, AssistantSource } from "@orbyn/core";
import { errorText } from "../../lib/errors";
import { client } from "../../lib/api";

export function ConversationUpdate({
  entry,
  onReply,
  onWork,
  onActivity,
  onSource,
  onRefresh,
}: {
  entry: Extract<AssistantConversationEntry, { kind: "update" }>;
  onReply: () => void;
  onWork: (id: string) => void;
  onActivity: (lane: "background" | "overnight") => void;
  onSource?: (source: AssistantSource) => void;
  onRefresh: () => void;
}) {
  const [error, setError] = useState("");
  const [stopping, setStopping] = useState(false);
  return (
    <article
      className={
        "ai-row ai-work-update" +
        (entry.event === "failure" ? " is-failed" : "")
      }
      data-conversation-sequence={entry.sequence}
    >
      <div className="ai-reply">
        <div className="ai-update-meta">
          <span>{entry.lane === "overnight" ? "Overnight" : "Background"}</span>
          <time
            dateTime={entry.created_at}
            title={new Date(entry.created_at).toLocaleString()}
          >
            {new Date(entry.created_at).toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
            })}
          </time>
        </div>
        <p className="ai-update-text">{entry.text}</p>
        <div className="ai-update-actions">
          {entry.event === "question" && entry.actionable === false ? (
            <span>Closed</span>
          ) : entry.event !== "question" || entry.waiting_kind === "person" ? (
            <button type="button" className="text-button" onClick={onReply}>
              Reply
            </button>
          ) : entry.execution_chat_id ? (
            <button
              type="button"
              className="text-button"
              onClick={() => onWork(entry.execution_chat_id!)}
            >
              Review request
            </button>
          ) : (
            <button
              type="button"
              className="text-button"
              onClick={() => onActivity(entry.lane)}
            >
              Review request
            </button>
          )}
          <details>
            <summary>Details</summary>
            {entry.night_runs?.map((run) => (
              <div key={`${run.work.kind}:${run.work.id}`}>
                <span>
                  {run.state === "done"
                    ? "Finished"
                    : run.state === "waiting"
                      ? "Needs review"
                      : run.state === "failed"
                        ? "Couldn’t finish"
                        : run.state === "cancelled"
                          ? "Stopped"
                          : "Still working"}
                </span>
                <p className="ai-update-text">{run.text}</p>
              </div>
            ))}
            <div className="ai-update-details">
              {entry.execution_chat_id ? (
                <button
                  type="button"
                  className="text-button"
                  onClick={() => onWork(entry.execution_chat_id!)}
                >
                  View work
                </button>
              ) : (
                <button
                  type="button"
                  className="text-button"
                  onClick={() => onActivity(entry.lane)}
                >
                  {entry.work.kind === "night"
                    ? "Review night"
                    : "View activity"}
                </button>
              )}
              {entry.sources
                .filter(
                  (source) => source.kind === "doc" || source.kind === "task",
                )
                .map((source) => (
                  <button
                    key={`${source.kind}:${source.id}`}
                    type="button"
                    className="text-button"
                    onClick={() =>
                      onSource?.(
                        source.kind === "doc"
                          ? {
                              doc_id: source.id,
                              block_id: null,
                              title: "Page",
                              quote: "",
                            }
                          : {
                              kind: "task",
                              id: source.id,
                              title: source.kind,
                              quote: "",
                            },
                      )
                    }
                  >
                    {source.kind === "doc"
                      ? "Page"
                      : source.kind.charAt(0).toUpperCase() +
                        source.kind.slice(1)}
                  </button>
                ))}
              {entry.work.kind === "job" &&
                entry.event === "question" &&
                entry.actionable !== false && (
                  <button
                    type="button"
                    className="text-button danger"
                    disabled={stopping}
                    onClick={() => {
                      setStopping(true);
                      setError("");
                      void client
                        .stopAssistantRun(entry.work.id)
                        .then(onRefresh, (e) => setError(errorText(e)))
                        .finally(() => setStopping(false));
                    }}
                  >
                    Stop work
                  </button>
                )}
            </div>
          </details>
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </div>
    </article>
  );
}
