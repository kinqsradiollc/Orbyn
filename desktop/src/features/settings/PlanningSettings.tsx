import { SettingsSection } from "./SettingsSection";
import { Select } from "../../components/Select";
import { useConfirm } from "../../components/Confirm";
import { useEffect, useState, type FormEvent } from "react";
import { MapPin, Pencil, Plus, Save, Trash2, X } from "lucide-react";
import {
  BREAK_LEVELS,
  TRAVEL_MODES,
  clockMinutes,
  describeRrule,
  hourText as clockText,
  learningSummary,
  type BreakLevel,
  type BufferScope,
  type Frame,
  type FrameFilters,
  type Place,
  type PlannerPrefs,
  type Team,
  type TravelMode,
} from "@orbyn/core";
import { client } from "../../lib/api";
import type { PlannerLearning } from "@orbyn/core";
import { usePlanning } from "../../app/planning";
import { OutcomeNote, useAction } from "../../components/Outcome";
import { DayPicker } from "../../components/DayPicker";
import { BREAK_LABELS } from "../calendar/PlannerPanel";
import { FrameForm } from "./FrameForm";
import { HabitsEditor } from "./HabitsEditor";
import { TimeAnalytics } from "./TimeAnalytics";
import {
  deviceTimeZone,
  minutesLabel,
  timeZones,
  WEEKDAY_SHORT,
  zoneCity,
} from "../../lib/planning";
import { DateField } from "../../components/DateField";

type Props = { teams: Team[]; report: (e: unknown) => void };

type Draft = Omit<PlannerPrefs, "calendar_sets" | "pinned_user_ids">;
const draftFrom = (p: PlannerPrefs): Draft => {
  const { calendar_sets, pinned_user_ids, ...rest } = p;
  void calendar_sets;
  void pinned_user_ids;
  return rest;
};

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

/** How each working hour usually goes: green goes well, dark grey slips. */
function HourStrip({
  hours,
  from,
  to,
}: {
  hours: number[];
  from: number;
  to: number;
}) {
  const shown = hours
    .map((v, h) => ({ v, h }))
    .filter((x) => x.h >= from && x.h < Math.max(to, from + 1));
  return (
    <figure
      className="hour-strip"
      aria-label="How your working hours usually go"
    >
      <div className="hour-strip-bars">
        {shown.map(({ v, h }) => (
          <span
            key={h}
            className={
              v >= 0.25 ? "is-good" : v <= -0.25 ? "is-slipping" : "is-even"
            }
            style={{ height: `${8 + Math.abs(v) * 32}px` }}
            title={`${clockText(h)}: ${v >= 0.25 ? "usually goes well" : v <= -0.25 ? "often slips" : "about average"}`}
          />
        ))}
      </div>
      <figcaption>
        <span className="hour-strip-axis">
          <span>{clockText(from)}</span>
          <span>{clockText(Math.max(to, from + 1))}</span>
        </span>
        <span className="hour-strip-legend">
          <i className="is-good" /> usually goes well
          <i className="is-slipping" /> often slips
        </span>
      </figcaption>
    </figure>
  );
}

/**
 * How you like to work: time zone, working hours, how the planner pads and
 * splits tasks, buffers and travel, extra time zones, frames and places.
 */
export function PlanningSettings({ teams, report }: Props) {
  const { prefs, savePrefs, lists } = usePlanning();
  const [draft, setDraft] = useState<Draft | null>(prefs && draftFrom(prefs));
  const [zoneToAdd, setZoneToAdd] = useState("");
  const [learning, setLearning] = useState<PlannerLearning | null>(null);
  const save = useAction(report);
  const preview = useAction(report);
  const zones = timeZones();

  useEffect(() => {
    client.getLearning().then(setLearning, () => setLearning(null));
  }, []);

  useEffect(() => {
    if (prefs && !draft) setDraft(draftFrom(prefs));
  }, [prefs, draft]);

  if (!draft)
    return (
      <SettingsSection className="card settings-card">
        <p className="muted">Loading your planning settings…</p>
      </SettingsSection>
    );

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((d) => d && { ...d, [key]: value });
    save.setOutcome(null);
  };
  const device = deviceTimeZone();

  // Which events get buffers (all your timed busy events by default).
  const scope: BufferScope = draft.buffer_scope ?? {
    personal: true,
    team_ids: null,
    list_ids: [],
    min_minutes: 0,
    only_with_others: false,
  };
  const setScope = (patch: Partial<BufferScope>) =>
    set("buffer_scope", { ...scope, ...patch });
  const digest = draft.digest ?? {
    morning: false,
    evening: false,
    morning_time: "07:00",
    evening_time: "17:00",
  };
  const setDigest = (patch: Partial<typeof digest>) =>
    set("digest", { ...digest, ...patch });
  const toggleScopeTeam = (id: string) => {
    const current = scope.team_ids ?? teams.map((t) => t.id);
    const next = current.includes(id)
      ? current.filter((x) => x !== id)
      : [...current, id];
    setScope({ team_ids: next.length === teams.length ? null : next });
  };
  const toggleScopeList = (id: string) =>
    setScope({
      list_ids: scope.list_ids.includes(id)
        ? scope.list_ids.filter((x) => x !== id)
        : [...scope.list_ids, id],
    });

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
      <SettingsSection
        className="card settings-card"
        aria-labelledby="work-title"
      >
        <h2 id="work-title">How you work</h2>
        <form onSubmit={submit}>
          <p className="muted">
            The planner, buffers and travel time all follow these.
          </p>
          <div className="settings-grid">
            <div className="settings-field wide">
              <label htmlFor="pref-zone">Time zone</label>
              <div className="field-row">
                <Select
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
                </Select>
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
              <DateField
                id="pref-start"
                type="time"
                required
                value={draft.work_start}
                onChange={(e) => set("work_start", e.target.value)}
              />
            </div>
            <div className="settings-field">
              <label htmlFor="pref-end">Work ends</label>
              <DateField
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
              <Select
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
              </Select>
            </div>
          </div>

          <label className="switch-line settings-field">
            <input
              type="checkbox"
              role="switch"
              className="ai-switch"
              checked={draft.count_blocks_as_spent ?? false}
              onChange={(e) => set("count_blocks_as_spent", e.target.checked)}
            />
            <span>
              Count blocked time as worked when I complete a task
              <small>
                The past part of its time blocks is added to the time spent on
                it.
              </small>
            </span>
          </label>

          <h3 className="settings-subtitle">Planner notices</h3>
          <p className="muted">
            Heads-ups about unfinished blocks, tasks at risk, tasks due soon and
            clashes. They always show in Notifications.
          </p>
          <div className="settings-grid">
            <NumberInput
              id="pref-deadline"
              label="Warn about tasks due within (days)"
              hint="For tasks with no time set aside. 0 turns this off."
              value={draft.deadline_notice_days ?? 1}
              min={0}
              max={14}
              onChange={(n) => set("deadline_notice_days", n)}
            />
            <label className="switch-line settings-field">
              <input
                type="checkbox"
                role="switch"
                className="ai-switch"
                checked={draft.planner_notices?.push ?? true}
                onChange={(e) =>
                  set("planner_notices", {
                    push: e.target.checked,
                    email: draft.planner_notices?.email ?? false,
                  })
                }
              />
              <span>
                Push notifications
                <small>On phones signed in to the Orbyn app.</small>
              </span>
            </label>
            <label className="switch-line settings-field">
              <input
                type="checkbox"
                role="switch"
                className="ai-switch"
                checked={draft.planner_notices?.email ?? false}
                onChange={(e) =>
                  set("planner_notices", {
                    push: draft.planner_notices?.push ?? true,
                    email: e.target.checked,
                  })
                }
              />
              <span>
                Email
                <small>Sent when the server has email set up.</small>
              </span>
            </label>
          </div>

          <h3 className="settings-subtitle">What Orbyn has learned</h3>
          <p className="muted">
            The planner learns from your own finished tasks, planned blocks and
            focus sessions, and nobody else’s. Your tasks aren’t changed; only
            where and how long they’re planned.
          </p>
          <div className="settings-grid">
            <label className="switch-line settings-field">
              <input
                type="checkbox"
                role="switch"
                className="ai-switch"
                checked={draft.learn_estimates ?? false}
                onChange={(e) => set("learn_estimates", e.target.checked)}
              />
              <span>
                Adjust estimates from history
                <small>{learningSummary(learning).estimates}</small>
              </span>
            </label>
            <label className="switch-line settings-field">
              <input
                type="checkbox"
                role="switch"
                className="ai-switch"
                checked={draft.learn_rhythm ?? true}
                onChange={(e) => set("learn_rhythm", e.target.checked)}
              />
              <span>
                Put demanding work in your best hours
                <small>{learningSummary(learning).rhythm}</small>
              </span>
            </label>
            <label className="switch-line settings-field">
              <input
                type="checkbox"
                role="switch"
                className="ai-switch"
                checked={draft.balance_load ?? true}
                onChange={(e) => set("balance_load", e.target.checked)}
              />
              <span>
                Keep days to what you usually get through
                <small>{learningSummary(learning).load}</small>
              </span>
            </label>
          </div>
          {learning && learning.rhythm.confidence > 0 && (
            <HourStrip
              hours={learning.rhythm.hours}
              from={Number(draft.work_start.slice(0, 2))}
              to={Math.ceil(clockMinutes(draft.work_end) / 60)}
            />
          )}
          {learning &&
            (learning.estimates.tags.length > 0 ||
              (learning.estimates.lists ?? []).length > 0) && (
              <ul className="estimate-tags">
                {learning.estimates.tags.slice(0, 6).map((t) => (
                  <li key={t.tag_id}>
                    <span>#{t.name}</span>
                    <span className="mono">{t.ratio}×</span>
                    <small className="muted">{t.samples} tasks</small>
                  </li>
                ))}
                {(learning.estimates.lists ?? []).slice(0, 6).map((l) => (
                  <li key={l.list_id}>
                    <span>{l.name}</span>
                    <span className="mono">{l.ratio}×</span>
                    <small className="muted">{l.samples} tasks</small>
                  </li>
                ))}
              </ul>
            )}

          <h3 className="settings-subtitle">Daily digest</h3>
          <p className="muted">
            A short email with your day. Sent from the workspace’s own mail
            server, at the times below in your zone. Off until you turn it on.
          </p>
          <div className="settings-grid">
            <label className="switch-line settings-field">
              <input
                type="checkbox"
                role="switch"
                className="ai-switch"
                checked={digest.morning}
                onChange={(e) => setDigest({ morning: e.target.checked })}
              />
              <span>
                Morning agenda
                <small>Today’s events, due tasks and set-aside time.</small>
              </span>
            </label>
            <label className="settings-field">
              <span className="settings-label">Morning time</span>
              <DateField
                type="time"
                value={digest.morning_time}
                onChange={(e) => setDigest({ morning_time: e.target.value })}
              />
            </label>
            <label className="switch-line settings-field">
              <input
                type="checkbox"
                role="switch"
                className="ai-switch"
                checked={digest.evening}
                onChange={(e) => setDigest({ evening: e.target.checked })}
              />
              <span>
                Evening review
                <small>What’s still open, and a look at tomorrow.</small>
              </span>
            </label>
            <label className="settings-field">
              <span className="settings-label">Evening time</span>
              <DateField
                type="time"
                value={digest.evening_time}
                onChange={(e) => setDigest({ evening_time: e.target.value })}
              />
            </label>
          </div>
          <div className="digest-preview">
            <button
              type="button"
              className="secondary"
              disabled={preview.pending}
              onClick={() =>
                void preview.run(async () => {
                  await client.sendTestDigest("morning");
                  return "Sent a preview to your email.";
                })
              }
            >
              {preview.pending ? "Sending…" : "Email me a preview"}
            </button>
            <OutcomeNote outcome={preview.outcome} />
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
            <NumberInput
              id="pref-travel-pad"
              label="Extra travel padding (min)"
              hint="Added to every trip, there and back."
              value={draft.travel_padding_minutes ?? 0}
              min={0}
              max={30}
              onChange={(n) => set("travel_padding_minutes", n)}
            />
          </div>
          <fieldset className="check-group">
            <legend>Which events get buffers</legend>
            <div className="check-grid">
              <label className="check-line">
                <input
                  type="checkbox"
                  checked={scope.personal}
                  onChange={(e) => setScope({ personal: e.target.checked })}
                />
                Personal events
              </label>
              {teams.map((t) => (
                <label key={t.id} className="check-line">
                  <input
                    type="checkbox"
                    checked={
                      scope.team_ids === null || scope.team_ids.includes(t.id)
                    }
                    onChange={() => toggleScopeTeam(t.id)}
                  />
                  {t.name}
                </label>
              ))}
            </div>
          </fieldset>
          {lists.length > 0 && (
            <fieldset className="check-group">
              <legend>
                Only events in these lists (none ticked: any list)
              </legend>
              <div className="check-grid">
                {lists.map((l) => (
                  <label key={l.id} className="check-line">
                    <input
                      type="checkbox"
                      checked={scope.list_ids.includes(l.id)}
                      onChange={() => toggleScopeList(l.id)}
                    />
                    {l.team_name ? `${l.name} · ${l.team_name}` : l.name}
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          <div className="settings-grid">
            <NumberInput
              id="pref-buffer-min"
              label="Only events at least (min)"
              hint="Shorter events get no buffers. 0 for every event."
              value={scope.min_minutes}
              min={0}
              max={1440}
              onChange={(n) => setScope({ min_minutes: n })}
            />
            <label className="switch-line settings-field">
              <input
                type="checkbox"
                role="switch"
                className="ai-switch"
                checked={scope.only_with_others}
                onChange={(e) =>
                  setScope({ only_with_others: e.target.checked })
                }
              />
              <span>
                Only meetings with others
                <small>
                  Events with people invited, a meeting link, or a team.
                </small>
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
              <Select
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
              </Select>
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
      </SettingsSection>
      <TimeAnalytics report={report} />
      <FramesEditor teams={teams} report={report} />
      <HabitsEditor report={report} />
      <PlacesEditor report={report} />
    </>
  );
}

// ---- Frames ------------------------------------------------------------------

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
  const { ask, tell } = useConfirm();
  const { lists, tags } = usePlanning();
  const [frames, setFrames] = useState<Frame[] | null>(null);
  const [editing, setEditing] = useState<Frame | "new" | null>(null);
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

  const remove = async (f: Frame) => {
    if (
      !(await ask({
        title: `Delete the frame “${f.name}”?`,
        confirmLabel: "Delete",
        destructive: true,
      }))
    )
      return;
    void action.run(async () => {
      await client.deleteFrame(f.id);
      await load();
      return "Frame deleted.";
    });
  };

  return (
    <SettingsSection className="card settings-card" title="Frames">
      <div className="settings-head">
        <div>
          <p className="muted">
            Time set aside for a kind of work, like “Deep work, weekday
            mornings”. The planner fills frames with matching tasks.
          </p>
        </div>
        {editing === null && (
          <button className="secondary" onClick={() => setEditing("new")}>
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
                  {f.rrule ? describeRrule(f.rrule) : daysLabel(f.days)} ·{" "}
                  {f.start_time}–{f.end_time}
                  {f.busy && " · Busy"} · {filterSummary(f.filters, names)}
                </small>
              </span>
              <button
                className="icon-button"
                aria-label={`Edit ${f.name}`}
                onClick={() => setEditing(f)}
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
        <FrameForm
          key={editing === "new" ? "new" : editing.id}
          frame={editing === "new" ? null : editing}
          teams={teams}
          report={report}
          heading={editing === "new" ? "New frame" : "Edit frame"}
          onCancel={() => setEditing(null)}
          onSaved={() => {
            const added = editing === "new";
            setEditing(null);
            void load();
            action.setOutcome({
              ok: true,
              text: added ? "Frame added." : "Frame saved.",
            });
          }}
        />
      )}
      <OutcomeNote outcome={action.outcome} />
    </SettingsSection>
  );
}

// ---- Places ------------------------------------------------------------------

type PlaceDraft = {
  label: string;
  match: string;
  travel_minutes: number;
  mode: TravelMode | null;
  /** Minutes at rush hour; null: the same as usual. */
  peak_minutes: number | null;
};
const blankPlace = (): PlaceDraft => ({
  label: "",
  match: "",
  travel_minutes: 20,
  mode: null,
  peak_minutes: null,
});
const MODE_LABELS: Record<TravelMode, string> = {
  walk: "Walking",
  cycle: "Cycling",
  transit: "Public transport",
  drive: "Driving",
};

/** Places and how long it takes to get there, for travel time around events. */
function PlacesEditor({ report }: { report: (e: unknown) => void }) {
  const { ask, tell } = useConfirm();
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
      mode: draft.mode,
      peak_minutes: draft.peak_minutes,
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

  const remove = async (p: Place) => {
    if (
      !(await ask({
        title: `Delete the place “${p.label}”?`,
        confirmLabel: "Delete",
        destructive: true,
      }))
    )
      return;
    void action.run(async () => {
      await client.deletePlace(p.id);
      await load();
      return "Place deleted.";
    });
  };

  return (
    <SettingsSection className="card settings-card" title="Places">
      <div className="settings-head">
        <div>
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
                  {p.mode && ` · ${MODE_LABELS[p.mode]}`}
                  {p.peak_minutes != null &&
                    ` · ${minutesLabel(p.peak_minutes)} at rush hour`}
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
                    mode: p.mode ?? null,
                    peak_minutes: p.peak_minutes ?? null,
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
            <div className="settings-field">
              <label htmlFor="place-mode">How you get there</label>
              <Select
                id="place-mode"
                value={draft.mode ?? ""}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    mode: (e.target.value || null) as TravelMode | null,
                  })
                }
              >
                <option value="">Not set</option>
                {TRAVEL_MODES.map((m) => (
                  <option key={m} value={m}>
                    {MODE_LABELS[m]}
                  </option>
                ))}
              </Select>
            </div>
            <div className="settings-field">
              <label htmlFor="place-peak">At rush hour (min)</label>
              <input
                id="place-peak"
                type="number"
                min={0}
                max={240}
                placeholder="Same"
                value={draft.peak_minutes ?? ""}
                aria-describedby="place-peak-hint"
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    peak_minutes:
                      e.target.value === "" ? null : Number(e.target.value),
                  })
                }
              />
              <small id="place-peak-hint" className="field-hint">
                Weekdays 7–9 AM and 4–6 PM. Empty: the same as usual.
              </small>
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
    </SettingsSection>
  );
}
