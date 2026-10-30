import { RoutineSetupReview } from "./RoutineSetupReview";
import { RoutineQuietPolicyEditor } from "./RoutineQuietCheck";
import { RoutineRetryPolicyEditor } from "./RoutineRecovery";
import { GoalWorkSheet } from "./GoalWorkSheet";
import { RoutineRunHistory } from "./RoutineRunHistory";
import React, { useEffect, useRef, useState } from "react";
import { ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import {
  addDays,
  dayTime,
  describeRrule,
  localDateKey,
  nextOccurrence,
  weekdayOf,
  type AgentRoutine,
  type AgentRoutineInput,
  type ApprovalScopes,
  type AssistantChangeKind,
  type DocSummary,
  type Goal,
  type GoalCheckin,
  type Project,
} from "@orbyn/core";
import { Button } from "../../components/Button";
import { Chip, ChipRow } from "../../components/Chip";
import { ChoicePicker } from "../../components/ChoicePicker";
import { InlineDetails } from "../../components/InlineDetails";
import { AssistantControls } from "./AssistantControls";
import { ErrorBanner } from "../../components/ErrorBanner";
import { DateField, Field, TimeField } from "../../components/Field";
import { MoreMenu, type MoreAction } from "../../components/MoreMenu";
import { Sheet, sheetStyles } from "../../components/Sheet";
import { client } from "../../lib/api";
import { Alert } from "../../lib/alert";
import { session } from "../../lib/session";
import {
  CHANGE_KIND_LABELS,
  checkinStatusLabel,
  dayLabel,
} from "./assistant-labels";
import { colors, fonts, themed } from "../../theme";
import { shared } from "../../styles";

const WEEKDAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
type Repeat = "daily" | "weekdays" | "weekly";
/** Which form is open: a new goal or routine, or one being edited. */
type Form =
  | { kind: "goal"; id: string | null }
  | { kind: "routine"; id: string | null }
  | null;

function nextRun(day: string, time: Date, repeat: Repeat, timezone: string) {
  const rule =
    repeat === "daily"
      ? "FREQ=DAILY"
      : repeat === "weekdays"
        ? "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR"
        : `FREQ=WEEKLY;BYDAY=${WEEKDAYS[weekdayOf(day)]}`;
  const start = dayTime(
    day,
    time.getHours() * 60 + time.getMinutes(),
    timezone,
  );
  return {
    rule,
    next:
      start > new Date()
        ? start
        : nextOccurrence(start, rule, timezone, new Date()),
  };
}

/** The Repeat choice a saved rule came from. */
function repeatOf(rrule: string): Repeat {
  if (/FREQ=DAILY/.test(rrule)) return "daily";
  if (/BYDAY=MO,TU,WE,TH,FR$/.test(rrule)) return "weekdays";
  return "weekly";
}

function summaryOf(goal: Goal) {
  return typeof goal.progress.summary === "string" ? goal.progress.summary : "";
}

const inAnHour = () => {
  const date = new Date();
  date.setHours(date.getHours() + 1, 0, 0, 0);
  return date;
};

/** Goals, weekly check-ins and scheduled assistant runs on the phone. */
export function AssistantUpcoming(props: Parameters<typeof UpcomingBody>[0]) {
  return <UpcomingBody key={session.token} {...props} />;
}
function UpcomingBody({
  agentName,
  visible,
  conversationEnabled = false,
  onOpenChat,
  onClose,
}: {
  /** The name the person gave their assistant. */
  agentName: string;
  visible: boolean;
  conversationEnabled?: boolean;
  onOpenChat?: (id: string) => void;
  onClose: () => void;
}) {
  const owner = session.token;
  const live = useRef(true);
  const shown = useRef({ visible, epoch: 0 });
  if (shown.current.visible !== visible) {
    shown.current = { visible, epoch: shown.current.epoch + 1 };
  }
  const epoch = shown.current.epoch;
  const current = () =>
    live.current &&
    shown.current.visible &&
    shown.current.epoch === epoch &&
    session.token === owner;
  const sequence = useRef(0);
  const mutation = useRef(false);
  const refreshQueued = useRef(false);
  const latestReload = useRef<() => Promise<void>>(async () => {});
  const [loadFailed, setLoadFailed] = useState(false);
  const [historyFailed, setHistoryFailed] = useState<string[]>([]);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      sequence.current++;
    };
  }, []);
  const [loading, setLoading] = useState(true);
  const [allowed, setAllowed] = useState<ApprovalScopes>({});
  const [goals, setGoals] = useState<Goal[]>([]);
  const [workGoal, setWorkGoal] = useState<{
    goal: Goal;
    mode: "start" | "history";
  } | null>(null);
  const [checkins, setCheckins] = useState<Record<string, GoalCheckin[]>>({});
  const [routines, setRoutines] = useState<AgentRoutine[]>([]);
  const [historyRoutineId, setHistoryRoutineId] = useState<string | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [agentDocs, setAgentDocs] = useState<DocSummary[]>([]);
  const [timezone, setTimezone] = useState("UTC");
  const [form, setForm] = useState<Form>(null);
  const [goalTitle, setGoalTitle] = useState("");
  const [goalTarget, setGoalTarget] = useState("");
  const [goalDate, setGoalDate] = useState<string | null>(null);
  const [goalProject, setGoalProject] = useState("");
  const [goalDoc, setGoalDoc] = useState("");
  const [routineSetup, setRoutineSetup] = useState<AgentRoutineInput | null>(
    null,
  );
  const [routineSetupUncertain, setRoutineSetupUncertain] = useState(false);
  const [routineText, setRoutineText] = useState("");
  const [routineDay, setRoutineDay] = useState(localDateKey(new Date(), "UTC"));
  const [routineTime, setRoutineTime] = useState(inAnHour);
  const [repeat, setRepeat] = useState<Repeat>("daily");
  const routineDraftKey = JSON.stringify([
    routineText,
    routineDay,
    routineTime.getTime(),
    repeat,
  ]);
  const [routineBaseline, setRoutineBaseline] = useState("");
  useEffect(() => {
    setRoutineBaseline(routineDraftKey);
  }, [form?.kind, form?.id]);

  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const load = async () => {
    const ticket = ++sequence.current;
    const owned = () => current() && ticket === sequence.current;
    const [nextGoals, nextRoutines, nextProjects, nextDocs, prefs, scopes] =
      await Promise.all([
        client.listGoals(),
        client.listAgentRoutines(),
        client.listProjects(),
        client.listDocs({ kind: "agent" }),
        client.getPlannerPrefs(),
        client.assistantApprovalScopes(),
      ]);
    if (!owned()) return;
    setAllowed(scopes);
    setGoals(nextGoals);
    setRoutines(nextRoutines);
    setProjects(nextProjects);
    setAgentDocs(nextDocs);
    setTimezone(prefs.timezone || "UTC");
    const results = await Promise.all(
      nextGoals.slice(0, 30).map(async (goal) => {
        try {
          return {
            id: goal.id,
            history: await client.goalCheckins(goal.id),
            failed: false,
          };
        } catch {
          return { id: goal.id, history: [] as GoalCheckin[], failed: true };
        }
      }),
    );
    if (!owned()) return;
    setCheckins(
      Object.fromEntries(
        results.filter((r) => !r.failed).map((r) => [r.id, r.history]),
      ),
    );
    setHistoryFailed(results.filter((r) => r.failed).map((r) => r.id));
    setLoadFailed(false);
  };
  const reload = async () => {
    if (!current()) return;
    if (mutation.current) {
      refreshQueued.current = true;
      return;
    }
    setLoading(true);
    setError("");
    const ticket = sequence.current + 1;
    try {
      await load();
    } catch {
      if (current() && ticket === sequence.current) {
        setLoadFailed(true);
        setError("Couldn't load upcoming work. Try again.");
      }
    } finally {
      if (current() && ticket === sequence.current) setLoading(false);
    }
  };
  latestReload.current = reload;
  useEffect(() => {
    if (visible) void reload();
    return () => {
      sequence.current++;
    };
  }, [visible]);
  const run = async (fn: () => Promise<void>, message: string) => {
    if (!current() || mutation.current) return;
    mutation.current = true;
    sequence.current++;
    setLoading(false);
    setSaving(true);
    setError("");
    try {
      await fn();
    } catch {
      if (current()) setError(message);
    } finally {
      mutation.current = false;
      if (live.current && session.token === owner) {
        setSaving(false);
        if (refreshQueued.current) {
          refreshQueued.current = false;
          void latestReload.current();
        }
      }
    }
  };
  const refreshSaved = async () => {
    try {
      await load();
    } catch {
      if (current()) {
        setLoadFailed(true);
        setError("Saved. Couldn't refresh upcoming work. Try again.");
      }
    }
  };
  const loadHistory = (goal: Goal) =>
    run(async () => {
      try {
        const history = await client.goalCheckins(goal.id);
        if (!current()) return;
        setCheckins((all) => ({ ...all, [goal.id]: history }));
        setHistoryFailed((ids) => ids.filter((id) => id !== goal.id));
      } catch (e) {
        if (current())
          setHistoryFailed((ids) => [...new Set([...ids, goal.id])]);
        throw e;
      }
    }, "Couldn't load that goal’s history. Try again.");
  const removeAllowed = (kind: AssistantChangeKind) =>
    run(async () => {
      const next = { ...allowed };
      delete next[kind];
      const saved = await client.setAssistantApprovalScopes(next);
      if (current()) setAllowed(saved);
    }, "Couldn't remove that permission. Try again.");

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

  const openGoalForm = (goal: Goal | null) => {
    if (saving || form || loadFailed) return;
    setGoalTitle(goal?.title ?? "");
    setGoalTarget(goal?.target ?? "");
    setGoalDate(goal?.target_date ?? null);
    setGoalProject(goal?.project_id ?? "");
    setGoalDoc(goal?.plan_doc_id ?? "");
    setError("");
    setForm({ kind: "goal", id: goal?.id ?? null });
  };

  const openRoutineForm = (routine: AgentRoutine | null) => {
    if (saving || form || loadFailed) return;
    if (routine) {
      const next = new Date(routine.next_run_at);
      const day = localDateKey(next, routine.timezone);
      const minutes = Math.round(
        (next.getTime() - dayTime(day, 0, routine.timezone).getTime()) / 60000,
      );
      const time = new Date();
      time.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
      setRoutineText(routine.instruction);
      setRoutineDay(day);
      setRoutineTime(time);
      setRepeat(repeatOf(routine.rrule));
    } else {
      setRoutineText("");
      setRoutineDay(localDateKey(new Date(), timezone));
      setRoutineTime(inAnHour());
      setRepeat("daily");
    }
    setError("");
    setRoutineSetup(null);
    setRoutineSetupUncertain(false);
    setForm({ kind: "routine", id: routine?.id ?? null });
  };

  const saveGoal = async () => {
    if (!goalTitle.trim() || form?.kind !== "goal") return;
    await run(async () => {
      const input = {
        title: goalTitle.trim(),
        target: goalTarget,
        target_date: goalDate,
        project_id: goalProject || null,
        plan_doc_id: goalDoc || null,
      };
      if (form.id) await client.updateGoal(form.id, input);
      else await client.createGoal(input);
      if (!live.current || session.token !== owner) return;
      setForm(null);
      if (current()) await refreshSaved();
    }, "Couldn't save the goal. Check its project and plan note, then retry.");
  };
  const saveRoutine = async () => {
    if (!routineText.trim() || form?.kind !== "routine") return;
    await run(async () => {
      const zone = routines.find((r) => r.id === form.id)?.timezone ?? timezone;
      const { rule, next } = nextRun(routineDay, routineTime, repeat, zone);
      if (!next) throw new Error("No future run available");
      if (form.id)
        await client.updateAgentRoutine(form.id, {
          instruction: routineText.trim(),
          rrule: rule,
          next_run_at: next.toISOString(),
        });
      else {
        setRoutineSetup({
          instruction: routineText.trim(),
          rrule: rule,
          timezone: zone,
          next_run_at: next.toISOString(),
        });
        return;
      }
      if (!live.current || session.token !== owner) return;
      setForm(null);
      if (current()) await refreshSaved();
    }, "Couldn't save the routine. Check its schedule, then retry.");
  };
  const setGoalStatus = (goal: Goal, status: Goal["status"]) =>
    run(async () => {
      await client.updateGoal(goal.id, { status });
      if (current()) await refreshSaved();
    }, "Couldn't update the goal. Try again.");
  const toggleRoutine = (routine: AgentRoutine) =>
    run(async () => {
      let next = new Date(routine.next_run_at);
      if (routine.paused && next <= new Date())
        next =
          nextOccurrence(next, routine.rrule, routine.timezone, new Date()) ??
          new Date(Date.now() + 60_000);
      await client.updateAgentRoutine(routine.id, {
        paused: !routine.paused,
        next_run_at: next.toISOString(),
      });
      if (current()) await refreshSaved();
    }, "Couldn't update the routine. Try again.");
  const deleteItem = (kind: "goal" | "routine", id: string, name: string) =>
    run(async () => {
      const confirmed = await new Promise<boolean>((resolve) =>
        Alert.alert(
          kind === "goal" ? "Delete goal?" : "Delete routine?",
          `${name} · ${kind === "goal" ? "Its progress history will be removed." : "Its upcoming runs will be removed."}`,
          [
            { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
            {
              text: "Delete",
              style: "destructive",
              onPress: () => resolve(true),
            },
          ],
          { cancelable: true, onDismiss: () => resolve(false) },
        ),
      );
      if (!confirmed || !current()) return;
      if (kind === "goal") await client.deleteGoal(id);
      else await client.deleteAgentRoutine(id);
      if (current()) await refreshSaved();
    }, "Couldn't delete it. Try again.");
  const deleteGoal = (goal: Goal) =>
    void deleteItem("goal", goal.id, goal.title);
  const deleteRoutine = (routine: AgentRoutine) =>
    void deleteItem("routine", routine.id, routine.instruction);

  const today = localDateKey(new Date(), timezone);
  const currentMonday = addDays(today, -((weekdayOf(today) + 6) % 7));
  const activeGoals = goals.filter((goal) => goal.status !== "done");
  const permissionSummaryFor = (goal: Goal) => {
    const rows = allowedRows.filter(
      ([, rule]) =>
        rule === "always" || (rule?.scope === "goal" && rule.id === goal.id),
    );
    return rows.length
      ? `Saved automatic change permissions for this goal: ${rows.map(([kind]) => CHANGE_KIND_LABELS[kind] ?? kind).join(", ")}.`
      : "No automatic change permissions are saved for this goal.";
  };
  const goalPlanDocs = goalProject
    ? agentDocs.filter((doc) => doc.project_id === goalProject)
    : agentDocs;

  const goalActions = (goal: Goal): MoreAction[] => [
    {
      label: "Edit",
      icon: "fileText",
      onPress: () => openGoalForm(goal),
      disabled: saving || loadFailed || !!form,
    },
    {
      label: goal.status === "paused" ? "Resume" : "Pause",
      icon: goal.status === "paused" ? "play" : "pause",
      onPress: () =>
        void setGoalStatus(
          goal,
          goal.status === "paused" ? "active" : "paused",
        ),
      disabled: saving || loadFailed || !!form,
    },
    {
      label: "Mark done",
      icon: "check",
      onPress: () => void setGoalStatus(goal, "done"),
      disabled: saving || loadFailed || !!form || goal.status === "done",
    },
    {
      label: "Delete",
      icon: "trash",
      destructive: true,
      disabled: saving || loadFailed || !!form,
      onPress: () => deleteGoal(goal),
    },
  ];
  const routineActions = (routine: AgentRoutine): MoreAction[] => [
    {
      label: "Edit",
      icon: "fileText",
      onPress: () => openRoutineForm(routine),
      disabled: saving || loadFailed || !!form,
    },
    {
      label: routine.paused ? "Resume" : "Pause",
      icon: routine.paused ? "play" : "pause",
      onPress: () => void toggleRoutine(routine),
      disabled: saving || loadFailed || !!form,
    },
    {
      label: "Delete",
      icon: "trash",
      destructive: true,
      disabled: saving || loadFailed || !!form,
      onPress: () => deleteRoutine(routine),
    },
  ];

  if (workGoal && visible)
    return (
      <GoalWorkSheet
        goal={workGoal.goal}
        initialMode={workGoal.mode}
        permissionSummary={permissionSummaryFor(workGoal.goal)}
        onClose={() => setWorkGoal(null)}
        onOpenChat={
          onOpenChat
            ? (id) => {
                setWorkGoal(null);
                onOpenChat(id);
              }
            : undefined
        }
      />
    );

  const closeRoutineSetup = async () => {
    if (!current() || saving) return;
    const unknown = routineSetupUncertain;
    setRoutineSetup(null);
    setRoutineSetupUncertain(false);
    setForm(null);
    if (unknown) {
      setSaving(true);
      try {
        await refreshSaved();
        if (current())
          setError(
            "Save status was unknown. Check your routines before adding another.",
          );
      } finally {
        if (live.current && session.token === owner) setSaving(false);
      }
    }
  };
  return (
    <Sheet
      visible={visible}
      title={form ? `${form.id ? "Edit" : "New"} ${form.kind}` : "Upcoming"}
      closeDisabled={saving}
      onClose={() => {
        if (saving) return;
        if (routineSetupUncertain) {
          void closeRoutineSetup();
          return;
        }
        if (form) {
          setRoutineSetup(null);
          setForm(null);
          setError("");
        } else onClose();
      }}
    >
      <ScrollView
        contentContainerStyle={sheetStyles.body}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        automaticallyAdjustKeyboardInsets
      >
        <View style={sheetStyles.column}>
          {visible && (
            <AssistantControls deliveryEnabled={conversationEnabled} />
          )}
          <ErrorBanner error={error} onDismiss={() => setError("")} />
          <Text style={[shared.small, s.intro]}>
            {agentName} · {timezone}
          </Text>
          {form?.kind === "goal" ? (
            <View>
              <Field label="Goal">
                <TextInput
                  editable={!saving}
                  accessibilityLabel="Goal"
                  value={goalTitle}
                  onChangeText={setGoalTitle}
                  maxLength={120}
                  placeholder="Finish the thesis draft"
                  placeholderTextColor={colors.faint}
                  style={shared.input}
                />
              </Field>
              <Field label="What does done look like?">
                <TextInput
                  editable={!saving}
                  accessibilityLabel="What does done look like?"
                  value={goalTarget}
                  onChangeText={setGoalTarget}
                  maxLength={2000}
                  multiline
                  style={[shared.input, s.multiline]}
                />
              </Field>
              <Field label="Target date">
                <DateField
                  disabled={saving}
                  label="Target date"
                  placeholder="No target date"
                  value={goalDate}
                  onChange={setGoalDate}
                  clearable
                />
              </Field>
              <Field label="Project">
                <ChoicePicker
                  label="Project"
                  value={goalProject}
                  disabled={saving}
                  options={[
                    { value: "", label: "No project" },
                    ...projects.map((p) => ({ value: p.id, label: p.name })),
                  ]}
                  onChange={(id) => {
                    setGoalProject(id);
                    if (
                      id &&
                      !agentDocs.some(
                        (d) => d.id === goalDoc && d.project_id === id,
                      )
                    )
                      setGoalDoc("");
                  }}
                />
              </Field>
              <Field label="Plan note">
                <ChoicePicker
                  label="Plan note"
                  value={goalDoc}
                  disabled={saving}
                  options={[
                    { value: "", label: "No plan note" },
                    ...goalPlanDocs.map((d) => ({
                      value: d.id,
                      label: d.title || "Untitled",
                    })),
                  ]}
                  onChange={setGoalDoc}
                />
              </Field>
              <View style={s.formActions}>
                <Button
                  title={saving ? "Saving…" : "Save goal"}
                  disabled={saving || !goalTitle.trim()}
                  style={s.formAction}
                  onPress={() => void saveGoal()}
                />
                <Button
                  title="Cancel"
                  secondary
                  disabled={saving}
                  style={s.formAction}
                  onPress={() => {
                    setForm(null);
                    setError("");
                  }}
                />
              </View>
            </View>
          ) : form?.kind === "routine" ? (
            routineSetup ? (
              <RoutineSetupReview
                input={routineSetup}
                active={visible}
                ruleLabel={ruleLabel}
                onBusy={setSaving}
                onUncertain={setRoutineSetupUncertain}
                onBack={() => {
                  setRoutineSetup(null);
                  setError("");
                }}
                onCheckUpcoming={() => void closeRoutineSetup()}
                onSaved={async () => {
                  if (!current()) return;
                  setSaving(true);
                  setRoutineSetup(null);
                  setRoutineSetupUncertain(false);
                  setForm(null);
                  await refreshSaved();
                  if (live.current && session.token === owner) setSaving(false);
                }}
              />
            ) : (
              <View>
                <Field label={`What should ${agentName} do?`}>
                  <TextInput
                    editable={!saving}
                    accessibilityLabel={`What should ${agentName} do?`}
                    value={routineText}
                    onChangeText={setRoutineText}
                    maxLength={4000}
                    multiline
                    placeholder="Summarise what's due this week"
                    placeholderTextColor={colors.faint}
                    style={[shared.input, s.multiline]}
                  />
                </Field>
                <Field label={form.id ? "Next run" : "First run"}>
                  <DateField
                    disabled={saving}
                    label={form.id ? "Next run" : "First run"}
                    value={routineDay}
                    onChange={(day) => day && setRoutineDay(day)}
                    minimumDate={new Date()}
                  />
                </Field>
                <Field label="Time">
                  <TimeField
                    disabled={saving}
                    label="Time"
                    value={routineTime}
                    onChange={setRoutineTime}
                  />
                </Field>
                <Field label="Repeat">
                  <ChipRow label="Repeat">
                    {(
                      [
                        ["daily", "Daily"],
                        ["weekdays", "Weekdays"],
                        ["weekly", "Weekly"],
                      ] as const
                    ).map(([value, label]) => (
                      <Chip
                        disabled={saving}
                        key={value}
                        label={label}
                        selected={repeat === value}
                        onPress={() => setRepeat(value)}
                      />
                    ))}
                  </ChipRow>
                </Field>
                <View style={s.formActions}>
                  <Button
                    title={
                      saving
                        ? "Saving…"
                        : form.id
                          ? "Save routine"
                          : "Review routine"
                    }
                    disabled={saving || !routineText.trim()}
                    style={s.formAction}
                    onPress={() => void saveRoutine()}
                  />
                  <Button
                    title="Cancel"
                    secondary
                    disabled={saving}
                    style={s.formAction}
                    onPress={() => {
                      setForm(null);
                      setError("");
                    }}
                  />
                </View>
                {form.id ? (
                  <>
                    <RoutineRetryPolicyEditor
                      routineId={form.id}
                      disabled={saving || routineDraftKey !== routineBaseline}
                    />
                    <RoutineQuietPolicyEditor
                      routineId={form.id}
                      disabled={saving || routineDraftKey !== routineBaseline}
                    />
                  </>
                ) : (
                  <Text style={shared.small}>
                    Retries are off. Save this routine before configuring
                    bounded recovery.
                  </Text>
                )}
              </View>
            )
          ) : (
            <View style={s.formActions}>
              <Button
                title="New goal"
                disabled={loading || saving || loadFailed}
                icon="plus"
                secondary
                style={s.formAction}
                onPress={() => openGoalForm(null)}
              />
              <Button
                title="New routine"
                disabled={loading || saving || loadFailed}
                icon="plus"
                secondary
                style={s.formAction}
                onPress={() => openRoutineForm(null)}
              />
            </View>
          )}

          {!form && (
            <>
              {loadFailed && (
                <Button
                  title="Retry"
                  secondary
                  disabled={loading || saving}
                  onPress={() => void reload()}
                />
              )}
              <Text style={[shared.sectionTitle, s.section]}>Goals</Text>
              {loading ? (
                <Text style={shared.small}>Loading…</Text>
              ) : activeGoals.length ? (
                activeGoals.map((goal) => {
                  const history = checkins[goal.id] ?? [];
                  const latest = history[0];
                  const historyKnown = Object.hasOwn(checkins, goal.id);
                  const checkinDay =
                    latest?.week_of === currentMonday &&
                    ["done", "running"].includes(latest.status)
                      ? addDays(currentMonday, 7)
                      : currentMonday;
                  const summary = summaryOf(goal);
                  return (
                    <View key={goal.id} style={s.row}>
                      <View style={s.flex}>
                        <Text style={s.rowTitle}>{goal.title}</Text>
                        <Text style={shared.small}>
                          {goal.status === "paused"
                            ? "Paused"
                            : historyKnown
                              ? `Check-in ${dayLabel(checkinDay)}`
                              : historyFailed.includes(goal.id)
                                ? "History unavailable"
                                : "History not loaded"}
                          {goal.target_date
                            ? ` · Target ${dayLabel(goal.target_date)}`
                            : ""}
                          {goal.project_name ? ` · ${goal.project_name}` : ""}
                        </Text>
                        {!historyKnown && (
                          <Button
                            title={
                              historyFailed.includes(goal.id)
                                ? "Retry history"
                                : "Load history"
                            }
                            secondary
                            disabled={saving || loading || loadFailed}
                            onPress={() => void loadHistory(goal)}
                          />
                        )}
                        <Button
                          title="Work on this goal"
                          secondary
                          disabled={
                            saving ||
                            loading ||
                            loadFailed ||
                            !!form ||
                            goal.status !== "active"
                          }
                          onPress={() => setWorkGoal({ goal, mode: "start" })}
                        />
                        <Button
                          title="Work history"
                          secondary
                          disabled={saving || loading || loadFailed || !!form}
                          onPress={() => setWorkGoal({ goal, mode: "history" })}
                        />
                        {latest && (
                          <Text style={shared.small}>
                            Last check-in: {checkinStatusLabel(latest.status)}
                          </Text>
                        )}
                        {(summary || latest?.summary) && (
                          <InlineDetails title="Progress details">
                            {!!summary && (
                              <Text style={shared.small}>{summary}</Text>
                            )}
                            {!!latest?.summary && (
                              <Text style={shared.small}>{latest.summary}</Text>
                            )}
                          </InlineDetails>
                        )}
                      </View>
                      <MoreMenu
                        label={`Options for ${goal.title}`}
                        title={goal.title}
                        actions={goalActions(goal)}
                        disabled={saving || loading || loadFailed}
                      />
                    </View>
                  );
                })
              ) : (
                !loadFailed && <Text style={shared.small}>No goals yet.</Text>
              )}

              {goals.some((goal) => goal.status === "done") && (
                <InlineDetails title="Completed planning goals">
                  {goals
                    .filter((goal) => goal.status === "done")
                    .map((goal) => (
                      <View key={goal.id}>
                        <Text style={shared.body}>{goal.title}</Text>
                        <Button
                          title="Work history"
                          secondary
                          disabled={saving || loading || loadFailed || !!form}
                          onPress={() => setWorkGoal({ goal, mode: "history" })}
                        />
                      </View>
                    ))}
                </InlineDetails>
              )}
              <Text style={[shared.sectionTitle, s.section]}>Routines</Text>
              {loading ? (
                <Text style={shared.small}>Loading…</Text>
              ) : routines.length ? (
                routines.map((routine) => (
                  <View key={routine.id} style={s.row}>
                    <View style={s.flex}>
                      <Text style={s.rowTitle}>{routine.instruction}</Text>
                      <Text style={shared.small}>
                        {routine.paused
                          ? "Paused"
                          : `Next ${new Date(
                              routine.next_run_at,
                            ).toLocaleString([], {
                              dateStyle: "medium",
                              timeStyle: "short",
                              timeZone: routine.timezone,
                            })}`}{" "}
                        · {describeRrule(routine.rrule)}
                      </Text>
                      <RoutineRunHistory
                        routineId={routine.id}
                        timezone={routine.timezone}
                        open={visible && historyRoutineId === routine.id}
                        disabled={saving || !!form}
                        onToggle={() =>
                          setHistoryRoutineId((id) =>
                            id === routine.id ? null : routine.id,
                          )
                        }
                        onOpenChat={onOpenChat}
                      />
                    </View>
                    <MoreMenu
                      label={`Options for ${routine.instruction}`}
                      title={routine.instruction}
                      actions={routineActions(routine)}
                      disabled={saving || loading || loadFailed}
                    />
                  </View>
                ))
              ) : (
                !loadFailed && (
                  <Text style={shared.small}>No routines yet.</Text>
                )
              )}

              {allowedRows.length > 0 && (
                <InlineDetails
                  title={`Automatic permissions (${allowedRows.length})`}
                >
                  {allowedRows.map(([kind, rule]) => (
                    <View key={kind} style={s.row}>
                      <View style={s.flex}>
                        <Text style={s.rowTitle}>
                          {CHANGE_KIND_LABELS[kind] ?? kind}
                        </Text>
                        <Text style={shared.small}>{ruleLabel(rule)}</Text>
                      </View>
                      <MoreMenu
                        label={`Options for ${CHANGE_KIND_LABELS[kind] ?? kind}`}
                        title={CHANGE_KIND_LABELS[kind] ?? kind}
                        disabled={saving || loading || loadFailed}
                        actions={[
                          {
                            label: "Ask me first again",
                            icon: "trash",
                            destructive: true,
                            onPress: () => void removeAllowed(kind),
                          },
                        ]}
                      />
                    </View>
                  ))}
                </InlineDetails>
              )}
            </>
          )}
        </View>
      </ScrollView>
    </Sheet>
  );
}

const s = themed(() =>
  StyleSheet.create({
    intro: { marginBottom: 14 },
    flex: { flex: 1, minWidth: 0, gap: 2 },
    multiline: { height: 96, maxHeight: 180, textAlignVertical: "top" },
    formActions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    formAction: { flexGrow: 1, flexBasis: 120 },
    section: { marginTop: 18, marginBottom: 4 },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      paddingVertical: 10,
    },
    rowTitle: { fontFamily: fonts.medium, fontSize: 15, color: colors.text },
  }),
);
