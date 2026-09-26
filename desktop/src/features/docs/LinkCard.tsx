import { useEffect, useState, type ReactNode } from "react";
import {
  CalendarDays,
  CheckCircle2,
  Circle,
  ExternalLink,
  FileText,
  FolderKanban,
  NotebookPen,
} from "lucide-react";
import {
  addDays,
  itemBody,
  localDateKey,
  viewDueChange,
  type LinkCard,
  type ObjectRef,
} from "@orbyn/core";
import { Popover } from "../../components/Popover";
import { DateField } from "../../components/DateField";
import { client } from "../../lib/api";
import { deviceTimeZone } from "../../lib/planning";

/**
 * A link's hover card (LNK-07): what a link points to, with the few things
 * worth doing without leaving the page — tick a task, give it a new
 * deadline, open it. Opened by resting the pointer on a link pill.
 */

const when = (iso: string, allDay = false) => {
  const d = new Date(iso);
  const day = d.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
  return allDay
    ? day
    : `${day} ${d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
};

const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });

/** "2h", "45m", "1h 30m". */
const duration = (minutes: number) => {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return [h ? `${h}h` : "", m ? `${m}m` : ""].filter(Boolean).join(" ");
};

function Row({ children }: { children: ReactNode }) {
  return <li className="link-card-row">{children}</li>;
}

export function LinkCardPopover({
  target,
  anchor,
  onOpen,
  onOpenDoc,
  onChanged,
  onClose,
  onHover,
  report,
}: {
  target: ObjectRef;
  anchor: DOMRect;
  onOpen: () => void;
  /** Open a page (an event's meeting note). */
  onOpenDoc: (id: string) => void;
  /** Something was ticked or moved: the page's pills read afresh. */
  onChanged: () => void;
  onClose: () => void;
  /** The pointer is on the card (true) or has left it (false). */
  onHover: (inside: boolean) => void;
  report: (e: unknown) => void;
}) {
  const [card, setCard] = useState<LinkCard | null>(null);
  const [picking, setPicking] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const kind =
    target.kind === "doc" ||
    target.kind === "task" ||
    target.kind === "event" ||
    target.kind === "project"
      ? target.kind
      : null;
  const load = () => {
    if (!kind) return;
    client
      .linkCard({ kind, id: target.id, block: target.block })
      .then(setCard, report);
  };
  useEffect(load, [target.kind, target.id, target.block]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!kind) return null;

  const run = (work: () => Promise<unknown>, said?: string) => {
    setBusy(true);
    setNote("");
    void work()
      .then(() => {
        if (said) setNote(said);
        load();
        onChanged();
      })
      .catch((e) => {
        const message = e instanceof Error ? e.message : "";
        if (message) setNote(message);
        else report(e);
      })
      .finally(() => setBusy(false));
  };

  const tick = () =>
    card &&
    run(() =>
      client.postItemUpdate(card.id, { status: card.done ? "todo" : "done" }),
    );

  /** Your account's time zone, as views use (the device's until the card is here). */
  const zone = card?.time_zone ?? deviceTimeZone();
  /** A new deadline, the way views move one: the time kept, repeats refused. */
  const moveTo = (day: string | null) =>
    card &&
    run(
      async () => {
        const item = await client.getItem(card.id);
        const moved = viewDueChange(item, day, zone);
        if (!moved.ok) throw new Error(moved.reason);
        await client.updateItem(card.id, {
          ...itemBody(item),
          ...moved.change,
        });
        setPicking(false);
      },
      day ? "Deadline moved." : "Deadline cleared.",
    );

  const today = localDateKey(new Date(), zone);
  const openNote = () =>
    card &&
    run(async () => {
      const doc = card.note_id
        ? { id: card.note_id }
        : await client.itemNote(card.id);
      onOpenDoc(doc.id);
      onClose();
    });

  const gone = card && card.state !== "ok";
  return (
    <Popover
      anchor={anchor}
      label="Link"
      onClose={onClose}
      takeFocus={false}
      width={300}
    >
      <div
        className="link-card"
        onMouseEnter={() => onHover(true)}
        onMouseLeave={() => onHover(false)}
      >
        {!card ? (
          <p className="link-card-loading">Loading…</p>
        ) : gone ? (
          <p className="link-card-gone">
            {card.state === "deleted"
              ? `“${card.title}” is in Trash.`
              : "This isn't there, or isn't yours to open."}
          </p>
        ) : (
          <>
            <div className="link-card-head">
              {card.kind === "task" ? (
                <button
                  type="button"
                  className="link-pill-tick"
                  role="checkbox"
                  aria-checked={!!card.done}
                  aria-label={card.done ? "Mark not done" : "Mark done"}
                  disabled={!card.can_write || busy}
                  onClick={tick}
                >
                  {card.done ? (
                    <CheckCircle2 size={16} aria-hidden="true" />
                  ) : (
                    <Circle size={16} aria-hidden="true" />
                  )}
                </button>
              ) : card.kind === "event" ? (
                <CalendarDays size={16} aria-hidden="true" />
              ) : card.kind === "project" ? (
                <FolderKanban size={16} aria-hidden="true" />
              ) : (
                <FileText size={16} aria-hidden="true" />
              )}
              <strong className={card.done ? "is-done" : undefined}>
                {card.title}
              </strong>
            </div>
            <ul className="link-card-rows">
              {card.kind === "task" && (
                <>
                  <Row>
                    {card.due_at
                      ? `Due ${when(card.due_at, card.all_day)}`
                      : "No deadline"}
                  </Row>
                  {card.estimate_minutes ? (
                    <Row>Estimate {duration(card.estimate_minutes)}</Row>
                  ) : null}
                  {card.project && <Row>{card.project.name}</Row>}
                  {card.planned && (
                    <Row>
                      Planned {when(card.planned.start_at)}–
                      {clock(card.planned.end_at)}
                    </Row>
                  )}
                </>
              )}
              {card.kind === "event" && (
                <>
                  {card.start_at && (
                    <Row>
                      {when(card.start_at, card.all_day)}
                      {card.end_at && !card.all_day
                        ? `–${clock(card.end_at)}`
                        : ""}
                    </Row>
                  )}
                  {card.project && <Row>{card.project.name}</Row>}
                </>
              )}
              {card.kind === "doc" && (
                <>
                  {card.moved_from && (
                    <Row>That page was merged into this one.</Row>
                  )}
                  <Row>
                    {[card.kind_label, card.folder, card.project?.name]
                      .filter(Boolean)
                      .join(" · ")}
                  </Row>
                  {card.section !== undefined && (
                    <Row>
                      {card.section === null
                        ? "The line this pointed at has gone."
                        : `At “${card.section}”`}
                    </Row>
                  )}
                  {card.preview && (
                    <li className="link-card-preview">{card.preview}</li>
                  )}
                </>
              )}
              {card.kind === "project" && card.progress && (
                <>
                  <Row>
                    {card.progress.done} of {card.progress.total} tasks done
                  </Row>
                  <li className="link-card-bar" aria-hidden="true">
                    <span
                      style={{
                        width: `${card.progress.total ? (card.progress.done / card.progress.total) * 100 : 0}%`,
                      }}
                    />
                  </li>
                  {card.next && (
                    <Row>
                      Next: {card.next.title}
                      {card.next.due_at ? ` · ${when(card.next.due_at)}` : ""}
                    </Row>
                  )}
                  {card.deadline && (
                    <Row>Latest date {when(card.deadline, true)}</Row>
                  )}
                </>
              )}
            </ul>
            {picking && card.kind === "task" && (
              <div className="link-card-move">
                <button
                  type="button"
                  className="link-card-action"
                  onClick={() => moveTo(today)}
                >
                  Today
                </button>
                <button
                  type="button"
                  className="link-card-action"
                  onClick={() => moveTo(addDays(today, 1))}
                >
                  Tomorrow
                </button>
                <button
                  type="button"
                  className="link-card-action"
                  onClick={() => moveTo(addDays(today, 7))}
                >
                  Next week
                </button>
                <DateField
                  value={
                    card.due_at ? localDateKey(new Date(card.due_at), zone) : ""
                  }
                  onChange={(e) => e.target.value && moveTo(e.target.value)}
                  aria-label="New deadline"
                />
              </div>
            )}
            {note && <p className="link-card-note">{note}</p>}
            <div className="link-card-actions">
              {card.kind === "task" && card.can_write && (
                <>
                  <button
                    type="button"
                    className="link-card-action"
                    disabled={busy}
                    onClick={tick}
                  >
                    {card.done ? "Untick" : "Tick"}
                  </button>
                  <button
                    type="button"
                    className={"link-card-action" + (picking ? " is-on" : "")}
                    aria-expanded={picking}
                    disabled={busy || card.repeats}
                    title={
                      card.repeats
                        ? "A repeating task's dates change from the task itself."
                        : undefined
                    }
                    onClick={() => setPicking((v) => !v)}
                  >
                    Reschedule
                  </button>
                </>
              )}
              {card.kind === "event" && (
                <button
                  type="button"
                  className="link-card-action"
                  disabled={busy}
                  onClick={openNote}
                >
                  <NotebookPen size={13} aria-hidden="true" />
                  {card.note_id ? "Meeting note" : "Start a meeting note"}
                </button>
              )}
              <button
                type="button"
                className="link-card-action is-open"
                onClick={() => {
                  // A merged page opens the page it went into.
                  if (card.moved_from) onOpenDoc(card.id);
                  else onOpen();
                  onClose();
                }}
              >
                <ExternalLink size={13} aria-hidden="true" /> Open
              </button>
            </div>
          </>
        )}
      </div>
    </Popover>
  );
}
