import { updateStatusLabel } from "./assistant-labels";
import { CopyMessage } from "./ConversationMessage";
import type { AssistantConversationEntry } from "@orbyn/core";

export function ConversationUpdate({
  entry,
  onReply,
  onWork,
  onActivity,
  onDetails,
}: {
  entry: Extract<AssistantConversationEntry, { kind: "update" }>;
  onReply: () => void;
  onWork: (id: string) => void;
  onActivity: (lane: "background" | "overnight") => void;
  onDetails: () => void;
}) {
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
          <strong>{updateStatusLabel(entry)}</strong>
        </div>
        <p className="ai-update-text">{entry.text}</p>
        <div className="ai-update-actions">
          {entry.event !== "question" && (
            <button
              type="button"
              className="secondary"
              onClick={() =>
                entry.execution_chat_id
                  ? onWork(entry.execution_chat_id)
                  : onActivity(entry.lane)
              }
            >
              {entry.event === "morning_summary"
                ? "Review activity"
                : "Review result"}
            </button>
          )}
          <CopyMessage text={entry.text} />
          {entry.event === "question" && entry.actionable === false ? (
            <span>Closed</span>
          ) : entry.event !== "question" || entry.waiting_kind === "person" ? (
            <button type="button" className="text-button" onClick={onReply}>
              {entry.event === "question" ? "Answer" : "Reply"}
            </button>
          ) : entry.execution_chat_id ? (
            <button
              type="button"
              className="text-button"
              onClick={() => onWork(entry.execution_chat_id!)}
            >
              Review
            </button>
          ) : (
            <button
              type="button"
              className="text-button"
              onClick={() => onActivity(entry.lane)}
            >
              Review
            </button>
          )}
          <button type="button" className="text-button" onClick={onDetails}>
            Details
          </button>
        </div>
      </div>
    </article>
  );
}
