import {
  parseRrule,
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
import { useEffect, useState, type FormEvent } from "react";
import { messageOf, useResource } from "../../lib/resource";
import { client } from "../../lib/session";
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
export function FramesPanel({
  workspace,
  startId,
  onChanged,
}: {
  workspace: Workspace;
  startId?: string;
  onChanged: () => void;
}) {
  const confirm = useConfirm();
  const toast = useToast();
  const frames = useResource(() => client.listFrames(), []);
  const [editing, setEditing] = useState<Frame | "new" | null>(null);
  const [opened, setOpened] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (opened || !startId || !frames.data) return;
    setOpened(true);
    const frame = frames.data.find((f) => f.id === startId);
    if (frame) setEditing(frame);
    else setError("This frame no longer exists.");
  }, [frames.data, opened, startId]);

  const remove = async (frame: Frame) => {
    const yes = await confirm({
      title: `Delete “${frame.name}”?`,
      body: "All occurrences of this frame are removed. Tasks are unchanged.",
      action: "Delete",
      danger: true,
    });
    if (!yes) return;
    setError("");
    try {
      await client.deleteFrame(frame.id);
      await frames.reload();
      toast({ text: "Frame deleted." });
      onChanged();
    } catch (failure) {
      setError(messageOf(failure, "Couldn't delete that frame."));
    }
  };

  if (editing)
    return (
      <FrameForm
        key={editing === "new" ? "new" : editing.id}
        frame={editing === "new" ? null : editing}
        workspace={workspace}
        onCancel={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
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
        <Button onClick={() => setEditing("new")}>
          <Plus aria-hidden="true" /> Add frame
        </Button>
      </div>
      {error && <ErrorNotice message={error} />}
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
            <IconButton label={`Edit ${f.name}`} onClick={() => setEditing(f)}>
              <Pencil />
            </IconButton>
            <IconButton
              label={`Delete ${f.name}`}
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
}: {
  frame: Frame | null;
  workspace: Workspace;
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

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const problem =
      needsDays && !days.length
        ? "Pick at least one day."
        : mode === "custom" && !custom.trim()
          ? "Write a repeat rule, like FREQ=WEEKLY;BYDAY=MO,WE."
          : end <= start
            ? "A frame ends after it starts."
            : "";
    if (problem) {
      setError(problem);
      return;
    }
    const body = {
      name: name.trim(),
      days: days.length ? days : [1, 2, 3, 4, 5],
      start_time: start,
      end_time: end,
      color,
      filters,
      rrule: rule,
      busy: busyFrame,
      timezone: timezone || null,
    };
    setBusy(true);
    setError("");
    try {
      if (frame) await client.updateFrame(frame.id, body);
      else await client.createFrame(body);
      onSaved();
    } catch (failure) {
      setError(messageOf(failure, "Couldn't save this frame."));
    } finally {
      setBusy(false);
    }
  };
  const bringBack = async (date: string) => {
    if (!frame) return;
    setBusy(true);
    setError("");
    try {
      const next = await client.unskipFrame(frame.id, date);
      setSkipped(next.exdates ?? []);
    } catch (failure) {
      setError(messageOf(failure, "Couldn't bring that day back."));
    } finally {
      setBusy(false);
    }
  };
  const checks = (
    choices: { id: string; name: string }[],
    key: "list_ids" | "tag_ids" | "team_ids",
    legend: string,
  ) =>
    choices.length > 0 && (
      <fieldset className="calendar-fieldset">
        <legend>{legend}</legend>
        <div className="calendar-checks">
          {choices.map((x) => (
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
      {error && <ErrorNotice message={error} />}
      <div className="dialog-actions">
        <Button variant="ghost" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" busy={busy}>
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
export function HabitsPanel({ onChanged }: { onChanged: () => void }) {
  const confirm = useConfirm();
  const toast = useToast();
  const habits = useResource(() => client.listHabits(), []);
  const [editing, setEditing] = useState<Habit | "new" | null>(null);
  const [plan, setPlan] = useState<HabitPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const when = (iso: string) =>
    new Date(iso).toLocaleString(undefined, {
      weekday: "short",
      hour: "numeric",
      minute: "2-digit",
      timeZone: tz,
    });

  const act = async (work: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (failure) {
      setError(messageOf(failure, "Couldn't change your habits."));
    } finally {
      setBusy(false);
    }
  };
  const remove = async (h: Habit) => {
    const yes = await confirm({
      title: `Delete the habit “${h.name}”?`,
      action: "Delete",
      danger: true,
    });
    if (!yes) return;
    void act(async () => {
      await client.deleteHabit(h.id);
      habits.set((all) => all?.filter((x) => x.id !== h.id));
      setPlan(null);
      toast({ text: "Habit deleted." });
    });
  };
  const planWeek = () =>
    void act(async () => {
      const result = await client.planHabits({ days: 7 });
      setPlan(result);
      if (!result.blocks.length)
        toast({ text: "Your habits are on track this week." });
    });
  const apply = () =>
    void act(async () => {
      if (!plan) return;
      const saved = await client.applyHabitPlan(
        plan.blocks.map((b) => ({
          habit_id: b.habit_id,
          start_at: b.start_at,
          end_at: b.end_at,
        })),
      );
      setPlan(null);
      toast({
        text: `Added ${plural(saved.length, "session")} to your calendar.`,
      });
      onChanged();
    });

  if (editing)
    return (
      <HabitForm
        key={editing === "new" ? "new" : editing.id}
        habit={editing === "new" ? null : editing}
        onCancel={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
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
          disabled={busy || !habits.data}
          onClick={() => setEditing("new")}
        >
          <Plus aria-hidden="true" /> Add habit
        </Button>
      </div>
      {error && <ErrorNotice message={error} />}
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
              disabled={busy}
              onClick={() => setEditing(h)}
            >
              <Pencil />
            </IconButton>
            <IconButton
              label={`Delete ${h.name}`}
              disabled={busy}
              onClick={() => void remove(h)}
            >
              <Trash2 />
            </IconButton>
          </div>
        ))}
      </div>
      {habits.data?.some((h) => h.active) && (
        <Button disabled={busy} onClick={planWeek}>
          <CalendarClock aria-hidden="true" />{" "}
          {busy ? "Planning" : "Plan this week's habits"}
        </Button>
      )}
      {plan && plan.blocks.length > 0 && (
        <div className="calendar-flags">
          <h4>{plural(plan.blocks.length, "session")} found</h4>
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
          <Button variant="primary" disabled={busy} onClick={apply}>
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
}: {
  habit: Habit | null;
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
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const problem =
      (from === "") !== (to === "")
        ? "Set both ends of the window, or leave both blank."
        : !name.trim() || !days.length
          ? "Add a name and choose at least one day."
          : from && to <= from
            ? "The time window must end after it starts."
            : "";
    if (problem) {
      setError(problem);
      return;
    }
    const body: HabitInput = {
      name: name.trim(),
      cadence,
      period,
      duration_minutes: duration,
      days,
      window_start: from || null,
      window_end: to || null,
      priority,
      active,
    };
    setBusy(true);
    setError("");
    try {
      if (habit) await client.updateHabit(habit.id, body);
      else await client.createHabit(body);
      onSaved();
    } catch (failure) {
      setError(messageOf(failure, "Couldn't save this habit."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="calendar-form"
      onSubmit={(e) => void submit(e)}
      aria-busy={busy}
    >
      <h3>{habit ? "Edit habit" : "Add habit"}</h3>
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
      {error && <ErrorNotice message={error} />}
      <div className="dialog-actions">
        <Button variant="ghost" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" busy={busy}>
          {habit ? "Save habit" : "Add habit"}
        </Button>
      </div>
    </form>
  );
}
