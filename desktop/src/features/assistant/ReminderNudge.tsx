import { useEffect, useState } from "react";
import { localDateKey, type ReminderNudgeCard } from "@orbyn/core";
import {
  performReminderAction,
  type ReminderActionReceipt,
} from "@orbyn/api-client";
import { client } from "../../lib/api";
import { errorText } from "../../lib/errors";
import { MoreHorizontal } from "lucide-react";
import { Popover } from "../../components/Popover";
import "./reminder-nudge.css";
import { DateField } from "../../components/DateField";

/** Explicit work choices and Undo on a saved personal reminder. */
export function ReminderNudge({
  card,
  busy,
  chatId,
  turnId,
  skipped,
}: {
  card: ReminderNudgeCard;
  busy: boolean;
  chatId: string | null;
  turnId: string;
  skipped: boolean;
}) {
  const [menu, setMenu] = useState<DOMRect | null>(null);
  const [pending, setPending] = useState(false);
  const [stopped, setStopped] = useState(false);
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState<ReminderActionReceipt | null>(null);
  const [receiptLoading, setReceiptLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    setReceiptLoading(true);
    void client
      .reminderActionReceipt(card.id)
      .then(
        (saved) => {
          if (!cancelled)
            setReceipt(
              saved && !saved.undone
                ? {
                    id: saved.id,
                    message: saved.message,
                    undo: () => client.undoReminderAction(saved.id),
                  }
                : null,
            );
        },
        (error) => {
          if (!cancelled)
            setError(
              error instanceof Error
                ? error.message
                : "Could not restore this reminder action.",
            );
        },
      )
      .finally(() => {
        if (!cancelled) setReceiptLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [card.id]);
  const [choosing, setChoosing] = useState<"move" | "book" | null>(null);
  const [day, setDay] = useState("");
  const [minutes, setMinutes] = useState(30);
  useEffect(() => {
    void client.getPlannerPrefs().then(
      (prefs) => setDay(localDateKey(new Date(), prefs.timezone)),
      (e) => setError(errorText(e)),
    );
  }, []);
  const run = async (work: () => Promise<void>) => {
    setPending(true);
    setError("");
    try {
      await work();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setPending(false);
    }
  };
  const act = (action: ReminderNudgeCard["actions"][number]) =>
    void run(async () => {
      setReceipt(
        await performReminderAction(client, card, action, {
          day,
          minutes,
          ...(chatId ? { chatId } : {}),
          turnId,
        }),
      );
      setChoosing(null);
    });
  return (
    <div className="ai-nudge">
      {receipt ? (
        <div className="button-row start">
          <span role="status">{receipt.message}</span>
          <button
            type="button"
            className="secondary"
            disabled={busy || pending || receiptLoading}
            onClick={() =>
              void run(async () => {
                await receipt.undo();
                setReceipt(null);
              })
            }
          >
            Undo
          </button>
        </div>
      ) : (
        <div className="button-row start">
          {card.actions.map((action) => (
            <button
              type="button"
              className="secondary"
              key={action}
              disabled={busy || pending || receiptLoading}
              onClick={() =>
                action === "move" || action === "book"
                  ? setChoosing(action)
                  : act(action)
              }
            >
              {
                { done: "Done", move: "Move", skip: "Skip", book: "Book time" }[
                  action
                ]
              }
            </button>
          ))}
        </div>
      )}
      {choosing && (
        <div className="agents-identity-form">
          <label htmlFor={`nudge-day-${card.id}`}>
            {choosing === "move" ? "New deadline day" : "Day to book time"}
          </label>
          <DateField
            id={`nudge-day-${card.id}`}
            type="date"
            value={day}
            onChange={(event) => setDay(event.target.value)}
          />
          {choosing === "book" && card.entity_kind !== "habit" && (
            <label>
              Minutes
              <input
                type="number"
                min={5}
                max={1440}
                value={minutes}
                onChange={(event) => setMinutes(Number(event.target.value))}
              />
            </label>
          )}
          <div className="button-row start">
            <button
              type="button"
              className="secondary"
              disabled={busy || pending || !day}
              onClick={() => act(choosing)}
            >
              {choosing === "move" ? "Move deadline" : "Book time"}
            </button>
            <button
              type="button"
              className="secondary"
              disabled={pending}
              onClick={() => setChoosing(null)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      <div className="button-row start">
        {stopped ? (
          <span role="status">Reminders stopped for this thing.</span>
        ) : (
          <button
            type="button"
            className="icon-button"
            aria-label="Reminder options"
            disabled={busy || pending || receiptLoading}
            onClick={(event) =>
              setMenu(event.currentTarget.getBoundingClientRect())
            }
          >
            <MoreHorizontal size={16} aria-hidden="true" />
          </button>
        )}
      </div>
      {menu && (
        <Popover
          anchor={menu}
          label="Reminder options"
          onClose={() => setMenu(null)}
        >
          <button
            type="button"
            className="secondary"
            disabled={busy || pending || stopped}
            onClick={() => {
              setMenu(null);
              void run(async () => {
                await client.stopReminderNudge(card.id);
                setStopped(true);
              });
            }}
          >
            Stop reminders for this thing
          </button>
        </Popover>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
