import { Select } from "../../components/Select";
import { Popover } from "../../components/Popover";
import { useConfirm } from "../../components/Confirm";
import { hasHigherDialog } from "../../lib/dialogLayers";
import { createPortal } from "react-dom";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  Ban,
  CalendarClock,
  Check,
  CornerLeftUp,
  Hourglass,
  Link2,
  ListTree,
  Crosshair,
  Eye,
  MapPin,
  NotebookPen,
  Video,
  ListChecks,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Sparkles,
  Plus,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { StarButton } from "../../components/StarButton";
import {
  activityOriginLabel,
  dateLabel,
  dueLine,
  freshItem,
  isClosed,
  pageAboutTask,
  projectPlace,
  sameDay,
  seriesNoteFor,
  statusLabels,
  STATUSES,
  type EventNoteRef,
  type HttpError,
  type Item,
  type ItemDetail,
  type ItemContext,
  type Project,
  type Doc,
  type ItemLink,
  type ItemStep,
  type Status,
} from "@orbyn/core";
import { client } from "../../lib/api";
import { AskBox } from "../followthrough/AskBox";
import { ProofSection } from "../followthrough/ProofSection";
import { MeetingOutcome } from "../followthrough/MeetingOutcome";
import "../followthrough/followthrough.css";
import { celebrate } from "../../lib/celebrate";
import { progressOf, timeAgo } from "../../lib/tasks";
import { ProgressBar } from "../../components/ProgressBar";
import { StatusPill } from "../../components/StatusPill";
import { ItemFacts } from "../../components/ItemFacts";
import { minutesLabel } from "../../lib/planning";
import { SessionsSection } from "./SessionsSection";
import { Linkify, hostOf } from "../../components/Linkify";
import "./task.css";
import { errorText } from "../../lib/errors";
import { ShareLinkButton } from "../../components/ShareButton";
import { useToast } from "../../components/Toast";
import { copyLink } from "../../lib/links";
import { LinkedHere } from "../docs/DocLinks";

type Props = {
  /** The task as listed; the panel loads its checklist and timeline. */
  item: Item;
  /** Team name for team items (falls back to `item.team_name`). */
  teamName?: string | null;
  /** False for viewers of a team item: everything is read-only. */
  canWrite: boolean;
  /** True while another dialog (the item editor) sits on top. */
  suspended?: boolean;
  onClose: () => void;
  onEdit: (item: Item) => void;
  /** Opens focus mode for this task. */
  onFocus?: (item: Item) => void;
  /** Refresh the planner after a change. */
  onChanged: () => Promise<void>;
  /** Everything in the planner: the parent and the subtasks. */
  items?: Item[];
  /** Shows another item in this panel (a parent or a subtask). */
  onOpenItem?: (item: Item) => void;
  /** Planner error handler (signs out on 401). */
  onError: (e: unknown) => void;
  /**
   * Opens (or starts) the meeting note for an event: the class it was
   * opened on for a repeating one, or with `series`, the whole series'.
   */
  onOpenNote?: (item: Item, series?: boolean) => void;
  /** The class of a repeating event the panel was opened on (its first start). */
  occurrence?: string | null;
  /** Plan time for the task in the calendar, before its deadline. */
  onFindTime?: (item: Item) => void;
  /** Show a session's day on the calendar. */
  onShowOnCalendar?: (at: string) => void;
  onOpenProject?: (projectId: string) => void;
  onAskTask?: (item: Item) => void;
  onOpenDoc?: (doc: Doc, blockId?: string | null) => void;
};

const SNAPS = [0, 25, 50, 75, 100];

/** "Sep 20, 9:00 AM → 11:00 AM", or across days "Sep 20, 9:00 AM → Sep 22, 5:00 PM". */
function timeRange(start: string | null, end: string | null) {
  if (!start) return "No date";
  if (!end) return dateLabel(start);
  const endLabel = sameDay(new Date(start), new Date(end))
    ? new Date(end).toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit",
      })
    : dateLabel(end);
  return `${dateLabel(start)} → ${endLabel}`;
}

/**
 * Task detail: a right-side drawer on wide screens and a full-screen sheet on
 * narrow ones. Status, progress, checklist and the updates timeline. Every
 * change returns the fresh `ItemDetail`, then the planner list refreshes.
 * Render it keyed by the item id so switching tasks starts fresh.
 */
export function TaskDetail({
  item,
  teamName,
  canWrite,
  suspended,
  onClose,
  onEdit,
  onFocus,
  onChanged,
  onError,
  onOpenNote,
  occurrence,
  items,
  onOpenItem,
  onFindTime,
  onShowOnCalendar,
  onOpenProject,
  onAskTask,
  onOpenDoc,
}: Props) {
  const { ask, tell } = useConfirm();
  const toast = useToast();
  // Opened: it leads the quick switcher's recent list, on every device.
  useEffect(() => {
    void client.recordRecent("task", item.id).catch(() => {});
  }, [item.id]);
  const [detail, setDetail] = useState<ItemDetail | null>(null);
  const [context, setContext] = useState<ItemContext | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [placementRetry, setPlacementRetry] = useState<{
    project_id: string | null;
    stage_id?: string | null;
    version: number;
  } | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [newStep, setNewStep] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const renameCancelled = useRef(false);
  const [stepOptions, setStepOptions] = useState<{
    id: string;
    anchor: DOMRect;
  } | null>(null);
  const [body, setBody] = useState("");
  const [nextStatus, setNextStatus] = useState<Status | "">("");
  const [draft, setDraft] = useState<number | null>(null);
  const [optionsAt, setOptionsAt] = useState<DOMRect | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const panel = useRef<HTMLElement>(null);
  const mounted = useRef(true);
  const writing = useRef(false);
  const detailRead = useRef(0);
  const [readError, setReadError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      detailRead.current += 1;
    };
  }, []);
  const closeButton = useRef<HTMLButtonElement>(null);
  const latest = useRef({ onError });
  latest.current = { onError };

  // Reload when the task changes elsewhere: an edit bumps the version; a
  // teammate's step or update changes the counts on the next list refresh.
  const reloadKey = [
    item.id,
    item.version,
    item.status,
    item.steps_done,
    item.steps_total,
    item.updates_count,
    item.last_update_at,
  ].join("|");
  useEffect(() => {
    let alive = true;
    const request = ++detailRead.current;
    setReadError("");
    client.getItem(item.id).then(
      (d) => {
        if (alive && request === detailRead.current) setDetail(d);
      },
      (e) => {
        if (!alive || request !== detailRead.current) return;
        setReadError(errorText(e));
        if ((e as HttpError).status === 401) latest.current.onError(e);
      },
    );
    return () => {
      alive = false;
    };
  }, [reloadKey, item.id, retry]);

  // Opened on one class of a repeating event: that class opens its own
  // note, so a note the series keeps for every class is pointed to here.
  const [seriesNote, setSeriesNote] = useState<EventNoteRef | null>(null);
  const noteKind = item.kind === "event" && !!item.rrule && !!onOpenNote;
  useEffect(() => {
    if (!noteKind || !occurrence) return;
    let alive = true;
    client.eventNotes([item.id]).then(
      (notes) =>
        alive &&
        setSeriesNote(
          seriesNoteFor(notes, {
            item_id: item.id,
            occurrence,
            team_id: item.team_id,
          }) ?? null,
        ),
      () => alive && setSeriesNote(null),
    );
    return () => {
      alive = false;
    };
  }, [item.id, item.team_id, noteKind, occurrence]);
  const [contextRetry, setContextRetry] = useState(0);
  const [contextLoading, setContextLoading] = useState(true);
  const [contextError, setContextError] = useState("");
  const contextRead = useRef(0);
  useEffect(() => {
    if (item.kind !== "task") return;
    let alive = true;
    const request = ++contextRead.current;
    setContextLoading(true);
    setContextError("");
    void Promise.allSettled([
      client.itemContext(item.id),
      canWrite ? client.listProjects() : Promise.resolve([] as Project[]),
    ]).then(([links, catalog]) => {
      if (!alive || request !== contextRead.current) return;
      if (links.status === "fulfilled") setContext(links.value);
      if (catalog.status === "fulfilled")
        setProjects(
          catalog.value.filter(
            (project) => (project.team_id ?? null) === (item.team_id ?? null),
          ),
        );
      const failures = [links, catalog].filter(
        (result) => result.status === "rejected",
      );
      if (failures.length) {
        setContextError("Couldn't load project and pages. Try again.");
        for (const failure of failures)
          if (
            failure.status === "rejected" &&
            (failure.reason as HttpError).status === 401
          )
            latest.current.onError(failure.reason);
      }
      setContextLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [item.id, item.kind, item.team_id, item.version, canWrite, contextRetry]);

  const moveToProject = async (input: {
    project_id: string | null;
    stage_id?: string | null;
  }) => {
    contextRead.current += 1;
    try {
      const version = (detail ?? item).version;
      const confirmed = await client.setItemProject(item.id, {
        ...input,
        version,
      });
      if (!mounted.current) return;
      setPlacementRetry(null);
      setDetail((was) =>
        was
          ? {
              ...was,
              ...confirmed.item,
              attendees: was.attendees,
              links: was.links,
            }
          : was,
      );
    } catch (error) {
      if (mounted.current && (error as HttpError).status === 409) {
        setPlacementRetry({ ...input, version: (detail ?? item).version });
        setRetry((value) => value + 1);
      }
      throw error;
    } finally {
      if (mounted.current) setContextRetry((n) => n + 1);
    }
  };

  /** A dialog in the Sessions section is open: it handles Escape. */
  const [scheduling, setScheduling] = useState(false);
  const [blockPending, setBlockPending] = useState(false);
  // Subtasks: a new one goes in the same place (team and list) as this task.
  const [newSubtask, setNewSubtask] = useState("");
  const addSubtask = (e: FormEvent) => {
    e.preventDefault();
    const title = newSubtask.trim();
    if (!title) return;
    void blockAction(async () => {
      await client.createItem({
        ...freshItem(),
        title,
        kind: "task",
        parent_id: item.id,
        team_id: item.team_id ?? null,
        list_id: item.list_id ?? null,
      });
      if (mounted.current) setNewSubtask("");
    });
  };
  /** Add a subtask, then reload the list and the planner. */
  const blockAction = async (fn: () => Promise<unknown>) => {
    if (writing.current || !canWrite) return false;
    writing.current = true;
    detailRead.current += 1;
    setBlockPending(true);
    setError("");
    try {
      await fn();
      if (!mounted.current) return true;
      try {
        await onChanged();
      } catch (e) {
        if (mounted.current)
          setError(`Saved. Couldn't refresh the planner. ${errorText(e)}`);
      }
      return true;
    } catch (e) {
      if (mounted.current) {
        setError(errorText(e));
        if ((e as HttpError).status === 401) onError(e);
      }
      return false;
    } finally {
      writing.current = false;
      if (mounted.current) setBlockPending(false);
    }
  };

  // Focus the panel on open; give focus back to whatever opened it.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    closeButton.current?.focus();
    return () => {
      clearTimeout(timer.current);
      queueMicrotask(() => {
        if (
          opener?.isConnected &&
          !opener.closest("[inert], [hidden]") &&
          opener.getClientRects().length
        )
          opener.focus({ preventScroll: true });
        else
          document
            .querySelector<HTMLElement>(".command-trigger:not([disabled])")
            ?.focus();
      });
    };
  }, []);

  useEffect(() => {
    const backgrounds = Array.from(
      document.querySelectorAll<HTMLElement>(".shell, .sidebar"),
    );
    const previous = backgrounds.map((node) => ({ node, inert: node.inert }));
    previous.forEach(({ node }) => {
      node.inert = true;
    });
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      previous.forEach(({ node, inert }) => {
        node.inert = inert;
      });
      document.body.style.overflow = overflow;
    };
  }, []);

  // Escape closes; Tab stays inside the panel.
  useEffect(() => {
    // The schedule dialog handles its own keys while it's open.
    if (suspended || scheduling) return;
    const onKey = (e: KeyboardEvent) => {
      if (
        e.defaultPrevented ||
        hasHigherDialog(panel.current) ||
        panel.current?.closest("[inert]")
      )
        return;
      if (e.key === "Escape") {
        if (renaming || writing.current) return;
        e.preventDefault();
        onClose();
      }
      if (e.key !== "Tab" || !panel.current) return;
      const focusable = panel.current.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), a[href], summary, select:not(:disabled), [tabindex]:not([tabindex="-1"])',
      );
      const visible = Array.from(focusable).filter(
        (node) =>
          node.getClientRects().length && !node.closest("[hidden], [inert]"),
      );
      const first = visible[0];
      const last = visible.at(-1);
      if (!first || !last) return;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [suspended, scheduling, renaming, onClose]);

  const current: Item = detail ?? item;
  const parent = current.parent_id
    ? items?.find((i) => i.id === current.parent_id)
    : undefined;
  const children = (items ?? [])
    .filter((i) => i.parent_id === current.id)
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  /** Levels above this task: a tree has three levels at most. */
  let depth = 0;
  for (let up = parent; up && depth < 3; depth++) {
    const id = up.parent_id;
    up = id ? items?.find((i) => i.id === id) : undefined;
  }
  const canAddSubtask =
    canWrite &&
    current.kind === "task" &&
    depth < 2 &&
    !isClosed(current.status);
  const steps = (detail?.steps ?? [])
    .slice()
    .sort((a, b) => a.position - b.position);
  const updates = detail?.updates ?? [];
  const stepsDone = detail
    ? steps.filter((s) => s.done).length
    : (item.steps_done ?? 0);
  const stepsTotal = detail ? steps.length : (item.steps_total ?? 0);
  const progress = draft ?? progressOf(current);
  const team = current.team_id ? (teamName ?? current.team_name) : null;

  /** Run a change, keep the fresh detail, then refresh the planner. */
  const run = async (fn: () => Promise<ItemDetail>) => {
    if (writing.current || !canWrite || !detail || readError) return false;
    writing.current = true;
    const request = ++detailRead.current;
    setPending(true);
    setError("");
    try {
      const before = (detail ?? item).status;
      const next = await fn();
      if (!mounted.current) return true;
      setDetail(next);
      if (next.status === "done" && before !== "done") celebrate();
      try {
        await onChanged();
      } catch (e) {
        if (mounted.current)
          setError(`Saved. Couldn't refresh the planner. ${errorText(e)}`);
      }
      return true;
    } catch (e) {
      if (!mounted.current) return false;
      setError(errorText(e));
      if ((e as HttpError).status === 401) onError(e);
      if ((e as HttpError).status === 409)
        void client.getItem(item.id).then(
          (next) => {
            if (mounted.current && request === detailRead.current)
              setDetail(next);
          },
          () => undefined,
        );
      return false;
    } finally {
      writing.current = false;
      if (mounted.current) setPending(false);
    }
  };

  const setStatus = (status: Status) => {
    if (status === current.status) return;
    void run(() => client.postItemUpdate(item.id, { status }));
  };

  const commitProgress = (value: number) => {
    clearTimeout(timer.current);
    if (value === progressOf(current)) {
      setDraft(null);
      return;
    }
    setDraft(value);
    void run(() => client.postItemUpdate(item.id, { progress: value })).then(
      (saved) => {
        if (saved && mounted.current) setDraft(null);
      },
    );
  };

  const slide = (raw: number) => {
    // Snap to 0/25/50/75/100 when close to a mark.
    const near = Math.round(raw / 25) * 25;
    const value = Math.abs(near - raw) <= 4 ? near : raw;
    setDraft(value);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => commitProgress(value), 500);
  };

  const addStep = (e: FormEvent) => {
    e.preventDefault();
    const title = newStep.trim();
    if (!title) return;
    void run(() => client.addStep(item.id, { title })).then(
      (ok) => ok && setNewStep(""),
    );
  };

  const toggleStep = (s: ItemStep) =>
    void run(() => client.updateStep(item.id, s.id, { done: !s.done }));

  const renameStep = (step: ItemStep, title: string) => {
    if (renameCancelled.current) {
      renameCancelled.current = false;
      return;
    }
    const next = title.trim();
    if (!next || next === step.title) {
      setRenaming(null);
      return;
    }
    void run(() => client.updateStep(item.id, step.id, { title: next })).then(
      (saved) => {
        if (saved && mounted.current) setRenaming(null);
      },
    );
  };

  const deleteStep = (s: ItemStep) =>
    void run(() => client.deleteStep(item.id, s.id));

  const postUpdate = (e: FormEvent) => {
    e.preventDefault();
    const text = body.trim();
    if (!text && !nextStatus) return;
    void run(() =>
      client.postItemUpdate(item.id, {
        ...(text ? { body: text } : {}),
        ...(nextStatus ? { status: nextStatus } : {}),
      }),
    ).then((ok) => {
      if (!ok) return;
      setBody("");
      setNextStatus("");
    });
  };

  const chosenStep = stepOptions
    ? steps.find((step) => step.id === stepOptions.id)
    : undefined;
  const locked = !canWrite || pending || blockPending || !detail || !!readError;

  return createPortal(
    <div
      className="drawer-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !writing.current && !scheduling)
          onClose();
      }}
    >
      <aside
        ref={panel}
        className="task-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-drawer-title"
        aria-busy={pending || blockPending}
      >
        <header className="drawer-head">
          <div className="drawer-kicker">
            <span>{current.kind === "event" ? "Event" : "Task"}</span>
            {team && (
              <span className="team-badge" title={"Shared with " + team}>
                <Users size={11} />
                {team}
              </span>
            )}
            <button
              className="icon-button drawer-share"
              aria-label="Copy link"
              title="Copy link"
              onClick={() =>
                void copyLink({ kind: "task", id: current.id }).then((ok) =>
                  toast({
                    text: ok ? "Link copied" : "Couldn't copy the link",
                  }),
                )
              }
            >
              <Link2 size={15} />
            </button>
            <StarButton
              kind="task"
              id={current.id}
              name={current.title}
              className="icon-button drawer-share"
            />
            <ShareLinkButton
              className="drawer-share"
              target={{ kind: "task", id: current.id }}
              title={current.title}
              onError={(e) => setError(errorText(e))}
            />
            {canWrite &&
              current.kind === "task" &&
              !isClosed(current.status) && (
                <button
                  className="icon-button drawer-share"
                  aria-label="Task options"
                  aria-expanded={!!optionsAt}
                  disabled={locked}
                  onClick={(e) =>
                    setOptionsAt(e.currentTarget.getBoundingClientRect())
                  }
                >
                  <MoreHorizontal size={18} />
                </button>
              )}
            <button
              ref={closeButton}
              className="icon-button drawer-close"
              aria-label="Close task panel"
              disabled={pending || blockPending}
              onClick={onClose}
            >
              <X size={20} />
            </button>
          </div>
          {parent && (
            <button
              className="link-button drawer-parent"
              onClick={() => onOpenItem?.(parent)}
            >
              <CornerLeftUp size={13} aria-hidden="true" /> {parent.title}
            </button>
          )}
          <h2 id="task-drawer-title">{current.title}</h2>
        </header>

        <div className="drawer-body">
          {readError && (
            <div className="error" role="alert">
              {readError}
              <button
                type="button"
                className="text-button"
                disabled={pending || blockPending}
                onClick={() => setRetry((n) => n + 1)}
              >
                Retry task
              </button>
            </div>
          )}
          {current.kind === "task" && onAskTask && (
            <button className="text-button" onClick={() => onAskTask(current)}>
              <Sparkles size={14} aria-hidden="true" /> Ask about this task
            </button>
          )}
          <div className="drawer-facts">
            <span>
              <CalendarClock size={14} aria-hidden="true" />
              {current.kind === "task" && current.due_at
                ? // "Due" is the deadline: an all-day task is due by the end of
                  // its (last) day, one with an end time when it ends.
                  dueLine(current)
                : timeRange(current.due_at, current.end_at)}
            </span>
            <span className={"priority " + current.priority}>
              {current.priority} priority
            </span>
            {current.kind === "task" &&
              !isClosed(current.status) &&
              current.remaining_minutes != null && (
                <span className="drawer-fact">
                  <Hourglass size={14} aria-hidden="true" />
                  {minutesLabel(current.remaining_minutes)} left
                </span>
              )}
            {current.location && (
              <span className="drawer-fact">
                <MapPin size={14} aria-hidden="true" />
                {current.location}
              </span>
            )}
            {current.meeting_url && (
              <a
                className="drawer-fact link-button"
                href={current.meeting_url}
                target="_blank"
                rel="noreferrer"
              >
                <Video size={14} aria-hidden="true" /> Meeting link
              </a>
            )}
            {current.kind === "event" && onOpenNote && (
              <button
                className="drawer-fact link-button"
                onClick={() => onOpenNote(current)}
              >
                <NotebookPen size={14} aria-hidden="true" /> Meeting note
              </button>
            )}
            {current.kind === "event" &&
              onOpenNote &&
              occurrence &&
              seriesNote && (
                <button
                  className="drawer-fact link-button"
                  title="The note for every time of this event"
                  onClick={() => onOpenNote(current, true)}
                >
                  <NotebookPen size={14} aria-hidden="true" /> Series note: “
                  {seriesNote.title || "Untitled"}”
                </button>
              )}
          </div>
          <ItemFacts item={current} className="drawer-planning" />
          {current.kind === "task" && (
            <details className="drawer-section task-connections">
              <summary>Project and pages</summary>
              {contextLoading && (
                <p className="drawer-hint" role="status">
                  Loading connections…
                </p>
              )}
              {contextError && (
                <p className="error" role="alert">
                  {contextError}
                  <button
                    type="button"
                    className="text-button"
                    disabled={pending || blockPending}
                    onClick={() => setContextRetry((n) => n + 1)}
                  >
                    Retry connections
                  </button>
                </p>
              )}
              {context?.project && onOpenProject && (
                <button
                  className="link-button"
                  onClick={() => onOpenProject(context.project!.id)}
                >
                  {projectPlace(context.project)}
                </button>
              )}
              {canWrite && projects.length > 0 && (
                <div className="task-context-picker">
                  <Select
                    value={current.project_id ?? ""}
                    aria-label="File task in project"
                    disabled={locked || contextLoading || !!contextError}
                    onChange={(e) =>
                      void blockAction(() =>
                        moveToProject({ project_id: e.target.value || null }),
                      )
                    }
                  >
                    <option value="">No project</option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </Select>
                  {!!context?.project && (
                    <Select
                      value={current.stage_id ?? ""}
                      aria-label="Project stage"
                      disabled={locked || contextLoading || !!contextError}
                      onChange={(e) =>
                        void blockAction(() =>
                          moveToProject({
                            project_id: context.project!.id,
                            stage_id: e.target.value || null,
                          }),
                        )
                      }
                    >
                      <option value="">No stage</option>
                      {projects
                        .find((p) => p.id === context.project?.id)
                        ?.stages.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                    </Select>
                  )}
                </div>
              )}
              {placementRetry && (
                <div role="status">
                  <p>
                    Task changed. Review its current placement before retrying
                    your saved choice:{" "}
                    {projects.find((p) => p.id === placementRetry.project_id)
                      ?.name ?? "No project"}
                    {placementRetry.stage_id !== undefined &&
                      ` / ${projects.flatMap((p) => p.stages).find((stage) => stage.id === placementRetry.stage_id)?.name ?? "No stage"}`}
                    .
                  </p>
                  <button
                    type="button"
                    disabled={
                      locked ||
                      contextLoading ||
                      current.version <= placementRetry.version
                    }
                    onClick={() =>
                      void blockAction(() => moveToProject(placementRetry))
                    }
                  >
                    Retry saved move
                  </button>
                  <button type="button" onClick={() => setPlacementRetry(null)}>
                    Dismiss
                  </button>
                </div>
              )}
              {context?.came_from && onOpenDoc && (
                <div className="task-context-link">
                  <span>Came from </span>
                  <button
                    className="link-button"
                    onClick={() =>
                      void client.getDoc(context.came_from!.doc_id).then(
                        (doc) => {
                          if (mounted.current)
                            onOpenDoc(doc, context.came_from!.block_id);
                        },
                        (error) => {
                          if (mounted.current) onError(error);
                        },
                      )
                    }
                  >
                    {context.came_from.title}
                  </button>
                  {context.came_from.quote && (
                    <small>“{context.came_from.quote}”</small>
                  )}
                </div>
              )}
              {!!context?.pages.length && onOpenDoc && (
                <div className="task-context-link">
                  <span>Pages about this task</span>
                  {context.pages.map((p) => (
                    <button
                      key={p.id}
                      className="link-button"
                      onClick={() =>
                        void client.getDoc(p.id).then(
                          (doc) => {
                            if (mounted.current) onOpenDoc(doc, p.block_id);
                          },
                          (error) => {
                            if (mounted.current) onError(error);
                          },
                        )
                      }
                    >
                      {p.title}
                    </button>
                  ))}
                </div>
              )}
              {canWrite && onOpenDoc && (
                <button
                  className="link-button"
                  disabled={locked}
                  onClick={() =>
                    void blockAction(async () => {
                      const doc = await client.createDoc(
                        pageAboutTask(current),
                      );
                      if (mounted.current) onOpenDoc(doc);
                    })
                  }
                >
                  New page about this task
                </button>
              )}
            </details>
          )}
          {canWrite ? (
            <div
              className="status-picker"
              role="radiogroup"
              aria-label="Status"
            >
              {STATUSES.map((s) => (
                <button
                  key={s}
                  role="radio"
                  aria-checked={current.status === s}
                  className={`tone-${s} ${current.status === s ? "active" : ""}`}
                  disabled={locked}
                  onClick={() => setStatus(s)}
                >
                  <i aria-hidden="true" />
                  {statusLabels[s]}
                </button>
              ))}
            </div>
          ) : (
            <div className="drawer-readonly">
              <StatusPill status={current.status} />
              <p className="view-only-note">
                <Eye size={14} /> View only — you&apos;re a viewer
                {team ? ` in ${team}` : ""}.
              </p>
            </div>
          )}
          {error && (
            <div className="error" role="alert">
              {error}
            </div>
          )}

          {current.kind === "task" && current.team_id && (
            <AskBox itemId={current.id} onChanged={() => void onChanged()} />
          )}

          {current.kind === "task" && (
            <SessionsSection
              item={current}
              canWrite={canWrite}
              reloadKey={reloadKey}
              onFindTime={onFindTime}
              onShowOnCalendar={onShowOnCalendar}
              onDialogChange={setScheduling}
              onChanged={onChanged}
              onError={onError}
            />
          )}

          <section className="drawer-section" aria-labelledby="progress-title">
            <div className="drawer-section-head">
              <h3 id="progress-title">Progress</h3>
              <span className="drawer-count">
                {current.status === "done" ? "Complete" : `${progress}%`}
              </span>
            </div>
            <ProgressBar
              size="lg"
              value={progress}
              status={current.status}
              label={`Progress on ${current.title}`}
              hideValue
            />
            {stepsTotal > 0 ? (
              <p className="drawer-hint">
                Progress follows the checklist — {stepsDone} of {stepsTotal}{" "}
                steps done.
              </p>
            ) : canWrite ? (
              <div className="progress-control">
                <label htmlFor="progress-range" className="sr-only">
                  Set progress
                </label>
                <input
                  id="progress-range"
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  list="progress-snaps"
                  value={progress}
                  disabled={locked || current.status === "done"}
                  aria-valuetext={`${progress}%`}
                  onChange={(e) => slide(Number(e.target.value))}
                />
                <datalist id="progress-snaps">
                  {SNAPS.map((v) => (
                    <option key={v} value={v} />
                  ))}
                </datalist>
                <div className="progress-snaps">
                  {SNAPS.map((v) => (
                    <button
                      key={v}
                      type="button"
                      className={progress === v ? "active" : ""}
                      disabled={locked || current.status === "done"}
                      onClick={() => commitProgress(v)}
                    >
                      {v}%
                    </button>
                  ))}
                </div>
                {current.status === "done" && (
                  <p className="drawer-hint">
                    Reopen the task to change its progress.
                  </p>
                )}
              </div>
            ) : null}
          </section>

          {current.notes && (
            <section className="drawer-section">
              <h3>Notes</h3>
              <p className="drawer-notes">
                <Linkify text={current.notes} />
              </p>
            </section>
          )}

          {(detail?.links ?? []).length > 0 && (
            <section className="drawer-section" aria-labelledby="links-title">
              <h3 id="links-title">
                <Link2 size={16} aria-hidden="true" /> Links
              </h3>
              <ul className="item-links">
                {((detail?.links ?? []) as ItemLink[]).map((l) => (
                  <li key={l.id}>
                    <a href={l.url} target="_blank" rel="noopener noreferrer">
                      {l.title || l.url}
                    </a>
                    {l.title && <small>{hostOf(l.url)}</small>}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* The pages that link here, and the one this task came from. */}
          <LinkedHere
            kind={current.kind === "event" ? "event" : "task"}
            id={current.id}
            report={onError}
            compact
          />

          {current.kind === "task" && (
            <ProofSection itemId={current.id} canWrite={canWrite} />
          )}

          {current.kind === "event" &&
            (!!current.team_id || !!current.attendees?.length) && (
              <MeetingOutcome item={current} canWrite={canWrite} />
            )}

          {current.kind === "task" &&
            (children.length > 0 || canAddSubtask) && (
              <section
                className="drawer-section"
                aria-labelledby="subtasks-title"
              >
                <div className="drawer-section-head">
                  <h3 id="subtasks-title">
                    <ListTree size={16} aria-hidden="true" /> Subtasks
                  </h3>
                  {children.length > 0 && (
                    <span className="drawer-count">
                      {children.filter((c) => c.status === "done").length} of{" "}
                      {children.filter((c) => c.status !== "cancelled").length}{" "}
                      done
                    </span>
                  )}
                </div>
                {children.length > 0 && (
                  <ul className="subtask-list">
                    {children.map((c) => (
                      <li key={c.id}>
                        <button
                          className="subtask-main"
                          onClick={() => onOpenItem?.(c)}
                        >
                          <span className="subtask-title">{c.title}</span>
                          <small>
                            {progressOf(c)}%
                            {c.estimate_minutes
                              ? ` · ${minutesLabel(c.estimate_minutes)}`
                              : ""}
                            {c.remaining_minutes != null && !isClosed(c.status)
                              ? ` · ${minutesLabel(c.remaining_minutes)} left`
                              : ""}
                          </small>
                        </button>
                        <StatusPill status={c.status} />
                      </li>
                    ))}
                  </ul>
                )}
                {canAddSubtask && (
                  <form className="step-add" onSubmit={addSubtask}>
                    <label htmlFor="subtask-title" className="sr-only">
                      New subtask
                    </label>
                    <input
                      id="subtask-title"
                      maxLength={200}
                      placeholder="Add a subtask…"
                      value={newSubtask}
                      disabled={pending || blockPending}
                      onChange={(e) => setNewSubtask(e.target.value)}
                    />
                    <button
                      className="secondary"
                      disabled={blockPending || !newSubtask.trim()}
                    >
                      <Plus size={14} /> Add subtask
                    </button>
                  </form>
                )}
                {canWrite && current.kind === "task" && depth >= 2 && (
                  <p className="drawer-hint">
                    Subtasks go three levels deep at most.
                  </p>
                )}
              </section>
            )}

          <section className="drawer-section" aria-labelledby="steps-title">
            <div className="drawer-section-head">
              <h3 id="steps-title">
                <ListChecks size={16} aria-hidden="true" /> Checklist
              </h3>
              {stepsTotal > 0 && (
                <span className="drawer-count">
                  {stepsDone} of {stepsTotal} done
                </span>
              )}
            </div>
            {readError ? null : detail === null ? (
              <p className="drawer-hint">Loading checklist…</p>
            ) : steps.length ? (
              <ul className="step-list">
                {steps.map((s) => (
                  <li key={s.id} className={"step " + (s.done ? "done" : "")}>
                    <button
                      role="checkbox"
                      aria-checked={s.done}
                      aria-label={s.title}
                      className={"check " + (s.done ? "checked can-pop" : "")}
                      disabled={locked}
                      onClick={() => toggleStep(s)}
                    >
                      {s.done && <Check size={13} />}
                    </button>
                    {renaming === s.id ? (
                      <input
                        className="step-rename"
                        aria-label={`Rename step ${s.title}`}
                        autoFocus
                        maxLength={200}
                        defaultValue={s.title}
                        onBlur={(e) => renameStep(s, e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            renameStep(s, e.currentTarget.value);
                          }
                          if (e.key === "Escape") {
                            e.preventDefault();
                            e.stopPropagation();
                            renameCancelled.current = true;
                            setRenaming(null);
                          }
                        }}
                      />
                    ) : (
                      <span className="step-title">{s.title}</span>
                    )}
                    {canWrite && renaming !== s.id && (
                      <button
                        type="button"
                        className="icon-button step-actions"
                        aria-label={`Options for ${s.title}`}
                        aria-haspopup="dialog"
                        disabled={locked}
                        onClick={(event) =>
                          setStepOptions({
                            id: s.id,
                            anchor: event.currentTarget.getBoundingClientRect(),
                          })
                        }
                      >
                        <MoreHorizontal size={16} />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="drawer-hint">
                {canWrite ? "No steps yet." : "No checklist for this task."}
              </p>
            )}
            {canWrite && (
              <form className="step-add" onSubmit={addStep}>
                <input
                  aria-label="New step"
                  placeholder="Add a step…"
                  maxLength={200}
                  value={newStep}
                  disabled={locked}
                  onChange={(e) => setNewStep(e.target.value)}
                />
                <button
                  className="secondary"
                  disabled={locked || !newStep.trim()}
                >
                  <Plus size={15} /> Add
                </button>
              </form>
            )}
          </section>

          <section className="drawer-section" aria-labelledby="updates-title">
            <div className="drawer-section-head">
              <h3 id="updates-title">
                <MessageSquare size={16} aria-hidden="true" /> Updates
              </h3>
              {updates.length > 0 && (
                <span className="drawer-count">{updates.length}</span>
              )}
            </div>
            {canWrite && (
              <form className="update-composer" onSubmit={postUpdate}>
                <label htmlFor="update-body" className="sr-only">
                  Write an update
                </label>
                <textarea
                  id="update-body"
                  rows={2}
                  maxLength={2000}
                  placeholder="Write an update…"
                  value={body}
                  disabled={locked}
                  onChange={(e) => setBody(e.target.value)}
                />
                <div className="update-composer-row">
                  <label>
                    <span className="sr-only">Change status</span>
                    <Select
                      value={nextStatus}
                      disabled={locked}
                      onChange={(e) =>
                        setNextStatus(e.target.value as Status | "")
                      }
                    >
                      <option value="">
                        Keep status ({statusLabels[current.status]})
                      </option>
                      {STATUSES.filter((s) => s !== current.status).map((s) => (
                        <option key={s} value={s}>
                          Move to {statusLabels[s]}
                        </option>
                      ))}
                    </Select>
                  </label>
                  <button
                    className="primary"
                    disabled={locked || (!body.trim() && !nextStatus)}
                  >
                    {pending ? "Posting…" : "Post update"}
                  </button>
                </div>
              </form>
            )}
            {updates.length ? (
              <ol className="timeline">
                {updates.map((u) => (
                  <li key={u.id} className="timeline-entry">
                    <span className="timeline-avatar" aria-hidden="true">
                      {u.author_name.trim()[0]?.toUpperCase() ?? "?"}
                    </span>
                    <div className="timeline-main">
                      <p className="timeline-head">
                        <strong>{u.author_name}</strong>
                        <time
                          dateTime={u.created_at}
                          title={new Date(u.created_at).toLocaleString()}
                        >
                          {timeAgo(u.created_at)}
                        </time>
                        {u.via_agent && (
                          <span className="timeline-via">
                            {activityOriginLabel({ via_agent: u.via_agent })}
                          </span>
                        )}
                      </p>
                      {u.body && <p className="timeline-body">{u.body}</p>}
                      {(u.status || u.progress !== null) && (
                        <p className="timeline-chips">
                          {u.status && (
                            <span className="timeline-chip">
                              Status → <StatusPill status={u.status} />
                            </span>
                          )}
                          {u.progress !== null && (
                            <span className="timeline-chip">
                              Progress → {u.progress}%
                            </span>
                          )}
                        </p>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              detail && <p className="drawer-hint">No updates yet.</p>
            )}
          </section>
        </div>

        <div className="drawer-foot">
          {onFocus && current.kind === "task" && !isClosed(current.status) && (
            <button className="primary" onClick={() => onFocus(current)}>
              <Crosshair size={15} /> Focus
            </button>
          )}
          <button className="secondary" onClick={() => onEdit(current)}>
            {canWrite ? (
              <>
                <Pencil size={15} /> Edit details
              </>
            ) : (
              <>
                <Eye size={15} /> View details
              </>
            )}
          </button>
        </div>
      </aside>
      {stepOptions && chosenStep && canWrite && (
        <Popover
          anchor={stepOptions.anchor}
          label={`Options for ${chosenStep.title}`}
          onClose={() => setStepOptions(null)}
        >
          <div className="popover-actions">
            <button
              className="popover-action"
              disabled={locked}
              onClick={() => {
                renameCancelled.current = false;
                setRenaming(chosenStep.id);
                setStepOptions(null);
              }}
            >
              <Pencil size={15} /> Rename step
            </button>
            <button
              className="popover-action danger"
              disabled={locked}
              onClick={() => {
                setStepOptions(null);
                deleteStep(chosenStep);
              }}
            >
              <Trash2 size={15} /> Delete step
            </button>
          </div>
        </Popover>
      )}
      {optionsAt &&
        canWrite &&
        current.kind === "task" &&
        !isClosed(current.status) && (
          <Popover
            anchor={optionsAt}
            label="Task options"
            onClose={() => setOptionsAt(null)}
          >
            <div className="popover-actions">
              <button
                className="popover-action danger"
                disabled={locked}
                onClick={async () => {
                  setOptionsAt(null);
                  if (
                    await ask({
                      title: `Cancel “${current.title}”? It closes without being done.`,
                    })
                  )
                    setStatus("cancelled");
                }}
              >
                <Ban size={15} /> Cancel task
              </button>
            </div>
          </Popover>
        )}
    </div>,
    document.body,
  );
}
