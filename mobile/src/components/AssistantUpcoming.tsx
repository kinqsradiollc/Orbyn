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
  type ApprovalScopes,
  type AssistantChangeKind,
  type DocSummary,
  type Goal,
  type GoalCheckin,
  type Project,
} from "@orbyn/core";
import { Button } from "./Button";
import { Chip, ChipRow } from "./Chip";
import { ErrorBanner } from "./ErrorBanner";
import { DateField, Field, TimeField } from "./Field";
import { MoreMenu, type MoreAction } from "./MoreMenu";
import { Sheet, sheetStyles } from "./Sheet";
import { client } from "../lib/api";
import { confirmAction } from "../lib/confirm";
import {
  CHANGE_KIND_LABELS,
  checkinStatusLabel,
  dayLabel,
} from "../lib/assistant-labels";
import { colors, fonts, themed } from "../theme";
import { shared } from "../styles";

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
export function AssistantUpcoming({
  agentName,
  visible,
  onClose,
}: {
  /** The name the person gave their assistant. */
  agentName: string;
  visible: boolean;
  onClose: () => void;
}) {
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
  const [form, setForm] = useState<Form>(null);
  const [goalTitle, setGoalTitle] = useState("");
  const [goalTarget, setGoalTarget] = useState("");
  const [goalDate, setGoalDate] = useState<string | null>(null);
  const [goalProject, setGoalProject] = useState("");
  const [goalDoc, setGoalDoc] = useState("");
  const [routineText, setRoutineText] = useState("");
  const [routineDay, setRoutineDay] = useState(localDateKey(new Date(), "UTC"));
  const [routineTime, setRoutineTime] = useState(inAnHour);
  const [repeat, setRepeat] = useState<Repeat>("daily");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

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
    const zone = prefs.timezone || "UTC";
    setGoals(nextGoals);
    setRoutines(nextRoutines);
    setProjects(nextProjects);
    setAgentDocs(nextDocs);
    setTimezone(zone);
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
    if (!visible) return;
    setError("");
    void load()
      .catch(
        () =>
          live.current &&
          setError("Upcoming goals and routines could not be loaded."),
      )
      .finally(() => live.current && setLoading(false));
  }, [visible]);

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

  const openGoalForm = (goal: Goal | null) => {
    setGoalTitle(goal?.title ?? "");
    setGoalTarget(goal?.target ?? "");
    setGoalDate(goal?.target_date ?? null);
    setGoalProject(goal?.project_id ?? "");
    setGoalDoc(goal?.plan_doc_id ?? "");
    setError("");
    setForm({ kind: "goal", id: goal?.id ?? null });
  };

  const openRoutineForm = (routine: AgentRoutine | null) => {
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
    setForm({ kind: "routine", id: routine?.id ?? null });
  };

  const saveGoal = async () => {
    if (!goalTitle.trim() || saving || form?.kind !== "goal") return;
    setSaving(true);
    setError("");
    try {
      const input = {
        title: goalTitle.trim(),
        target: goalTarget,
        target_date: goalDate,
        project_id: goalProject || null,
        plan_doc_id: goalDoc || null,
      };
      if (form.id) await client.updateGoal(form.id, input);
      else await client.createGoal(input);
      setForm(null);
      await load();
    } catch {
      setError(
        "The goal could not be saved. Check its project and Agent note, then try again.",
      );
    } finally {
      setSaving(false);
    }
  };

  const saveRoutine = async () => {
    if (!routineText.trim() || saving || form?.kind !== "routine") return;
    setSaving(true);
    setError("");
    try {
      const zone = form.id
        ? (routines.find((r) => r.id === form.id)?.timezone ?? timezone)
        : timezone;
      const { rule, next } = nextRun(routineDay, routineTime, repeat, zone);
      if (!next) throw new Error("No future run is available.");
      if (form.id)
        await client.updateAgentRoutine(form.id, {
          instruction: routineText.trim(),
          rrule: rule,
          next_run_at: next.toISOString(),
        });
      else
        await client.createAgentRoutine({
          instruction: routineText.trim(),
          rrule: rule,
          timezone,
          next_run_at: next.toISOString(),
        });
      setForm(null);
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
      if (routine.paused && next <= new Date())
        next =
          nextOccurrence(next, routine.rrule, routine.timezone, new Date()) ??
          new Date(Date.now() + 60_000);
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

  const deleteGoal = (goal: Goal) =>
    confirmAction(
      "Delete this goal?",
      "Its progress history will be removed.",
      "Delete",
      () =>
        void (async () => {
          setSaving(true);
          try {
            await client.deleteGoal(goal.id);
            await load();
          } catch {
            setError("The goal could not be deleted.");
          } finally {
            setSaving(false);
          }
        })(),
    );

  const deleteRoutine = (routine: AgentRoutine) =>
    confirmAction(
      "Delete this routine?",
      "Its upcoming runs will be removed.",
      "Delete",
      () =>
        void (async () => {
          setSaving(true);
          try {
            await client.deleteAgentRoutine(routine.id);
            await load();
          } catch {
            setError("The routine could not be deleted.");
          } finally {
            setSaving(false);
          }
        })(),
    );

  const today = localDateKey(new Date(), timezone);
  const currentMonday = addDays(today, -((weekdayOf(today) + 6) % 7));
  const activeGoals = goals.filter((goal) => goal.status !== "done");
  const goalPlanDocs = goalProject
    ? agentDocs.filter((doc) => doc.project_id === goalProject)
    : agentDocs;

  const goalActions = (goal: Goal): MoreAction[] => [
    {
      label: "Edit",
      icon: "fileText",
      onPress: () => openGoalForm(goal),
      disabled: saving,
    },
    {
      label: goal.status === "paused" ? "Resume" : "Pause",
      icon: goal.status === "paused" ? "play" : "pause",
      onPress: () =>
        void setGoalStatus(
          goal,
          goal.status === "paused" ? "active" : "paused",
        ),
      disabled: saving,
    },
    {
      label: "Mark done",
      icon: "check",
      onPress: () => void setGoalStatus(goal, "done"),
      disabled: saving || goal.status === "done",
    },
    {
      label: "Delete",
      icon: "trash",
      destructive: true,
      onPress: () => deleteGoal(goal),
    },
  ];
  const routineActions = (routine: AgentRoutine): MoreAction[] => [
    {
      label: "Edit",
      icon: "fileText",
      onPress: () => openRoutineForm(routine),
      disabled: saving,
    },
    {
      label: routine.paused ? "Resume" : "Pause",
      icon: routine.paused ? "play" : "pause",
      onPress: () => void toggleRoutine(routine),
      disabled: saving,
    },
    {
      label: "Delete",
      icon: "trash",
      destructive: true,
      onPress: () => deleteRoutine(routine),
    },
  ];

  return (
    <Sheet visible={visible} title="Goals and routines" onClose={onClose}>
      <ScrollView
        contentContainerStyle={sheetStyles.body}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        automaticallyAdjustKeyboardInsets
      >
        <View style={sheetStyles.column}>
          <ErrorBanner error={error} onDismiss={() => setError("")} />
          <Text style={[shared.small, s.intro]}>
            {agentName} checks in on your goals each week and runs routines at
            the times you set. Times are in {timezone}.
          </Text>
          {form?.kind === "goal" ? (
            <View style={shared.card}>
              <Text style={[shared.sectionTitle, s.formTitle]}>
                {form.id ? "Edit goal" : "New goal"}
              </Text>
              <Field label="Goal">
                <TextInput
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
                  value={goalTarget}
                  onChangeText={setGoalTarget}
                  maxLength={2000}
                  multiline
                  style={[shared.input, s.multiline]}
                />
              </Field>
              <Field label="Target date">
                <DateField
                  label="Target date"
                  placeholder="No target date"
                  value={goalDate}
                  onChange={setGoalDate}
                  clearable
                />
              </Field>
              <Field label="Project">
                <ChipRow label="Project">
                  <Chip
                    label="No project"
                    selected={!goalProject}
                    onPress={() => setGoalProject("")}
                  />
                  {projects.map((project) => (
                    <Chip
                      key={project.id}
                      label={project.name}
                      selected={goalProject === project.id}
                      onPress={() => {
                        setGoalProject(project.id);
                        if (
                          goalDoc &&
                          !agentDocs.some(
                            (doc) =>
                              doc.id === goalDoc &&
                              doc.project_id === project.id,
                          )
                        )
                          setGoalDoc("");
                      }}
                    />
                  ))}
                </ChipRow>
              </Field>
              <Field label="Plan (an Agent note)">
                <ChipRow label="Plan note">
                  <Chip
                    label="No plan note"
                    selected={!goalDoc}
                    onPress={() => setGoalDoc("")}
                  />
                  {goalPlanDocs.map((doc) => (
                    <Chip
                      key={doc.id}
                      label={doc.title || "Untitled"}
                      selected={goalDoc === doc.id}
                      onPress={() => setGoalDoc(doc.id)}
                    />
                  ))}
                </ChipRow>
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
                  onPress={() => setForm(null)}
                />
              </View>
            </View>
          ) : form?.kind === "routine" ? (
            <View style={shared.card}>
              <Text style={[shared.sectionTitle, s.formTitle]}>
                {form.id ? "Edit routine" : "New routine"}
              </Text>
              <Field label={`What should ${agentName} do?`}>
                <TextInput
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
                  label={form.id ? "Next run" : "First run"}
                  value={routineDay}
                  onChange={(day) => day && setRoutineDay(day)}
                  minimumDate={new Date()}
                />
              </Field>
              <Field label="Time">
                <TimeField
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
                  title={saving ? "Saving…" : "Save routine"}
                  disabled={saving || !routineText.trim()}
                  style={s.formAction}
                  onPress={() => void saveRoutine()}
                />
                <Button
                  title="Cancel"
                  secondary
                  disabled={saving}
                  style={s.formAction}
                  onPress={() => setForm(null)}
                />
              </View>
            </View>
          ) : (
            <View style={s.formActions}>
              <Button
                title="New goal"
                icon="plus"
                secondary
                style={s.formAction}
                onPress={() => openGoalForm(null)}
              />
              <Button
                title="New routine"
                icon="plus"
                secondary
                style={s.formAction}
                onPress={() => openRoutineForm(null)}
              />
            </View>
          )}

          <Text style={[shared.sectionTitle, s.section]}>Goals</Text>
          {loading ? (
            <Text style={shared.small}>Loading…</Text>
          ) : activeGoals.length ? (
            activeGoals.map((goal) => {
              const history = checkins[goal.id] ?? [];
              const latest = history[0];
              const checkinDay =
                latest?.week_of === currentMonday &&
                ["done", "running"].includes(latest.status)
                  ? addDays(currentMonday, 7)
                  : currentMonday;
              const summary = summaryOf(goal);
              return (
                <View key={goal.id} style={s.row}>
                  <View style={s.flex}>
                    <Text style={s.rowTitle} numberOfLines={1}>
                      {goal.title}
                    </Text>
                    <Text style={shared.small} numberOfLines={2}>
                      {goal.status === "paused"
                        ? "Paused"
                        : `Check-in ${dayLabel(checkinDay)}`}
                      {goal.target_date
                        ? ` · Target ${dayLabel(goal.target_date)}`
                        : ""}
                      {goal.project_name ? ` · ${goal.project_name}` : ""}
                    </Text>
                    {(!!summary || latest) && (
                      <Text style={shared.small} numberOfLines={2}>
                        {summary ||
                          `Last check-in: ${checkinStatusLabel(latest!.status)}${latest!.summary ? ` · ${latest!.summary}` : ""}`}
                      </Text>
                    )}
                  </View>
                  <MoreMenu
                    label={`Options for ${goal.title}`}
                    title={goal.title}
                    actions={goalActions(goal)}
                    disabled={saving}
                  />
                </View>
              );
            })
          ) : (
            <Text style={shared.small}>No goals yet.</Text>
          )}

          <Text style={[shared.sectionTitle, s.section]}>Routines</Text>
          {loading ? (
            <Text style={shared.small}>Loading…</Text>
          ) : routines.length ? (
            routines.map((routine) => (
              <View key={routine.id} style={s.row}>
                <View style={s.flex}>
                  <Text style={s.rowTitle} numberOfLines={1}>
                    {routine.instruction}
                  </Text>
                  <Text style={shared.small} numberOfLines={2}>
                    {routine.paused
                      ? "Paused"
                      : `Next ${new Date(routine.next_run_at).toLocaleString(
                          [],
                          {
                            dateStyle: "medium",
                            timeStyle: "short",
                            timeZone: routine.timezone,
                          },
                        )}`}{" "}
                    · {describeRrule(routine.rrule)}
                  </Text>
                  {typeof routine.last_result?.summary === "string" && (
                    <Text style={shared.small} numberOfLines={2}>
                      {routine.last_result.summary}
                    </Text>
                  )}
                </View>
                <MoreMenu
                  label={`Options for ${routine.instruction}`}
                  title={routine.instruction}
                  actions={routineActions(routine)}
                  disabled={saving}
                />
              </View>
            ))
          ) : (
            <Text style={shared.small}>No routines yet.</Text>
          )}

          {allowedRows.length > 0 && (
            <>
              <Text style={[shared.sectionTitle, s.section]}>
                Allowed without asking
              </Text>
              {allowedRows.map(([kind, rule]) => (
                <View key={kind} style={s.row}>
                  <View style={s.flex}>
                    <Text style={s.rowTitle} numberOfLines={1}>
                      {CHANGE_KIND_LABELS[kind] ?? kind}
                    </Text>
                    <Text style={shared.small} numberOfLines={2}>
                      {ruleLabel(rule)}
                    </Text>
                  </View>
                  <MoreMenu
                    label={`Options for ${CHANGE_KIND_LABELS[kind] ?? kind}`}
                    title={CHANGE_KIND_LABELS[kind] ?? kind}
                    disabled={saving}
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
    formTitle: { marginBottom: 14 },
    flex: { flex: 1, minWidth: 0, gap: 2 },
    multiline: { minHeight: 78, textAlignVertical: "top" },
    formActions: { flexDirection: "row", gap: 8 },
    formAction: { flex: 1 },
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
