import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  Check,
  MoreHorizontal,
  Pause,
  Pencil,
  Play,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import {
  addDays,
  dayTime,
  describeRrule,
  localDateKey,
  nextOccurrence,
  weekdayOf,
  type AgentRoutine,
  type ApprovalScopes,
  type AssistantChangeKind,
  type DocSummary,
  type Goal,
  type GoalCheckin,
  type Project,
} from "@orbyn/core";
import { DateField } from "../../components/DateField";
import { Select } from "../../components/Select";
import { useConfirm } from "../../components/Confirm";
import { Popover } from "../../components/Popover";
import { client } from "../../lib/api";
import {
  CHANGE_KIND_LABELS,
  checkinStatusLabel,
  dayLabel,
} from "../../lib/assistant-labels";

const WEEKDAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

function nextRun(day: string, time: string, repeat: string, timezone: string) {
  const [hour, minute] = time.split(":").map(Number);
  const rule =
    repeat === "daily"
      ? "FREQ=DAILY"
      : repeat === "weekdays"
        ? "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR"
        : `FREQ=WEEKLY;BYDAY=${WEEKDAYS[weekdayOf(day)]}`;
  const start = dayTime(day, hour * 60 + minute, timezone);
  return {
    rule,
    start,
    next:
      start > new Date()
        ? start
        : nextOccurrence(start, rule, timezone, new Date()),
  };
}

function summaryOf(goal: Goal) {
  return typeof goal.progress.summary === "string" ? goal.progress.summary : "";
}

/** Personal goals, their weekly check-ins, and scheduled assistant routines. */
export function AssistantUpcoming({
  agentName,
  onClose,
}: {
  agentName: string;
  onClose: () => void;
}) {
  const { ask } = useConfirm();
  const live = useRef(true);
  useEffect(
    () => () => {
      live.current = false;
    },
    [],
  );
  const [loading, setLoading] = useState(true);
  const [allowed, setAllowed] = useState<ApprovalScopes>({});
  const [goals, setGoals] = useState<Goal[]>([]);
  const [checkins, setCheckins] = useState<Record<string, GoalCheckin[]>>({});
  const [routines, setRoutines] = useState<AgentRoutine[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [agentDocs, setAgentDocs] = useState<DocSummary[]>([]);
  const [timezone, setTimezone] = useState("UTC");
  // A form is open for a new goal or routine ("new") or for one by id.
  const [goalForm, setGoalForm] = useState<string | null>(null);
  const [routineForm, setRoutineForm] = useState<string | null>(null);
  const [goalTitle, setGoalTitle] = useState("");
  const [goalTarget, setGoalTarget] = useState("");
  const [goalDate, setGoalDate] = useState("");
  const [goalProject, setGoalProject] = useState("");
  const [goalDoc, setGoalDoc] = useState("");
  const [routineText, setRoutineText] = useState("");
  const [routineDay, setRoutineDay] = useState(() =>
    localDateKey(new Date(), "UTC"),
  );
  const [routineTime, setRoutineTime] = useState("09:00");
  const [repeat, setRepeat] = useState("daily");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [menu, setMenu] = useState<{
    kind: "goal" | "routine";
    id: string;
    anchor: DOMRect;
  } | null>(null);

  // Escape closes the panel, unless a menu or dialog above it is open.
  const latestClose = useRef(onClose);
  latestClose.current = onClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (document.querySelector(".modal-backdrop, .popover")) return;
      latestClose.current();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const load = async () => {
    const [nextGoals, nextRoutines, nextProjects, nextDocs, prefs, scopes] =
      await Promise.all([
        client.listGoals(),
        client.listAgentRoutines(),
        client.listProjects(),
        client.listDocs({ kind: "agent" }),
        client.getPlannerPrefs(),
        client.assistantApprovalScopes().catch(() => ({}) as ApprovalScopes),
      ]);
    if (!live.current) return;
    setAllowed(scopes);
    setGoals(nextGoals);
    setRoutines(nextRoutines);
    setProjects(nextProjects);
    setAgentDocs(nextDocs);
    setTimezone(prefs.timezone || "UTC");
    setRoutineDay(localDateKey(new Date(), prefs.timezone || "UTC"));
    // One goal's check-ins failing leaves the others (and the goal) shown.
    const results = await Promise.all(
      nextGoals
        .slice(0, 30)
        .map(
          async (goal) =>
            [
              goal.id,
              await client.goalCheckins(goal.id).catch(() => []),
            ] as const,
        ),
    );
    if (live.current) setCheckins(Object.fromEntries(results));
  };

  useEffect(() => {
    void load()
      .catch(
        () =>
          live.current &&
          setError("Upcoming goals and routines could not be loaded."),
      )
      .finally(() => live.current && setLoading(false));
  }, []);

  const removeAllowed = async (kind: AssistantChangeKind) => {
    const next = { ...allowed };
    delete next[kind];
    setSaving(true);
    setError("");
    try {
      const saved = await client.setAssistantApprovalScopes(next);
      if (live.current) setAllowed(saved);
    } catch {
      if (live.current)
        setError("That permission could not be removed. Try again.");
    } finally {
      if (live.current) setSaving(false);
    }
  };
  const allowedRows = (
    Object.entries(allowed) as [
      AssistantChangeKind,
      ApprovalScopes[AssistantChangeKind],
    ][]
  ).filter(([, rule]) => !!rule);
  const ruleLabel = (rule: ApprovalScopes[AssistantChangeKind]) =>
    rule === "always"
      ? "Always"
      : rule?.scope === "goal"
        ? `For the goal “${goals.find((g) => g.id === rule.id)?.title ?? "a goal"}”`
        : `For the routine “${routines.find((r) => r.id === rule?.id)?.instruction ?? "a routine"}”`;

  const activeGoals = useMemo(
    () => goals.filter((goal) => goal.status !== "done"),
    [goals],
  );
  const goalPlanDocs = goalProject
    ? agentDocs.filter((doc) => doc.project_id === goalProject)
    : agentDocs;
  const chooseGoalProject = (projectId: string) => {
    setGoalProject(projectId);
    if (
      projectId &&
      !agentDocs.some(
        (doc) => doc.id === goalDoc && doc.project_id === projectId,
      )
    )
      setGoalDoc("");
  };

  const openGoalForm = (goal?: Goal) => {
    setMenu(null);
    setRoutineForm(null);
    setGoalTitle(goal?.title ?? "");
    setGoalTarget(goal?.target ?? "");
    setGoalDate(goal?.target_date ?? "");
    setGoalProject(goal?.project_id ?? "");
    setGoalDoc(goal?.plan_doc_id ?? "");
    setGoalForm(goal?.id ?? "new");
  };

  const openRoutineForm = (routine?: AgentRoutine) => {
    setMenu(null);
    setGoalForm(null);
    setRoutineText(routine?.instruction ?? "");
    if (routine) {
      const at = new Date(routine.next_run_at);
      setRoutineDay(localDateKey(at, routine.timezone));
      setRoutineTime(
        at.toLocaleTimeString("en-GB", {
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
          timeZone: routine.timezone,
        }),
      );
      setRepeat(
        routine.rrule === "FREQ=DAILY"
          ? "daily"
          : routine.rrule === "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR"
            ? "weekdays"
            : "weekly",
      );
    } else {
      setRoutineDay(localDateKey(new Date(), timezone));
      setRoutineTime("09:00");
      setRepeat("daily");
    }
    setRoutineForm(routine?.id ?? "new");
  };

  const saveGoal = async (event: FormEvent) => {
    event.preventDefault();
    if (!goalTitle.trim() || saving || !goalForm) return;
    setSaving(true);
    setError("");
    const input = {
      title: goalTitle,
      target: goalTarget,
      target_date: goalDate || null,
      project_id: goalProject || null,
      plan_doc_id: goalDoc || null,
    };
    try {
      if (goalForm === "new") await client.createGoal(input);
      else await client.updateGoal(goalForm, input);
      setGoalForm(null);
      await load();
    } catch {
      setError(
        "The goal could not be saved. Check its project and Agent note, then try again.",
      );
    } finally {
      setSaving(false);
    }
  };

  const saveRoutine = async (event: FormEvent) => {
    event.preventDefault();
    if (!routineText.trim() || saving || !routineForm) return;
    setSaving(true);
    setError("");
    try {
      const { rule, next } = nextRun(routineDay, routineTime, repeat, timezone);
      if (!next)
        throw new Error("No future run is available for this schedule.");
      const input = {
        instruction: routineText,
        rrule: rule,
        timezone,
        next_run_at: next.toISOString(),
      };
      if (routineForm === "new") await client.createAgentRoutine(input);
      else await client.updateAgentRoutine(routineForm, input);
      setRoutineForm(null);
      await load();
    } catch {
      setError(
        "The routine could not be saved. Choose a future time and try again.",
      );
    } finally {
      setSaving(false);
    }
  };

  const setGoalStatus = async (goal: Goal, status: Goal["status"]) => {
    setMenu(null);
    setSaving(true);
    try {
      await client.updateGoal(goal.id, { status });
      await load();
    } catch {
      setError("The goal could not be updated.");
    } finally {
      setSaving(false);
    }
  };

  const toggleRoutine = async (routine: AgentRoutine) => {
    setMenu(null);
    setSaving(true);
    try {
      let next = new Date(routine.next_run_at);
      if (routine.paused && next <= new Date()) {
        next =
          nextOccurrence(next, routine.rrule, routine.timezone, new Date()) ??
          new Date(Date.now() + 60_000);
      }
      await client.updateAgentRoutine(routine.id, {
        paused: !routine.paused,
        next_run_at: next.toISOString(),
      });
      await load();
    } catch {
      setError("The routine could not be updated.");
    } finally {
      setSaving(false);
    }
  };

  const deleteSelected = async () => {
    if (!menu) return;
    const selected = menu;
    setMenu(null);
    if (
      !(await ask({
        title:
          selected.kind === "goal"
            ? "Delete this goal?"
            : "Delete this routine?",
        body: "Its progress history and upcoming runs will be removed.",
        confirmLabel: "Delete",
        destructive: true,
      }))
    )
      return;
    setSaving(true);
    try {
      if (selected.kind === "goal") await client.deleteGoal(selected.id);
      else await client.deleteAgentRoutine(selected.id);
      await load();
    } catch {
      setError("It could not be deleted. Try again.");
    } finally {
      setSaving(false);
    }
  };

  const today = localDateKey(new Date(), timezone);
  const currentMonday = addDays(today, -((weekdayOf(today) + 6) % 7));

  const goalFields = (
    <form
      className="settings-subform ai-upcoming-form"
      aria-label={goalForm === "new" ? "New goal" : "Edit goal"}
      onSubmit={(event) => void saveGoal(event)}
    >
      <div className="settings-field">
        <label htmlFor="ai-goal-title">Goal</label>
        <input
          id="ai-goal-title"
          required
          autoFocus
          maxLength={120}
          placeholder="e.g. Pass COMP90089"
          value={goalTitle}
          onChange={(event) => setGoalTitle(event.target.value)}
        />
      </div>
      <div className="settings-field">
        <label htmlFor="ai-goal-target">What does done look like?</label>
        <textarea
          id="ai-goal-target"
          maxLength={2000}
          rows={2}
          value={goalTarget}
          onChange={(event) => setGoalTarget(event.target.value)}
        />
      </div>
      <label className="settings-field">
        <span className="settings-label">Target date</span>
        <DateField
          value={goalDate}
          onChange={(event) => setGoalDate(event.target.value)}
        />
      </label>
      <label className="settings-field">
        <span className="settings-label">Project</span>
        <Select
          value={goalProject}
          onChange={(event) => chooseGoalProject(event.target.value)}
        >
          <option value="">No project</option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </Select>
      </label>
      <label className="settings-field">
        <span className="settings-label">Plan (an Agent note)</span>
        <Select
          value={goalDoc}
          onChange={(event) => setGoalDoc(event.target.value)}
        >
          <option value="">No plan note</option>
          {goalPlanDocs.map((doc) => (
            <option key={doc.id} value={doc.id}>
              {doc.title}
            </option>
          ))}
        </Select>
      </label>
      <div className="button-row">
        <button
          type="button"
          className="secondary"
          onClick={() => setGoalForm(null)}
        >
          Cancel
        </button>
        <button type="submit" className="primary" disabled={saving}>
          {goalForm === "new" ? "Add goal" : "Save goal"}
        </button>
      </div>
    </form>
  );

  const routineFields = (
    <form
      className="settings-subform ai-upcoming-form"
      aria-label={routineForm === "new" ? "New routine" : "Edit routine"}
      onSubmit={(event) => void saveRoutine(event)}
    >
      <div className="settings-field">
        <label htmlFor="ai-routine-text">What should {agentName} do?</label>
        <textarea
          id="ai-routine-text"
          required
          autoFocus
          maxLength={4000}
          rows={3}
          placeholder="e.g. Check my week and flag anything at risk"
          value={routineText}
          onChange={(event) => setRoutineText(event.target.value)}
        />
      </div>
      <div className="ai-upcoming-pair">
        <label className="settings-field">
          <span className="settings-label">
            {routineForm === "new" ? "First run" : "Next run"}
          </span>
          <DateField
            type="date"
            value={routineDay}
            onChange={(event) => setRoutineDay(event.target.value)}
          />
        </label>
        <label className="settings-field">
          <span className="settings-label">Time</span>
          <DateField
            type="time"
            value={routineTime}
            onChange={(event) => setRoutineTime(event.target.value)}
          />
        </label>
      </div>
      <label className="settings-field">
        <span className="settings-label">Repeat</span>
        <Select
          value={repeat}
          onChange={(event) => setRepeat(event.target.value)}
        >
          <option value="daily">Every day</option>
          <option value="weekdays">Every weekday</option>
          <option value="weekly">Every week</option>
        </Select>
      </label>
      <div className="button-row">
        <button
          type="button"
          className="secondary"
          onClick={() => setRoutineForm(null)}
        >
          Cancel
        </button>
        <button type="submit" className="primary" disabled={saving}>
          {routineForm === "new" ? "Add routine" : "Save routine"}
        </button>
      </div>
    </form>
  );

  const menuGoal =
    menu?.kind === "goal" ? goals.find((g) => g.id === menu.id) : undefined;
  const menuRoutine =
    menu?.kind === "routine"
      ? routines.find((r) => r.id === menu.id)
      : undefined;
  const openMenu = (
    kind: "goal" | "routine",
    id: string,
    target: HTMLElement,
  ) =>
    setMenu(
      menu?.id === id
        ? null
        : { kind, id, anchor: target.getBoundingClientRect() },
    );

  return (
    <aside
      id="ai-upcoming"
      className="ai-upcoming"
      aria-labelledby="ai-upcoming-title"
    >
      <div className="ai-upcoming-head">
        <h2 id="ai-upcoming-title">Upcoming</h2>
        <button
          type="button"
          className="icon-button"
          aria-label="Close Upcoming"
          title="Close"
          onClick={onClose}
        >
          <X size={18} aria-hidden="true" />
        </button>
      </div>
      <div className="ai-upcoming-body">
        <p className="muted ai-upcoming-lead">
          Weekly goal check-ins and {agentName}’s scheduled runs, in your
          planner time zone ({timezone}).
        </p>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}

        <section aria-labelledby="ai-goals-title">
          <div className="ai-upcoming-section-head">
            <h3 id="ai-goals-title" className="settings-subtitle">
              Goals
            </h3>
            <button
              type="button"
              className="text-button"
              disabled={loading}
              onClick={() => openGoalForm()}
            >
              <Plus size={14} aria-hidden="true" /> New goal
            </button>
          </div>
          {goalForm === "new" && goalFields}
          {loading ? (
            <p className="muted">Loading…</p>
          ) : activeGoals.length ? (
            <ul className="settings-list">
              {activeGoals.map((goal) => {
                if (goalForm === goal.id)
                  return (
                    <li key={goal.id} className="is-editing">
                      {goalFields}
                    </li>
                  );
                const history = checkins[goal.id] ?? [];
                const latest = history[0];
                const checkinDay =
                  latest?.week_of === currentMonday &&
                  ["done", "running"].includes(latest.status)
                    ? addDays(currentMonday, 7)
                    : currentMonday;
                return (
                  <li key={goal.id}>
                    <div className="settings-list-main">
                      <strong>{goal.title}</strong>
                      <small>
                        {goal.status === "paused"
                          ? "Paused"
                          : `Check-in ${dayLabel(checkinDay)}`}
                        {goal.target_date
                          ? ` · Target ${dayLabel(goal.target_date)}`
                          : ""}
                        {goal.project_name ? ` · ${goal.project_name}` : ""}
                      </small>
                      {summaryOf(goal) && <small>{summaryOf(goal)}</small>}
                      {latest && (
                        <small>
                          Last check-in: {checkinStatusLabel(latest.status)}
                          {latest.summary ? ` · ${latest.summary}` : ""}
                        </small>
                      )}
                    </div>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={`Options for ${goal.title}`}
                      aria-haspopup="dialog"
                      aria-expanded={menu?.id === goal.id}
                      disabled={saving}
                      onClick={(event) =>
                        openMenu("goal", goal.id, event.currentTarget)
                      }
                    >
                      <MoreHorizontal size={18} aria-hidden="true" />
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            goalForm !== "new" && <p className="muted">No goals yet.</p>
          )}
        </section>

        <section aria-labelledby="ai-routines-title">
          <div className="ai-upcoming-section-head">
            <h3 id="ai-routines-title" className="settings-subtitle">
              Routines
            </h3>
            <button
              type="button"
              className="text-button"
              disabled={loading}
              onClick={() => openRoutineForm()}
            >
              <Plus size={14} aria-hidden="true" /> New routine
            </button>
          </div>
          {routineForm === "new" && routineFields}
          {loading ? (
            <p className="muted">Loading…</p>
          ) : routines.length ? (
            <ul className="settings-list">
              {routines.map((routine) =>
                routineForm === routine.id ? (
                  <li key={routine.id} className="is-editing">
                    {routineFields}
                  </li>
                ) : (
                  <li key={routine.id}>
                    <div className="settings-list-main">
                      <strong>{routine.instruction}</strong>
                      <small>
                        {routine.paused
                          ? "Paused"
                          : `Next ${new Date(routine.next_run_at).toLocaleString([], { dateStyle: "medium", timeStyle: "short", timeZone: routine.timezone })}`}{" "}
                        · {describeRrule(routine.rrule)}
                      </small>
                      {typeof routine.last_result?.summary === "string" && (
                        <small>Last run: {routine.last_result.summary}</small>
                      )}
                    </div>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={`Options for ${routine.instruction}`}
                      aria-haspopup="dialog"
                      aria-expanded={menu?.id === routine.id}
                      disabled={saving}
                      onClick={(event) =>
                        openMenu("routine", routine.id, event.currentTarget)
                      }
                    >
                      <MoreHorizontal size={18} aria-hidden="true" />
                    </button>
                  </li>
                ),
              )}
            </ul>
          ) : (
            routineForm !== "new" && <p className="muted">No routines yet.</p>
          )}
        </section>

        {allowedRows.length > 0 && (
          <section aria-labelledby="ai-allowed-title">
            <h3 id="ai-allowed-title" className="settings-subtitle">
              Allowed without asking
            </h3>
            <ul className="settings-list">
              {allowedRows.map(([kind, rule]) => {
                const label = CHANGE_KIND_LABELS[kind] ?? kind;
                return (
                  <li key={kind}>
                    <div className="settings-list-main">
                      <strong>{label}</strong>
                      <small>{ruleLabel(rule)}</small>
                    </div>
                    <button
                      type="button"
                      className="icon-button"
                      disabled={saving}
                      aria-label={`Ask again before changing ${label.toLowerCase()}`}
                      title="Ask me first again"
                      onClick={() => void removeAllowed(kind)}
                    >
                      <X size={16} aria-hidden="true" />
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </div>

      {menu && (menuGoal || menuRoutine) && (
        <Popover
          anchor={menu.anchor}
          label={`Options for ${menuGoal?.title ?? menuRoutine?.instruction}`}
          onClose={() => setMenu(null)}
        >
          <div className="popover-actions">
            {menuGoal && (
              <>
                <button
                  type="button"
                  onClick={() =>
                    void setGoalStatus(
                      menuGoal,
                      menuGoal.status === "paused" ? "active" : "paused",
                    )
                  }
                >
                  {menuGoal.status === "paused" ? (
                    <Play size={15} aria-hidden="true" />
                  ) : (
                    <Pause size={15} aria-hidden="true" />
                  )}
                  {menuGoal.status === "paused" ? "Resume" : "Pause"}
                </button>
                <button type="button" onClick={() => openGoalForm(menuGoal)}>
                  <Pencil size={15} aria-hidden="true" />
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => void setGoalStatus(menuGoal, "done")}
                >
                  <Check size={15} aria-hidden="true" />
                  Mark done
                </button>
              </>
            )}
            {menuRoutine && (
              <>
                <button
                  type="button"
                  onClick={() => void toggleRoutine(menuRoutine)}
                >
                  {menuRoutine.paused ? (
                    <Play size={15} aria-hidden="true" />
                  ) : (
                    <Pause size={15} aria-hidden="true" />
                  )}
                  {menuRoutine.paused ? "Resume" : "Pause"}
                </button>
                <button
                  type="button"
                  onClick={() => openRoutineForm(menuRoutine)}
                >
                  <Pencil size={15} aria-hidden="true" />
                  Edit
                </button>
              </>
            )}
            <button
              type="button"
              className="is-danger"
              onClick={() => void deleteSelected()}
            >
              <Trash2 size={15} aria-hidden="true" />
              Delete
            </button>
          </div>
        </Popover>
      )}
    </aside>
  );
}
