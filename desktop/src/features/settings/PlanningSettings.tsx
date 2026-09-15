import { useEffect, useState, type FormEvent } from "react";
import { MapPin, Pencil, Plus, Save, Trash2, X } from "lucide-react";
import {
  BREAK_LEVELS,
  PRIORITIES,
  type BreakLevel,
  type Frame,
  type FrameFilters,
  type Place,
  type PlannerPrefs,
  type Priority,
  type Team,
} from "@orbyn/core";
import { client } from "../../lib/api";
import { usePlanning } from "../../app/planning";
import { OutcomeNote, useAction } from "../../components/Outcome";
import { Swatches } from "../lists/ListsView";
import { BREAK_LABELS } from "../calendar/PlannerPanel";
import {
  deviceTimeZone,
  minutesLabel,
  SWATCHES,
  timeZones,
  WEEKDAY_SHORT,
  zoneCity,
} from "../../lib/planning";

type Props = { teams: Team[]; report: (e: unknown) => void };

type Draft = Omit<PlannerPrefs, "calendar_sets" | "pinned_user_ids">;
const draftFrom = (p: PlannerPrefs): Draft => {
  const { calendar_sets, pinned_user_ids, ...rest } = p;
  void calendar_sets;
  void pinned_user_ids;
  return rest;
};

/** Toggle buttons for weekdays (0 = Sunday). */
export function DayPicker({
  value,
  onChange,
  label,
}: {
  value: number[];
  onChange: (days: number[]) => void;
  label: string;
}) {
  return (
    <div className="day-toggles" role="group" aria-label={label}>
      {WEEKDAY_SHORT.map((name, day) => {
        const on = value.includes(day);
        return (
          <button
            key={name}
            type="button"
            aria-pressed={on}
            className={on ? "active" : ""}
            onClick={() =>
              onChange(
                on
                  ? value.filter((d) => d !== day)
                  : [...value, day].sort((a, b) => a - b),
              )
            }
          >
            {name}
          </button>
        );
      })}
    </div>
  );
}

const daysLabel = (days: number[]) =>
  days.join(",") === "1,2,3,4,5"
    ? "Weekdays"
    : days.length === 7
      ? "Every day"
      : days.map((d) => WEEKDAY_SHORT[d]).join(", ");

function NumberInput({
  id,
  label,
  hint,
  value,
  min,
  max,
  onChange,
}: {
  id: string;
  label: string;
  hint?: string;
  value: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
}) {
  return (
    <div className="settings-field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="number"
        inputMode="numeric"
        required
        min={min}
        max={max}
        value={value}
        aria-describedby={hint ? id + "-hint" : undefined}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      {hint && (
        <small id={id + "-hint"} className="field-hint">
          {hint}
        </small>
      )}
    </div>
  );
}

/**
 * How you like to work: time zone, working hours, how the planner pads and
 * splits tasks, buffers and travel, extra time zones, frames and places.
 */
export function PlanningSettings({ teams, report }: Props) {
  const { prefs, savePrefs } = usePlanning();
  const [draft, setDraft] = useState<Draft | null>(prefs && draftFrom(prefs));
  const [zoneToAdd, setZoneToAdd] = useState("");
  const save = useAction(report);
  const zones = timeZones();

  useEffect(() => {
    if (prefs && !draft) setDraft(draftFrom(prefs));
  }, [prefs, draft]);

  if (!draft)
    return (
      <section className="card settings-card">
        <p className="muted">Loading your planning settings…</p>
      </section>
    );

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((d) => d && { ...d, [key]: value });
    save.setOutcome(null);
  };
  const device = deviceTimeZone();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!draft.work_days.length) {
      save.setOutcome({ ok: false, text: "Pick at least one working day." });
      return;
    }
    if (draft.work_end <= draft.work_start) {
      save.setOutcome({
        ok: false,
        text: "Working hours must end after they start.",
      });
      return;
    }
    void save.run(async () => {
      const next = await savePrefs(draft);
      setDraft(draftFrom(next));
      return "Saved. The planner uses these from now on.";
    });
  };

  return (
    <>
      <section className="card settings-card" aria-labelledby="work-title">
        <form onSubmit={submit}>
          <h2 id="work-title">How you work</h2>
          <p className="muted">
            The planner, buffers and travel time all follow these.
          </p>
          <div className="settings-grid">
            <div className="settings-field wide">
              <label htmlFor="pref-zone">Time zone</label>
              <div className="field-row">
                <select
                  id="pref-zone"
                  value={draft.timezone}
                  onChange={(e) => set("timezone", e.target.value)}
                >
                  {!zones.includes(draft.timezone) && (
                    <option value={draft.timezone}>{draft.timezone}</option>
                  )}
                  {zones.map((z) => (
                    <option key={z} value={z}>
                      {z.replaceAll("_", " ")}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="secondary"
                  disabled={draft.timezone === device}
                  onClick={() => set("timezone", device)}
                >
                  Use this device&apos;s time zone
                </button>
              </div>
              {draft.timezone !== device && (
                <small className="field-hint">
                  This device is set to {device.replaceAll("_", " ")}.
                </small>
              )}
            </div>
            <div className="settings-field wide">
              <span className="settings-label" id="work-days-label">
                Working days
              </span>
              <DayPicker
                label="Working days"
                value={draft.work_days}
                onChange={(d) => set("work_days", d)}
              />
            </div>
            <div className="settings-field">
              <label htmlFor="pref-start">Work starts</label>
              <input
                id="pref-start"
                type="time"
                required
                value={draft.work_start}
                onChange={(e) => set("work_start", e.target.value)}
              />
            </div>
            <div className="settings-field">
              <label htmlFor="pref-end">Work ends</label>
              <input
                id="pref-end"
                type="time"
                required
                value={draft.work_end}
                onChange={(e) => set("work_end", e.target.value)}
              />
            </div>
            <NumberInput
              id="pref-days"
              label="Days to plan by default"
              value={draft.horizon_days}
              min={1}
              max={7}
              onChange={(n) => set("horizon_days", n)}
            />
          </div>

          <h3 className="settings-subtitle">Planner</h3>
          <div className="settings-grid">
            <NumberInput
              id="pref-pad"
              label="Padding (%)"
              hint="Extra time added to each estimate."
              value={draft.pad_percent}
              min={0}
              max={100}
              onChange={(n) => set("pad_percent", n)}
            />
            <NumberInput
              id="pref-split"
              label="Split tasks longer than (min)"
              hint="Longer tasks become several sessions."
              value={draft.split_after_minutes}
              min={15}
              max={480}
              onChange={(n) => set("split_after_minutes", n)}
            />
            <NumberInput
              id="pref-min"
              label="Shortest block (min)"
              value={draft.min_block_minutes}
              min={5}
              max={240}
              onChange={(n) => set("min_block_minutes", n)}
            />
            <div className="settings-field">
              <label htmlFor="pref-breaks">Breaks</label>
              <select
                id="pref-breaks"
                value={draft.break_level}
                onChange={(e) =>
                  set("break_level", e.target.value as BreakLevel)
                }
              >
                {BREAK_LEVELS.map((b) => (
                  <option key={b} value={b}>
                    {BREAK_LABELS[b]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <h3 className="settings-subtitle">Buffers and travel</h3>
          <div className="settings-grid">
            <NumberInput
              id="pref-before"
              label="Buffer before events (min)"
              value={draft.buffer_before_minutes}
              min={0}
              max={120}
              onChange={(n) => set("buffer_before_minutes", n)}
            />
            <NumberInput
              id="pref-after"
              label="Buffer after events (min)"
              value={draft.buffer_after_minutes}
              min={0}
              max={120}
              onChange={(n) => set("buffer_after_minutes", n)}
            />
            <NumberInput
              id="pref-travel"
              label="Default travel time (min)"
              hint="For events with a location that matches no place."
              value={draft.default_travel_minutes}
              min={0}
              max={240}
              onChange={(n) => set("default_travel_minutes", n)}
            />
            <label className="switch-line settings-field">
              <input
                type="checkbox"
                role="switch"
                className="ai-switch"
                checked={draft.adaptive_buffers}
                onChange={(e) => set("adaptive_buffers", e.target.checked)}
              />
              <span>
                Adaptive buffers
                <small>Longer buffers around longer events.</small>
              </span>
            </label>
          </div>

          <h3 className="settings-subtitle">Extra time zones</h3>
          <p className="muted">
            Shown as extra columns on the calendar (up to 3).
          </p>
          <ul className="chip-list">
            {draft.extra_timezones.map((z) => (
              <li key={z} className="chip">
                {zoneCity(z)}
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Remove ${z}`}
                  onClick={() =>
                    set(
                      "extra_timezones",
                      draft.extra_timezones.filter((x) => x !== z),
                    )
                  }
                >
                  <X size={12} />
                </button>
              </li>
            ))}
          </ul>
          {draft.extra_timezones.length < 3 && (
            <div className="field-row">
              <label className="sr-only" htmlFor="pref-add-zone">
                Time zone to add
              </label>
              <select
                id="pref-add-zone"
                value={zoneToAdd}
                onChange={(e) => setZoneToAdd(e.target.value)}
              >
                <option value="">Choose a time zone…</option>
                {zones
                  .filter((z) => !draft.extra_timezones.includes(z))
                  .map((z) => (
                    <option key={z} value={z}>
                      {z.replaceAll("_", " ")}
                    </option>
                  ))}
              </select>
              <button
                type="button"
                className="secondary"
                disabled={!zoneToAdd}
                onClick={() => {
                  set("extra_timezones", [...draft.extra_timezones, zoneToAdd]);
                  setZoneToAdd("");
                }}
              >
                <Plus size={14} /> Add
              </button>
            </div>
          )}

          <div className="settings-footer">
            <button className="primary" disabled={save.pending}>
              <Save size={14} />{" "}
              {save.pending ? "Saving…" : "Save planning settings"}
            </button>
            <OutcomeNote outcome={save.outcome} />
          </div>
        </form>
      </section>
      <FramesEditor teams={teams} report={report} />
      <PlacesEditor report={report} />
    </>
  );
}

// ---- Frames ------------------------------------------------------------------

type FrameDraft = {
  name: string;
  days: number[];
  start_time: string;
  end_time: string;
  color: string;
  filters: FrameFilters;
};
const blankFrame = (): FrameDraft => ({
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
});
const toggle = <T,>(xs: T[], x: T) =>
  xs.includes(x) ? xs.filter((y) => y !== x) : [...xs, x];

function filterSummary(f: FrameFilters, names: Map<string, string>) {
  const parts: string[] = [];
  if (f.priorities.length) parts.push(f.priorities.join(" or ") + " priority");
  const named = [...f.list_ids, ...f.tag_ids, ...f.team_ids]
    .map((id) => names.get(id))
    .filter(Boolean);
  if (named.length) parts.push(named.join(", "));
  if (f.min_minutes) parts.push(`at least ${minutesLabel(f.min_minutes)}`);
  if (f.max_minutes) parts.push(`at most ${minutesLabel(f.max_minutes)}`);
  return parts.length ? parts.join(" · ") : "Any task";
}

/** Frames: recurring windows reserved for a kind of work. */
function FramesEditor({ teams, report }: Props) {
  const { lists, tags } = usePlanning();
  const [frames, setFrames] = useState<Frame[] | null>(null);
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [draft, setDraft] = useState<FrameDraft>(blankFrame);
  const action = useAction(report);

  const load = () =>
    client.listFrames().then(setFrames, (e) => {
      setFrames([]);
      report(e);
    });
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const names = new Map<string, string>([
    ...lists.map((l) => [l.id, l.name] as [string, string]),
    ...tags.map((t) => [t.id, "#" + t.name] as [string, string]),
    ...teams.map((t) => [t.id, t.name] as [string, string]),
  ]);
  const setFilter = <K extends keyof FrameFilters>(k: K, v: FrameFilters[K]) =>
    setDraft((d) => ({ ...d, filters: { ...d.filters, [k]: v } }));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!draft.days.length) {
      action.setOutcome({ ok: false, text: "Pick at least one day." });
      return;
    }
    if (draft.end_time <= draft.start_time) {
      action.setOutcome({ ok: false, text: "A frame ends after it starts." });
      return;
    }
    const body = { ...draft, name: draft.name.trim() };
    void action
      .run(async () => {
        if (editing === "new") await client.createFrame(body);
        else if (editing) await client.updateFrame(editing, body);
        await load();
        return editing === "new" ? "Frame added." : "Frame saved.";
      })
      .then((ok) => ok && setEditing(null));
  };

  const remove = (f: Frame) => {
    if (!window.confirm(`Delete the frame “${f.name}”?`)) return;
    void action.run(async () => {
      await client.deleteFrame(f.id);
      await load();
      return "Frame deleted.";
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
    <section className="card settings-card" aria-labelledby="frames-title">
      <div className="settings-head">
        <div>
          <h2 id="frames-title">Frames</h2>
          <p className="muted">
            Time set aside for a kind of work, like “Deep work, weekday
            mornings”. The planner fills frames with matching tasks.
          </p>
        </div>
        {editing === null && (
          <button
            className="secondary"
            onClick={() => {
              setDraft(blankFrame());
              setEditing("new");
            }}
          >
            <Plus size={14} /> New frame
          </button>
        )}
      </div>
      {frames === null ? (
        <p className="muted">Loading frames…</p>
      ) : frames.length === 0 && editing === null ? (
        <p className="muted">
          No frames yet. Tasks can go anywhere in your working hours.
        </p>
      ) : (
        <ul className="settings-list">
          {frames.map((f) => (
            <li key={f.id}>
              <i
                className="list-dot"
                style={{ background: f.color }}
                aria-hidden="true"
              />
              <span className="settings-list-main">
                <strong>{f.name}</strong>
                <small>
                  {daysLabel(f.days)} · {f.start_time}–{f.end_time} ·{" "}
                  {filterSummary(f.filters, names)}
                </small>
              </span>
              <button
                className="icon-button"
                aria-label={`Edit ${f.name}`}
                onClick={() => {
                  setDraft({
                    name: f.name,
                    days: f.days,
                    start_time: f.start_time,
                    end_time: f.end_time,
                    color: f.color,
                    filters: f.filters,
                  });
                  setEditing(f.id);
                }}
              >
                <Pencil size={14} />
              </button>
              <button
                className="icon-button"
                aria-label={`Delete ${f.name}`}
                disabled={action.pending}
                onClick={() => remove(f)}
              >
                <Trash2 size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {editing !== null && (
        <form className="settings-subform" onSubmit={submit}>
          <h3 className="settings-subtitle">
            {editing === "new" ? "New frame" : "Edit frame"}
          </h3>
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
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </div>
            <div className="settings-field wide">
              <span className="settings-label">Days</span>
              <DayPicker
                label="Frame days"
                value={draft.days}
                onChange={(days) => setDraft({ ...draft, days })}
              />
            </div>
            <div className="settings-field">
              <label htmlFor="frame-start">Starts</label>
              <input
                id="frame-start"
                type="time"
                required
                value={draft.start_time}
                onChange={(e) =>
                  setDraft({ ...draft, start_time: e.target.value })
                }
              />
            </div>
            <div className="settings-field">
              <label htmlFor="frame-end">Ends</label>
              <input
                id="frame-end"
                type="time"
                required
                value={draft.end_time}
                onChange={(e) =>
                  setDraft({ ...draft, end_time: e.target.value })
                }
              />
            </div>
            <div className="settings-field wide">
              <span className="settings-label">Colour</span>
              <Swatches
                label="Frame colour"
                value={draft.color}
                onChange={(color) => setDraft({ ...draft, color })}
              />
            </div>
          </div>
          <p className="muted">
            Which tasks go here (leave blank for any task):
          </p>
          <fieldset className="check-group">
            <legend>Priorities</legend>
            <div className="check-grid">
              {PRIORITIES.map((p: Priority) => (
                <label key={p} className="check-line">
                  <input
                    type="checkbox"
                    checked={draft.filters.priorities.includes(p)}
                    onChange={() =>
                      setFilter(
                        "priorities",
                        toggle(draft.filters.priorities, p),
                      )
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
          <div className="button-row">
            <button
              type="button"
              className="secondary"
              onClick={() => setEditing(null)}
            >
              Cancel
            </button>
            <button className="primary" disabled={action.pending}>
              {editing === "new" ? "Add frame" : "Save frame"}
            </button>
          </div>
        </form>
      )}
      <OutcomeNote outcome={action.outcome} />
    </section>
  );
}

// ---- Places ------------------------------------------------------------------

type PlaceDraft = { label: string; match: string; travel_minutes: number };
const blankPlace = (): PlaceDraft => ({
  label: "",
  match: "",
  travel_minutes: 20,
});

/** Places and how long it takes to get there, for travel time around events. */
function PlacesEditor({ report }: { report: (e: unknown) => void }) {
  const [places, setPlaces] = useState<Place[] | null>(null);
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [draft, setDraft] = useState<PlaceDraft>(blankPlace);
  const action = useAction(report);

  const load = () =>
    client.listPlaces().then(setPlaces, (e) => {
      setPlaces([]);
      report(e);
    });
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const body = {
      label: draft.label.trim(),
      match: draft.match.trim(),
      travel_minutes: draft.travel_minutes,
    };
    void action
      .run(async () => {
        if (editing === "new") await client.createPlace(body);
        else if (editing) await client.updatePlace(editing, body);
        await load();
        return editing === "new" ? "Place added." : "Place saved.";
      })
      .then((ok) => ok && setEditing(null));
  };

  const remove = (p: Place) => {
    if (!window.confirm(`Delete the place “${p.label}”?`)) return;
    void action.run(async () => {
      await client.deletePlace(p.id);
      await load();
      return "Place deleted.";
    });
  };

  return (
    <section className="card settings-card" aria-labelledby="places-title">
      <div className="settings-head">
        <div>
          <h2 id="places-title">Places</h2>
          <p className="muted">
            When an event&apos;s location mentions a place, the calendar keeps
            its travel time free before and after.
          </p>
        </div>
        {editing === null && (
          <button
            className="secondary"
            onClick={() => {
              setDraft(blankPlace());
              setEditing("new");
            }}
          >
            <Plus size={14} /> New place
          </button>
        )}
      </div>
      {places === null ? (
        <p className="muted">Loading places…</p>
      ) : places.length === 0 && editing === null ? (
        <p className="muted">No places yet.</p>
      ) : (
        <ul className="settings-list">
          {places.map((p) => (
            <li key={p.id}>
              <MapPin size={15} aria-hidden="true" />
              <span className="settings-list-main">
                <strong>{p.label}</strong>
                <small>
                  Matches “{p.match}” · {minutesLabel(p.travel_minutes)} to get
                  there
                </small>
              </span>
              <button
                className="icon-button"
                aria-label={`Edit ${p.label}`}
                onClick={() => {
                  setDraft({
                    label: p.label,
                    match: p.match,
                    travel_minutes: p.travel_minutes,
                  });
                  setEditing(p.id);
                }}
              >
                <Pencil size={14} />
              </button>
              <button
                className="icon-button"
                aria-label={`Delete ${p.label}`}
                disabled={action.pending}
                onClick={() => remove(p)}
              >
                <Trash2 size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {editing !== null && (
        <form className="settings-subform" onSubmit={submit}>
          <div className="settings-grid">
            <div className="settings-field">
              <label htmlFor="place-label">Name</label>
              <input
                id="place-label"
                required
                autoFocus
                maxLength={60}
                value={draft.label}
                placeholder="Office"
                onChange={(e) => setDraft({ ...draft, label: e.target.value })}
              />
            </div>
            <div className="settings-field">
              <label htmlFor="place-match">Location contains</label>
              <input
                id="place-match"
                required
                maxLength={200}
                value={draft.match}
                placeholder="Collins St"
                onChange={(e) => setDraft({ ...draft, match: e.target.value })}
              />
            </div>
            <div className="settings-field">
              <label htmlFor="place-travel">Travel (min)</label>
              <input
                id="place-travel"
                type="number"
                required
                min={0}
                max={240}
                value={draft.travel_minutes}
                onChange={(e) =>
                  setDraft({ ...draft, travel_minutes: Number(e.target.value) })
                }
              />
            </div>
          </div>
          <div className="button-row">
            <button
              type="button"
              className="secondary"
              onClick={() => setEditing(null)}
            >
              Cancel
            </button>
            <button className="primary" disabled={action.pending}>
              {editing === "new" ? "Add place" : "Save place"}
            </button>
          </div>
        </form>
      )}
      <OutcomeNote outcome={action.outcome} />
    </section>
  );
}
