import {
  addDays,
  dayTime,
  deadlineOf,
  isClosed,
  localDateKey,
  type CalendarEntry,
  type EditScope,
  type Item,
  type PlannedBlock,
  type PlannerPrefs,
  type TimeBlock,
} from "@orbyn/core";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useAccount } from "../../app/account";
import { navigate, useSearch, useTitle } from "../../lib/router";
import { client } from "../../lib/session";
import {
  Button,
  ErrorNotice,
  IconButton,
  Loading,
  useToast,
} from "../../ui/kit";
import { X } from "lucide-react";
import { ScopeDialog, tasks } from "../shared-task";
import { useTaskLayer } from "../shared-task/host-store";
import {
  DeadlineChoice,
  Details,
  Popover,
  TimeDialog,
  type DetailActions,
} from "./Details";
import { FocusBanner, FocusMode } from "./Focus";
import { monthName, rangeTitle } from "./format";
import { ManageDialog, type ManageTab } from "./ManageDialog";
import {
  AGENDA_DAYS,
  daysFrom,
  entryKey,
  externalKey,
  frameKey,
  ghostKey,
  isMode,
  isTyping,
  keyOf,
  MODES,
  nextQuarter,
  rangeOf,
  stepMonth,
  type Mode,
  type Picked,
  type PickedRef,
} from "./model";
import { AgendaList, MonthGrid } from "./MonthGrid";
import { PlanBar, PlanPanel, type PlanRequest } from "./PlanPanel";
import { CheckIns, TasksToPlace } from "./Rail";
import { StageView } from "./StageView";
import { TimeGrid } from "./TimeGrid";
import { Toolbar } from "./Toolbar";
import { useActions, type Times } from "./useActions";
import { usePlan } from "./usePlan";
import {
  useLive,
  useRange,
  useTeammates,
  useWorkspace,
  type Workspace,
} from "./useWorkspace";
import "./calendar.css";

const SET_KEY = "orbyn-calendar-set";
const SIDE_KEY = "orbyn-calendar-side";

const remembered = (key: string) => {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
};

function useWidth() {
  const [width, setWidth] = useState(() => window.innerWidth);
  useEffect(() => {
    const change = () => setWidth(window.innerWidth);
    window.addEventListener("resize", change);
    return () => window.removeEventListener("resize", change);
  }, []);
  return width;
}

export default function CalendarScreen() {
  const { user } = useAccount();
  const account = user?.id ?? "";
  const workspace = useWorkspace();
  useTitle("Calendar");
  const prefs = workspace.prefs;
  if (workspace.phase === "error" && !prefs)
    return (
      <div className="page">
        <ErrorNotice
          message="Couldn't load your calendar."
          onRetry={() => void workspace.retry()}
        />
      </div>
    );
  if (!prefs)
    return (
      <div className="page">
        <Loading label="Loading your calendar" />
      </div>
    );
  return (
    <Calendar
      key={account}
      account={account}
      prefs={prefs}
      workspace={workspace}
    />
  );
}

type Dialogs =
  | { kind: "schedule"; item: Item }
  | { kind: "move"; block: TimeBlock }
  | { kind: "ghost"; ghost: PlannedBlock }
  | { kind: "manage"; tab: ManageTab; frameId?: string }
  | null;

function Calendar({
  account,
  prefs,
  workspace,
}: {
  account: string;
  prefs: PlannerPrefs;
  workspace: Workspace;
}) {
  const tz = prefs.timezone;
  const toast = useToast();
  const search = useSearch();
  const query = useMemo(() => new URLSearchParams(search), [search]);
  const today = localDateKey(new Date(), tz);
  const rawMode = query.get("mode");
  const mode: Mode = isMode(rawMode) ? rawMode : "stage";
  const rawDate = query.get("date");
  const date = rawDate && /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : today;

  const setNav = useCallback(
    (next: { mode?: Mode; date?: string }, replace = true) => {
      const params = new URLSearchParams(location.search);
      if (next.mode) {
        if (next.mode === "stage") params.delete("mode");
        else params.set("mode", next.mode);
      }
      if (next.date) params.set("date", next.date);
      const text = params.toString();
      navigate(`/app/calendar${text ? `?${text}` : ""}`, replace);
    },
    [],
  );
  const setDate = useCallback((day: string) => setNav({ date: day }), [setNav]);
  const setMode = useCallback(
    (next: Mode) => setNav({ mode: next }, false),
    [setNav],
  );

  const width = useWidth();
  const narrow = width <= 820;
  const span = width <= 520 ? 1 : width <= 900 ? 3 : 7;
  const range = rangeOf(mode, date, span);
  const days = useMemo(
    () => daysFrom(range.first, range.days),
    [range.first, range.days],
  );
  const data = useRange(account, range.first, range.days, tz);
  const view = data.view;

  // ---- sets ----
  const sets = prefs.calendar_sets;
  const [setId, setSetId] = useState(() => remembered(SET_KEY));
  useEffect(() => {
    let live = true;
    client.getPrefs().then(
      (p) => {
        const chosen = p.views?.calendar?.set;
        if (live && chosen !== undefined)
          setSetId(chosen === "all" ? "" : chosen);
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, []);
  const chooseSet = useCallback((id: string) => {
    setSetId(id);
    try {
      localStorage.setItem(SET_KEY, id);
    } catch {
      // The choice lasts this visit.
    }
    void client
      .savePrefs({ views: { calendar: { set: id || "all" } } })
      .catch(() => undefined);
  }, []);
  const activeSet = sets.find((s) => s.id === setId) ?? null;

  const shown = useMemo(() => {
    if (!view) return null;
    const allowed = (x: { team_id: string | null; list_id: string | null }) => {
      if (!activeSet) return true;
      const place = x.team_id
        ? activeSet.team_ids.includes(x.team_id)
        : activeSet.personal;
      const list =
        !activeSet.list_ids.length ||
        (!!x.list_id && activeSet.list_ids.includes(x.list_id));
      return place && list;
    };
    const entries = view.entries.filter(allowed);
    const ids = new Set(entries.map((e) => e.item_id));
    return {
      ...view,
      entries,
      blocks: view.blocks.filter(allowed),
      derived: view.derived.filter((d) => ids.has(d.item_id)),
    };
  }, [activeSet, view]);
  const external = useMemo(
    () => [
      ...(view?.external ?? []).filter(
        (e) =>
          !activeSet?.subscription_ids ||
          activeSet.subscription_ids.includes(e.subscription_id),
      ),
      ...data.fieldDates,
    ],
    [activeSet, data.fieldDates, view?.external],
  );

  // ---- everything that changes data ----
  const actions = useActions({
    tz,
    workspace,
    patch: data.patch,
    reload: data.reload,
  });
  const plan = usePlan(workspace.items, view);
  const [revision, setRevision] = useState(0);
  const [focusVersion, setFocusVersion] = useState(0);
  const refreshAll = useCallback(() => {
    actions.reloadIdle();
    void data.reloadFields();
    void workspace.refreshTasks();
    setRevision((n) => n + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actions.reloadIdle, data.reloadFields, workspace.refreshTasks]);
  // News from elsewhere: the shared planner keeps tasks fresh on its own.
  const refreshView = useCallback(() => {
    actions.reloadIdle();
    setRevision((n) => n + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actions.reloadIdle]);
  useLive(refreshView, () => setFocusVersion((n) => n + 1));

  const mates = useTeammates(
    workspace.teams,
    account,
    prefs.pinned_user_ids,
    data.from,
    data.to,
    mode === "stage" || mode === "week" || mode === "day",
  );

  // ---- what's open ----
  const [pickedRef, setPickedRef] = useState<PickedRef | null>(null);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const [dialog, setDialog] = useState<Dialogs>(null);
  const [slot, setSlot] = useState<string | null>(null);
  const [focusItem, setFocusItem] = useState<Item | null>(null);
  const [sideOpen, setSideOpen] = useState(
    () => remembered(SIDE_KEY) !== "closed",
  );
  const [timeBusy, setTimeBusy] = useState(false);
  const [timeError, setTimeError] = useState("");
  const [request, setRequest] = useState<PlanRequest | null>(null);

  // The task panel's Focus button lands here, so one focus mode runs.
  const { focus: askedFocus } = useTaskLayer();
  useLayoutEffect(() => {
    if (!askedFocus) return;
    tasks.closeFocus();
    setFocusItem(askedFocus);
  }, [askedFocus]);

  // A record the view no longer holds closes its details.
  const picked = useMemo<Picked | null>(() => {
    if (!pickedRef || !shown) return null;
    const { kind, key } = pickedRef;
    if (kind === "entry") {
      const entry = shown.entries.find((e) => entryKey(e) === key);
      return entry ? { kind, entry } : null;
    }
    if (kind === "block") {
      const block = shown.blocks.find((b) => b.id === key);
      return block ? { kind, block } : null;
    }
    if (kind === "frame") {
      const frame = shown.frames?.find((f) => frameKey(f) === key);
      return frame ? { kind, frame } : null;
    }
    if (kind === "habit") {
      const habit = shown.habit_blocks?.find((h) => h.id === key);
      return habit ? { kind, habit } : null;
    }
    if (kind === "external") {
      const event = external.find((x) => externalKey(x) === key);
      return event ? { kind, event } : null;
    }
    const ghost = plan.proposals.find((g) => ghostKey(g) === key);
    return ghost ? { kind, ghost } : null;
  }, [external, pickedRef, plan.proposals, shown]);

  const pick = useCallback((next: Picked | null, rect?: DOMRect) => {
    setPickedRef(next ? keyOf(next) : null);
    setAnchor(rect ?? null);
  }, []);

  const startFocus = useCallback(
    async (itemId: string) => {
      const known = workspace.itemById.get(itemId);
      try {
        setFocusItem(known ?? (await client.getItem(itemId)));
      } catch (failure) {
        toast({
          error: true,
          text:
            failure instanceof Error
              ? failure.message
              : "Couldn't open that task.",
        });
      }
    },
    [toast, workspace.itemById],
  );

  // Other screens reach Calendar by link: focus, a plan, or an existing plan.
  useEffect(() => {
    const asks = [
      "focus",
      "plan",
      "plan_id",
      "days",
      "include",
      "only",
      "until",
    ];
    if (!asks.some((name) => query.has(name))) return;
    const focusId = query.get("focus");
    if (focusId) void startFocus(focusId);
    const planId = query.get("plan_id");
    if (planId) {
      plan.setOpen(true);
      client
        .getPlan(planId)
        .then(plan.show, () => plan.setError("Couldn't open that plan."));
    } else if (query.get("plan")) {
      // `?plan=<itemId>` is "Find time": that task alone, up to its deadline.
      const asked = query.get("plan") as string;
      const item = /^[0-9a-f-]{36}$/i.test(asked)
        ? workspace.itemById.get(asked)
        : undefined;
      const only = /^[0-9a-f-]{36}$/i.test(asked)
        ? [asked]
        : query.get("only")?.split(",").filter(Boolean);
      plan.setOpen(true);
      setSideOpen(true);
      setRequest({
        key: search,
        days: query.get("days") ? Number(query.get("days")) : undefined,
        include: query.get("include")?.split(",").filter(Boolean),
        only,
        until: query.get("until") ?? (item ? deadlineOf(item) : null),
      });
    }
    // Asked once: a later change of date must not ask again.
    const rest = new URLSearchParams(search);
    asks.forEach((name) => rest.delete(name));
    const text = rest.toString();
    navigate(`/app/calendar${text ? `?${text}` : ""}`, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  // A plan may land in another week: show where its work is.
  const planId = plan.plan?.id;
  const shownPlan = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!plan.plan || plan.plan.applied || shownPlan.current === planId) return;
    shownPlan.current = planId;
    const first = plan.proposals.map((b) => b.start_at).sort()[0];
    if (!first) return;
    const day = localDateKey(new Date(first), tz);
    if (mode === "month" || mode === "agenda")
      setNav({ mode: "week", date: day });
    else if (!days.includes(day)) setDate(day);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planId]);

  const canWriteItem = useCallback(
    (itemId: string, teamId?: string | null) => {
      const item = workspace.itemById.get(itemId);
      return workspace.canWrite(item ?? { team_id: teamId ?? null });
    },
    [workspace],
  );
  const canWriteEntry = useCallback(
    (e: CalendarEntry) => canWriteItem(e.item_id, e.team_id),
    [canWriteItem],
  );
  const canDrag = useCallback(
    (p: Picked) => {
      if (p.kind === "entry") return canWriteEntry(p.entry);
      if (p.kind === "block")
        return (
          p.block.status !== "done" &&
          canWriteItem(p.block.item_id, p.block.team_id)
        );
      return false;
    },
    [canWriteEntry, canWriteItem],
  );
  const canComplete = useCallback(
    (e: CalendarEntry) => {
      if (e.kind !== "task" || isClosed(e.status)) return false;
      const item = workspace.itemById.get(e.item_id);
      if (item && (!workspace.canWrite(item) || isClosed(item.status)))
        return false;
      if (!e.occurrence) return true;
      return (
        !!item?.due_at && Date.parse(item.due_at) === Date.parse(e.start_at)
      );
    },
    [workspace],
  );

  const openItem = useCallback(
    (itemId: string, entry?: CalendarEntry) =>
      tasks.open(itemId, {
        occurrence: entry?.occurrence
          ? {
              occurrence: entry.occurrence,
              start_at: entry.start_at,
              end_at: entry.end_at,
            }
          : undefined,
        onClose: refreshAll,
      }),
    [refreshAll],
  );

  const details: DetailActions = {
    canWriteEntry,
    canWriteItem,
    canComplete,
    openItem,
    focus: (itemId) => void startFocus(itemId),
    complete: (itemId, repeating) => void actions.complete(itemId, repeating),
    reopen: (itemId) => void actions.reopen(itemId),
    skipOccurrence: (entry) => void actions.skipOccurrence(entry),
    duplicate: (block) => void actions.duplicate(block),
    reschedule: (block) => void actions.reschedule(block),
    beforeDeadline: (block) => void actions.moveBeforeDeadline(block),
    changeTime: (block) => setDialog({ kind: "move", block }),
    removeBlock: (block) => void actions.removeBlock(block),
    editFrame: (frameId) =>
      setDialog({ kind: "manage", tab: "frames", frameId }),
    skipFrame: (frame) => void actions.skipFrame(frame),
    checkInHabit: (habit, outcome) => void actions.checkInHabit(habit, outcome),
    removeHabit: (habit) => void actions.removeHabit(habit),
    changeGhost: (ghost) => setDialog({ kind: "ghost", ghost }),
    removeGhost: (ghost) => void plan.remove(ghost),
    // A plan's moves of existing sessions are ticked, not dragged.
    ghostTunable: (ghost) =>
      plan.live &&
      !plan.pending &&
      (plan.plan?.blocks.includes(ghost) ?? false),
    openField: (target, id) =>
      navigate(target === "page" ? `/app/doc/${id}` : `/app/project/${id}`),
  };

  const openEventAt = useCallback(
    (start: Date, end?: Date) =>
      tasks.create({
        prefill: {
          kind: "event",
          due_at: start.toISOString(),
          end_at: (end ?? new Date(start.getTime() + 3_600_000)).toISOString(),
        },
        onClose: refreshAll,
      }),
    [refreshAll],
  );
  const newEvent = useCallback(() => {
    const here =
      slot && days.includes(localDateKey(new Date(slot), tz))
        ? new Date(slot)
        : nextQuarter(date, tz);
    openEventAt(here);
  }, [date, days, openEventAt, slot, tz]);

  const dropTask = useCallback(
    (id: string, start: Date) => {
      const item = workspace.itemById.get(id);
      if (item) void actions.createBlock(item, start);
    },
    [actions, workspace.itemById],
  );
  const dropOnDay = useCallback(
    (id: string, day: string) => {
      const item = workspace.itemById.get(id);
      if (item) void actions.planOnDay(item, day);
    },
    [actions, workspace.itemById],
  );

  const step = useCallback(
    (by: -1 | 1) => {
      if (mode === "month") {
        const next = stepMonth(date, by);
        setDate(next.slice(0, 7) === today.slice(0, 7) ? today : next);
      } else if (mode === "stage") setDate(addDays(date, by * 7));
      else
        setDate(
          addDays(
            date,
            by * (mode === "week" ? span : mode === "agenda" ? AGENDA_DAYS : 1),
          ),
        );
    },
    [date, mode, setDate, span, today],
  );

  const togglePlan = useCallback(() => {
    if (plan.open) {
      plan.close();
      return;
    }
    if (mode === "month" || mode === "agenda") setMode("stage");
    setSideOpen(true);
    plan.setOpen(true);
  }, [mode, plan, setMode]);

  const openDay = useCallback(
    (day: string) => setNav({ mode: "day", date: day }, false),
    [setNav],
  );

  const planIt = useCallback(
    (itemId: string) => {
      plan.setOpen(true);
      setSideOpen(true);
      setRequest({ key: `${itemId}:${Date.now()}`, include: [itemId] });
    },
    [plan],
  );

  const applyPlan = useCallback(async () => {
    const done = await plan.apply();
    if (!done) return;
    toast({
      text: done.text,
      action: done.at
        ? {
            label: "Show on calendar",
            run: () => setDate(localDateKey(new Date(done.at), tz)),
          }
        : undefined,
    });
    await data.reload();
    await workspace.refreshTasks();
    setRevision((n) => n + 1);
  }, [data, plan, setDate, toast, tz, workspace]);

  // ---- shortcuts ----
  const blocked = !!dialog || !!anchor || !!focusItem || !!actions.ask;
  const latest = useRef({
    step,
    setDate,
    setMode,
    togglePlan,
    sets,
    chooseSet,
    newEvent,
    slot,
    today,
    picked,
    pick,
  });
  latest.current = {
    step,
    setDate,
    setMode,
    togglePlan,
    sets,
    chooseSet,
    newEvent,
    slot,
    today,
    picked,
    pick,
  };
  useEffect(() => {
    if (blocked) return;
    const onKey = (e: KeyboardEvent) => {
      if (
        e.defaultPrevented ||
        isTyping(e) ||
        e.metaKey ||
        e.ctrlKey ||
        e.altKey ||
        document.querySelector("dialog[open], .menu")
      )
        return;
      const l = latest.current;
      const key = e.key.toLowerCase();
      if (e.key === "ArrowLeft") l.step(-1);
      else if (e.key === "ArrowRight") l.step(1);
      else if (e.key === "Escape") {
        if (l.picked) l.pick(null);
        else if (l.slot) setSlot(null);
        else return;
      } else if (key === "t") l.setDate(l.today);
      else if (key === "p") l.togglePlan();
      else if (key === "c") l.newEvent();
      else if (/^[0-9]$/.test(key)) {
        const n = Number(key);
        if (n === 0) l.chooseSet("");
        else if (l.sets[n - 1]) l.chooseSet(l.sets[n - 1].id);
        else return;
      } else {
        const m = MODES.find((x) => x.key === key);
        if (!m) return;
        l.setMode(m.id);
      }
      e.preventDefault();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [blocked]);

  const title =
    mode === "month"
      ? monthName(date)
      : mode === "day"
        ? rangeTitle([date])
        : rangeTitle(days);
  const ghosts = plan.plan && !plan.plan.applied ? plan.plan.blocks : [];
  const keepFree = plan.state?.keepFree ?? [];
  const tunable = plan.open && plan.live && !plan.pending;
  const showSide = sideOpen || narrow;
  const fromLocal = (value: string) => {
    const [d, t] = value.split("T");
    const [h, m] = t.split(":").map(Number);
    return dayTime(d, h * 60 + m, tz);
  };
  const saveTime = async (times: Times) => {
    if (dialog?.kind !== "schedule" && dialog?.kind !== "move") return;
    setTimeBusy(true);
    setTimeError("");
    try {
      const block =
        dialog.kind === "schedule"
          ? await client.createBlock({ item_id: dialog.item.id, ...times })
          : await client.updateBlock(dialog.block.id, times);
      setDialog(null);
      actions.warnIfLate(block);
      await data.reload();
      await workspace.refreshTasks();
    } catch (failure) {
      setTimeError(
        failure instanceof Error ? failure.message : "Couldn't save that time.",
      );
    } finally {
      setTimeBusy(false);
    }
  };

  const loadingView = !shown && data.loading;
  const failedView = !shown && !data.loading && !!data.error;

  return (
    <div
      className={`calendar-page${showSide ? " has-side" : ""}`}
      aria-busy={actions.saving || data.loading}
    >
      <div className="calendar-main">
        <Toolbar
          mode={mode}
          title={title}
          isToday={date === today}
          onToday={() => setDate(today)}
          onStep={step}
          onMode={setMode}
          sets={sets}
          setId={activeSet?.id ?? ""}
          onSet={chooseSet}
          showMates={
            workspace.teams.length > 0 &&
            (mode === "stage" || mode === "week" || mode === "day")
          }
          mates={mates}
          planOpen={plan.open}
          onPlan={togglePlan}
          onNewEvent={newEvent}
          onManage={(tab) => setDialog({ kind: "manage", tab })}
          sideOpen={sideOpen}
          onSide={() => {
            const next = !sideOpen;
            setSideOpen(next);
            try {
              localStorage.setItem(SIDE_KEY, next ? "open" : "closed");
            } catch {
              // Remembered for this visit.
            }
          }}
        />
        <FocusBanner
          items={workspace.items}
          hidden={!!focusItem}
          version={focusVersion}
          onOpen={setFocusItem}
        />
        {actions.note && (
          <div className="calendar-note is-warn" role="alert">
            <span>{actions.note.text}</span>
            {actions.note.actions.map((a) => (
              <Button
                key={a.label}
                variant="ghost"
                disabled={actions.saving}
                onClick={a.run}
              >
                {a.label}
              </Button>
            ))}
            <IconButton label="Dismiss" onClick={() => actions.setNote(null)}>
              <X />
            </IconButton>
          </div>
        )}
        {data.fieldsError && (
          <ErrorNotice
            message="Page and project dates couldn't load."
            onRetry={() => void data.reloadFields()}
          />
        )}
        {shown && data.error && (
          <ErrorNotice
            message="Couldn't refresh the calendar. Showing what's loaded."
            onRetry={() => void data.reload()}
          />
        )}
        {mates.shown.length > 0 && (
          <div
            className="calendar-mates"
            role="group"
            aria-label="Teammates shown"
          >
            <span className="small muted">Busy</span>
            {mates.shown.map((m) => (
              <span key={m.user_id} className="small" dir="auto">
                <i
                  className="calendar-dot"
                  style={{ background: m.color }}
                  aria-hidden="true"
                />{" "}
                {m.name}
              </span>
            ))}
            <Button variant="ghost" onClick={mates.clear}>
              Hide
            </Button>
          </div>
        )}
        <span className="sr-only" role="status">
          {actions.saving ? "Saving calendar" : ""}
        </span>
        <div className="calendar-surface">
          {failedView ? (
            <div className="calendar-state">
              <ErrorNotice
                message="Couldn't load the calendar."
                onRetry={() => void data.reload()}
              />
            </div>
          ) : loadingView || !shown ? (
            <div className="calendar-state">
              <Loading label="Loading calendar" />
            </div>
          ) : mode === "stage" ? (
            <StageView
              weekStart={range.first}
              date={date}
              prefs={prefs}
              view={shown}
              external={external}
              proposals={plan.proposals}
              newSessions={ghosts.length}
              tunable={tunable}
              keepFree={keepFree}
              mates={mates.shown}
              listById={workspace.listById}
              narrow={narrow}
              picked={picked}
              writeBusy={actions.saving}
              actions={details}
              canMoveEntry={canWriteEntry}
              canMoveBlock={(b) => canDrag({ kind: "block", block: b })}
              onDate={setDate}
              onPick={(next) => pick(next)}
              onMoveBlock={(b, times, label) =>
                void actions.moveBlock(b, times, label)
              }
              onCopyBlock={(b, start) => void actions.duplicate(b, start)}
              onMoveEntry={actions.moveEntry}
              onPinGhost={(g, start, end) => void plan.pin(g, start, end)}
              onKeepFree={(start, end) => void plan.keepFree(start, end)}
              onDropKeepFree={(r) => void plan.dropKeepFree(r)}
              onDropTask={dropTask}
              onDropTaskOnDay={dropOnDay}
              onNewAt={(start) => openEventAt(start)}
              onSlot={setSlot}
              onOpenItem={openItem}
              slot={slot}
            />
          ) : mode === "week" || mode === "day" ? (
            <TimeGrid
              days={days}
              tz={tz}
              view={shown}
              external={external}
              ghosts={ghosts}
              tunable={tunable}
              keepFree={keepFree}
              zones={prefs.extra_timezones.slice(0, 3)}
              mates={mates.shown}
              listById={workspace.listById}
              relatedItem={
                picked?.kind === "block"
                  ? picked.block.item_id
                  : picked?.kind === "entry"
                    ? picked.entry.item_id
                    : null
              }
              slot={slot}
              canDrag={canDrag}
              onPick={pick}
              onOpenDay={openDay}
              onSlot={setSlot}
              onNewRange={openEventAt}
              onKeepFree={(start, end) => void plan.keepFree(start, end)}
              onDropKeepFree={(r) => void plan.dropKeepFree(r)}
              onMoveBlock={(b, times) => void actions.moveBlock(b, times)}
              onCopyBlock={(b, start) => void actions.duplicate(b, start)}
              onMoveEntry={actions.moveEntry}
              onPinGhost={(g, start, end) => void plan.pin(g, start, end)}
              onDropTask={dropTask}
              onDropTaskOnDay={dropOnDay}
            />
          ) : mode === "month" ? (
            <div className="calendar-month-layout">
              <MonthGrid
                date={date}
                tz={tz}
                view={shown}
                external={external}
                listById={workspace.listById}
                onSelect={setDate}
                onOpenDay={openDay}
                onPick={pick}
                onDropTask={dropOnDay}
              />
              <div className="calendar-month-day">
                <AgendaList
                  days={[date]}
                  tz={tz}
                  view={shown}
                  external={external}
                  listById={workspace.listById}
                  onPick={pick}
                  empty="Nothing planned this day"
                />
              </div>
            </div>
          ) : (
            <AgendaList
              days={days}
              tz={tz}
              view={shown}
              external={external}
              listById={workspace.listById}
              onPick={pick}
              empty="Nothing planned for these dates"
            />
          )}
        </div>
        <PlanBar plan={plan} onApply={() => void applyPlan()} />
      </div>

      {showSide && (
        <aside className="calendar-side" aria-label="Plan and tasks to place">
          {plan.open && (
            <PlanPanel
              prefs={prefs}
              items={workspace.items}
              teams={workspace.teams}
              lists={workspace.lists}
              plan={plan}
              request={request}
              tz={tz}
              revision={revision}
              onClose={plan.close}
              onChanged={refreshAll}
              onSeen={(at) => setDate(localDateKey(new Date(at), tz))}
            />
          )}
          <CheckIns
            tz={tz}
            version={revision}
            onOpen={openItem}
            onPlanIt={planIt}
            onChanged={refreshAll}
          />
          <TasksToPlace
            workspace={workspace}
            onSchedule={(item) => setDialog({ kind: "schedule", item })}
          />
        </aside>
      )}

      {picked && anchor && (
        <Popover
          anchor={anchor}
          label="Item details"
          onClose={() => pick(null)}
        >
          <Details
            picked={picked}
            tz={tz}
            writeBusy={actions.saving}
            actions={details}
            onClose={() => pick(null)}
          />
        </Popover>
      )}

      {dialog?.kind === "schedule" && (
        <TimeDialog
          heading="Plan a session"
          subject={dialog.item.title}
          start={nextQuarter(date, tz)}
          minutes={Math.min(dialog.item.estimate_minutes ?? 30, 1440)}
          tz={tz}
          busy={timeBusy}
          error={timeError}
          fromLocal={fromLocal}
          onSave={(times) => void saveTime(times)}
          onClose={() => {
            setTimeError("");
            setDialog(null);
          }}
        />
      )}
      {dialog?.kind === "move" && (
        <TimeDialog
          heading="Change time"
          subject={dialog.block.title}
          start={new Date(dialog.block.start_at)}
          minutes={Math.round(
            (Date.parse(dialog.block.end_at) -
              Date.parse(dialog.block.start_at)) /
              60_000,
          )}
          tz={tz}
          busy={timeBusy}
          error={timeError}
          fromLocal={fromLocal}
          onSave={(times) => void saveTime(times)}
          onClose={() => {
            setTimeError("");
            setDialog(null);
          }}
        />
      )}
      {dialog?.kind === "ghost" && (
        <TimeDialog
          heading="Move planned session"
          subject={dialog.ghost.title}
          start={new Date(dialog.ghost.start_at)}
          minutes={Math.round(
            (Date.parse(dialog.ghost.end_at) -
              Date.parse(dialog.ghost.start_at)) /
              60_000,
          )}
          tz={tz}
          minimumMinutes={1}
          minuteStep={1}
          hint="Updates this preview. Apply the plan to save it."
          fromLocal={fromLocal}
          onSave={(times) => {
            const ghost = dialog.ghost;
            setDialog(null);
            void plan.pin(
              ghost,
              new Date(times.start_at),
              new Date(times.end_at),
            );
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === "manage" && (
        <ManageDialog
          tab={dialog.tab}
          frameId={dialog.frameId}
          workspace={workspace}
          activeSet={setId}
          onActiveSetGone={() => chooseSet("")}
          onClose={() => setDialog(null)}
          onChanged={refreshAll}
        />
      )}
      {actions.ask?.kind === "scope" && (
        <ScopeDialog
          kind={actions.ask.entry.kind}
          action="move"
          onChoose={(scope: EditScope) => actions.answerScope(scope)}
          onCancel={() => actions.setAsk(null)}
        />
      )}
      {actions.ask?.kind === "deadline" && (
        <DeadlineChoice
          title={actions.ask.entry.title}
          when={new Date(actions.ask.times.start_at).toLocaleString(undefined, {
            weekday: "short",
            day: "numeric",
            month: "short",
            hour: "numeric",
            minute: "2-digit",
            timeZone: tz,
          })}
          onPlan={() => void actions.answerDeadline("plan")}
          onMove={() => void actions.answerDeadline("move")}
          onCancel={() => actions.setAsk(null)}
        />
      )}
      {focusItem && (
        <FocusMode
          key={focusItem.id}
          item={focusItem}
          items={workspace.items}
          canWrite={workspace.canWrite(focusItem)}
          breakLevel={prefs.break_level}
          onClose={() => {
            setFocusItem(null);
            setFocusVersion((n) => n + 1);
          }}
          onSwitch={setFocusItem}
          onChanged={refreshAll}
        />
      )}
    </div>
  );
}
