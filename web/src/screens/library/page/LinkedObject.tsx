import {
  addDays,
  itemBody,
  localDateKey,
  viewDueChange,
  type LinkCard,
  type ObjectRef,
} from "@orbyn/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { messageOf } from "../../../lib/resource";
import { client } from "../../../lib/session";
import { useLibraryOwner } from "../lifetime";
import {
  Button,
  Dialog,
  ErrorNotice,
  Input,
  Loading,
  Pill,
} from "../../../ui/kit";
import type { PageLinks } from "./context";
import "./linked-object.css";

type Target = ObjectRef & { kind: LinkCard["kind"] };

function dateLabel(value: string, zone: string, allDay = false) {
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const date = new Date(dateOnly ? `${value}T12:00:00Z` : value);
  if (!Number.isFinite(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    timeZone: dateOnly ? "UTC" : zone,
    year: "numeric",
    month: "short",
    day: "numeric",
    ...(!allDay && !dateOnly
      ? ({ hour: "numeric", minute: "2-digit" } as const)
      : {}),
  });
}

function minutes(value: number) {
  const hours = Math.floor(value / 60);
  const rest = value % 60;
  return [hours ? `${hours}h` : "", rest || !hours ? `${rest}m` : ""]
    .filter(Boolean)
    .join(" ");
}

/** Details are explicit so touch, keyboard and pointer users share one path. */
export function LinkedObject({
  target,
  links,
  onClose,
}: {
  target: Target;
  links: PageLinks;
  onClose: () => void;
}) {
  const linkCallbacks = useRef(links);
  linkCallbacks.current = links;
  const [card, setCard] = useState<LinkCard | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reading, setReading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [needsRead, setNeedsRead] = useState(false);
  const [editing, setEditing] = useState(false);
  const [day, setDay] = useState("");
  const mutation = useRef(false);
  const request = useRef(0);
  const current = useLibraryOwner();
  const load = useCallback(async () => {
    if (!current() || mutation.current) return;
    const round = ++request.current;
    setReading(true);
    setError("");
    try {
      const next = await client.linkCard(target);
      if (!current() || round !== request.current) return;
      setCard(next);
      setNeedsRead(false);
      linkCallbacks.current.onChanged?.();
    } catch (failure) {
      if (current() && round === request.current) {
        setNeedsRead(true);
        setError(messageOf(failure, "Couldn't load these details."));
      }
    } finally {
      if (current() && round === request.current) setReading(false);
    }
  }, [current, target.kind, target.id, target.block]);
  useEffect(() => {
    void load();
    return () => {
      request.current++;
    };
  }, [load]);

  // A failed response may follow a committed write. Read the current receipt
  // before offering another mutation; never blindly replay an uncertain action.
  const run = async (work: () => Promise<void>, said: string) => {
    if (
      mutation.current ||
      needsRead ||
      reading ||
      !current() ||
      card?.state !== "ok"
    )
      return;
    mutation.current = true;
    request.current++;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await work();
      if (!current()) return;
      setNotice(said);
      links.onChanged?.();
      // Release the mutation lock only after the confirmed write, then refresh.
      mutation.current = false;
      setNeedsRead(true);
      await load();
    } catch (failure) {
      if (!current()) return;
      setError(messageOf(failure, "Couldn't confirm this change."));
      setNeedsRead(true);
    } finally {
      mutation.current = false;
      if (current()) setBusy(false);
    }
  };
  const zone =
    card?.time_zone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const disabled = busy || reading || needsRead;
  const editable = card?.state === "ok" && card.can_write;
  const move = (value: string | null) => {
    if (!editable || card.kind !== "task") return;
    void run(
      async () => {
        const item = await client.getItem(card.id);
        if (!current()) return;
        if (item.kind !== "task")
          throw new Error(
            "This item is now an event. Open it to change its dates.",
          );
        const change = viewDueChange(item, value, zone);
        if (!change.ok) throw new Error(change.reason);
        await client.updateItem(item.id, {
          ...itemBody(item),
          ...change.change,
        });
        if (current()) setEditing(false);
      },
      value ? "Deadline updated." : "Deadline cleared.",
    );
  };
  const openDoc = (id: string, block?: string) => {
    if (!current() || busy) return;
    links.onOpen(`orbyn://doc/${id}${block ? `#${block}` : ""}`);
    onClose();
  };
  const open = () => {
    if (!card || card.state !== "ok" || busy || !current()) return;
    if (card.kind === "doc")
      openDoc(card.id, card.section == null ? undefined : target.block);
    else {
      links.onOpen(
        `orbyn://${card.kind === "event" ? "task" : card.kind}/${card.id}`,
      );
      onClose();
    }
  };
  const meetingNote = () => {
    if (card?.kind !== "event" || card.state !== "ok") return;
    if (card.note_id) {
      openDoc(card.note_id);
      return;
    }
    // The endpoint creates the caller's note after checking event visibility;
    // it does not require permission to edit the event itself.
    void run(async () => {
      const made = await client.itemNote(card.id);
      if (!current()) return;
      links.onChanged?.();
      links.onOpen(`orbyn://doc/${made.id}`);
      onClose();
    }, "Meeting note ready.");
  };
  const today = localDateKey(new Date(), zone);
  return createPortal(
    <div onClick={(event) => event.stopPropagation()}>
      <Dialog
        title="Linked object"
        onClose={() => !busy && onClose()}
        actions={
          <>
            <Button
              variant="ghost"
              disabled={busy || reading}
              onClick={() => void load()}
            >
              Refresh details
            </Button>
            {card?.state === "ok" && (
              <Button variant="primary" disabled={busy} onClick={open}>
                Open {card.kind === "doc" ? "page" : card.kind}
              </Button>
            )}
          </>
        }
      >
        <div className="linked-object">
          {!card && reading && <Loading label="Loading linked object" />}
          {error && (
            <ErrorNotice
              message={error}
              onRetry={busy ? undefined : () => void load()}
            />
          )}
          {needsRead && (
            <p className="small muted" role="status">
              Refresh details to check what was saved before trying another
              change. Your deadline choice stays here.
            </p>
          )}
          {notice && (
            <p className="small" role="status">
              {notice}
            </p>
          )}
          {card && card.state !== "ok" && (
            <p>
              {card.state === "deleted"
                ? "This page is in Trash. Restore it from its link or the Library."
                : "This object is unavailable. It may have been removed or your access may have changed."}
            </p>
          )}
          {card?.state === "ok" && (
            <>
              <div className="linked-object-heading">
                <strong dir="auto">{card.title || "Untitled"}</strong>
                <Pill>
                  {card.kind_label ||
                    (card.kind === "doc" ? "Page" : card.kind)}
                </Pill>
              </div>
              {!card.can_write && card.kind === "task" && (
                <p className="small muted">
                  You can view this task. Changes require edit access.
                </p>
              )}
              <dl className="linked-object-facts">
                {card.project && (
                  <>
                    <dt>Project</dt>
                    <dd>
                      <Button
                        variant="ghost"
                        disabled={busy}
                        onClick={() => {
                          if (!current()) return;
                          links.onOpen(`orbyn://project/${card.project!.id}`);
                          onClose();
                        }}
                      >
                        {card.project.name}
                      </Button>
                    </dd>
                  </>
                )}
                {card.kind === "task" && (
                  <>
                    <dt>Status</dt>
                    <dd>{card.done ? "Done" : "To do"}</dd>
                    <dt>Deadline</dt>
                    <dd>
                      {card.due_at
                        ? dateLabel(card.due_at, zone, card.all_day)
                        : "No deadline"}
                    </dd>
                    <dt>Estimate</dt>
                    <dd>
                      {card.estimate_minutes != null
                        ? minutes(card.estimate_minutes)
                        : "No estimate"}
                    </dd>
                    <dt>Planned</dt>
                    <dd>
                      {card.planned
                        ? `${dateLabel(card.planned.start_at, zone)} – ${dateLabel(card.planned.end_at, zone)}`
                        : "No planned session"}
                    </dd>
                  </>
                )}
                {card.kind === "event" && (
                  <>
                    <dt>Starts</dt>
                    <dd>
                      {card.start_at
                        ? dateLabel(card.start_at, zone, card.all_day)
                        : "No start time"}
                    </dd>
                    {card.end_at && (
                      <>
                        <dt>Ends</dt>
                        <dd>{dateLabel(card.end_at, zone, card.all_day)}</dd>
                      </>
                    )}
                    {card.all_day && (
                      <>
                        <dt>Duration</dt>
                        <dd>All day</dd>
                      </>
                    )}
                  </>
                )}
                {card.kind === "doc" && (
                  <>
                    <dt>Folder</dt>
                    <dd>{card.folder || "Unfiled"}</dd>
                    {target.block && (
                      <>
                        <dt>Linked section</dt>
                        <dd dir="auto">
                          {card.section == null
                            ? "This line has been removed."
                            : card.section}
                        </dd>
                      </>
                    )}
                  </>
                )}
                {card.kind === "project" && (
                  <>
                    <dt>Progress</dt>
                    <dd>
                      {card.progress
                        ? `${card.progress.done} of ${card.progress.total} tasks done`
                        : "Progress unavailable"}
                    </dd>
                    <dt>Next task</dt>
                    <dd>
                      {card.next ? (
                        <>
                          <Button
                            variant="ghost"
                            disabled={busy}
                            onClick={() => {
                              if (!current()) return;
                              links.onOpen(`orbyn://task/${card.next!.id}`);
                              onClose();
                            }}
                          >
                            {card.next.title}
                          </Button>
                          {card.next.due_at && (
                            <span className="small muted">
                              Due {dateLabel(card.next.due_at, zone)}
                            </span>
                          )}
                        </>
                      ) : (
                        "No upcoming task"
                      )}
                    </dd>
                    <dt>Latest date</dt>
                    <dd>
                      {card.deadline
                        ? dateLabel(card.deadline, zone, true)
                        : "No date set"}
                    </dd>
                  </>
                )}
              </dl>
              {card.kind === "project" &&
                card.progress &&
                card.progress.total > 0 && (
                  <progress
                    aria-label="Project task completion"
                    max={card.progress.total}
                    value={card.progress.done}
                  />
                )}
              {card.moved_from && (
                <p className="small muted">
                  The original page was merged into this page. Open goes to its
                  current location.
                </p>
              )}
              {card.preview && (
                <blockquote className="linked-object-preview" dir="auto">
                  {card.preview}
                </blockquote>
              )}
              {card.kind === "task" && editable && (
                <div className="linked-object-actions">
                  <Button
                    disabled={disabled}
                    onClick={() =>
                      void run(
                        async () => {
                          await client.postItemUpdate(card.id, {
                            status: card.done ? "todo" : "done",
                          });
                        },
                        card.done ? "Task marked to do." : "Task marked done.",
                      )
                    }
                  >
                    {card.done ? "Mark to do" : "Mark done"}
                  </Button>
                  <Button
                    disabled={disabled || card.repeats}
                    aria-expanded={editing}
                    onClick={() => {
                      setEditing((was) => !was);
                      if (!editing && !day)
                        setDay(
                          card.due_at
                            ? localDateKey(new Date(card.due_at), zone)
                            : today,
                        );
                    }}
                  >
                    Change deadline
                  </Button>
                  {card.due_at && (
                    <Button
                      disabled={disabled || card.repeats}
                      onClick={() => move(null)}
                    >
                      Clear deadline
                    </Button>
                  )}
                </div>
              )}
              {card.kind === "task" && card.repeats && (
                <p className="small muted">
                  Change repeating dates from the task so you can choose which
                  occurrences to update.
                </p>
              )}
              {card.kind === "task" && editable && editing && (
                <form
                  className="linked-object-deadline"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (day) move(day);
                  }}
                >
                  <label className="field">
                    New deadline
                    <Input
                      type="date"
                      value={day}
                      disabled={disabled || card.repeats}
                      onChange={(event) => setDay(event.currentTarget.value)}
                      required
                    />
                  </label>
                  <div className="linked-object-actions">
                    <Button
                      type="submit"
                      variant="primary"
                      disabled={disabled || !day || card.repeats}
                    >
                      Save deadline
                    </Button>
                    <Button
                      disabled={disabled || card.repeats}
                      onClick={() => {
                        setDay(today);
                        move(today);
                      }}
                    >
                      Today
                    </Button>
                    <Button
                      disabled={disabled || card.repeats}
                      onClick={() => {
                        const next = addDays(today, 1);
                        setDay(next);
                        move(next);
                      }}
                    >
                      Tomorrow
                    </Button>
                    <Button
                      disabled={disabled || card.repeats}
                      onClick={() => {
                        const next = addDays(today, 7);
                        setDay(next);
                        move(next);
                      }}
                    >
                      In a week
                    </Button>
                  </div>
                  <p className="small muted">
                    Keeps the task's time in {zone}.
                  </p>
                </form>
              )}
              {card.kind === "event" && (
                <Button disabled={disabled} onClick={meetingNote}>
                  {card.note_id ? "Open meeting note" : "Create meeting note"}
                </Button>
              )}
            </>
          )}
        </div>
      </Dialog>
    </div>,
    document.body,
  );
}
