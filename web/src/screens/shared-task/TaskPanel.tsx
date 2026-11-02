import { useRouteScope } from "../../lib/route-scope";
import { registerTaskPreparation } from "./host-store";
import { useBeforeNavigate } from "../../lib/router";
import {
  appUrl,
  dateLabel,
  dueLine,
  isClosed,
  localDateKey,
  sameDay,
  seriesNoteFor,
  STATUSES,
  statusLabels,
  type EditScope,
  type EventNoteRef,
  type Item,
  type ItemDetail,
  type ItemInput,
  type ItemLink,
  type Status,
} from "@orbyn/core";
import {
  Ban,
  CalendarClock,
  Check,
  Copy,
  CornerLeftUp,
  Crosshair,
  Eye,
  Hourglass,
  Link2,
  MapPin,
  MoreHorizontal,
  NotebookPen,
  Share2,
  Sparkles,
  Star,
  Trash2,
  Users,
  Video,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { messageOf } from "../../lib/resource";
import { useNavigate } from "../../lib/router";
import { client, getSessionVersion } from "../../lib/session";
import {
  Button,
  ErrorNotice,
  IconButton,
  Loading,
  Menu,
  Pill,
  useConfirm,
  useToast,
} from "../../ui/kit";
import { buildInput, draftFrom, type Draft, type OccurrenceRef } from "./draft";
import { minutesLabel } from "./format";
import { selectedOccurrence, type SelectedView } from "./selected-occurrence";
import { useTasks } from "./host-store";
import { ItemFields } from "./ItemFields";
import type { Pending } from "./pickers";
import { ScopeDialog } from "./ScopeDialog";
import {
  AskCard,
  Checklist,
  Connections,
  Linked,
  LinkedHere,
  MeetingOutcome,
  Progress,
  Proof,
  Sessions,
  Subtasks,
  Updates,
} from "./sections";
import {
  deleteNow,
  refreshPlanner,
  saveItem,
  saveStatus,
  useItems,
  usePlanning,
  useTaskActions,
  type EditOptions,
} from "./store";

function timeRange(start: string | null, end: string | null) {
  if (!start) return "No date";
  if (!end) return dateLabel(start);
  const close = sameDay(new Date(start), new Date(end))
    ? new Date(end).toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit",
      })
    : dateLabel(end);
  return `${dateLabel(start)} → ${close}`;
}

/** All-day labels name the stored local dates, including an exclusive end's last day. */
function selectedAllDayLabel(item: Item | ItemInput) {
  if (!item.due_at) return "No date";
  const zone = item.timezone || "UTC";
  const first = new Date(item.due_at);
  const last = item.end_at ? new Date(Date.parse(item.end_at) - 1) : first;
  const label = (at: Date) =>
    at.toLocaleDateString([], {
      timeZone: zone,
      weekday: "short",
      month: "short",
      day: "numeric",
    });
  if (item.kind === "task") return `Due ${label(last)}`;
  return localDateKey(first, zone) === localDateKey(last, zone)
    ? label(first)
    : `${label(first)} → ${label(last)}`;
}

const refresh = () => void refreshPlanner().catch(() => undefined);

/**
 * One task or event, read and changed in one place: a side panel beside the
 * list on wide screens, a full sheet on phones. Status, checklist and updates
 * save as they happen. The fields are a draft with Save and Discard, so a
 * repeating item can ask which times a change covers and nothing typed is
 * lost when a save fails.
 */
export function TaskPanel({
  id,
  listed,
  occurrence,
  onClose,
  onSaved,
  onChanged,
}: {
  id: string;
  /** The item as a screen had it, to show at once. */
  listed?: Item;
  occurrence?: OccurrenceRef | null;
  onClose: () => void;
  onSaved: (item: Item, generation: number) => boolean;
  /** A status change was confirmed; the item itself is unchanged in identity. */
  onChanged: (generation: number) => boolean;
}) {
  const tasks = useTasks();
  const scope = useRouteScope();
  const navigate = useNavigate();
  const items = useItems();
  const planning = usePlanning();
  const fromList = items.find((item) => item.id === id) ?? listed;
  const [readDetail, setDetail] = useState<ItemDetail | null>(null);
  const detail = readDetail?.id === id ? readDetail : null;
  const [readError, setReadError] = useState("");
  const [gone, setGone] = useState(false);
  const [readTry, setReadTry] = useState(0);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const writing = useRef(false);
  const read = useRef(0);
  const generation = useRef(getSessionVersion()).current;
  const mounted = useRef(true);
  const identity = useRef({ id, scope, ready: false, canWrite: false });
  identity.current.id = id;
  identity.current.scope = scope;
  type Operation = { current: () => boolean };
  const operation = useRef<Operation | null>(null);
  const unknownSave = useRef<{
    id: string;
    version: number;
    options: EditOptions;
    draft: Draft;
    view: SelectedView | null;
  } | null>(null);
  const [unknownCheck, setUnknownCheck] = useState<
    "idle" | "checking" | "unchanged" | "changed" | "failed" | null
  >(null);
  const savedReadFailure = useRef<{
    item: Item;
    retry: number;
    draft: Draft;
    view: SelectedView | null;
  } | null>(null);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      operation.current = null;
      writing.current = false;
    };
  }, []);
  const panel = useRef<HTMLElement>(null);
  const toast = useToast();
  const confirm = useConfirm();
  const { remove } = useTaskActions();

  const version = fromList?.version;
  const reloadKey = [
    id,
    version,
    fromList?.status,
    fromList?.steps_done,
    fromList?.steps_total,
    fromList?.updates_count,
    fromList?.last_update_at,
  ].join("|");

  useEffect(() => {
    let alive = true;
    const request = ++read.current;
    if (!mounted.current || generation !== getSessionVersion()) return;
    if (
      savedReadFailure.current?.item.id === id &&
      savedReadFailure.current.retry === readTry
    )
      return;
    const owns = () =>
      alive &&
      mounted.current &&
      generation === getSessionVersion() &&
      request === read.current &&
      identity.current.id === id;
    setReadError("");
    client.getItem(id).then(
      (next) => {
        if (owns()) setDetail(next);
      },
      (e) => {
        if (!owns()) return;
        const status = (e as { status?: number }).status;
        if (status === 404 || status === 403) setGone(true);
        else setReadError(messageOf(e, "Couldn't load this task."));
      },
    );
    return () => {
      alive = false;
    };
  }, [reloadKey, id, readTry]);

  useEffect(() => {
    if (
      mounted.current &&
      generation === getSessionVersion() &&
      identity.current.id === id
    )
      void client.recordRecent("task", id).catch(() => undefined);
  }, [id]);

  // Focus moves in and goes back to what opened the panel.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null,
      root = panel.current,
      generation = getSessionVersion();
    const allowed = () =>
      generation === getSessionVersion() &&
      (!scope || (scope.getSnapshot().visible && scope.getSnapshot().focused));
    if (allowed()) root?.focus({ preventScroll: true });
    return () => {
      const ownedFocus =
        !!root?.contains(document.activeElement) ||
        document.activeElement === document.body;
      if (
        allowed() &&
        ownedFocus &&
        opener?.isConnected &&
        !opener.closest("[inert]") &&
        !opener.matches(":disabled") &&
        !document.querySelector("dialog[open]")
      )
        opener.focus({ preventScroll: true });
    };
  }, [scope]);

  // Beside the list on wide screens; over it, and the only thing in reach,
  // where the scrim shows.
  useEffect(() => {
    const narrow = matchMedia("(max-width: 1280px)");
    const app = document.querySelector<HTMLElement>(".app");
    const apply = () => {
      if (app) app.inert = narrow.matches;
    };
    apply();
    narrow.addEventListener("change", apply);
    return () => {
      narrow.removeEventListener("change", apply);
      if (app) app.inert = false;
    };
  }, []);

  const accountVersion = getSessionVersion();
  const current = useMemo<Item | undefined>(
    () =>
      detail
        ? {
            ...detail,
            ...(fromList &&
            fromList.id === detail.id &&
            fromList.version >= detail.version
              ? pick(fromList)
              : {}),
          }
        : fromList,
    [detail, fromList, accountVersion],
  );

  // Membership can enumerate a long-lived series. Draft-only renders reuse its projection.
  const resolvedView = useMemo(
    () =>
      current
        ? selectedOccurrence(
            {
              ...current,
              overrides:
                detail && detail.version >= current.version
                  ? detail.overrides
                  : undefined,
            },
            occurrence ?? null,
          )
        : null,
    [current, detail, occurrence, accountVersion],
  );
  const failedRead = savedReadFailure.current;
  const waitingForSavedDetail =
    failedRead &&
    (!detail ||
      detail.version < failedRead.item.version ||
      (!!occurrence && resolvedView?.state !== "ready"));
  const view =
    unknownSave.current?.view ??
    (waitingForSavedDetail ? failedRead.view : null) ??
    resolvedView;
  const selectedReady =
    !occurrence ||
    (unknownSave.current ? view : resolvedView)?.state === "ready";
  const shown = view?.item ?? current;
  const draftState = useDraft(current, detail, occurrence ?? null, view);
  const { draft, update, dirty, reset, pendingRows, known } = draftState;
  const latestDraft = useRef(draft);
  latestDraft.current = draft;

  const canWrite = current ? planning.canWrite(current) : false;
  identity.current.ready = !!detail && !readError && selectedReady;
  identity.current.canWrite = canWrite;
  useEffect(() => {
    const failed = savedReadFailure.current;
    if (
      !mounted.current ||
      generation !== getSessionVersion() ||
      !failed ||
      !selectedReady ||
      detail?.id !== failed.item.id ||
      detail.version < failed.item.version
    )
      return;
    savedReadFailure.current = null;
    if (latestDraft.current === failed.draft) reset();
  }, [detail, selectedReady, reset]);
  const panelOwned = () =>
    mounted.current &&
    generation === getSessionVersion() &&
    identity.current.id === id &&
    identity.current.scope === scope;
  const begin = (readOnly = false): Operation | null => {
    const opening = scope?.getSnapshot();
    if (
      writing.current ||
      !panelOwned() ||
      (!readOnly &&
        (!identity.current.ready ||
          !identity.current.canWrite ||
          !!unknownSave.current)) ||
      (scope && (!opening?.visible || !opening.focused))
    )
      return null;
    const href = opening
      ? opening.pathname + opening.search + opening.hash
      : "";
    const owned: Operation = {
      current: () => {
        const here = scope?.getSnapshot();
        return (
          mounted.current &&
          generation === getSessionVersion() &&
          operation.current === owned &&
          identity.current.scope === scope &&
          (!scope ||
            (!!here?.pathname &&
              here.pathname + here.search + here.hash === href))
        );
      },
    };
    operation.current = owned;
    writing.current = true;
    ++read.current;
    return owned;
  };

  const checkUnknownSave = async () => {
    const unresolved = unknownSave.current;
    if (!unresolved) return;
    const owned = begin(true);
    if (!owned) return;
    setUnknownCheck("checking");
    try {
      const next = await client.getItem(unresolved.id);
      if (!owned.current() || unknownSave.current !== unresolved) return;
      // An original-series read cannot identify or disprove a successful fork.
      setUnknownCheck(
        next.id === unresolved.id && next.version === unresolved.version
          ? "unchanged"
          : "changed",
      );
    } catch {
      if (owned.current() && unknownSave.current === unresolved)
        setUnknownCheck("failed");
    } finally {
      if (owned.current()) {
        operation.current = null;
        writing.current = false;
      }
    }
  };

  const requestClose = useCallback(async () => {
    if (writing.current) return;
    if (
      dirty &&
      !(await confirm({
        title: "Discard changes?",
        body: "Your edits haven't been saved.",
        action: "Discard changes",
        danger: true,
      }))
    )
      return;
    onClose();
  }, [dirty, confirm, onClose]);

  const prepareClose = useCallback(async () => {
    if (writing.current) return false;
    const captured = latestDraft.current;
    if (
      dirty &&
      !(await confirm({
        title: "Discard changes?",
        body: "Your edits haven't been saved.",
        action: "Discard changes",
        danger: true,
      }))
    )
      return false;
    return !writing.current && captured === latestDraft.current;
  }, [dirty, draft, confirm]);
  useEffect(() => registerTaskPreparation(prepareClose), [prepareClose]);
  useBeforeNavigate(prepareClose);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (
        !panel.current?.contains(document.activeElement) ||
        event.key !== "Escape" ||
        event.defaultPrevented
      )
        return;
      if (document.querySelector("dialog[open], .menu")) return;
      event.preventDefault();
      void requestClose();
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [requestClose]);

  /** Runs a change only while this presentation still owns its receipt. */
  const run = useCallback(
    async (work: () => Promise<ItemDetail>) => {
      const owned = begin();
      if (!owned) return false;
      setPending(true);
      setError("");
      try {
        const next = await work();
        if (!owned.current()) return false;
        setDetail(next);
        refresh();
        return true;
      } catch (error) {
        if (!owned.current()) return false;
        setError(messageOf(error, "Couldn't save that."));
        if ((error as { status?: number }).status === 409) {
          try {
            const next = await client.getItem(id);
            if (owned.current()) setDetail(next);
          } catch {
            /* The original error remains visible. */
          }
        }
        return false;
      } finally {
        if (owned.current()) {
          operation.current = null;
          writing.current = false;
          setPending(false);
        }
      }
    },
    [id, scope],
  );

  const setStatus = (status: Status) => {
    if (!current || status === current.status) return;
    void run(async () => {
      const owned = operation.current;
      await saveStatus(current, status);
      if (!owned?.current())
        throw Error("This task change belongs to an earlier presentation.");
      // The write is confirmed even if the read below fails.
      onChanged(generation);
      return client.getItem(id);
    });
  };

  const [askScope, setAskScope] = useState<"save" | "delete" | null>(null);
  const [saving, setSaving] = useState(false);

  const commit = async (options: EditOptions = {}) => {
    if (!current || !draft) return;
    const built = buildInput(draft, current, known, draftState.repeatStart);
    if (built.error !== undefined) return setError(built.error);
    const owned = begin();
    if (!owned) return;
    setSaving(true);
    setError("");
    let saved: Item | null = null;
    try {
      // Saved-panel status is immediate; a dirty field draft is not status intent.
      saved = await saveItem(current, built.data, current.version, options);
      if (!owned.current()) return;
      const next = await client.getItem(saved.id);
      if (!owned.current() || !onSaved(next, generation)) return;
      setDetail(next);
      if (latestDraft.current === draft) reset();
      toast({ text: "Saved" });
    } catch (error) {
      if (!owned.current()) return;
      if (saved) {
        // The write is known. Adopt its identity and require a read, never refork it.
        savedReadFailure.current = {
          item: saved,
          retry: readTry,
          draft,
          view: saved.id === current.id ? view : null,
        };
        if (!onSaved(saved, generation)) return;
        setDetail(null);
        setReadError(
          "Your changes were saved, but the updated task couldn't be loaded. Retry loading it before saving again.",
        );
        setError("");
      } else {
        const status =
          typeof error === "object" && error !== null && "status" in error
            ? error.status
            : undefined;
        const rejected =
          typeof status === "number" &&
          status >= 400 &&
          status < 500 &&
          status !== 408;
        if (!rejected) {
          // Latch before releasing the operation: a missing receipt is not permission to replay.
          unknownSave.current = {
            id: current.id,
            version: current.version,
            options: { ...options },
            draft: structuredClone(draft),
            view,
          };
          setUnknownCheck("idle");
          setError("");
          return;
        }
        setError(
          status === 409
            ? "This task changed elsewhere. Review it, then save again."
            : messageOf(error, "Couldn't save your changes."),
        );
        if ((error as { status?: number }).status === 409) {
          try {
            const next = await client.getItem(id);
            if (owned.current()) setDetail(next);
          } catch {
            /* Keep the dirty draft and original conflict visible. */
          }
        }
      }
    } finally {
      if (owned.current()) {
        operation.current = null;
        writing.current = false;
        setSaving(false);
      }
    }
  };

  const save = () => {
    if (unknownSave.current) return;
    const unfinished = Object.entries(pendingRows).find(([, on]) => on)?.[0];
    if (unfinished)
      return setError(
        `Add or clear the unfinished ${unfinished.replace(/s$/, "")} before saving.`,
      );
    if (current?.rrule) setAskScope("save");
    else void commit();
  };

  const startOf = occurrence?.occurrence ?? current?.due_at ?? undefined;
  const withScope = (scope: EditScope): EditOptions => ({
    scope,
    occurrence: startOf,
  });

  const removeItem = async () => {
    if (!current) return;
    if (current.rrule) return setAskScope("delete");
    if (
      await confirm({
        title: `Delete “${current.title}”?`,
        body: "You can undo this for a few seconds.",
        action: "Delete",
        danger: true,
      })
    ) {
      onClose();
      remove(current);
    }
  };

  const copyLink = () => {
    void navigator.clipboard
      .writeText(appUrl(location.origin, { kind: "task", id }))
      .then(
        () => toast({ text: "Link copied" }),
        () => toast({ text: "Couldn't copy the link", error: true }),
      );
  };
  const askAbout = () => {
    onClose();
    navigate(`/app/assistant?task=${encodeURIComponent(id)}`);
  };

  const parent = current?.parent_id
    ? items.find((item) => item.id === current.parent_id)
    : undefined;
  const steps = detail?.steps ?? [];
  const stepsDone = detail
    ? steps.filter((step) => step.done).length
    : (current?.steps_done ?? 0);
  const stepsTotal = detail ? steps.length : (current?.steps_total ?? 0);
  const mayWrite = canWrite && !unknownSave.current && selectedReady;
  const locked = !mayWrite || pending || saving || !detail || !!readError;
  const team = current?.team_id
    ? (planning.teams.find((t) => t.id === current.team_id)?.name ??
      current.team_name)
    : null;
  const open = !!current && !isClosed(current.status);

  return createPortal(
    <>
      <button
        type="button"
        className="st-scrim"
        tabIndex={-1}
        aria-label="Close task panel"
        onClick={() => void requestClose()}
      />
      <aside
        ref={panel}
        className="st-panel"
        tabIndex={-1}
        role="dialog"
        aria-modal="false"
        aria-label={current?.title ?? "Task"}
        aria-busy={pending || saving}
      >
        <header className="st-head">
          <span className="st-kicker">
            {current?.kind === "event" ? "Event" : "Task"}
            {team && (
              <span className="st-team" title={`Shared with ${team}`}>
                <Users aria-hidden="true" /> {team}
              </span>
            )}
          </span>
          <span className="st-gap" />
          <IconButton label="Copy link" onClick={copyLink}>
            <Link2 />
          </IconButton>
          {current && (
            <StarButton
              item={current}
              disabled={pending || saving || !!unknownSave.current}
              mayAct={() =>
                panelOwned() && !writing.current && !unknownSave.current
              }
            />
          )}
          {current && (
            <Menu
              label="Task options"
              trigger={(show, expanded) => (
                <IconButton
                  label="Task options"
                  aria-expanded={expanded}
                  onClick={show}
                >
                  <MoreHorizontal />
                </IconButton>
              )}
            >
              {(close) => (
                <>
                  {open && current.kind === "task" && (
                    <button
                      onClick={() => {
                        close();
                        tasks.focus(current);
                      }}
                    >
                      <Crosshair aria-hidden="true" /> Focus
                    </button>
                  )}
                  {current.kind === "task" && (
                    <button
                      onClick={() => {
                        close();
                        askAbout();
                      }}
                    >
                      <Sparkles aria-hidden="true" /> Ask about this task
                    </button>
                  )}
                  {typeof navigator.share === "function" && (
                    <button
                      onClick={() => {
                        close();
                        void navigator
                          .share({
                            title: current.title,
                            url: appUrl(location.origin, { kind: "task", id }),
                          })
                          .catch(() => undefined);
                      }}
                    >
                      <Share2 aria-hidden="true" /> Share link
                    </button>
                  )}
                  <button
                    onClick={() => {
                      close();
                      void navigator.clipboard.writeText(current.title);
                    }}
                  >
                    <Copy aria-hidden="true" /> Copy title
                  </button>
                  {mayWrite && open && current.kind === "task" && (
                    <button
                      onClick={() => {
                        close();
                        void confirm({
                          title: `Cancel “${current.title}”?`,
                          body: "It closes without being done.",
                          action: "Cancel task",
                          danger: true,
                        }).then((yes) => yes && setStatus("cancelled"));
                      }}
                    >
                      <Ban aria-hidden="true" /> Cancel task
                    </button>
                  )}
                  {mayWrite && (
                    <button
                      className="is-danger"
                      onClick={() => {
                        close();
                        void removeItem();
                      }}
                    >
                      <Trash2 aria-hidden="true" /> Delete
                    </button>
                  )}
                </>
              )}
            </Menu>
          )}
          <IconButton
            label="Close task panel"
            disabled={saving}
            onClick={() => void requestClose()}
          >
            <X />
          </IconButton>
        </header>
        {gone ? (
          <div className="st-body">
            <ErrorNotice message="This task is gone, or you no longer have access to it." />
          </div>
        ) : !current || !draft ? (
          <div className="st-body">
            {readError ? (
              <ErrorNotice
                message={readError}
                onRetry={() => setReadTry((n) => n + 1)}
              />
            ) : (
              <Loading label="Opening task" />
            )}
          </div>
        ) : (
          <div className="st-body">
            {parent && (
              <button
                type="button"
                className="st-parent"
                onClick={() => tasks.open(parent)}
              >
                <CornerLeftUp aria-hidden="true" />
                <span dir="auto">{parent.title}</span>
              </button>
            )}
            <textarea
              className="st-title"
              aria-label="Title"
              dir="auto"
              rows={1}
              maxLength={200}
              readOnly={!mayWrite || !detail}
              value={draft.title}
              ref={(node) => {
                if (node) {
                  node.style.height = "auto";
                  node.style.height = `${node.scrollHeight}px`;
                }
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.preventDefault();
              }}
              onChange={(event) =>
                update((d) => ({ ...d, title: event.target.value }))
              }
            />
            {readError && (
              <ErrorNotice
                message={readError}
                onRetry={() => setReadTry((n) => n + 1)}
              />
            )}
            {occurrence && !selectedReady && !readError && (
              <ErrorNotice
                message={
                  view?.state === "unavailable"
                    ? "This occurrence is no longer available. Reopen it from Calendar."
                    : "The selected occurrence details aren't available yet. Retry loading before making changes."
                }
                onRetry={() => setReadTry((n) => n + 1)}
              />
            )}
            <div className="st-facts">
              <span>
                <CalendarClock aria-hidden="true" />
                {view?.state === "unavailable"
                  ? "Occurrence unavailable"
                  : occurrence && shown?.all_day
                    ? selectedAllDayLabel(shown)
                    : shown?.kind === "task" && shown.due_at
                      ? dueLine(shown)
                      : timeRange(shown?.due_at ?? null, shown?.end_at ?? null)}
              </span>
              {current.kind === "task" &&
                open &&
                current.remaining_minutes != null && (
                  <span>
                    <Hourglass aria-hidden="true" />
                    {minutesLabel(current.remaining_minutes)} left
                  </span>
                )}
              {shown?.location && (
                <span>
                  <MapPin aria-hidden="true" />
                  <span dir="auto">{shown.location}</span>
                </span>
              )}
              {shown?.meeting_url && (
                <a href={shown.meeting_url} target="_blank" rel="noreferrer">
                  <Video aria-hidden="true" /> Meeting link
                </a>
              )}
              {current.kind === "event" &&
                !unknownSave.current &&
                selectedReady && (
                  <MeetingNotes
                    item={current}
                    occurrence={occurrence ?? null}
                    onError={setError}
                    mayAct={() =>
                      panelOwned() &&
                      identity.current.ready &&
                      !writing.current &&
                      !unknownSave.current
                    }
                  />
                )}
            </div>
            {canWrite ? (
              <div className="st-status" role="radiogroup" aria-label="Status">
                {STATUSES.map((status) => (
                  <button
                    key={status}
                    type="button"
                    role="radio"
                    className={`is-${status}`}
                    aria-checked={current.status === status}
                    disabled={locked}
                    onClick={() => setStatus(status)}
                  >
                    {current.status === status && <Check aria-hidden="true" />}
                    {statusLabels[status]}
                  </button>
                ))}
              </div>
            ) : (
              <p className="st-readonly">
                <Pill>{statusLabels[current.status]}</Pill>
                <Eye aria-hidden="true" /> View only{team ? ` in ${team}` : ""}
              </p>
            )}
            {unknownCheck && (
              <div className="notice" role="alert">
                <div>
                  <p>
                    Save outcome unknown. Your draft is kept. Review the
                    calendar before making another change.
                  </p>
                  {unknownCheck === "unchanged" && (
                    <p className="small">
                      The original version is unchanged. The save outcome is
                      still unknown.
                    </p>
                  )}
                  {unknownCheck === "changed" && (
                    <p className="small">
                      The original version changed. The saved result is still
                      unconfirmed.
                    </p>
                  )}
                  {unknownCheck === "failed" && (
                    <p className="small">
                      State couldn't be checked. The save outcome is still
                      unknown.
                    </p>
                  )}
                  <Button
                    variant="ghost"
                    busy={unknownCheck === "checking"}
                    onClick={() => void checkUnknownSave()}
                  >
                    Check state
                  </Button>
                  <a
                    className="btn btn-ghost"
                    href="/app/calendar"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Review calendar
                  </a>
                </div>
              </div>
            )}
            {error && <ErrorNotice message={error} />}
            {mayWrite && current.kind === "task" && current.team_id && (
              <AskCard itemId={id} onChanged={refresh} />
            )}
            <ItemFields
              draft={draft}
              update={update}
              existing={current}
              baseTeam={current.team_id ?? null}
              timezone={current.timezone ?? undefined}
              projectId={current.project_id ?? null}
              readOnly={!mayWrite || !detail}
              linksState={
                known.links ? "ready" : readError ? "failed" : "loading"
              }
              inviteesState={
                known.invitees ? "ready" : readError ? "failed" : "loading"
              }
              pending={pendingRows}
              onUpdated={(next) => {
                setDetail((was) =>
                  was ? ({ ...was, ...next } as ItemDetail) : was,
                );
                refresh();
              }}
            />
            {current.kind === "task" && (
              <Checklist
                item={current}
                steps={steps}
                loaded={!!detail}
                canWrite={mayWrite}
                locked={locked}
                run={run}
              />
            )}
            {current.kind === "task" && (
              <Subtasks
                item={current}
                items={items}
                canWrite={mayWrite}
                locked={locked}
                onError={setError}
              />
            )}
            {current.kind === "task" && (
              <Sessions
                item={current}
                canWrite={mayWrite}
                reloadKey={reloadKey}
                onChanged={refresh}
              />
            )}
            <Progress
              key={current.id}
              item={current}
              stepsTotal={stepsTotal}
              stepsDone={stepsDone}
              canWrite={mayWrite}
              locked={locked}
              run={run}
            />
            {!!current.notes &&
              (!canWrite || /https?:\/\//.test(current.notes)) && (
                <p className="st-notes" dir="auto">
                  <Linked text={current.notes} />
                </p>
              )}
            {(detail?.links?.length ?? 0) > 0 && (
              <ul className="st-links">
                {(detail!.links as ItemLink[]).map((link) => (
                  <li key={link.id}>
                    <a
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      dir="auto"
                    >
                      {link.title || link.url}
                    </a>
                  </li>
                ))}
              </ul>
            )}
            {current.kind === "task" && (
              <Connections
                item={current}
                version={detail?.version ?? current.version}
                canWrite={mayWrite}
                locked={locked}
                onSaved={() => {
                  setReadTry((n) => n + 1);
                  refresh();
                }}
              />
            )}
            <LinkedHere item={current} />
            {current.kind === "task" && (
              <Proof itemId={id} canWrite={mayWrite} />
            )}
            {current.kind === "event" &&
              (!!current.team_id || !!detail?.attendees?.length) && (
                <MeetingOutcome item={detail ?? current} canWrite={mayWrite} />
              )}
            <Updates
              item={current}
              detail={detail}
              canWrite={mayWrite}
              locked={locked}
              run={run}
            />
          </div>
        )}
        {dirty && canWrite && (
          <footer className="st-foot">
            <Button variant="ghost" disabled={saving} onClick={reset}>
              Discard
            </Button>
            <Button
              variant="primary"
              busy={saving}
              disabled={
                !detail ||
                !!readError ||
                !selectedReady ||
                pending ||
                !!unknownSave.current
              }
              onClick={save}
            >
              Save changes
            </Button>
          </footer>
        )}
      </aside>
      {askScope && current && (
        <ScopeDialog
          kind={current.kind}
          action={askScope}
          onCancel={() => setAskScope(null)}
          onChoose={(scope) => {
            const action = askScope;
            setAskScope(null);
            if (action === "save") return void commit(withScope(scope));
            if (scope === "all") {
              onClose();
              remove(current);
              return;
            }
            void deleteNow(current, withScope(scope)).then(
              () => {
                onClose();
                toast({ text: "Removed" });
              },
              (e) => setError(messageOf(e, "Couldn't delete this.")),
            );
          }}
        />
      )}
    </>,
    document.body,
  );
}

/** The fields a list row knows fresher than an older detail read. */
const pick = (item: Item) => ({
  status: item.status,
  version: item.version,
  progress: item.progress,
  steps_done: item.steps_done,
  steps_total: item.steps_total,
  remaining_minutes: item.remaining_minutes,
  spent_minutes: item.spent_minutes,
  score: item.score,
});

function useDraft(
  item: Item | undefined,
  detail: ItemDetail | null,
  occurrence: OccurrenceRef | null,
  view: SelectedView | null,
) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [baseline, setBaseline] = useState("");
  const [start, setStart] = useState("");
  const pendingRows = useRef<Pending>({}).current;
  const seed = useRef("");
  const source = detail ?? item;
  // A loading snapshot can seed the readonly form; only ready admits writes.
  const key = source
    ? `${source.id}:${source.version}:${detail ? "full" : "list"}:${view?.state}:${JSON.stringify(view?.occurrence)}`
    : "";
  const dirty = !!draft && JSON.stringify(draft) !== baseline;
  const adopt = useCallback(() => {
    if (!source) return;
    const next = draftFrom(source as never, true, occurrence, view);
    setDraft(next);
    setBaseline(JSON.stringify(next));
    setStart(JSON.stringify(next.repeat));
  }, [source, occurrence, view]);
  useEffect(() => {
    if (!key || key === seed.current) return;
    // A newer copy replaces the form unless someone is typing in it.
    if (dirty) return;
    seed.current = key;
    adopt();
  }, [key, dirty, adopt]);
  const update = useCallback(
    (change: (d: Draft) => Draft) =>
      setDraft((current) => (current ? change(current) : current)),
    [],
  );
  const reset = useCallback(() => {
    for (const row of Object.keys(pendingRows)) pendingRows[row] = false;
    seed.current = "";
    adopt();
  }, [adopt, pendingRows]);
  const known = useMemo(
    () => ({ links: !!detail, invitees: !!detail }),
    [detail],
  );
  return {
    draft,
    update,
    dirty,
    reset,
    pendingRows,
    known,
    repeatStart: start,
  };
}

function StarButton({
  item,
  disabled = false,
  mayAct,
}: {
  item: Item;
  disabled?: boolean;
  mayAct: () => boolean;
}) {
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  useEffect(() => {
    let alive = true;
    client.listFavourites().then(
      (all) =>
        alive &&
        setOn(all.some((f) => f.kind === "task" && f.target_id === item.id)),
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [item.id]);
  return (
    <IconButton
      label={on ? "Remove star" : "Star"}
      aria-pressed={on}
      disabled={disabled || busy}
      onClick={() => {
        if (disabled || busy || !mayAct()) return;
        setBusy(true);
        client
          .setFavourite("task", item.id, !on)
          .then(
            () => setOn(!on),
            (e) =>
              toast({
                text: messageOf(e, "Couldn't change the star."),
                error: true,
              }),
          )
          .finally(() => setBusy(false));
      }}
    >
      <Star fill={on ? "currentColor" : "none"} />
    </IconButton>
  );
}

function MeetingNotes({
  item,
  occurrence,
  onError,
  mayAct,
}: {
  item: Item;
  occurrence: OccurrenceRef | null;
  onError: (text: string) => void;
  mayAct: () => boolean;
}) {
  const tasks = useTasks();
  const navigate = useNavigate();
  const [series, setSeries] = useState<EventNoteRef | null>(null);
  useEffect(() => {
    if (!item.rrule || !occurrence) return;
    let alive = true;
    client.eventNotes([item.id]).then(
      (notes) =>
        alive &&
        setSeries(
          seriesNoteFor(notes, {
            item_id: item.id,
            occurrence: occurrence.occurrence,
            team_id: item.team_id,
          }) ?? null,
        ),
      () => alive && setSeries(null),
    );
    return () => {
      alive = false;
    };
  }, [item.id, item.rrule, item.team_id, occurrence]);
  const open = (whole: boolean) => {
    if (!mayAct()) return;
    return client
      .itemNote(
        item.id,
        !whole && item.rrule && occurrence ? occurrence.occurrence : null,
      )
      .then(
        (note) => {
          tasks.close();
          navigate(`/app/doc/${note.id}`);
        },
        (e) => onError(messageOf(e, "Couldn't open the note.")),
      );
  };
  return (
    <>
      <button type="button" onClick={() => void open(false)}>
        <NotebookPen aria-hidden="true" /> Meeting note
      </button>
      {occurrence && series && (
        <button
          type="button"
          title="The note for every time of this event"
          onClick={() => void open(true)}
        >
          <NotebookPen aria-hidden="true" /> Series note: “
          {series.title || "Untitled"}”
        </button>
      )}
    </>
  );
}
