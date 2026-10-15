import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useModalFocus } from "../../hooks/useModalFocus";
import { MessageCircleQuestion } from "lucide-react";
import { dateLabel, type TaskAsk } from "@orbyn/core";
import { client } from "../../lib/api";
import { errorText } from "../../lib/planning";
import { DateField } from "../../components/DateField";

const when = (iso: string | null) => (iso ? dateLabel(iso) : "no set date");
const dayOf = (iso: string | null) => (iso ? iso.slice(0, 10) : "");

/** Whose turn an ask is, from where you stand. */
export function askTurn(
  ask: TaskAsk,
  lists: { to_me: TaskAsk[]; from_me: TaskAsk[] },
) {
  if (lists.to_me.some((a) => a.id === ask.id)) return "mine";
  if (lists.from_me.some((a) => a.id === ask.id)) return "theirs";
  return "settled";
}

/**
 * One ask, answered in place. Asked of you: take it on, suggest another
 * date, or say you can't. A suggestion to you: agree or keep your date.
 * Waiting on someone else: says so, with a way to withdraw.
 */
export function AskCard({
  ask,
  turn,
  onChanged,
}: {
  ask: TaskAsk;
  turn: "mine" | "theirs" | "settled";
  onChanged: () => void;
}) {
  const [mode, setMode] = useState<"idle" | "counter" | "decline">("idle");
  const [day, setDay] = useState(dayOf(ask.due_at));
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const mutation = useRef(false);
  useEffect(() => {
    setMode("idle");
  }, [ask.status]);
  const act = async (fn: () => Promise<unknown>) => {
    if (mutation.current || turn === "settled") return;
    mutation.current = true;
    setBusy(true);
    setError("");
    try {
      await fn();
      setMode("idle");
      onChanged();
    } catch (e) {
      setError(errorText(e));
    } finally {
      mutation.current = false;
      setBusy(false);
    }
  };
  const countered = ask.status === "countered";
  const iAmAsked = turn === "mine" ? !countered : countered;

  let text: string;
  if (ask.status === "accepted")
    text = `${ask.asked_of_name} took this on, by ${when(ask.due_at)}.`;
  else if (ask.status === "declined")
    text = `${ask.asked_of_name} couldn't take this on${ask.reply ? `: “${ask.reply}”` : "."}`;
  else if (ask.status === "withdrawn") text = "This ask was withdrawn.";
  else if (turn === "mine" && !countered)
    text = `${ask.asked_by_name} asked you to do this by ${when(ask.due_at)}.`;
  else if (turn === "mine" && countered)
    text = `${ask.asked_of_name} suggests ${when(ask.counter_due_at)} instead of ${when(ask.due_at)}.`;
  else if (countered)
    text = `You suggested ${when(ask.counter_due_at)}. Waiting for ${ask.asked_by_name}.`;
  else text = `Waiting for ${ask.asked_of_name} to answer.`;

  return (
    <div className={"ask-card is-" + turn}>
      <p className="ask-text">
        <MessageCircleQuestion size={15} aria-hidden="true" />
        <span>
          {text}
          {(ask.reply || ask.message) && ask.status !== "declined" && (
            <small>“{countered ? ask.reply : ask.message || ask.reply}”</small>
          )}
        </span>
      </p>
      {turn === "mine" && mode === "idle" && (
        <div className="ask-actions">
          {iAmAsked ? (
            <>
              <button
                className="primary"
                disabled={busy}
                onClick={() =>
                  void act(() =>
                    client.replyToAsk(ask.id, { action: "accept" }),
                  )
                }
              >
                Take it on
              </button>
              <button
                className="secondary"
                disabled={busy}
                onClick={() => setMode("counter")}
              >
                Suggest another date
              </button>
              <button
                className="text-button"
                disabled={busy}
                onClick={() => setMode("decline")}
              >
                Can't do it
              </button>
            </>
          ) : (
            <>
              <button
                className="primary"
                disabled={busy}
                onClick={() =>
                  void act(() => client.settleAsk(ask.id, "agree"))
                }
              >
                Agree to {when(ask.counter_due_at)}
              </button>
              <button
                className="secondary"
                disabled={busy}
                onClick={() => void act(() => client.settleAsk(ask.id, "keep"))}
              >
                Keep {when(ask.due_at)}
              </button>
            </>
          )}
        </div>
      )}
      {turn === "theirs" && !countered && (
        <div className="ask-actions">
          <button
            className="text-button"
            disabled={busy}
            onClick={() => void act(() => client.settleAsk(ask.id, "withdraw"))}
          >
            Withdraw request
          </button>
        </div>
      )}
      {mode === "counter" && (
        <AskDialog
          title="Suggest a date"
          busy={busy}
          error={error}
          onClose={() => setMode("idle")}
        >
          <form
            className="ask-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (!day) return;
              void act(() =>
                client.replyToAsk(ask.id, {
                  action: "counter",
                  due_at: day
                    ? new Date(`${day}T17:00:00`).toISOString()
                    : null,
                  message: message.trim(),
                }),
              );
            }}
          >
            <label>
              Suggested date
              <DateField
                type="date"
                disabled={busy}
                value={day}
                required
                onChange={(e) => setDay(e.target.value)}
              />
            </label>
            <input
              disabled={busy}
              value={message}
              maxLength={500}
              placeholder="Reason (optional)"
              aria-label="Why"
              onChange={(e) => setMessage(e.target.value)}
            />
            <button className="secondary" disabled={busy || !day}>
              Send suggestion
            </button>
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={() => setMode("idle")}
            >
              Cancel
            </button>
          </form>
        </AskDialog>
      )}
      {mode === "decline" && (
        <AskDialog
          title="Decline request"
          busy={busy}
          error={error}
          onClose={() => setMode("idle")}
        >
          <form
            className="ask-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (!message.trim()) return;
              void act(() =>
                client.replyToAsk(ask.id, {
                  action: "decline",
                  message: message.trim(),
                }),
              );
            }}
          >
            <input
              disabled={busy}
              value={message}
              maxLength={500}
              required
              placeholder="Reason · shared with requester"
              aria-label="Why you can't"
              onChange={(e) => setMessage(e.target.value)}
              autoFocus
            />
            <button className="secondary" disabled={busy || !message.trim()}>
              Send
            </button>
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={() => setMode("idle")}
            >
              Cancel
            </button>
          </form>
        </AskDialog>
      )}
      {error && mode === "idle" && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function AskBox(props: Parameters<typeof AskBoxBody>[0]) {
  return <AskBoxBody key={props.itemId} {...props} />;
}

/** The ask on one task, in its panel. Nothing when there isn't one. */
function AskBoxBody({
  itemId,
  onChanged,
}: {
  itemId: string;
  onChanged: () => void;
}) {
  const [state, setState] = useState<{
    ask: TaskAsk;
    turn: "mine" | "theirs" | "settled";
  } | null>(null);
  const [error, setError] = useState("");
  const request = useRef(0);
  const load = useCallback(async () => {
    const version = ++request.current;
    try {
      const lists = await client.listAsks();
      if (version !== request.current) return;
      const ask = [...lists.to_me, ...lists.from_me, ...lists.recent].find(
        (row) => row.item_id === itemId,
      );
      setState(ask ? { ask, turn: askTurn(ask, lists) } : null);
      setError("");
    } catch (reason) {
      if (version === request.current) setError(errorText(reason));
    }
  }, [itemId]);
  useEffect(() => {
    setState(null);
    void load();
    return () => {
      request.current += 1;
    };
  }, [load]);
  if (error)
    return (
      <p className="error" role="alert">
        {error}
        <button
          className="text-button"
          onClick={() => {
            void load();
          }}
        >
          Retry
        </button>
      </p>
    );
  if (!state) return null;
  return (
    <AskCard
      key={state.ask.id}
      ask={state.ask}
      turn={state.turn}
      onChanged={() => {
        load();
        onChanged();
      }}
    />
  );
}

function AskDialog({
  title,
  busy,
  error,
  onClose,
  children,
}: {
  title: string;
  busy: boolean;
  error: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const focus = useModalFocus(onClose, busy);
  useEffect(() => {
    const node = focus.ref.current as HTMLDialogElement;
    node.showModal();
    return () => node.close();
  }, []);
  return createPortal(
    <dialog
      ref={(node) => {
        focus.ref.current = node;
      }}
      data-modal-focus={focus.id}
      className="modal modal-small ask-dialog"
      aria-labelledby="ask-dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <h2 id="ask-dialog-title">{title}</h2>
      {children}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </dialog>,
    document.body,
  );
}
