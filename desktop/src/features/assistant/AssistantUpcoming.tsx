import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { MoreHorizontal, Plus, Sparkles } from "lucide-react";
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
export function AssistantUpcoming({ agentName }: { agentName: string }) {
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
  const [goalForm, setGoalForm] = useState(false);
  const [routineForm, setRoutineForm] = useState(false);
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

  const createGoal = async (event: FormEvent) => {
    event.preventDefault();
    if (!goalTitle.trim() || saving) return;
    setSaving(true);
    setError("");
    try {
      await client.createGoal({
        title: goalTitle,
        target: goalTarget,
        target_date: goalDate || null,
        project_id: goalProject || null,
        plan_doc_id: goalDoc || null,
      });
      setGoalTitle("");
      setGoalTarget("");
      setGoalDate("");
      setGoalProject("");
      setGoalDoc("");
      setGoalForm(false);
      await load();
    } catch {
      setError(
        "The goal could not be saved. Check its project and Agent note, then try again.",
      );
    } finally {
      setSaving(false);
    }
  };

  const createRoutine = async (event: FormEvent) => {
    event.preventDefault();
    if (!routineText.trim() || saving) return;
    setSaving(true);
    setError("");
    try {
      const { rule, next } = nextRun(routineDay, routineTime, repeat, timezone);
      if (!next)
        throw new Error("No future run is available for this schedule.");
      await client.createAgentRoutine({
        instruction: routineText,
        rrule: rule,
        timezone,
        next_run_at: next.toISOString(),
      });
      setRoutineText("");
      setRoutineForm(false);
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

  return (
    <section className="ai-upcoming" aria-labelledby="ai-upcoming-title">
      <header className="ai-upcoming-head">
        <div>
          <span className="eyebrow">
            <Sparkles size={14} /> UPCOMING
          </span>
          <h2 id="ai-upcoming-title">Goals and routines</h2>
          <p>
            Weekly goal check-ins and {agentName}’s scheduled runs use your
            planner time zone ({timezone}).
          </p>
        </div>
        <div className="ai-upcoming-add">
          <button
            type="button"
            className="ai-ghost"
            onClick={() => {
              setGoalForm((open) => !open);
              setRoutineForm(false);
            }}
          >
            <Plus size={14} /> Goal
          </button>
          <button
            type="button"
            className="ai-ghost"
            onClick={() => {
              setRoutineForm((open) => !open);
              setGoalForm(false);
            }}
          >
            <Plus size={14} /> Routine
          </button>
        </div>
      </header>
      {goalForm && (
        <form
          className="ai-upcoming-form"
          onSubmit={(event) => void createGoal(event)}
        >
          <h3>New goal</h3>
          <label>
            Goal
            <input
              required
              maxLength={120}
              value={goalTitle}
              onChange={(event) => setGoalTitle(event.target.value)}
            />
          </label>
          <label>
            What does done look like?
            <textarea
              maxLength={2000}
              rows={2}
              value={goalTarget}
              onChange={(event) => setGoalTarget(event.target.value)}
            />
          </label>
          <div className="ai-upcoming-form-grid">
            <label>
              Target date{" "}
              <DateField
                value={goalDate}
                onChange={(event) => setGoalDate(event.target.value)}
              />
            </label>
            <label>
              Project{" "}
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
            <label>
              Agent plan note{" "}
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
          </div>
          <div className="ai-upcoming-actions">
            <button type="submit" className="ai-primary" disabled={saving}>
              Save goal
            </button>
            <button
              type="button"
              className="ai-ghost"
              onClick={() => setGoalForm(false)}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
      {routineForm && (
        <form
          className="ai-upcoming-form"
          onSubmit={(event) => void createRoutine(event)}
        >
          <h3>New routine</h3>
          <label>
            What should {agentName} do?
            <textarea
              required
              maxLength={4000}
              rows={3}
              value={routineText}
              onChange={(event) => setRoutineText(event.target.value)}
            />
          </label>
          <div className="ai-upcoming-form-grid">
            <label>
              First run{" "}
              <DateField
                type="date"
                value={routineDay}
                onChange={(event) => setRoutineDay(event.target.value)}
              />
            </label>
            <label>
              Time{" "}
              <DateField
                type="time"
                value={routineTime}
                onChange={(event) => setRoutineTime(event.target.value)}
              />
            </label>
            <label>
              Repeat{" "}
              <Select
                value={repeat}
                onChange={(event) => setRepeat(event.target.value)}
              >
                <option value="daily">Every day</option>
                <option value="weekdays">Every weekday</option>
                <option value="weekly">Every week</option>
              </Select>
            </label>
          </div>
          <div className="ai-upcoming-actions">
            <button type="submit" className="ai-primary" disabled={saving}>
              Save routine
            </button>
            <button
              type="button"
              className="ai-ghost"
              onClick={() => setRoutineForm(false)}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
      {error && (
        <p className="ai-upcoming-error" role="alert">
          {error}
        </p>
      )}
      <div className="ai-upcoming-grid">
        <section>
          <h3>Goals</h3>
          {loading ? (
            <p className="ai-upcoming-empty">Loading goals…</p>
          ) : activeGoals.length ? (
            <ul className="ai-upcoming-list">
              {activeGoals.map((goal) => {
                const history = checkins[goal.id] ?? [];
                const latest = history[0];
                const checkinDay =
                  latest?.week_of === currentMonday &&
                  ["done", "running"].includes(latest.status)
                    ? addDays(currentMonday, 7)
                    : currentMonday;
                return (
                  <li key={goal.id}>
                    <div className="ai-upcoming-row-main">
                      <strong>{goal.title}</strong>
                      <small>
                        Weekly check-in {dayLabel(checkinDay)}
                        {goal.target_date
                          ? ` · target ${dayLabel(goal.target_date)}`
                          : ""}
                        {goal.project_name ? ` · ${goal.project_name}` : ""}
                      </small>
                      {summaryOf(goal) && <p>{summaryOf(goal)}</p>}
                      {latest && (
                        <small>
                          Last check-in · {checkinStatusLabel(latest.status)}
                          {latest.summary ? ` · ${latest.summary}` : ""}
                        </small>
                      )}
                    </div>
                    <div className="ai-upcoming-row-actions">
                      <button
                        type="button"
                        className="ai-ghost"
                        disabled={saving}
                        onClick={() =>
                          void setGoalStatus(
                            goal,
                            goal.status === "paused" ? "active" : "paused",
                          )
                        }
                      >
                        {goal.status === "paused" ? "Resume" : "Pause"}
                      </button>
                      <button
                        type="button"
                        className="ai-menu-trigger"
                        aria-label={`Options for ${goal.title}`}
                        aria-haspopup="dialog"
                        aria-expanded={menu?.id === goal.id}
                        onClick={(event) =>
                          setMenu(
                            menu?.id === goal.id
                              ? null
                              : {
                                  kind: "goal",
                                  id: goal.id,
                                  anchor:
                                    event.currentTarget.getBoundingClientRect(),
                                },
                          )
                        }
                      >
                        <MoreHorizontal size={16} />
                      </button>
                      {menu?.id === goal.id && (
                        <Popover
                          anchor={menu.anchor}
                          label={`Options for ${goal.title}`}
                          onClose={() => setMenu(null)}
                        >
                          <div className="popover-actions">
                            <button
                              type="button"
                              onClick={() => {
                                setMenu(null);
                                void setGoalStatus(goal, "done");
                              }}
                            >
                              Mark done
                            </button>
                            <button
                              type="button"
                              onClick={() => void deleteSelected()}
                            >
                              Delete
                            </button>
                          </div>
                        </Popover>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="ai-upcoming-empty">No active goals yet.</p>
          )}
        </section>
        <section>
          <h3>Routines</h3>
          {loading ? (
            <p className="ai-upcoming-empty">Loading routines…</p>
          ) : routines.length ? (
            <ul className="ai-upcoming-list">
              {routines.map((routine) => (
                <li key={routine.id}>
                  <div className="ai-upcoming-row-main">
                    <strong>{routine.instruction}</strong>
                    <small>
                      {routine.paused
                        ? "Paused"
                        : `Next · ${new Date(routine.next_run_at).toLocaleString([], { dateStyle: "medium", timeStyle: "short", timeZone: routine.timezone })}`}{" "}
                      · {describeRrule(routine.rrule)}
                    </small>
                    {typeof routine.last_result?.summary === "string" && (
                      <p>{routine.last_result.summary}</p>
                    )}
                  </div>
                  <div className="ai-upcoming-row-actions">
                    <button
                      type="button"
                      className="ai-ghost"
                      disabled={saving}
                      onClick={() => void toggleRoutine(routine)}
                    >
                      {routine.paused ? "Resume" : "Pause"}
                    </button>
                    <button
                      type="button"
                      className="ai-menu-trigger"
                      aria-label={`Options for ${routine.instruction}`}
                      aria-haspopup="dialog"
                      aria-expanded={menu?.id === routine.id}
                      onClick={(event) =>
                        setMenu(
                          menu?.id === routine.id
                            ? null
                            : {
                                kind: "routine",
                                id: routine.id,
                                anchor:
                                  event.currentTarget.getBoundingClientRect(),
                              },
                        )
                      }
                    >
                      <MoreHorizontal size={16} />
                    </button>
                    {menu?.id === routine.id && (
                      <Popover
                        anchor={menu.anchor}
                        label={`Options for ${routine.instruction}`}
                        onClose={() => setMenu(null)}
                      >
                        <div className="popover-actions">
                          <button
                            type="button"
                            onClick={() => void deleteSelected()}
                          >
                            Delete
                          </button>
                        </div>
                      </Popover>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="ai-upcoming-empty">No scheduled routines yet.</p>
          )}
        </section>
        {allowedRows.length > 0 && (
          <section>
            <h3>Allowed without asking</h3>
            <ul className="ai-upcoming-list">
              {allowedRows.map(([kind, rule]) => (
                <li key={kind}>
                  <div className="ai-upcoming-row-main">
                    <strong>{CHANGE_KIND_LABELS[kind] ?? kind}</strong>
                    <small>{ruleLabel(rule)}</small>
                  </div>
                  <div className="ai-upcoming-row-actions">
                    <button
                      type="button"
                      className="ai-ghost"
                      disabled={saving}
                      aria-label={`Ask again before changing ${(CHANGE_KIND_LABELS[kind] ?? kind).toLowerCase()}`}
                      onClick={() => void removeAllowed(kind)}
                    >
                      Remove
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </section>
  );
}
