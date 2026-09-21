import { Select } from "../../components/Select";
import { useConfirm } from "../../components/Confirm";
import { useEffect, useState, type FormEvent } from "react";
import {
  CalendarClock,
  Check,
  Pencil,
  Plus,
  Save,
  Trash2,
  X,
} from "lucide-react";
import type { Habit, HabitInput, HabitPlan, Priority } from "@orbyn/core";
import { client } from "../../lib/api";
import { OutcomeNote, useAction } from "../../components/Outcome";
import { DayPicker } from "../../components/DayPicker";
import {
  deviceTimeZone,
  minutesLabel,
  WEEKDAY_SHORT,
} from "../../lib/planning";

type Props = { report: (e: unknown) => void };

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
const daysLabel = (days: number[]) =>
  days.join(",") === "1,2,3,4,5"
    ? "weekdays"
    : days.length === 7
      ? "any day"
      : days.map((d) => WEEKDAY_SHORT[d]).join(", ");

const cadenceLabel = (h: Habit) =>
  `${h.cadence}× / ${h.period === "day" ? "day" : "week"}`;

type Draft = {
  name: string;
  cadence: number;
  period: "day" | "week";
  duration_minutes: number;
  days: number[];
  window_start: string;
  window_end: string;
  priority: Priority;
  active: boolean;
};

const blank: Draft = {
  name: "",
  cadence: 3,
  period: "week",
  duration_minutes: 30,
  days: ALL_DAYS,
  window_start: "",
  window_end: "",
  priority: "medium",
  active: true,
};

const draftOf = (h: Habit): Draft => ({
  name: h.name,
  cadence: h.cadence,
  period: h.period,
  duration_minutes: h.duration_minutes,
  days: h.days,
  window_start: h.window_start ?? "",
  window_end: h.window_end ?? "",
  priority: h.priority,
  active: h.active,
});

/** Habits: flexible routines the planner fits into free time. */
export function HabitsEditor({ report }: Props) {
  const { ask, tell } = useConfirm();
  const [habits, setHabits] = useState<Habit[] | null>(null);
  const [editing, setEditing] = useState<Habit | "new" | null>(null);
  const [plan, setPlan] = useState<HabitPlan | null>(null);
  const action = useAction(report);
  const planning = useAction(report);

  const load = () =>
    client.listHabits().then(setHabits, (e) => {
      setHabits([]);
      report(e);
    });
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const remove = async (h: Habit) => {
    if (
      !(await ask({
        title: `Delete the habit “${h.name}”?`,
        confirmLabel: "Delete",
        destructive: true,
      }))
    )
      return;
    void action.run(async () => {
      await client.deleteHabit(h.id);
      await load();
      return "Habit deleted.";
    });
  };

  const planHabits = () =>
    void planning.run(async () => {
      const result = await client.planHabits({ days: 7 });
      setPlan(result);
      if (!result.blocks.length)
        return "Nothing to add — your habits are on track this week.";
    });

  const apply = () =>
    void planning.run(async () => {
      if (!plan) return;
      const saved = await client.applyHabitPlan(
        plan.blocks.map((b) => ({
          habit_id: b.habit_id,
          start_at: b.start_at,
          end_at: b.end_at,
        })),
      );
      setPlan(null);
      return `Added ${saved.length} session${saved.length === 1 ? "" : "s"} to your calendar.`;
    });

  const tz = deviceTimeZone();
  const when = (iso: string) =>
    new Date(iso).toLocaleString([], {
      weekday: "short",
      hour: "numeric",
      minute: "2-digit",
      timeZone: tz,
    });

  return (
    <section className="card settings-card" aria-labelledby="habits-title">
      <div className="settings-head">
        <div>
          <h2 id="habits-title">Habits</h2>
          <p className="muted">
            Routines like “Gym 3× a week”. The planner fits them into free time
            and moves them when your week changes — no rigid recurring event.
          </p>
        </div>
        {editing === null && (
          <button className="secondary" onClick={() => setEditing("new")}>
            <Plus size={14} /> New habit
          </button>
        )}
      </div>

      {habits === null ? (
        <p className="muted">Loading habits…</p>
      ) : habits.length === 0 && editing === null ? (
        <p className="muted">
          No habits yet. Add one and the planner will keep time for it.
        </p>
      ) : (
        <ul className="settings-list">
          {habits.map((h) => (
            <li key={h.id}>
              <span className="settings-list-main">
                <strong>
                  {h.name}
                  {!h.active && <small className="muted"> · paused</small>}
                </strong>
                <small>
                  {cadenceLabel(h)} · {minutesLabel(h.duration_minutes)} ·{" "}
                  {daysLabel(h.days)}
                  {h.window_start && h.window_end
                    ? ` · ${h.window_start}–${h.window_end}`
                    : ""}
                </small>
              </span>
              <button
                className="icon-button"
                aria-label={`Edit ${h.name}`}
                onClick={() => setEditing(h)}
              >
                <Pencil size={14} />
              </button>
              <button
                className="icon-button"
                aria-label={`Delete ${h.name}`}
                disabled={action.pending}
                onClick={() => remove(h)}
              >
                <Trash2 size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {editing !== null && (
        <HabitForm
          key={editing === "new" ? "new" : editing.id}
          habit={editing === "new" ? null : editing}
          report={report}
          onCancel={() => setEditing(null)}
          onSaved={(added) => {
            setEditing(null);
            void load();
            action.setOutcome({
              ok: true,
              text: added ? "Habit added." : "Habit saved.",
            });
          }}
        />
      )}

      {habits && habits.some((h) => h.active) && editing === null && (
        <div className="habit-plan">
          <button
            className="secondary"
            disabled={planning.pending}
            onClick={planHabits}
          >
            <CalendarClock size={14} />{" "}
            {planning.pending ? "Planning…" : "Plan this week’s habits"}
          </button>
          {plan && plan.blocks.length > 0 && (
            <div className="habit-proposal">
              <p className="muted">
                {plan.blocks.length} session
                {plan.blocks.length === 1 ? "" : "s"} found:
              </p>
              <ul className="settings-list">
                {plan.blocks.map((b) => (
                  <li key={`${b.habit_id}-${b.start_at}`}>
                    <span className="settings-list-main">
                      <strong>{b.name}</strong>
                      <small>{when(b.start_at)}</small>
                    </span>
                  </li>
                ))}
              </ul>
              {plan.summary.some((s) => s.reason) && (
                <ul className="habit-notes">
                  {plan.summary
                    .filter((s) => s.reason)
                    .map((s) => (
                      <li key={s.habit_id} className="muted">
                        {s.name}: {s.reason}
                      </li>
                    ))}
                </ul>
              )}
              <div className="habit-plan-actions">
                <button
                  className="primary"
                  disabled={planning.pending}
                  onClick={apply}
                >
                  <Check size={14} /> Add to calendar
                </button>
                <button className="text-button" onClick={() => setPlan(null)}>
                  Dismiss
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <OutcomeNote outcome={action.outcome} />
      <OutcomeNote outcome={planning.outcome} />
    </section>
  );
}

function HabitForm({
  habit,
  report,
  onCancel,
  onSaved,
}: {
  habit: Habit | null;
  report: (e: unknown) => void;
  onCancel: () => void;
  onSaved: (added: boolean) => void;
}) {
  const [d, setD] = useState<Draft>(habit ? draftOf(habit) : blank);
  const action = useAction(report);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) =>
    setD((prev) => ({ ...prev, [k]: v }));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void action.run(async () => {
      if ((d.window_start === "") !== (d.window_end === "")) {
        report(new Error("Set both ends of the window, or leave both blank."));
        return;
      }
      const body: HabitInput = {
        name: d.name.trim(),
        cadence: d.cadence,
        period: d.period,
        duration_minutes: d.duration_minutes,
        days: d.days,
        window_start: d.window_start || null,
        window_end: d.window_end || null,
        priority: d.priority,
        active: d.active,
      };
      if (habit) await client.updateHabit(habit.id, body);
      else await client.createHabit(body);
      onSaved(!habit);
    });
  };

  return (
    <form className="settings-subform habit-form" onSubmit={submit}>
      <label>
        Name
        <input
          value={d.name}
          onChange={(e) => set("name", e.target.value)}
          maxLength={60}
          required
          placeholder="Gym, Read, Deep work…"
        />
      </label>
      <div className="settings-row">
        <label>
          How often
          <input
            type="number"
            min={1}
            max={d.period === "day" ? 6 : 21}
            value={d.cadence}
            onChange={(e) => set("cadence", Number(e.target.value))}
          />
        </label>
        <label>
          Per
          <Select
            value={d.period}
            onChange={(e) => set("period", e.target.value as "day" | "week")}
          >
            <option value="week">week</option>
            <option value="day">day</option>
          </Select>
        </label>
        <label>
          Each takes (min)
          <input
            type="number"
            min={5}
            max={480}
            step={5}
            value={d.duration_minutes}
            onChange={(e) => set("duration_minutes", Number(e.target.value))}
          />
        </label>
      </div>
      <div className="habit-days">
        <span className="settings-label">Days it can land on</span>
        <DayPicker
          value={d.days}
          onChange={(days) => set("days", days)}
          label="Days a habit can land on"
        />
      </div>
      <div className="settings-row">
        <label>
          From (optional)
          <input
            type="time"
            value={d.window_start}
            onChange={(e) => set("window_start", e.target.value)}
          />
        </label>
        <label>
          To (optional)
          <input
            type="time"
            value={d.window_end}
            onChange={(e) => set("window_end", e.target.value)}
          />
        </label>
        <label>
          Priority
          <Select
            value={d.priority}
            onChange={(e) => set("priority", e.target.value as Priority)}
          >
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </Select>
        </label>
      </div>
      <label className="settings-check">
        <input
          type="checkbox"
          checked={d.active}
          onChange={(e) => set("active", e.target.checked)}
        />
        Plan time for this habit
      </label>
      <div className="settings-form-actions">
        <button className="primary" disabled={action.pending}>
          <Save size={14} /> {habit ? "Save habit" : "Add habit"}
        </button>
        <button type="button" className="text-button" onClick={onCancel}>
          <X size={14} /> Cancel
        </button>
      </div>
      <OutcomeNote outcome={action.outcome} />
    </form>
  );
}
