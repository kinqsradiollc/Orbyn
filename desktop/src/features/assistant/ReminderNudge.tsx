import { useEffect, useRef, useState } from "react";
import { localDateKey, type ReminderNudgeCard } from "@orbyn/core";
import {
  performReminderAction,
  type ReminderActionReceipt,
} from "@orbyn/api-client";
import { createPortal } from "react-dom";
import type { ReactNode } from "react";
import { useModalFocus } from "../../hooks/useModalFocus";
import { client } from "../../lib/api";
import { errorText } from "../../lib/errors";
import { MoreHorizontal } from "lucide-react";
import { Popover } from "../../components/Popover";
import "./reminder-nudge.css";
import { DateField } from "../../components/DateField";

/** Explicit work choices and Undo on a saved personal reminder. */
export function ReminderNudge(props: Parameters<typeof ReminderNudgeBody>[0]) {
  return <ReminderNudgeBody key={props.card.id} {...props} />;
}

function ReminderNudgeBody({
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
  const mutation = useRef(false);
  const [receiptFailed, setReceiptFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const [pending, setPending] = useState(false);
  const [stopped, setStopped] = useState(false);
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState<ReminderActionReceipt | null>(null);
  const [receiptLoading, setReceiptLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    setReceiptLoading(true);
    setReceiptFailed(false);
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
          if (!cancelled) {
            setReceiptFailed(true);
            setError(
              error instanceof Error
                ? error.message
                : "Could not restore this reminder action.",
            );
          }
        },
      )
      .finally(() => {
        if (!cancelled) setReceiptLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [card.id, retry]);
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
    if (busy || mutation.current || receiptLoading || receiptFailed) return;
    mutation.current = true;
    setPending(true);
    setError("");
    try {
      await work();
    } catch (e) {
      setError(errorText(e));
    } finally {
      mutation.current = false;
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
            disabled={busy || pending || receiptLoading || receiptFailed}
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
              disabled={busy || pending || receiptLoading || receiptFailed}
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
        <NudgeDialog
          title={choosing === "move" ? "Move deadline" : "Book time"}
          busy={pending}
          onClose={() => {
            if (!mutation.current) setChoosing(null);
          }}
        >
          <div className="agents-identity-form">
            <label htmlFor={`nudge-day-${card.id}`}>
              {choosing === "move" ? "New deadline day" : "Day to book time"}
            </label>
            <DateField
              disabled={pending || busy}
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
                  disabled={pending || busy}
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
                disabled={
                  busy ||
                  pending ||
                  receiptFailed ||
                  !day ||
                  (choosing === "book" &&
                    card.entity_kind !== "habit" &&
                    (!Number.isFinite(minutes) ||
                      minutes < 5 ||
                      minutes > 1440))
                }
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
          {error && <p role="alert">{error}</p>}
        </NudgeDialog>
      )}
      <div className="button-row start">
        {stopped ? (
          <span role="status">Reminders stopped for this item.</span>
        ) : (
          <button
            type="button"
            className="icon-button"
            aria-label="Reminder options"
            disabled={busy || pending || receiptLoading || receiptFailed}
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
            Stop reminders for this item
          </button>
        </Popover>
      )}
      {error && !choosing && <p role="alert">{error}</p>}
      {receiptFailed && (
        <button
          className="text-button"
          onClick={() => setRetry((value) => value + 1)}
        >
          Retry action status
        </button>
      )}
    </div>
  );
}

function NudgeDialog({
  title,
  busy,
  onClose,
  children,
}: {
  title: string;
  busy: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const focus = useModalFocus(onClose, busy);
  useEffect(() => {
    const dialog = focus.ref.current as HTMLDialogElement;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return createPortal(
    <dialog
      ref={(node) => {
        focus.ref.current = node;
      }}
      data-modal-focus={focus.id}
      className="modal modal-small nudge-dialog"
      aria-labelledby="nudge-dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <h2 id="nudge-dialog-title">{title}</h2>
      {children}
    </dialog>,
    document.body,
  );
}
