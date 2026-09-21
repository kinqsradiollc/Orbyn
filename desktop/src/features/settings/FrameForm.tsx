import { Select } from "../../components/Select";
import { useState, type FormEvent, type ReactNode } from "react";
import { Undo2 } from "lucide-react";
import {
  PRIORITIES,
  parseRrule,
  type Frame,
  type FrameFilters,
  type Priority,
  type Team,
} from "@orbyn/core";
import { client } from "../../lib/api";
import { usePlanning } from "../../app/planning";
import { OutcomeNote, useAction } from "../../components/Outcome";
import { DayPicker } from "../../components/DayPicker";
import { Swatches } from "../lists/ListsView";
import { longDay, SWATCHES, timeZones } from "../../lib/planning";

/** How a frame repeats: chosen weekdays, a preset rule, or custom RRULE text. */
type RepeatMode =
  | "days"
  | "weekdays"
  | "biweekly"
  | "first-weekday"
  | "last-weekday"
  | "last-day"
  | "custom";

const REPEAT_OPTIONS: { id: RepeatMode; label: string }[] = [
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
const everyOtherWeek = (days: number[]) =>
  "FREQ=WEEKLY;INTERVAL=2;BYDAY=" +
  [...days]
    .sort((a, b) => a - b)
    .map((d) => CODES[d])
    .join(",");

/** The repeat choice that matches a saved rule. */
function repeatOf(rrule: string | null | undefined): {
  mode: RepeatMode;
  days?: number[];
} {
  if (!rrule) return { mode: "days" };
  const text = rrule.trim().toUpperCase();
  const preset = REPEAT_OPTIONS.find((o) => PRESETS[o.id] === text);
  if (preset) return { mode: preset.id };
  const rule = parseRrule(text);
  if (rule?.byDay.length && text === everyOtherWeek(rule.byDay))
    return { mode: "biweekly", days: rule.byDay };
  return { mode: "custom" };
}

type Draft = {
  name: string;
  days: number[];
  start_time: string;
  end_time: string;
  color: string;
  filters: FrameFilters;
  mode: RepeatMode;
  custom: string;
  busy: boolean;
  /** "" for the planner's time zone. */
  timezone: string;
};

const draftOf = (f: Frame | null): Draft => {
  if (!f)
    return {
      name: "",
      days: [1, 2, 3, 4, 5],
      start_time: "09:00",
      end_time: "12:00",
      color: SWATCHES[2],
      filters: {
        priorities: [],
        list_ids: [],
        tag_ids: [],
        team_ids: [],
        min_minutes: null,
        max_minutes: null,
      },
      mode: "days",
      custom: "",
      busy: false,
      timezone: "",
    };
  const repeat = repeatOf(f.rrule);
  return {
    name: f.name,
    days: repeat.days ?? f.days,
    start_time: f.start_time,
    end_time: f.end_time,
    color: f.color,
    filters: f.filters,
    mode: repeat.mode,
    custom: repeat.mode === "custom" ? (f.rrule ?? "") : "",
    busy: !!f.busy,
    timezone: f.timezone ?? "",
  };
};

const ruleOf = (d: Draft) =>
  d.mode === "days"
    ? null
    : d.mode === "biweekly"
      ? everyOtherWeek(d.days)
      : d.mode === "custom"
        ? d.custom.trim()
        : (PRESETS[d.mode] ?? null);

const toggle = <T,>(xs: T[], x: T) =>
  xs.includes(x) ? xs.filter((y) => y !== x) : [...xs, x];

type Props = {
  /** The frame to edit, or null for a new one. */
  frame: Frame | null;
  teams: Team[];
  report: (e: unknown) => void;
  onSaved: (frame: Frame) => void;
  onCancel: () => void;
  heading?: ReactNode;
};

/**
 * A frame's name, how it repeats (weekdays, presets or a custom rule the
 * server checks), times and time zone, busy or free, colour, which tasks go
 * in it, and the days it's skipped on. Used in Settings and on the calendar.
 */
export function FrameForm({
  frame,
  teams,
  report,
  onSaved,
  onCancel,
  heading,
}: Props) {
  const { lists, tags } = usePlanning();
  const [draft, setDraft] = useState(() => draftOf(frame));
  const [skipped, setSkipped] = useState(frame?.exdates ?? []);
  const action = useAction(report);
  const zones = timeZones();
  const needsDays = draft.mode === "days" || draft.mode === "biweekly";

  const set = (patch: Partial<Draft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    action.setOutcome(null);
  };
  const setFilter = <K extends keyof FrameFilters>(k: K, v: FrameFilters[K]) =>
    set({ filters: { ...draft.filters, [k]: v } });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const problem =
      needsDays && !draft.days.length
        ? "Pick at least one day."
        : draft.mode === "custom" && !draft.custom.trim()
          ? "Write a repeat rule, like FREQ=WEEKLY;BYDAY=MO,WE."
          : draft.end_time <= draft.start_time
            ? "A frame ends after it starts."
            : "";
    if (problem) {
      action.setOutcome({ ok: false, text: problem });
      return;
    }
    const body = {
      name: draft.name.trim(),
      days: draft.days.length ? draft.days : [1, 2, 3, 4, 5],
      start_time: draft.start_time,
      end_time: draft.end_time,
      color: draft.color,
      filters: draft.filters,
      rrule: ruleOf(draft),
      busy: draft.busy,
      timezone: draft.timezone || null,
    };
    void action.run(async () => {
      onSaved(
        frame
          ? await client.updateFrame(frame.id, body)
          : await client.createFrame(body),
      );
    });
  };

  const bringBack = (date: string) => {
    if (!frame) return;
    void action.run(async () => {
      const next = await client.unskipFrame(frame.id, date);
      setSkipped(next.exdates ?? []);
      return `${longDay(date)} is back.`;
    });
  };

  const checks = (
    items: { id: string; name: string }[],
    key: "list_ids" | "tag_ids" | "team_ids",
    legend: string,
  ) =>
    items.length > 0 && (
      <fieldset className="check-group">
        <legend>{legend}</legend>
        <div className="check-grid">
          {items.map((x) => (
            <label key={x.id} className="check-line">
              <input
                type="checkbox"
                checked={draft.filters[key].includes(x.id)}
                onChange={() =>
                  setFilter(key, toggle(draft.filters[key], x.id))
                }
              />
              {x.name}
            </label>
          ))}
        </div>
      </fieldset>
    );

  return (
    <form className="settings-subform frame-form" onSubmit={submit}>
      {heading && <h3 className="settings-subtitle">{heading}</h3>}
      <div className="settings-grid">
        <div className="settings-field wide">
          <label htmlFor="frame-name">Name</label>
          <input
            id="frame-name"
            required
            maxLength={60}
            autoFocus
            value={draft.name}
            placeholder="Deep work"
            onChange={(e) => set({ name: e.target.value })}
          />
        </div>
        <div className="settings-field wide">
          <label htmlFor="frame-repeat">Repeats</label>
          <Select
            id="frame-repeat"
            value={draft.mode}
            onChange={(e) => set({ mode: e.target.value as RepeatMode })}
          >
            {REPEAT_OPTIONS.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </Select>
        </div>
        {needsDays && (
          <div className="settings-field wide">
            <span className="settings-label">Days</span>
            <DayPicker
              label="Frame days"
              value={draft.days}
              onChange={(days) => set({ days })}
            />
          </div>
        )}
        {draft.mode === "custom" && (
          <div className="settings-field wide">
            <label htmlFor="frame-rule">Repeat rule</label>
            <input
              id="frame-rule"
              maxLength={200}
              spellCheck={false}
              value={draft.custom}
              placeholder="FREQ=MONTHLY;BYMONTHDAY=1,15"
              aria-describedby="frame-rule-hint"
              onChange={(e) => set({ custom: e.target.value })}
            />
            <small id="frame-rule-hint" className="field-hint">
              An iCalendar RRULE. It&apos;s checked when you save.
            </small>
          </div>
        )}
        <div className="settings-field">
          <label htmlFor="frame-start">Starts</label>
          <input
            id="frame-start"
            type="time"
            required
            value={draft.start_time}
            onChange={(e) => set({ start_time: e.target.value })}
          />
        </div>
        <div className="settings-field">
          <label htmlFor="frame-end">Ends</label>
          <input
            id="frame-end"
            type="time"
            required
            value={draft.end_time}
            onChange={(e) => set({ end_time: e.target.value })}
          />
        </div>
        <div className="settings-field">
          <label htmlFor="frame-zone">Time zone</label>
          <Select
            id="frame-zone"
            value={draft.timezone}
            onChange={(e) => set({ timezone: e.target.value })}
          >
            <option value="">Your planner time zone</option>
            {draft.timezone && !zones.includes(draft.timezone) && (
              <option value={draft.timezone}>{draft.timezone}</option>
            )}
            {zones.map((z) => (
              <option key={z} value={z}>
                {z.replaceAll("_", " ")}
              </option>
            ))}
          </Select>
        </div>
        <label className="switch-line settings-field">
          <input
            type="checkbox"
            role="switch"
            className="ai-switch"
            checked={draft.busy}
            onChange={(e) => set({ busy: e.target.checked })}
          />
          <span>
            Busy
            <small>Busy frames block booking pages and team suggestions.</small>
          </span>
        </label>
        <div className="settings-field wide">
          <span className="settings-label">Colour</span>
          <Swatches
            label="Frame colour"
            value={draft.color}
            onChange={(color) => set({ color })}
          />
        </div>
      </div>
      <p className="muted">Which tasks go here (leave blank for any task):</p>
      <fieldset className="check-group">
        <legend>Priorities</legend>
        <div className="check-grid">
          {PRIORITIES.map((p: Priority) => (
            <label key={p} className="check-line">
              <input
                type="checkbox"
                checked={draft.filters.priorities.includes(p)}
                onChange={() =>
                  setFilter("priorities", toggle(draft.filters.priorities, p))
                }
              />
              <span className="capitalize">{p}</span>
            </label>
          ))}
        </div>
      </fieldset>
      {checks(
        lists.map((l) => ({
          id: l.id,
          name: l.team_name ? `${l.name} · ${l.team_name}` : l.name,
        })),
        "list_ids",
        "Lists",
      )}
      {checks(
        tags.map((t) => ({ id: t.id, name: t.name })),
        "tag_ids",
        "Tags",
      )}
      {checks(
        teams.map((t) => ({ id: t.id, name: t.name })),
        "team_ids",
        "Teams",
      )}
      <div className="settings-grid">
        <div className="settings-field">
          <label htmlFor="frame-min">At least (min)</label>
          <input
            id="frame-min"
            type="number"
            min={1}
            max={10080}
            value={draft.filters.min_minutes ?? ""}
            placeholder="Any"
            onChange={(e) =>
              setFilter(
                "min_minutes",
                e.target.value ? Number(e.target.value) : null,
              )
            }
          />
        </div>
        <div className="settings-field">
          <label htmlFor="frame-max">At most (min)</label>
          <input
            id="frame-max"
            type="number"
            min={1}
            max={10080}
            value={draft.filters.max_minutes ?? ""}
            placeholder="Any"
            onChange={(e) =>
              setFilter(
                "max_minutes",
                e.target.value ? Number(e.target.value) : null,
              )
            }
          />
        </div>
      </div>
      {frame && skipped.length > 0 && (
        <div className="settings-field">
          <span className="settings-label">Skipped days</span>
          <ul className="chip-list">
            {skipped.map((d) => (
              <li key={d} className="chip">
                {longDay(d)}
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Bring back ${longDay(d)}`}
                  title="Bring back"
                  disabled={action.pending}
                  onClick={() => bringBack(d)}
                >
                  <Undo2 size={12} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="button-row">
        <button type="button" className="secondary" onClick={onCancel}>
          Cancel
        </button>
        <button className="primary" disabled={action.pending}>
          {frame ? "Save frame" : "Add frame"}
        </button>
      </div>
      <OutcomeNote outcome={action.outcome} />
    </form>
  );
}
