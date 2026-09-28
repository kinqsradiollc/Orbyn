import React, { useEffect, useState } from "react";
import {
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  addDays,
  dayTime,
  describeRrule,
  localDateKey,
  nextOccurrence,
  weekdayOf,
  type AgentRoutine,
  type DocSummary,
  type Goal,
  type GoalCheckin,
  type Project,
} from "@orbyn/core";
import { Button } from "./Button";
import { Chip, ChipRow } from "./Chip";
import { DateField, Field, TimeField } from "./Field";
import { MoreMenu, type MoreAction } from "./MoreMenu";
import { PressableScale, Pressable } from "../motion";
import { client } from "../lib/api";
import { confirmAction } from "../lib/confirm";
import { colors, fonts, radii, themed } from "../theme";
import { shared } from "../styles";

const WEEKDAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
type Picker = "project" | "note" | null;

function nextRun(day: string, time: Date, repeat: string, timezone: string) {
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

function summaryOf(goal: Goal) {
  return typeof goal.progress.summary === "string" ? goal.progress.summary : "";
}

/** Goals, weekly check-ins and scheduled Assistant runs on the phone. */
export function AssistantUpcoming({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
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
  const [goalDate, setGoalDate] = useState<string | null>(null);
  const [goalProject, setGoalProject] = useState("");
  const [goalDoc, setGoalDoc] = useState("");
  const [routineText, setRoutineText] = useState("");
  const [routineDay, setRoutineDay] = useState(localDateKey(new Date(), "UTC"));
  const [routineTime, setRoutineTime] = useState(() => {
    const date = new Date();
    date.setHours(date.getHours() + 1, 0, 0, 0);
    return date;
  });
  const [repeat, setRepeat] = useState("daily");
  const [picker, setPicker] = useState<Picker>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const load = async () => {
    const [nextGoals, nextRoutines, nextProjects, nextDocs, prefs] =
      await Promise.all([
        client.listGoals(),
        client.listAgentRoutines(),
        client.listProjects(),
        client.listDocs({ kind: "agent" }),
        client.getPlannerPrefs(),
      ]);
    const zone = prefs.timezone || "UTC";
    setGoals(nextGoals);
    setRoutines(nextRoutines);
    setProjects(nextProjects);
    setAgentDocs(nextDocs);
    setTimezone(zone);
    setRoutineDay(localDateKey(new Date(), zone));
    const results = await Promise.all(
      nextGoals
        .slice(0, 30)
        .map(
          async (goal) =>
            [goal.id, await client.goalCheckins(goal.id)] as const,
        ),
    );
    setCheckins(Object.fromEntries(results));
  };

  useEffect(() => {
    if (!visible) return;
    void load().catch(() =>
      setError("Upcoming goals and routines could not be loaded."),
    );
  }, [visible]);

  const createGoal = async () => {
    if (!goalTitle.trim() || saving) return;
    setSaving(true);
    setError("");
    try {
      await client.createGoal({
        title: goalTitle,
        target: goalTarget,
        target_date: goalDate,
        project_id: goalProject || null,
        plan_doc_id: goalDoc || null,
      });
      setGoalTitle("");
      setGoalTarget("");
      setGoalDate(null);
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

  const createRoutine = async () => {
    if (!routineText.trim() || saving) return;
    setSaving(true);
    setError("");
    try {
      const { rule, next } = nextRun(routineDay, routineTime, repeat, timezone);
      if (!next) throw new Error("No future run is available.");
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
  const selectedProject =
    projects.find((project) => project.id === goalProject)?.name ??
    "No project";
  const selectedDoc =
    agentDocs.find((doc) => doc.id === goalDoc)?.title ?? "No plan note";

  const goalActions = (goal: Goal): MoreAction[] => [
    {
      label: goal.status === "paused" ? "Resume" : "Pause",
      icon: "pause",
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
    { label: "Delete", destructive: true, onPress: () => deleteGoal(goal) },
  ];
  const routineActions = (routine: AgentRoutine): MoreAction[] => [
    {
      label: routine.paused ? "Resume" : "Pause",
      icon: routine.paused ? "play" : "pause",
      onPress: () => void toggleRoutine(routine),
      disabled: saving,
    },
    {
      label: "Delete",
      destructive: true,
      onPress: () => deleteRoutine(routine),
    },
  ];

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={s.screen}>
        <View style={s.header}>
          <View style={s.flex}>
            <Text style={shared.eyebrow}>UPCOMING</Text>
            <Text style={shared.title}>Goals and routines</Text>
            <Text style={shared.small}>
              Your planner time zone · {timezone}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close Upcoming"
            hitSlop={8}
            onPress={onClose}
          >
            <Text style={s.close}>Done</Text>
          </Pressable>
        </View>
        <View style={s.addRow}>
          <Button
            title="New goal"
            icon="plus"
            secondary
            onPress={() => {
              setGoalForm((open) => !open);
              setRoutineForm(false);
            }}
          />
          <Button
            title="New routine"
            icon="plus"
            secondary
            onPress={() => {
              setRoutineForm((open) => !open);
              setGoalForm(false);
            }}
          />
        </View>
        <ScrollView
          contentContainerStyle={s.content}
          keyboardShouldPersistTaps="handled"
        >
          {goalForm && (
            <View style={s.form}>
              <Text style={shared.sectionTitle}>New goal</Text>
              <Field label="Goal">
                <TextInput
                  value={goalTitle}
                  onChangeText={setGoalTitle}
                  maxLength={120}
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
              <DateField
                label="Target date"
                value={goalDate}
                onChange={setGoalDate}
                clearable
              />
              <Field label="Project (optional)">
                <PressableScale
                  accessibilityRole="button"
                  onPress={() => setPicker("project")}
                  style={s.select}
                >
                  <Text style={s.selectText}>{selectedProject}</Text>
                </PressableScale>
              </Field>
              <Field label="Agent plan note (optional)">
                <PressableScale
                  accessibilityRole="button"
                  onPress={() => setPicker("note")}
                  style={s.select}
                >
                  <Text style={s.selectText}>{selectedDoc}</Text>
                </PressableScale>
              </Field>
              <View style={s.formActions}>
                <Button
                  title="Save goal"
                  disabled={saving || !goalTitle.trim()}
                  onPress={() => void createGoal()}
                />
                <Button
                  title="Cancel"
                  secondary
                  onPress={() => setGoalForm(false)}
                />
              </View>
            </View>
          )}
          {routineForm && (
            <View style={s.form}>
              <Text style={shared.sectionTitle}>New routine</Text>
              <Field label="What should Orbyn do?">
                <TextInput
                  value={routineText}
                  onChangeText={setRoutineText}
                  maxLength={4000}
                  multiline
                  style={[shared.input, s.multiline]}
                />
              </Field>
              <DateField
                label="First run"
                value={routineDay}
                onChange={(day) => day && setRoutineDay(day)}
                minimumDate={new Date()}
              />
              <TimeField
                label="Time"
                value={routineTime}
                onChange={setRoutineTime}
              />
              <Field label="Repeat">
                <ChipRow label="Repeat routine">
                  {[
                    ["daily", "Daily"],
                    ["weekdays", "Weekdays"],
                    ["weekly", "Weekly"],
                  ].map(([value, label]) => (
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
                  title="Save routine"
                  disabled={saving || !routineText.trim()}
                  onPress={() => void createRoutine()}
                />
                <Button
                  title="Cancel"
                  secondary
                  onPress={() => setRoutineForm(false)}
                />
              </View>
            </View>
          )}
          {!!error && (
            <Text accessibilityRole="alert" style={s.error}>
              {error}
            </Text>
          )}
          <Text style={shared.sectionTitle}>Goals</Text>
          {activeGoals.length ? (
            activeGoals.map((goal) => {
              const history = checkins[goal.id] ?? [];
              const latest = history[0];
              const checkinDay =
                latest?.week_of === currentMonday &&
                ["done", "running"].includes(latest.status)
                  ? addDays(currentMonday, 7)
                  : currentMonday;
              return (
                <View key={goal.id} style={s.row}>
                  <View style={s.flex}>
                    <Text style={s.rowTitle}>{goal.title}</Text>
                    <Text style={shared.small}>
                      Weekly check-in · {checkinDay}
                      {goal.target_date ? ` · target ${goal.target_date}` : ""}
                      {goal.project_name ? ` · ${goal.project_name}` : ""}
                    </Text>
                    {!!summaryOf(goal) && (
                      <Text style={shared.small}>{summaryOf(goal)}</Text>
                    )}
                    {latest && (
                      <Text style={shared.small}>
                        Last check-in · {latest.status} · {latest.summary}
                      </Text>
                    )}
                  </View>
                  <MoreMenu
                    label={`Goal options for ${goal.title}`}
                    title={goal.title}
                    actions={goalActions(goal)}
                    disabled={saving}
                  />
                </View>
              );
            })
          ) : (
            <Text style={shared.small}>No active goals yet.</Text>
          )}
          <Text style={[shared.sectionTitle, s.sectionGap]}>Routines</Text>
          {routines.length ? (
            routines.map((routine) => (
              <View key={routine.id} style={s.row}>
                <View style={s.flex}>
                  <Text style={s.rowTitle}>{routine.instruction}</Text>
                  <Text style={shared.small}>
                    {routine.paused
                      ? "Paused"
                      : `Next · ${new Date(routine.next_run_at).toLocaleString([], { dateStyle: "medium", timeStyle: "short", timeZone: routine.timezone })}`}{" "}
                    · {describeRrule(routine.rrule)}
                  </Text>
                  {typeof routine.last_result?.summary === "string" && (
                    <Text style={shared.small}>
                      {routine.last_result.summary}
                    </Text>
                  )}
                </View>
                <MoreMenu
                  label="Routine options"
                  title={routine.instruction}
                  actions={routineActions(routine)}
                  disabled={saving}
                />
              </View>
            ))
          ) : (
            <Text style={shared.small}>No scheduled routines yet.</Text>
          )}
        </ScrollView>
        {picker && (
          <View style={s.pickerBackdrop}>
            <View style={s.pickerPanel}>
              <Text style={shared.sectionTitle}>
                {picker === "project"
                  ? "Choose a project"
                  : "Choose an Agent note"}
              </Text>
              <ScrollView>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    picker === "project" ? setGoalProject("") : setGoalDoc("");
                    setPicker(null);
                  }}
                  style={s.pickerRow}
                >
                  <Text style={s.pickerText}>
                    {picker === "project" ? "No project" : "No plan note"}
                  </Text>
                </Pressable>
                {(picker === "project" ? projects : goalPlanDocs).map(
                  (entry) => (
                    <Pressable
                      key={entry.id}
                      accessibilityRole="button"
                      onPress={() => {
                        if (picker === "project") {
                          setGoalProject(entry.id);
                          if (
                            goalDoc &&
                            !agentDocs.some(
                              (doc) =>
                                doc.id === goalDoc &&
                                doc.project_id === entry.id,
                            )
                          )
                            setGoalDoc("");
                        } else setGoalDoc(entry.id);
                        setPicker(null);
                      }}
                      style={s.pickerRow}
                    >
                      <Text style={s.pickerText}>
                        {picker === "project"
                          ? (entry as Project).name
                          : (entry as DocSummary).title}
                      </Text>
                    </Pressable>
                  ),
                )}
              </ScrollView>
              <Button
                title="Cancel"
                secondary
                onPress={() => setPicker(null)}
              />
            </View>
          </View>
        )}
      </View>
    </Modal>
  );
}

const s = themed(() =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background, paddingTop: 14 },
    header: {
      flexDirection: "row",
      gap: 12,
      alignItems: "flex-start",
      paddingHorizontal: 18,
      paddingBottom: 12,
    },
    flex: { flex: 1, minWidth: 0, gap: 4 },
    close: {
      fontFamily: fonts.semibold,
      color: colors.accent,
      fontSize: 15,
      padding: 8,
    },
    addRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
      paddingHorizontal: 18,
      paddingBottom: 8,
    },
    content: { paddingHorizontal: 18, paddingTop: 8, paddingBottom: 32 },
    form: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.card,
      padding: 16,
      marginBottom: 18,
    },
    multiline: { minHeight: 76, textAlignVertical: "top", paddingTop: 12 },
    formActions: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
      marginTop: 6,
    },
    row: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 12,
      paddingVertical: 14,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    rowTitle: { fontFamily: fonts.semibold, color: colors.text, fontSize: 15 },
    sectionGap: { marginTop: 22, marginBottom: 4 },
    error: {
      color: colors.danger,
      fontFamily: fonts.medium,
      marginVertical: 8,
    },
    select: {
      minHeight: 50,
      justifyContent: "center",
      paddingHorizontal: 14,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.input,
      backgroundColor: colors.surface,
    },
    selectText: { color: colors.text, fontFamily: fonts.regular, fontSize: 15 },
    pickerBackdrop: {
      position: "absolute",
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      zIndex: 10,
      backgroundColor: colors.background,
      padding: 22,
      paddingTop: 50,
    },
    pickerPanel: { flex: 1, gap: 12 },
    pickerRow: {
      minHeight: 50,
      justifyContent: "center",
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    pickerText: { color: colors.text, fontFamily: fonts.medium, fontSize: 15 },
  }),
);
