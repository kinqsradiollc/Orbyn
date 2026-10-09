import { useEffect, useState } from "react";
import type { AssistantHandoff } from "@orbyn/core";
import { client } from "../../lib/api";
import "./assistant-agents.css";

/** The owner explicitly names the next task; the other runtime decides how to do it. */
export function AssistantHandoffAction({
  jobId,
  title,
  lane,
  existing,
  onOpenChat,
}: {
  jobId: string;
  title: string;
  lane: "background" | "overnight";
  existing?: {
    id: string;
    status: AssistantHandoff["status"];
    recipient_chat_id: string | null;
  } | null;
  onOpenChat?: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [receipt, setReceipt] = useState<AssistantHandoff | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const current = receipt ?? existing;
  useEffect(() => {
    if (
      !current ||
      ["completed", "failed", "cancelled"].includes(current.status)
    )
      return;
    const timer = window.setInterval(() => {
      void client
        .assistantHandoff(current.id)
        .then(setReceipt)
        .catch(() => setError("Couldn't refresh handoff."));
    }, 10_000);
    return () => window.clearInterval(timer);
  }, [current?.id, current?.status]);
  const recipient = lane === "background" ? "Overnight" : "Background";
  const send = async () => {
    if (!instruction.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      const source = await client.assistantHandoffSource(jobId);
      if (source.lane !== lane) throw new Error("Source lane changed");
      const next = await client.requestAssistantHandoff({
        producer_job_id: jobId,
        expected_producer_revision: source.source.revision,
        recipient_lane: lane === "background" ? "overnight" : "background",
        title: title.slice(0, 120) || "Follow-up",
        instruction: instruction.trim(),
      });
      setReceipt(next);
      setOpen(false);
    } catch {
      setError("Couldn't send this result. Refresh and try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="assistant-handoff-action">
      {!open && current ? (
        <div className="assistant-handoff-status">
          <span role="status">
            {recipient}:{" "}
            {
              {
                proposed: "Queued",
                accepted: "Working",
                completed: "Done",
                failed: "Needs review",
                cancelled: "Cancelled",
              }[current.status]
            }
          </span>
          {current.recipient_chat_id && onOpenChat && (
            <button
              type="button"
              className="secondary"
              onClick={() => onOpenChat(current.recipient_chat_id!)}
            >
              Open follow-up
            </button>
          )}
          {current.status === "failed" && (
            <button
              type="button"
              className="secondary"
              onClick={() => {
                setReceipt(null);
                setOpen(true);
              }}
            >
              Try again
            </button>
          )}
        </div>
      ) : open ? (
        <div className="assistant-handoff-form">
          <label>
            Task for {recipient}
            <textarea
              rows={2}
              maxLength={4000}
              value={instruction}
              onChange={(event) => setInstruction(event.target.value)}
              placeholder="What should it do next?"
            />
          </label>
          <div>
            <button
              type="button"
              className="primary"
              disabled={busy || !instruction.trim()}
              onClick={() => void send()}
            >
              {busy ? "Sending…" : `Send to ${recipient}`}
            </button>
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() => setOpen(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="secondary"
          onClick={() => setOpen(true)}
        >
          Hand off to {recipient}
        </button>
      )}
      {error && (
        <span role="alert" className="error">
          {error}
        </span>
      )}
    </div>
  );
}
