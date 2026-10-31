import type { AssistantHandoff } from "@orbyn/core";
import { useEffect, useState } from "react";
import { client } from "../../lib/session";
import { Button, Dialog, ErrorNotice, Field, TextArea } from "../../ui/kit";
import { LANE_NAME, type Lane } from "./hooks";

const STATUS = {
  proposed: "Queued",
  accepted: "Working",
  completed: "Run finished",
  failed: "Needs review",
  cancelled: "Cancelled",
} as const;

/** The owner names the next task; the other runtime decides how to do it. */
export function Handoff({
  jobId,
  title,
  lane,
  existing,
  onOpenChat,
}: {
  jobId: string;
  title: string;
  lane: Lane;
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
  const other: Lane = lane === "background" ? "overnight" : "background";
  const recipient = LANE_NAME[other];

  useEffect(() => {
    if (
      !current ||
      ["completed", "failed", "cancelled"].includes(current.status)
    )
      return;
    const timer = setInterval(() => {
      void client
        .assistantHandoff(current.id)
        .then(setReceipt, () => setError("Couldn't refresh handoff."));
    }, 10_000);
    return () => clearInterval(timer);
  }, [current?.id, current?.status]);

  const send = async () => {
    if (!instruction.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      const source = await client.assistantHandoffSource(jobId);
      if (source.lane !== lane) throw new Error("Source lane changed");
      setReceipt(
        await client.requestAssistantHandoff({
          producer_job_id: jobId,
          expected_producer_revision: source.source.revision,
          recipient_lane: other,
          title: title.slice(0, 120) || "Follow-up",
          instruction: instruction.trim(),
        }),
      );
      setOpen(false);
    } catch {
      setError("Couldn't send this result. Refresh and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="agents-buttons">
      {current && !open ? (
        <>
          <span className="small" role="status">
            {recipient}: {STATUS[current.status]}
          </span>
          {current.recipient_chat_id && onOpenChat && (
            <Button onClick={() => onOpenChat(current.recipient_chat_id!)}>
              Open follow-up
            </Button>
          )}
          {current.status === "failed" && (
            <Button
              onClick={() => {
                setReceipt(null);
                setOpen(true);
              }}
            >
              Try again
            </Button>
          )}
        </>
      ) : (
        <Button onClick={() => setOpen(true)}>Hand off to {recipient}</Button>
      )}
      {error && !open && (
        <span className="agents-failed small" role="alert">
          {error}
        </span>
      )}
      {open && (
        <Dialog
          title={`Task for ${recipient}`}
          onClose={() => {
            if (!busy) setOpen(false);
          }}
          actions={
            <>
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                busy={busy}
                disabled={!instruction.trim()}
                onClick={() => void send()}
              >
                {busy ? "Sending…" : `Send to ${recipient}`}
              </Button>
            </>
          }
        >
          <Field label="What should it do next?">
            <TextArea
              rows={3}
              maxLength={4000}
              value={instruction}
              disabled={busy}
              dir="auto"
              autoFocus
              onChange={(event) => setInstruction(event.target.value)}
            />
          </Field>
          {error && <ErrorNotice message={error} />}
        </Dialog>
      )}
    </div>
  );
}
