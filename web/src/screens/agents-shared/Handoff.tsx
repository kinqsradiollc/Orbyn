import { HttpError, type AssistantHandoff } from "@orbyn/core";
import { useEffect, useRef, useState } from "react";
import { messageOf } from "../../lib/resource";
import { client } from "../../lib/session";
import {
  Button,
  Dialog,
  ErrorNotice,
  Field,
  TextArea,
  useConfirm,
} from "../../ui/kit";
import { LANE_NAME, useOwner, useOwned, type Lane } from "./hooks";

const STATUS = {
  proposed: "Queued",
  accepted: "Working",
  completed: "Run finished",
  failed: "Needs review",
  cancelled: "Cancelled",
} as const;

/** The owner names the next task; the other runtime decides how to do it. */
function HandoffBody({
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
  const owned = useOwned();
  const confirm = useConfirm();
  const lock = useRef(false);
  const closing = useRef(false);
  const command = useRef<{
    previousId: string | null;
    body: Parameters<typeof client.requestAssistantHandoff>[0];
  } | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const [fresh, setFresh] = useState(true);
  const [open, setOpen] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [receipt, setReceipt] = useState<AssistantHandoff | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const current = receipt ?? existing;
  const other: Lane = lane === "background" ? "overnight" : "background";
  const recipient = LANE_NAME[other];

  const refresh = async () => {
    if (!owned() || lock.current || !current) return;
    lock.current = true;
    try {
      const next = await client.assistantHandoff(current.id);
      if (!owned()) return;
      if (
        next.producer_job_id !== jobId ||
        next.producer_lane !== lane ||
        next.recipient_lane !== other
      )
        throw new Error("This receipt belongs to different work.");
      setReceipt(next);
      setFresh(true);
      setError("");
    } catch (failure) {
      if (owned()) {
        setFresh(false);
        setError(messageOf(failure, "Couldn't refresh handoff."));
      }
    } finally {
      lock.current = false;
    }
  };
  useEffect(() => {
    if (!current) return;
    void refresh();
    if (["completed", "failed", "cancelled"].includes(current.status)) return;
    const timer = setInterval(() => {
      if (!document.hidden) void refresh();
    }, 10_000);
    return () => clearInterval(timer);
    // Receipt identity/status owns the polling lifecycle; each request has a lock.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id, current?.status]);

  const close = async () => {
    if (!owned() || lock.current || busy || closing.current) return;
    closing.current = true;
    try {
      if (
        instruction.trim() &&
        !(await confirm({
          title: "Close this handoff draft?",
          body: uncertain
            ? "Its save status is unknown. The exact request stays here so you can check it without sending another task."
            : "Your instruction stays here until you send it or leave this result.",
          action: "Close draft",
        }))
      )
        return;
      if (owned()) setOpen(false);
    } finally {
      closing.current = false;
    }
  };
  const matchesRequest = (
    next: AssistantHandoff,
    body: Parameters<typeof client.requestAssistantHandoff>[0],
  ) =>
    next.producer_job_id === jobId &&
    next.producer_lane === lane &&
    next.recipient_lane === other &&
    next.title === body.title &&
    next.instruction === body.instruction &&
    next.sources.some(
      (source) =>
        source.kind === "job" &&
        source.id === jobId &&
        source.revision === body.expected_producer_revision,
    );

  const checkRequest = async () => {
    const pending = command.current;
    if (!owned() || !pending || lock.current || closing.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      // Handoff POST has domain deduplication, not a durable idempotency key.
      // Failed/cancelled handoffs can be recreated, so an unknown POST is never replayed.
      const profiles = await client.assistantProfiles();
      if (!owned()) return;
      const candidate = profiles.profiles
        .find((profile) => profile.lane === lane)
        ?.outputs.find((output) => output.job_id === jobId)?.handoff;
      if (!candidate || candidate.id === pending.previousId)
        throw new Error(
          "No matching saved handoff is visible yet. Keep checking; sending another remains blocked.",
        );
      const next = await client.assistantHandoff(candidate.id);
      if (!owned()) return;
      if (!matchesRequest(next, pending.body))
        throw new Error(
          "The visible handoff doesn't match this instruction and source revision. Another request remains blocked.",
        );
      setReceipt(next);
      setFresh(true);
      setUncertain(false);
      command.current = null;
      setOpen(false);
    } catch (failure) {
      if (owned())
        setError(
          messageOf(
            failure,
            "Couldn't check the saved handoff. Your instruction is kept and another send remains blocked.",
          ),
        );
    } finally {
      lock.current = false;
      if (owned()) setBusy(false);
    }
  };

  const send = async () => {
    if (
      !owned() ||
      !instruction.trim() ||
      lock.current ||
      busy ||
      closing.current
    )
      return;
    if (command.current) {
      await checkRequest();
      return;
    }
    lock.current = true;
    setBusy(true);
    setError("");
    let dispatched = false;
    try {
      if (!command.current) {
        const source = await client.assistantHandoffSource(jobId);
        if (!owned()) return;
        if (
          source.lane !== lane ||
          source.source.kind !== "job" ||
          source.source.id !== jobId
        )
          throw new Error(
            "The producing work changed. Refresh this result before handing it off.",
          );
        command.current = {
          previousId: current?.id ?? null,
          body: {
            producer_job_id: jobId,
            expected_producer_revision: source.source.revision,
            recipient_lane: other,
            title: title.trim().slice(0, 240) || "Follow-up",
            instruction: instruction.trim(),
          },
        };
      }
      if (!owned()) return;
      const pending = command.current;
      dispatched = true;
      const next = await client.requestAssistantHandoff(pending.body);
      if (!owned()) return;
      if (!matchesRequest(next, pending.body))
        throw new Error(
          "The handoff receipt doesn't match this instruction and source revision.",
        );
      setReceipt(next);
      setFresh(true);
      setUncertain(false);
      command.current = null;
      setOpen(false);
    } catch (failure) {
      if (owned()) {
        const status = failure instanceof HttpError ? failure.statusCode : 0;
        const unknown =
          uncertain ||
          (dispatched &&
            (!status || status >= 500 || status === 408 || status === 429));
        setUncertain(unknown);
        if (!unknown) command.current = null;
        setError(
          unknown
            ? "Save status is unknown. Check this same request before sending another handoff. Your instruction is kept."
            : messageOf(
                failure,
                "Couldn't send this result. Your instruction is kept.",
              ),
        );
      }
    } finally {
      lock.current = false;
      if (owned()) setBusy(false);
    }
  };

  return (
    <div className="agents-buttons">
      {uncertain && !open && (
        <Button onClick={() => owned() && setOpen(true)}>
          Check handoff request
        </Button>
      )}
      {current && !open ? (
        <>
          <span className="small" role="status">
            {recipient}: {STATUS[current.status]}
          </span>
          {current.recipient_chat_id && onOpenChat && (
            <Button
              disabled={!fresh || busy}
              onClick={() => {
                if (owned() && fresh && current.recipient_chat_id)
                  onOpenChat(current.recipient_chat_id);
              }}
            >
              Open follow-up
            </Button>
          )}
          {current.status === "failed" && (
            <Button
              disabled={!fresh || busy || uncertain}
              onClick={() => {
                if (!owned() || !fresh) return;
                setReceipt(null);
                setOpen(true);
              }}
            >
              Try again
            </Button>
          )}
        </>
      ) : (
        <Button onClick={() => owned() && setOpen(true)}>
          {uncertain ? "Check handoff request" : `Hand off to ${recipient}`}
        </Button>
      )}
      {current && !fresh && (
        <Button disabled={busy} onClick={() => void refresh()}>
          Refresh handoff
        </Button>
      )}
      {error && !open && (
        <span className="agents-failed small" role="alert">
          {error}
        </span>
      )}
      {open && (
        <Dialog
          title={`Task for ${recipient}`}
          onClose={() => void close()}
          actions={
            <>
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => void close()}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                busy={busy}
                disabled={!instruction.trim()}
                onClick={() => void send()}
              >
                {busy
                  ? "Sending…"
                  : uncertain
                    ? "Check saved handoff"
                    : `Send to ${recipient}`}
              </Button>
            </>
          }
        >
          <Field label="What should it do next?">
            <TextArea
              rows={3}
              maxLength={4000}
              value={instruction}
              disabled={busy || uncertain}
              dir="auto"
              autoFocus
              onChange={(event) => {
                if (owned() && !uncertain && !busy)
                  setInstruction(event.target.value);
              }}
            />
          </Field>
          {error && <ErrorNotice message={error} />}
        </Dialog>
      )}
    </div>
  );
}

export function Handoff(props: Parameters<typeof HandoffBody>[0]) {
  const owner = useOwner();
  return (
    <HandoffBody key={`${owner}:${props.jobId}:${props.lane}`} {...props} />
  );
}
