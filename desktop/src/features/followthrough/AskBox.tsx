import { useCallback, useEffect, useState } from "react";
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
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
      setMode("idle");
      onChanged();
    } catch (e) {
      setError(errorText(e));
    } finally {
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
            Withdraw the ask
          </button>
        </div>
      )}
      {mode === "counter" && (
        <form
          className="ask-form"
          onSubmit={(e) => {
            e.preventDefault();
            void act(() =>
              client.replyToAsk(ask.id, {
                action: "counter",
                due_at: day ? new Date(`${day}T17:00:00`).toISOString() : null,
                message: message.trim(),
              }),
            );
          }}
        >
          <label>
            I can do it by
            <DateField
              type="date"
              value={day}
              required
              onChange={(e) => setDay(e.target.value)}
            />
          </label>
          <input
            value={message}
            maxLength={500}
            placeholder="A word about why (optional)"
            aria-label="Why"
            onChange={(e) => setMessage(e.target.value)}
          />
          <button className="secondary" disabled={busy || !day}>
            Send suggestion
          </button>
          <button
            type="button"
            className="text-button"
            onClick={() => setMode("idle")}
          >
            Cancel
          </button>
        </form>
      )}
      {mode === "decline" && (
        <form
          className="ask-form"
          onSubmit={(e) => {
            e.preventDefault();
            void act(() =>
              client.replyToAsk(ask.id, {
                action: "decline",
                message: message.trim(),
              }),
            );
          }}
        >
          <input
            value={message}
            maxLength={500}
            required
            placeholder="Why you can't — they'll see this"
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
            onClick={() => setMode("idle")}
          >
            Cancel
          </button>
        </form>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/** The ask on one task, in its panel. Nothing when there isn't one. */
export function AskBox({
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
  const load = useCallback(() => {
    client.listAsks().then(
      (lists) => {
        const ask =
          [...lists.to_me, ...lists.from_me, ...lists.recent].find(
            (a) => a.item_id === itemId,
          ) ?? null;
        setState(ask ? { ask, turn: askTurn(ask, lists) } : null);
      },
      () => setState(null),
    );
  }, [itemId]);
  useEffect(load, [load]);
  if (!state) return null;
  return (
    <AskCard
      ask={state.ask}
      turn={state.turn}
      onChanged={() => {
        load();
        onChanged();
      }}
    />
  );
}
