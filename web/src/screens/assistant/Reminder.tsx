import {
  performReminderAction,
  type ReminderActionReceipt,
} from "@orbyn/api-client";
import { localDateKey, type ReminderNudgeCard } from "@orbyn/core";
import { useEffect, useRef, useState } from "react";
import { client } from "../../lib/session";
import { messageOf } from "../../lib/resource";
import { Button, ErrorNotice, Field, Input } from "../../ui/kit";
import { useOwned } from "../agents-shared/hooks";
import { refreshPlanner } from "../shared-task";
import { useRead } from "./state";
const LABEL = {
  done: "Mark done",
  move: "Move to day",
  book: "Book time",
  skip: "Skip",
};
export function Reminder({
  card,
  chat,
  turn,
  skipped,
}: {
  card: ReminderNudgeCard;
  chat: string;
  turn: string;
  skipped: boolean;
}) {
  const owned = useOwned(),
    lock = useRef(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [uncertain, setUncertain] = useState(false),
    [receipt, setReceipt] = useState<ReminderActionReceipt | null>(null),
    [choosing, setChoosing] = useState<"move" | "book" | null>(null),
    [day, setDay] = useState(""),
    [minutes, setMinutes] = useState("30"),
    [stopped, setStopped] = useState(false);
  const saved = useRead(() => client.reminderActionReceipt(card.id), [card.id]),
    prefs = useRead(() => client.getPlannerPrefs());
  useEffect(() => {
    if (prefs.data && !day)
      setDay(localDateKey(new Date(), prefs.data.timezone));
  }, [prefs.data]);
  useEffect(() => {
    if (saved.data !== undefined) {
      setReceipt(
        saved.data && !saved.data.undone
          ? {
              id: saved.data.id,
              message: saved.data.message,
              undo: () => client.undoReminderAction(saved.data!.id),
            }
          : null,
      );
      setUncertain(false);
    }
  }, [saved.data]);
  const act = async (action: ReminderNudgeCard["actions"][number]) => {
    if (
      !owned() ||
      lock.current ||
      saved.loading ||
      saved.error ||
      uncertain ||
      receipt
    )
      return;
    if (
      (action === "move" || action === "book") &&
      (!day ||
        (action === "book" &&
          (!Number.isInteger(Number(minutes)) ||
            Number(minutes) < 1 ||
            Number(minutes) > 1440)))
    ) {
      setError("Choose a day and a duration from 1 to 1,440 minutes.");
      return;
    }
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await performReminderAction(client, card, action, {
        day,
        minutes: Number(minutes),
        chatId: chat,
        turnId: turn,
      });
      if (!owned()) return;
      setReceipt(result);
      setChoosing(null);
      await refreshPlanner();
    } catch (failure) {
      if (owned()) {
        setUncertain(true);
        setError(
          messageOf(
            failure,
            "The action receipt is unavailable. Check it before another action.",
          ),
        );
      }
    } finally {
      lock.current = false;
      if (owned()) setBusy(false);
    }
  };
  const undo = async () => {
    if (!owned() || !receipt || lock.current || uncertain) return;
    lock.current = true;
    setBusy(true);
    try {
      await receipt.undo();
      if (!owned()) return;
      setReceipt(null);
      await saved.reload();
      await refreshPlanner();
    } catch {
      if (owned()) {
        setUncertain(true);
        setError(
          "Couldn't confirm Undo. Check the receipt before another action.",
        );
      }
    } finally {
      lock.current = false;
      if (owned()) setBusy(false);
    }
  };
  const stop = async () => {
    if (!owned() || lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      await client.stopReminderNudge(card.id);
      if (owned()) setStopped(true);
    } catch (failure) {
      if (owned())
        setError(messageOf(failure, "Couldn't stop future reminders."));
    } finally {
      lock.current = false;
      if (owned()) setBusy(false);
    }
  };
  const blocked =
    busy || saved.loading || !!saved.error || uncertain || !!receipt;
  return (
    <section className="assistant-reminder" aria-label="Reminder choices">
      {saved.loading && <p role="status">Checking saved action…</p>}
      {(error || saved.error) && (
        <ErrorNotice
          message={error || saved.error}
          onRetry={() => void saved.reload()}
        />
      )}{" "}
      {prefs.error && (
        <ErrorNotice
          message={prefs.error}
          onRetry={() => void prefs.reload()}
        />
      )}{" "}
      {receipt ? (
        <div className="agents-buttons">
          <span role="status">{receipt.message}</span>
          <Button disabled={busy || uncertain} onClick={() => void undo()}>
            Undo
          </Button>
        </div>
      ) : skipped ? (
        <p>Reminder skipped</p>
      ) : (
        <div className="agents-buttons">
          {card.actions.map((action) => (
            <Button
              key={action}
              disabled={blocked}
              onClick={() =>
                action === "move" || action === "book"
                  ? setChoosing(action)
                  : void act(action)
              }
            >
              {LABEL[action]}
            </Button>
          ))}
        </div>
      )}
      {choosing && (
        <div className="agents-stack">
          <Field label={`Day (${prefs.data?.timezone ?? "loading time zone"})`}>
            <Input
              type="date"
              value={day}
              disabled={blocked || !prefs.data}
              onChange={(e) => setDay(e.target.value)}
            />
          </Field>
          {choosing === "book" && (
            <Field label="Minutes">
              <Input
                type="number"
                min={1}
                max={1440}
                value={minutes}
                disabled={blocked}
                onChange={(e) => setMinutes(e.target.value)}
              />
            </Field>
          )}
          <div className="agents-buttons">
            <Button disabled={busy} onClick={() => setChoosing(null)}>
              Cancel
            </Button>
            <Button
              disabled={blocked || !prefs.data}
              onClick={() => void act(choosing)}
            >
              {LABEL[choosing]}
            </Button>
          </div>
        </div>
      )}
      <Button
        variant="ghost"
        disabled={busy || stopped}
        onClick={() => void stop()}
      >
        {stopped ? "Future reminders stopped" : "Stop future reminders"}
      </Button>
    </section>
  );
}
