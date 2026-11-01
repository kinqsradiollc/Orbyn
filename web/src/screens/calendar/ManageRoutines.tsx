import {
  parseRrule,
  frameInput,
  habitInput,
  HttpError,
  type FrameInput,
  PRIORITIES,
  type Frame,
  type FrameFilters,
  type Habit,
  type HabitInput,
  type HabitPlan,
  type Priority,
} from "@orbyn/core";
import {
  CalendarClock,
  Check,
  Pencil,
  Plus,
  Trash2,
  Undo2,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
} from "react";
import { messageOf, useResource } from "../../lib/resource";
import {
  client,
  getSessionVersion,
  getToken,
  onToken,
} from "../../lib/session";
import {
  Button,
  Empty,
  ErrorNotice,
  Field,
  IconButton,
  Input,
  Loading,
  SelectBox,
  useConfirm,
  useToast,
} from "../../ui/kit";
import { SWATCHES } from "../shared-task/format";
import { dayLong, minutesLabel } from "./format";
import { plural } from "./model";
import type { Workspace } from "./useWorkspace";

export type RoutineEditorState = {
  dirty: boolean;
  pending: boolean;
  uncertain: boolean;
};
export type FrameCatalog = Pick<Workspace, "lists" | "tags" | "teams">;
type Report = (state: RoutineEditorState) => void;
const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
const uncertainFailure = (failure: unknown) =>
  !(failure instanceof HttpError) ||
  failure.statusCode >= 500 ||
  [408, 429].includes(failure.statusCode);
function useOwner() {
  const generation = useRef(getSessionVersion()).current;
  const mounted = useRef(true);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return useCallback(
    () => mounted.current && !!getToken() && getSessionVersion() === generation,
    [generation],
  );
}
/** Report only semantic state changes; callback identity must not create a render loop. */
function useReport(report: Report | undefined, state: RoutineEditorState) {
  const callback = useRef(report);
  callback.current = report;
  useLayoutEffect(() => {
    callback.current?.(state);
  }, [state.dirty, state.pending, state.uncertain]);
}
// Receipts last 24 hours server-side. Leave a margin and refuse clock rollback.
const replayable = (at: number) => {
  const age = Date.now() - at;
  return Number.isFinite(age) && age >= 0 && age < 23 * 60 * 60 * 1000;
};
const CLEAR: RoutineEditorState = {
  dirty: false,
  pending: false,
  uncertain: false,
};

type RepeatMode =
  | "days"
  | "weekdays"
  | "biweekly"
  | "first-weekday"
  | "last-weekday"
  | "last-day"
  | "custom";

const REPEATS: { id: RepeatMode; label: string }[] = [
  { id: "days", label: "Every week on these days" },
  { id: "weekdays", label: "Every weekday" },
  { id: "biweekly", label: "Every other week on these days" },
  { id: "first-weekday", label: "First weekday of the month" },
  { id: "last-weekday", label: "Last weekday of the month" },
  { id: "last-day", label: "Last day of the month" },
  { id: "custom", label: "Custom rule" },
];
const PRESETS: Partial<Record<RepeatMode, string>> = {
  weekdays: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR",
  "first-weekday": "FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=1",
  "last-weekday": "FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1",
  "last-day": "FREQ=MONTHLY;BYMONTHDAY=-1",
};
const CODES = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
const biweekly = (days: number[]) =>
  `FREQ=WEEKLY;INTERVAL=2;BYDAY=${[...days]
    .sort((a, b) => a - b)
    .map((d) => CODES[d])
    .join(",")}`;

function repeatOf(rrule: string | null | undefined): {
  mode: RepeatMode;
  days?: number[];
} {
  if (!rrule) return { mode: "days" };
  const text = rrule.trim().toUpperCase();
  const preset = REPEATS.find((o) => PRESETS[o.id] === text);
  if (preset) return { mode: preset.id };
  const rule = parseRrule(text);
  if (rule?.byDay.length && text === biweekly(rule.byDay))
    return { mode: "biweekly", days: rule.byDay };
  return { mode: "custom" };
}

const BLANK_FILTERS: FrameFilters = {
  priorities: [],
  list_ids: [],
  tag_ids: [],
  team_ids: [],
  min_minutes: null,
  max_minutes: null,
};

const flip = <T,>(xs: T[], x: T) =>
  xs.includes(x) ? xs.filter((y) => y !== x) : [...xs, x];
const WEEK = [1, 2, 3, 4, 5, 6, 0];
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function DayChips({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number[];
  onChange: (days: number[]) => void;
}) {
  return (
    <fieldset className="calendar-fieldset">
      <legend>{label}</legend>
      <div className="calendar-daychoice" role="group" aria-label={label}>
        {WEEK.map((d) => (
          <button
            key={d}
            type="button"
            aria-pressed={value.includes(d)}
            onClick={() => onChange(flip(value, d).sort((a, b) => a - b))}
          >
            {DAY_NAMES[d]}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

const zones = () => {
  try {
    return Intl.supportedValuesOf("timeZone");
  } catch {
    return ["UTC"];
  }
};

/** Recurring windows for a kind of work, drawn as bands behind the calendar. */
export function FramesPanel(props: {
  workspace: FrameCatalog;
  startId?: string;
  onChanged: () => void;
  onStateChange?: Report;
}) {
  const generation = useSyncExternalStore(onToken, getSessionVersion);
  return <FramesBody key={generation} {...props} />;
}
function FramesBody({
  workspace,
  startId,
  onChanged,
  onStateChange,
}: {
  workspace: FrameCatalog;
  startId?: string;
  onChanged: () => void;
  onStateChange?: Report;
}) {
  const owned = useOwner(),
    confirm = useConfirm(),
    toast = useToast();
  const frames = useResource(() => {
    if (!owned()) throw new Error("This account session has changed.");
    return client.listFrames();
  }, []);
  const [editing, setEditing] = useState<Frame | "new" | null>(null),
    [opened, setOpened] = useState(false),
    [error, setError] = useState("");
  const [pending, setPending] = useState(false),
    [unknown, setUnknown] = useState<Frame | null>(null),
    [child, setChild] = useState(CLEAR);
  const lock = useRef(false),
    unknownRef = useRef<Frame | null>(null);
  const reportChild = useCallback(
    (next: RoutineEditorState) =>
      setChild((old) => (same(old, next) ? old : next)),
    [],
  );
  useReport(onStateChange, {
    dirty: !!editing && child.dirty,
    pending: pending || child.pending,
    uncertain: !!unknown || child.uncertain,
  });
  useEffect(() => {
    if (!owned() || opened || !startId || !frames.data) return;
    setOpened(true);
    const frame = frames.data.find((row) => row.id === startId);
    if (frame) setEditing(frame);
    else setError("This frame no longer exists.");
  }, [frames.data, opened, startId, owned]);
  const remove = async (frame: Frame) => {
    if (!owned() || lock.current || unknownRef.current) return;
    lock.current = true;
    setPending(true);
    try {
      if (
        !(await confirm({
          title: `Delete “${frame.name}”?`,
          body: "All occurrences of this frame are removed. Tasks are unchanged.",
          action: "Delete",
          danger: true,
        }))
      )
        return;
      if (!owned()) return;
      await client.deleteFrame(frame.id);
      if (!owned()) return;
      frames.set((rows) => rows?.filter((row) => row.id !== frame.id));
      setError("");
      toast({ text: "Frame deleted." });
      onChanged();
    } catch (failure) {
      if (owned()) {
        if (uncertainFailure(failure)) {
          unknownRef.current = frame;
          setUnknown(frame);
        }
        setError(messageOf(failure, "Couldn't delete that frame."));
      }
    } finally {
      lock.current = false;
      if (owned()) setPending(false);
    }
  };
  const checkDelete = async () => {
    if (!owned() || lock.current || !unknownRef.current) return;
    const target = unknownRef.current;
    lock.current = true;
    setPending(true);
    try {
      const rows = await client.listFrames();
      if (!owned() || unknownRef.current !== target) return;
      frames.set(() => rows);
      if (rows.some((row) => row.id === target.id)) {
        setError(
          "This frame is still saved. The earlier deletion may still finish; keep checking before making another change.",
        );
      } else {
        unknownRef.current = null;
        setUnknown(null);
        setError("");
        onChanged();
      }
    } catch (failure) {
      if (owned()) setError(messageOf(failure, "Couldn't check saved frames."));
    } finally {
      lock.current = false;
      if (owned()) setPending(false);
    }
  };
  if (editing)
    return (
      <FrameForm
        key={editing === "new" ? "new" : editing.id}
        frame={editing === "new" ? null : editing}
        workspace={workspace}
        onStateChange={reportChild}
        onCancel={() => {
          if (owned()) {
            setEditing(null);
            setChild(CLEAR);
          }
        }}
        onSaved={() => {
          if (!owned()) return;
          setEditing(null);
          setChild(CLEAR);
          void frames.reload();
          toast({ text: "Frame saved." });
          onChanged();
        }}
      />
    );
  return (
    <div className="calendar-form">
      <div className="calendar-side-head">
        <span className="small muted">Windows reserved for a kind of work</span>
        <Button
          disabled={pending || !!unknown || !frames.data}
          onClick={() => {
            if (owned() && !lock.current && !unknownRef.current)
              setEditing("new");
          }}
        >
          <Plus aria-hidden="true" /> Add frame
        </Button>
      </div>
      {error && <ErrorNotice message={error} />}
      {unknown && (
        <div>
          <p>
            The deletion is unconfirmed. Check saved frames before continuing.
          </p>
          <Button disabled={pending} onClick={() => void checkDelete()}>
            Check saved frames
          </Button>
        </div>
      )}
      {frames.error && !frames.data && (
        <ErrorNotice
          message="Couldn't load frames."
          onRetry={() => void frames.reload()}
        />
      )}
      {frames.loading && !frames.data && <Loading label="Loading frames" />}
      {frames.data && !frames.data.length && <Empty title="No frames yet" />}
      <div className="rows">
        {frames.data?.map((f) => (
          <div key={f.id} className="calendar-person">
            <i
              className="calendar-dot"
              style={{ background: f.color }}
              aria-hidden="true"
            />
            <span className="row-main">
              <span className="row-title" dir="auto">
                {f.name}
              </span>
              <small className="muted">
                {f.start_time} to {f.end_time}
                {f.busy ? " · Busy" : ""}
              </small>
            </span>
            <IconButton
              label={`Edit ${f.name}`}
              disabled={pending || !!unknown}
              onClick={() => {
                if (owned() && !lock.current && !unknownRef.current)
                  setEditing(f);
              }}
            >
              <Pencil />
            </IconButton>
            <IconButton
              label={`Delete ${f.name}`}
              disabled={pending || !!unknown}
              onClick={() => void remove(f)}
            >
              <Trash2 />
            </IconButton>
          </div>
        ))}
      </div>
    </div>
  );
}

function FrameForm({
  frame,
  workspace,
  onCancel,
  onSaved,
  onStateChange,
}: {
  frame: Frame | null;
  workspace: FrameCatalog;
  onStateChange?: Report;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const repeat = repeatOf(frame?.rrule);
  const [name, setName] = useState(frame?.name ?? "");
  const [mode, setMode] = useState<RepeatMode>(repeat.mode);
  const [days, setDays] = useState(
    repeat.days ?? frame?.days ?? [1, 2, 3, 4, 5],
  );
  const [custom, setCustom] = useState(
    repeat.mode === "custom" ? (frame?.rrule ?? "") : "",
  );
  const [start, setStart] = useState(frame?.start_time ?? "09:00");
  const [end, setEnd] = useState(frame?.end_time ?? "12:00");
  const [color, setColor] = useState<string>(frame?.color ?? SWATCHES[2]);
  const [filters, setFilters] = useState<FrameFilters>(
    frame?.filters ?? BLANK_FILTERS,
  );
  const [busyFrame, setBusyFrame] = useState(!!frame?.busy);
  const [timezone, setTimezone] = useState(frame?.timezone ?? "");
  const [skipped, setSkipped] = useState(frame?.exdates ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const needsDays = mode === "days" || mode === "biweekly";
  const rule =
    mode === "days"
      ? null
      : mode === "biweekly"
        ? biweekly(days)
        : mode === "custom"
          ? custom.trim()
          : (PRESETS[mode] ?? null);

  const owned = useOwner(),
    confirm = useConfirm(),
    lock = useRef(false),
    unknownRef = useRef(false);
  const [confirming, setConfirming] = useState(false),
    [unknown, setUnknown] = useState(false),
    [matches, setMatches] = useState<Frame[] | null>(null);
  const body: FrameInput = {
    name: name.trim(),
    days: days.length ? days : [1, 2, 3, 4, 5],
    start_time: start,
    end_time: end,
    color,
    filters,
    rrule: rule,
    busy: busyFrame,
    timezone: timezone || null,
    exdates: skipped,
  };
  const signature = JSON.stringify({
    name,
    mode,
    days,
    custom,
    start,
    end,
    color,
    filters,
    busyFrame,
    timezone,
  });
  const baseline = useRef(signature).current,
    latest = useRef(signature);
  latest.current = signature;
  const attempt = useRef<
    | {
        kind: "save";
        body: FrameInput;
        id: string | null;
        priorIds: readonly string[];
      }
    | { kind: "restore"; date: string }
    | null
  >(null);
  const dirty = signature !== baseline,
    frozen = busy || confirming || unknown;
  useReport(onStateChange, {
    dirty,
    pending: busy || confirming,
    uncertain: unknown,
  });
  const cancel = async () => {
    if (!owned() || lock.current || unknownRef.current) return;
    const buffer = latest.current;
    lock.current = true;
    setConfirming(true);
    try {
      if (
        dirty &&
        !(await confirm({
          title: "Discard frame changes?",
          action: "Discard changes",
          danger: true,
        }))
      )
        return;
      if (owned() && latest.current === buffer) onCancel();
    } finally {
      lock.current = false;
      if (owned()) setConfirming(false);
    }
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!owned() || lock.current || unknownRef.current) return;
    const checked = frameInput.safeParse(body);
    const problem =
      needsDays && !days.length
        ? "Pick at least one day."
        : mode === "custom" && !custom.trim()
          ? "Write a repeat rule, like FREQ=WEEKLY;BYDAY=MO,WE."
          : !checked.success
            ? (checked.error.issues[0]?.message ?? "Check this frame.")
            : "";
    if (problem) {
      setError(problem);
      return;
    }
    if (!checked.success) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setMatches(null);
    attempt.current = null;
    let dispatched = false;
    try {
      const prior = frame ? [] : await client.listFrames();
      if (!owned()) return;
      attempt.current = {
        kind: "save",
        id: frame?.id ?? null,
        body: structuredClone(checked.data),
        priorIds: prior.map((row) => row.id),
      };
      dispatched = true;
      if (frame) await client.updateFrame(frame.id, checked.data);
      else await client.createFrame(checked.data);
      if (owned()) onSaved();
    } catch (failure) {
      if (owned()) {
        unknownRef.current = dispatched && uncertainFailure(failure);
        setUnknown(unknownRef.current);
        setError(
          messageOf(failure, "Couldn't save this frame. Your draft is kept."),
        );
      }
    } finally {
      lock.current = false;
      if (owned()) setBusy(false);
    }
  };
  const bringBack = async (date: string) => {
    if (!frame || !owned() || lock.current || unknownRef.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setMatches(null);
    attempt.current = { kind: "restore", date };
    try {
      const next = await client.unskipFrame(frame.id, date);
      if (owned()) setSkipped(next.exdates ?? []);
    } catch (failure) {
      if (owned()) {
        unknownRef.current = uncertainFailure(failure);
        setUnknown(unknownRef.current);
        setError(messageOf(failure, "Couldn't bring that day back."));
      }
    } finally {
      lock.current = false;
      if (owned()) setBusy(false);
    }
  };
  const checkSaved = async () => {
    if (!owned() || lock.current || !attempt.current) return;
    const submitted = attempt.current;
    lock.current = true;
    setBusy(true);
    try {
      const rows = await client.listFrames();
      if (!owned() || attempt.current !== submitted) return;
      if (submitted.kind === "restore") {
        const saved = rows.find((row) => row.id === frame?.id);
        if (saved && !(saved.exdates ?? []).includes(submitted.date)) {
          setSkipped(saved.exdates ?? []);
          unknownRef.current = false;
          setUnknown(false);
          attempt.current = null;
          setError("");
        } else
          setError(
            "That day has not been confirmed as restored. Check again before continuing.",
          );
      } else {
        setMatches(
          rows.filter(
            (row) =>
              (submitted.id
                ? row.id === submitted.id
                : !submitted.priorIds.includes(row.id)) &&
              Object.entries(submitted.body).every(([key, value]) =>
                same(row[key as keyof Frame], value),
              ),
          ),
        );
        setError(
          "The save is unconfirmed. Choose a matching saved frame to continue without creating another.",
        );
      }
    } catch (failure) {
      if (owned()) setError(messageOf(failure, "Couldn't check saved frames."));
    } finally {
      lock.current = false;
      if (owned()) setBusy(false);
    }
  };
  const useSaved = async (saved: Frame) => {
    const submitted = attempt.current;
    if (
      !owned() ||
      lock.current ||
      !matches?.includes(saved) ||
      submitted?.kind !== "save" ||
      !(submitted.id
        ? saved.id === submitted.id
        : !submitted.priorIds.includes(saved.id)) ||
      !Object.entries(submitted.body).every(([key, value]) =>
        same(saved[key as keyof Frame], value),
      )
    )
      return;
    lock.current = true;
    setConfirming(true);
    try {
      if (
        !(await confirm({
          title: "Use the saved frame?",
          body: "Keep this existing frame instead of repeating the unconfirmed save.",
          action: "Use saved frame",
        }))
      )
        return;
      if (
        owned() &&
        attempt.current === submitted &&
        matches?.includes(saved) &&
        (submitted.id
          ? saved.id === submitted.id
          : !submitted.priorIds.includes(saved.id)) &&
        Object.entries(submitted.body).every(([key, value]) =>
          same(saved[key as keyof Frame], value),
        )
      ) {
        unknownRef.current = false;
        onSaved();
      }
    } finally {
      lock.current = false;
      if (owned()) setConfirming(false);
    }
  };
  const checks = (
    choices: { id: string; name: string }[],
    key: "list_ids" | "tag_ids" | "team_ids",
    legend: string,
  ) =>
    (choices.length > 0 || filters[key].length > 0) && (
      <fieldset className="calendar-fieldset">
        <legend>{legend}</legend>
        <div className="calendar-checks">
          {[
            ...choices,
            ...filters[key]
              .filter((id) => !choices.some((choice) => choice.id === id))
              .map((id) => ({ id, name: `Unavailable selection (${id})` })),
          ].map((x) => (
            <label key={x.id} className="check">
              <input
                type="checkbox"
                checked={filters[key].includes(x.id)}
                onChange={() =>
                  setFilters({ ...filters, [key]: flip(filters[key], x.id) })
                }
              />
              <span dir="auto">{x.name}</span>
            </label>
          ))}
        </div>
      </fieldset>
    );
  const count =
    filters.priorities.length +
    filters.list_ids.length +
    filters.tag_ids.length +
    filters.team_ids.length;
  const zoneList = zones();
  return (
    <form
      className="calendar-form"
      onSubmit={(e) => void submit(e)}
      aria-busy={busy}
    >
      <h3>{frame ? "Edit frame" : "Add frame"}</h3>
      <fieldset disabled={frozen} className="calendar-fieldset">
        <legend className="sr-only">Frame settings</legend>
        <Field label="Name">
          <Input
            autoFocus
            required
            dir="auto"
            maxLength={60}
            placeholder="Deep work"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field label="Repeats">
          <SelectBox
            value={mode}
            onChange={(e) => setMode(e.target.value as RepeatMode)}
          >
            {REPEATS.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </SelectBox>
        </Field>
        {needsDays && <DayChips label="Days" value={days} onChange={setDays} />}
        {mode === "custom" && (
          <Field
            label="Repeat rule"
            hint="An iCalendar RRULE. It's checked when you save."
          >
            <Input
              maxLength={200}
              spellCheck={false}
              placeholder="FREQ=MONTHLY;BYMONTHDAY=1,15"
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
            />
          </Field>
        )}
        <div className="calendar-form-grid">
          <Field label="Starts">
            <Input
              type="time"
              required
              value={start}
              onChange={(e) => setStart(e.target.value)}
            />
          </Field>
          <Field label="Ends">
            <Input
              type="time"
              required
              value={end}
              onChange={(e) => setEnd(e.target.value)}
            />
          </Field>
          <Field label="Time zone">
            <SelectBox
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
            >
              <option value="">Your planner time zone</option>
              {timezone && !zoneList.includes(timezone) && (
                <option value={timezone}>{timezone}</option>
              )}
              {zoneList.map((z) => (
                <option key={z} value={z}>
                  {z.replaceAll("_", " ")}
                </option>
              ))}
            </SelectBox>
          </Field>
        </div>
        <label className="check">
          <input
            type="checkbox"
            checked={busyFrame}
            onChange={(e) => setBusyFrame(e.target.checked)}
          />
          Busy: blocks booking pages and team suggestions
        </label>
        <fieldset className="calendar-fieldset">
          <legend>Colour</legend>
          <div
            className="calendar-swatches"
            role="radiogroup"
            aria-label="Frame colour"
          >
            {SWATCHES.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={color.toLowerCase() === c}
                aria-label={c}
                style={{ background: c }}
                onClick={() => setColor(c)}
              />
            ))}
          </div>
        </fieldset>
        <details className="calendar-more-section">
          <summary>
            Task filters · {count ? `${count} picked` : "All tasks"}
            {filters.min_minutes !== null
              ? ` · at least ${filters.min_minutes} min`
              : ""}
            {filters.max_minutes !== null
              ? ` · at most ${filters.max_minutes} min`
              : ""}
          </summary>
          <p className="small muted">Unpicked categories allow any task.</p>
          <fieldset className="calendar-fieldset">
            <legend>Priorities</legend>
            <div className="calendar-checks">
              {PRIORITIES.map((p: Priority) => (
                <label key={p} className="check">
                  <input
                    type="checkbox"
                    checked={filters.priorities.includes(p)}
                    onChange={() =>
                      setFilters({
                        ...filters,
                        priorities: flip(filters.priorities, p),
                      })
                    }
                  />
                  {p[0].toUpperCase() + p.slice(1)}
                </label>
              ))}
            </div>
          </fieldset>
          {checks(
            workspace.lists.map((l) => ({
              id: l.id,
              name: l.team_name ? `${l.name} · ${l.team_name}` : l.name,
            })),
            "list_ids",
            "Lists",
          )}
          {checks(
            workspace.tags.map((t) => ({ id: t.id, name: t.name })),
            "tag_ids",
            "Tags",
          )}
          {checks(
            workspace.teams.map((t) => ({ id: t.id, name: t.name })),
            "team_ids",
            "Teams",
          )}
          <div className="calendar-form-grid">
            <Field label="At least (min)">
              <Input
                type="number"
                min={1}
                max={10080}
                placeholder="Any"
                value={filters.min_minutes ?? ""}
                onChange={(e) =>
                  setFilters({
                    ...filters,
                    min_minutes: e.target.value ? Number(e.target.value) : null,
                  })
                }
              />
            </Field>
            <Field label="At most (min)">
              <Input
                type="number"
                min={1}
                max={10080}
                placeholder="Any"
                value={filters.max_minutes ?? ""}
                onChange={(e) =>
                  setFilters({
                    ...filters,
                    max_minutes: e.target.value ? Number(e.target.value) : null,
                  })
                }
              />
            </Field>
          </div>
        </details>
        {frame && skipped.length > 0 && (
          <fieldset className="calendar-fieldset">
            <legend>Skipped days</legend>
            <div className="calendar-tags">
              {skipped.map((d) => (
                <span key={d} className="pill">
                  {dayLong(d)}
                  <button
                    type="button"
                    aria-label={`Bring back ${dayLong(d)}`}
                    disabled={busy}
                    onClick={() => void bringBack(d)}
                  >
                    <Undo2 aria-hidden="true" />
                  </button>
                </span>
              ))}
            </div>
          </fieldset>
        )}
      </fieldset>
      {error && <ErrorNotice message={error} />}
      {unknown && (
        <div>
          <p>Your change is unconfirmed; the draft is kept.</p>
          <Button
            disabled={busy || confirming}
            onClick={() => void checkSaved()}
          >
            Check saved frames
          </Button>
          {matches?.length === 0 && (
            <p>No matching frame found. Keep this draft and check again.</p>
          )}
          {matches?.map((saved) => (
            <div key={saved.id}>
              <strong>{saved.name}</strong>
              <p>
                {saved.start_time}–{saved.end_time} ·{" "}
                {saved.timezone ?? "Planner time zone"}
              </p>
              <Button
                disabled={busy || confirming}
                onClick={() => void useSaved(saved)}
              >
                Use saved frame
              </Button>
            </div>
          ))}
        </div>
      )}
      <div className="dialog-actions">
        <Button variant="ghost" disabled={frozen} onClick={() => void cancel()}>
          Cancel
        </Button>
        <Button
          type="submit"
          variant="primary"
          busy={busy}
          disabled={confirming || unknown}
        >
          {frame ? "Save frame" : "Add frame"}
        </Button>
      </div>
    </form>
  );
}

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
const daysLabel = (days: number[]) =>
  days.join(",") === "1,2,3,4,5"
    ? "weekdays"
    : days.length === 7
      ? "any day"
      : days.map((d) => DAY_NAMES[d]).join(", ");

/** Flexible routines the planner fits into free time. */
export function HabitsPanel(props: {
  onChanged: () => void;
  onStateChange?: Report;
}) {
  const generation = useSyncExternalStore(onToken, getSessionVersion);
  return <HabitsBody key={generation} {...props} />;
}
function HabitsBody({
  onChanged,
  onStateChange,
}: {
  onChanged: () => void;
  onStateChange?: Report;
}) {
  const owned = useOwner(),
    confirm = useConfirm(),
    toast = useToast();
  const habits = useResource(() => {
      if (!owned()) throw new Error("This account session has changed.");
      return client.listHabits();
    }, []),
    prefs = useResource(() => {
      if (!owned()) throw new Error("This account session has changed.");
      return client.getPlannerPrefs();
    }, []);
  const [editing, setEditing] = useState<Habit | "new" | null>(null),
    [plan, setPlan] = useState<HabitPlan | null>(null),
    [planTimezone, setPlanTimezone] = useState<string>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [unknown, setUnknown] = useState(false),
    [child, setChild] = useState(CLEAR),
    [checkedCalendar, setCheckedCalendar] = useState<string | null>(null);
  const lock = useRef(false),
    unknownRef = useRef(false),
    pending = useRef<
      | { kind: "delete"; habit: Habit; key: string; at: number }
      | { kind: "apply"; plan: HabitPlan }
      | null
    >(null);
  const reportChild = useCallback(
    (next: RoutineEditorState) =>
      setChild((old) => (same(old, next) ? old : next)),
    [],
  );
  useReport(onStateChange, {
    dirty: child.dirty,
    pending: busy || child.pending,
    uncertain: unknown || child.uncertain,
  });
  const tz = planTimezone ?? prefs.data?.timezone;
  const when = (iso: string) =>
    new Date(iso).toLocaleString(undefined, {
      weekday: "short",
      hour: "numeric",
      minute: "2-digit",
      ...(tz ? { timeZone: tz } : {}),
    });
  const remove = async (habit: Habit, replay = false) => {
    if (!owned() || lock.current || (unknownRef.current && !replay)) return;
    const prior = pending.current;
    if (replay && (prior?.kind !== "delete" || prior.habit.id !== habit.id))
      return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      if (!replay) {
        if (
          !(await confirm({
            title: `Delete the habit “${habit.name}”?`,
            action: "Delete",
            danger: true,
          }))
        )
          return;
        if (!owned()) return;
        pending.current = {
          kind: "delete",
          habit,
          key: crypto.randomUUID(),
          at: Date.now(),
        };
      }
      const attempt = pending.current;
      if (attempt?.kind !== "delete" || !owned()) return;
      if (replay && !replayable(attempt.at)) {
        setError(
          "The retry window has expired or the clock changed. Review saved habits; this deletion cannot be safely repeated here.",
        );
        return;
      }
      await client.once(attempt.key, () => client.deleteHabit(habit.id));
      if (!owned() || pending.current !== attempt) return;
      habits.set((rows) => rows?.filter((row) => row.id !== habit.id));
      setPlan(null);
      unknownRef.current = false;
      setUnknown(false);
      pending.current = null;
      toast({ text: "Habit deleted." });
      onChanged();
    } catch (failure) {
      if (owned()) {
        unknownRef.current = unknownRef.current || uncertainFailure(failure);
        setUnknown(unknownRef.current);
        setError(messageOf(failure, "Couldn't delete this habit."));
      }
    } finally {
      lock.current = false;
      if (owned()) setBusy(false);
    }
  };
  const reviewDeletedHabit = async () => {
    const attempt = pending.current;
    if (!owned() || lock.current || attempt?.kind !== "delete") return;
    lock.current = true;
    setBusy(true);
    try {
      const rows = await client.listHabits();
      if (!owned() || pending.current !== attempt) return;
      const saved = rows.find((row) => row.id === attempt.habit.id);
      setError(
        saved
          ? `Saved habit: ${saved.name} · ${saved.cadence} per ${saved.period} · ${saved.duration_minutes} minutes. This snapshot does not resolve the earlier deletion.`
          : "The habit is absent in the current snapshot. This cannot prove the outcome of the earlier request; its retry remains blocked after expiry.",
      );
    } catch (failure) {
      if (owned())
        setError(messageOf(failure, "Couldn't review saved habits."));
    } finally {
      lock.current = false;
      if (owned()) setBusy(false);
    }
  };
  const planWeek = async () => {
    if (
      !owned() ||
      lock.current ||
      unknownRef.current ||
      !prefs.data ||
      prefs.error
    )
      return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const currentPrefs = await client.getPlannerPrefs();
      if (!owned()) return;
      const result = await client.planHabits({ days: 7 });
      if (owned()) {
        setPlanTimezone(currentPrefs.timezone);
        setPlan(result);
      }
    } catch (failure) {
      if (owned())
        setError(messageOf(failure, "Couldn't preview this week's habits."));
    } finally {
      lock.current = false;
      if (owned()) setBusy(false);
    }
  };
  const apply = async () => {
    if (!owned() || lock.current || unknownRef.current || !plan?.blocks.length)
      return;
    const candidate = plan;
    lock.current = true;
    setBusy(true);
    setError("");
    pending.current = { kind: "apply", plan: candidate };
    setCheckedCalendar(null);
    try {
      const saved = await client.applyHabitPlan(
        candidate.blocks.map(({ habit_id, start_at, end_at }) => ({
          habit_id,
          start_at,
          end_at,
        })),
      );
      if (!owned()) return;
      pending.current = null;
      setPlan(null);
      toast({
        text: `Added ${plural(saved.length, "session")} to your calendar.${saved.length < candidate.blocks.length ? " Sessions that now clash were skipped." : ""}`,
      });
      onChanged();
    } catch (failure) {
      if (owned()) {
        unknownRef.current = unknownRef.current || uncertainFailure(failure);
        setUnknown(unknownRef.current);
        setError(
          messageOf(
            failure,
            "Couldn't confirm the calendar change. Your preview is kept.",
          ),
        );
      }
    } finally {
      lock.current = false;
      if (owned()) setBusy(false);
    }
  };
  const checkCalendar = async () => {
    const attempt = pending.current;
    if (!owned() || lock.current || attempt?.kind !== "apply") return;
    lock.current = true;
    setBusy(true);
    try {
      const times = attempt.plan.blocks
          .flatMap((block) => [block.start_at, block.end_at])
          .sort(),
        calendar = await client.calendar(times[0], times[times.length - 1]);
      if (!owned() || pending.current !== attempt) return;
      const found = attempt.plan.blocks.filter((proposed) =>
        (calendar.habit_blocks ?? []).some(
          (saved) =>
            saved.habit_id === proposed.habit_id &&
            new Date(saved.start_at).getTime() ===
              new Date(proposed.start_at).getTime() &&
            new Date(saved.end_at).getTime() ===
              new Date(proposed.end_at).getTime(),
        ),
      ).length;
      setCheckedCalendar(
        `${found} of ${attempt.plan.blocks.length} proposed sessions currently match your calendar. This read cannot prove which request added them. Keep the current calendar and make a fresh preview to continue.`,
      );
    } catch (failure) {
      if (owned())
        setError(messageOf(failure, "Couldn't check your calendar."));
    } finally {
      lock.current = false;
      if (owned()) setBusy(false);
    }
  };
  const keepCalendar = async () => {
    const attempt = pending.current;
    if (
      !owned() ||
      lock.current ||
      !checkedCalendar ||
      attempt?.kind !== "apply"
    )
      return;
    lock.current = true;
    setBusy(true);
    try {
      if (
        !(await confirm({
          title: "Keep the current calendar?",
          body: "Leave existing sessions as they are and discard this unconfirmed preview. A fresh preview will account for saved sessions.",
          action: "Keep current calendar",
        }))
      )
        return;
      if (owned() && pending.current === attempt) {
        pending.current = null;
        unknownRef.current = false;
        setUnknown(false);
        setPlan(null);
        setError("");
        setCheckedCalendar(null);
        onChanged();
      }
    } finally {
      lock.current = false;
      if (owned()) setBusy(false);
    }
  };
  if (editing)
    return (
      <HabitForm
        key={editing === "new" ? "new" : editing.id}
        habit={editing === "new" ? null : editing}
        onStateChange={reportChild}
        onCancel={() => {
          if (owned()) {
            setEditing(null);
            setChild(CLEAR);
          }
        }}
        onSaved={() => {
          if (!owned()) return;
          setEditing(null);
          setChild(CLEAR);
          setPlan(null);
          void habits.reload();
          onChanged();
        }}
      />
    );
  return (
    <div className="calendar-form" aria-busy={busy}>
      <div className="calendar-side-head">
        <span className="small muted">
          Routines that move as your calendar changes
        </span>
        <Button
          disabled={busy || unknown || !habits.data}
          onClick={() => {
            if (owned() && !lock.current && !unknownRef.current)
              setEditing("new");
          }}
        >
          <Plus aria-hidden="true" /> Add habit
        </Button>
      </div>
      {error && <ErrorNotice message={error} />}
      {prefs.error && (
        <ErrorNotice
          message="Couldn't load your planner time zone."
          onRetry={() => void prefs.reload()}
        />
      )}
      {unknown && (
        <div>
          <p>
            The change is unconfirmed. No automatic retry will add sessions.
          </p>
          {pending.current?.kind === "delete" ? (
            <div>
              <Button
                disabled={busy || !replayable(pending.current.at)}
                onClick={() => {
                  const attempt = pending.current;
                  if (attempt?.kind === "delete")
                    void remove(attempt.habit, true);
                }}
              >
                Retry same deletion
              </Button>
              <Button disabled={busy} onClick={() => void reviewDeletedHabit()}>
                Review saved habit
              </Button>
              {!replayable(pending.current.at) && (
                <p>
                  The retry window has expired or the clock changed. Saved-state
                  review will not resolve the original request.
                </p>
              )}
            </div>
          ) : (
            <>
              <Button disabled={busy} onClick={() => void checkCalendar()}>
                Check saved sessions
              </Button>
              {checkedCalendar && (
                <>
                  <p>{checkedCalendar}</p>
                  <Button disabled={busy} onClick={() => void keepCalendar()}>
                    Keep current calendar
                  </Button>
                </>
              )}
            </>
          )}
        </div>
      )}
      {habits.error && !habits.data && (
        <ErrorNotice
          message="Couldn't load habits."
          onRetry={() => void habits.reload()}
        />
      )}
      {habits.loading && !habits.data && <Loading label="Loading habits" />}
      {habits.data && !habits.data.length && <Empty title="No habits yet" />}
      <div className="rows">
        {habits.data?.map((h) => (
          <div key={h.id} className="calendar-person">
            <span className="row-main">
              <span className="row-title" dir="auto">
                {h.name}
                {!h.active && <small className="muted"> · paused</small>}
              </span>
              <small className="muted">
                {h.cadence}× / {h.period} · {minutesLabel(h.duration_minutes)} ·{" "}
                {daysLabel(h.days)}
                {h.window_start && h.window_end
                  ? ` · ${h.window_start} to ${h.window_end}`
                  : ""}
                {h.progress
                  ? ` · ${h.progress.done} of ${h.progress.target} set aside`
                  : ""}
              </small>
            </span>
            <IconButton
              label={`Edit ${h.name}`}
              disabled={busy || unknown}
              onClick={() => {
                if (owned() && !lock.current && !unknownRef.current)
                  setEditing(h);
              }}
            >
              <Pencil />
            </IconButton>
            <IconButton
              label={`Delete ${h.name}`}
              disabled={busy || unknown}
              onClick={() => void remove(h)}
            >
              <Trash2 />
            </IconButton>
          </div>
        ))}
      </div>
      {habits.data?.some((h) => h.active) && (
        <Button
          disabled={busy || unknown || !prefs.data || !!prefs.error}
          onClick={() => void planWeek()}
        >
          <CalendarClock aria-hidden="true" />{" "}
          {busy ? "Planning" : "Plan this week's habits"}
        </Button>
      )}
      {plan && (
        <div className="calendar-flags">
          <h4>{plural(plan.blocks.length, "session")} found</h4>
          {tz && (
            <p className="small muted">Times in {tz.replaceAll("_", " ")}</p>
          )}
          {plan.blocks.map((b) => (
            <p key={`${b.habit_id}-${b.start_at}`} className="small" dir="auto">
              {b.name}
              <span className="muted">
                {" "}
                · {when(b.start_at)} to {when(b.end_at)}
              </span>
            </p>
          ))}
          {plan.summary
            .filter((s) => s.reason)
            .map((s) => (
              <p key={s.habit_id} className="small muted" dir="auto">
                {s.name}: {s.reason}
              </p>
            ))}
          <Button
            variant="primary"
            disabled={busy || unknown || !plan.blocks.length}
            onClick={() => void apply()}
          >
            <Check aria-hidden="true" /> Add to calendar
          </Button>
        </div>
      )}
    </div>
  );
}

function HabitForm({
  habit,
  onCancel,
  onSaved,
  onStateChange,
}: {
  habit: Habit | null;
  onStateChange?: Report;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(habit?.name ?? "");
  const [cadence, setCadence] = useState(habit?.cadence ?? 3);
  const [period, setPeriod] = useState<"day" | "week">(habit?.period ?? "week");
  const [duration, setDuration] = useState(habit?.duration_minutes ?? 30);
  const [days, setDays] = useState(habit?.days ?? ALL_DAYS);
  const [from, setFrom] = useState(habit?.window_start ?? "");
  const [to, setTo] = useState(habit?.window_end ?? "");
  const [priority, setPriority] = useState<Priority>(
    habit?.priority ?? "medium",
  );
  const [active, setActive] = useState(habit?.active ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const owned = useOwner(),
    confirm = useConfirm(),
    lock = useRef(false),
    unknownRef = useRef(false);
  const [confirming, setConfirming] = useState(false),
    [unknown, setUnknown] = useState(false);
  const signature = JSON.stringify({
      name,
      cadence,
      period,
      duration,
      days,
      from,
      to,
      priority,
      active,
    }),
    baseline = useRef(signature).current,
    latest = useRef(signature);
  latest.current = signature;
  const attempt = useRef<{ key: string; body: HabitInput; at: number } | null>(
    null,
  );
  const dirty = signature !== baseline,
    frozen = busy || confirming || unknown;
  useReport(onStateChange, {
    dirty,
    pending: busy || confirming,
    uncertain: unknown,
  });
  const cancel = async () => {
    if (!owned() || lock.current || unknownRef.current) return;
    const buffer = latest.current;
    lock.current = true;
    setConfirming(true);
    try {
      if (
        dirty &&
        !(await confirm({
          title: "Discard habit changes?",
          action: "Discard changes",
          danger: true,
        }))
      )
        return;
      if (owned() && latest.current === buffer) onCancel();
    } finally {
      lock.current = false;
      if (owned()) setConfirming(false);
    }
  };
  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!owned() || lock.current) return;
    let submitted = attempt.current;
    if (!unknownRef.current) {
      if ((from === "") !== (to === "")) {
        setError("Set both ends of the window, or leave both blank.");
        return;
      }
      const checked = habitInput.safeParse({
        name: name.trim(),
        cadence,
        period,
        duration_minutes: duration,
        days,
        window_start: from || null,
        window_end: to || null,
        priority,
        active,
      });
      if (!checked.success) {
        setError(checked.error.issues[0]?.message ?? "Check this habit.");
        return;
      }
      submitted = {
        key: crypto.randomUUID(),
        body: checked.data,
        at: Date.now(),
      };
      attempt.current = submitted;
    }
    if (!submitted) return;
    if (unknownRef.current && !replayable(submitted.at)) {
      setError(
        "The retry window has expired or the clock changed. Review saved habits; this save cannot be safely repeated here.",
      );
      return;
    }
    const request = submitted;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await client.once(request.key, () =>
        habit
          ? client.updateHabit(habit.id, request.body)
          : client.createHabit(request.body),
      );
      if (owned() && attempt.current === request) {
        unknownRef.current = false;
        onSaved();
      }
    } catch (failure) {
      if (owned()) {
        unknownRef.current = unknownRef.current || uncertainFailure(failure);
        setUnknown(unknownRef.current);
        setError(
          messageOf(failure, "Couldn't save this habit. Your draft is kept."),
        );
      }
    } finally {
      lock.current = false;
      if (owned()) setBusy(false);
    }
  };
  const reviewSavedHabit = async () => {
    const submitted = attempt.current;
    if (!owned() || lock.current || !submitted) return;
    lock.current = true;
    setBusy(true);
    try {
      const rows = await client.listHabits();
      if (!owned() || attempt.current !== submitted) return;
      const candidates = rows.filter((row) =>
        habit ? row.id === habit.id : row.name === submitted.body.name,
      );
      setError(
        candidates.length
          ? `Current saved habits: ${candidates.map((row) => `${row.name} (${row.cadence} per ${row.period}, ${row.duration_minutes} minutes)`).join("; ")}. This snapshot does not resolve the original request.`
          : "No matching saved habit in this snapshot. This does not prove the earlier save failed; its retry remains blocked after expiry.",
      );
    } catch (failure) {
      if (owned())
        setError(messageOf(failure, "Couldn't review saved habits."));
    } finally {
      lock.current = false;
      if (owned()) setBusy(false);
    }
  };
  return (
    <form
      className="calendar-form"
      onSubmit={(e) => void submit(e)}
      aria-busy={busy}
    >
      <h3>{habit ? "Edit habit" : "Add habit"}</h3>
      <fieldset disabled={frozen} className="calendar-fieldset">
        <legend className="sr-only">Habit settings</legend>
        <Field label="Name">
          <Input
            autoFocus
            required
            dir="auto"
            maxLength={60}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <div className="calendar-form-grid">
          <Field label="How often">
            <Input
              type="number"
              min={1}
              max={period === "day" ? 6 : 21}
              value={cadence}
              onChange={(e) => setCadence(Number(e.target.value))}
            />
          </Field>
          <Field label="Per">
            <SelectBox
              value={period}
              onChange={(e) => setPeriod(e.target.value as "day" | "week")}
            >
              <option value="week">Week</option>
              <option value="day">Day</option>
            </SelectBox>
          </Field>
          <Field label="Minutes">
            <Input
              type="number"
              min={5}
              max={480}
              step={5}
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
            />
          </Field>
        </div>
        <DayChips label="Allowed days" value={days} onChange={setDays} />
        <div className="calendar-form-grid">
          <Field label="From (optional)">
            <Input
              type="time"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </Field>
          <Field label="To (optional)">
            <Input
              type="time"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </Field>
          <Field label="Priority">
            <SelectBox
              value={priority}
              onChange={(e) => setPriority(e.target.value as Priority)}
            >
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </SelectBox>
          </Field>
        </div>
        <label className="check">
          <input
            type="checkbox"
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
          />
          Plan time for this habit
        </label>
      </fieldset>
      {error && <ErrorNotice message={error} />}
      {unknown && (
        <div>
          <p>
            The save is unconfirmed. Your draft is frozen so a retry uses the
            same request identity.
          </p>
          <Button
            disabled={
              busy ||
              confirming ||
              !attempt.current ||
              !replayable(attempt.current.at)
            }
            onClick={() => void submit()}
          >
            Retry same save
          </Button>
          <Button
            disabled={busy || confirming}
            onClick={() => void reviewSavedHabit()}
          >
            Review saved habits
          </Button>
          {attempt.current && !replayable(attempt.current.at) && (
            <p>
              The retry window has expired or the clock changed. Saved-state
              review will not resolve the original request.
            </p>
          )}
        </div>
      )}
      <div className="dialog-actions">
        <Button variant="ghost" disabled={frozen} onClick={() => void cancel()}>
          Cancel
        </Button>
        <Button
          type="submit"
          variant="primary"
          busy={busy}
          disabled={confirming || unknown}
        >
          {habit ? "Save habit" : "Add habit"}
        </Button>
      </div>
    </form>
  );
}
