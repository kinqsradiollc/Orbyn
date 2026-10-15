import React, { useEffect, useRef, useState } from "react";
import {
  Platform,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { Pressable } from "../../motion";
import {
  MILESTONE_STATUS_LABELS,
  addDays,
  isClosed,
  localDateKey,
  shortMinutes,
  type Item,
  type ProjectMilestone,
} from "@orbyn/core";
import { client } from "../../lib/api";
import { confirmAction } from "../../lib/confirm";
import { BottomSheet } from "../../components/BottomSheet";
import { Icon } from "../../components/Icon";
import { Pill, type PillTone } from "../../components/Pill";
import { SmallAction } from "../../components/SmallAction";
import { DateTimeControl } from "../../components/DateTimeControl";
import { colors, fonts, radii, themed } from "../../theme";
import { shared } from "../../styles";

const TONE: Record<ProjectMilestone["status"], PillTone> = {
  done: "accent",
  on_track: "accent",
  not_planned: "warning",
  late: "warning",
  passed: "warning",
  empty: "muted",
};

/** "Fri 16 Oct" for a milestone's day. */
const dayLabel = (day: string) =>
  new Date(`${day}T12:00:00`).toLocaleDateString([], {
    weekday: "short",
    day: "numeric",
    month: "short",
  });

const keyOf = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

type Draft = {
  id: string | null;
  name: string;
  due_on: string;
  item_ids: string[];
};

/**
 * A project's milestones on its Home (as on the web): dated checkpoints in
 * their own list, each rolling up its tasks — how many are done and, for
 * your part, whether it's planned to finish by the day. Never dates on
 * stages, and never a task's deadline.
 */
export function ProjectMilestones(
  props: Parameters<typeof ProjectMilestonesBody>[0],
) {
  return <ProjectMilestonesBody key={props.projectId} {...props} />;
}

function ProjectMilestonesBody({
  projectId,
  items,
  canWrite,
  onChanged,
  onError,
}: {
  projectId: string;
  /** The project's tasks. */
  items: Item[];
  canWrite: boolean;
  onChanged?: () => void;
  onError: (e: unknown) => void;
}) {
  const [list, setList] = useState<ProjectMilestone[] | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);

  const request = useRef(0);
  const mutation = useRef(false);
  const [failed, setFailed] = useState(false);
  const load = async () => {
    const epoch = ++request.current;
    setFailed(false);
    try {
      const next = await client.projectMilestones(projectId);
      if (epoch === request.current) setList(next);
    } catch (e) {
      if (epoch === request.current) {
        setFailed(true);
        onError(e);
      }
    }
  };
  const act = async (work: () => Promise<unknown>) => {
    if (!canWrite || mutation.current) return;
    mutation.current = true;
    setBusy(true);
    try {
      await work();
      setDraft(null);
      setPicking(false);
      await load();
      onChanged?.();
    } catch (e) {
      onError(e);
    } finally {
      mutation.current = false;
      setBusy(false);
    }
  };
  useEffect(() => {
    void load();
    return () => {
      request.current++;
    };
    // Reloads with its project.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const tasks = items.filter((i) => i.kind === "task" && !isClosed(i.status));
  const today = localDateKey(
    new Date(),
    Intl.DateTimeFormat().resolvedOptions().timeZone,
  );

  const save = async () => {
    if (!canWrite || mutation.current || !draft || !draft.name.trim()) return;
    mutation.current = true;
    setBusy(true);
    try {
      if (draft.id) {
        await client.updateMilestone(projectId, draft.id, {
          name: draft.name.trim(),
          due_on: draft.due_on,
        });
        const was = new Set(
          items.filter((i) => i.milestone_id === draft.id).map((i) => i.id),
        );
        for (const id of draft.item_ids)
          if (!was.has(id)) await client.setItemMilestone(id, draft.id);
        for (const id of was)
          if (!draft.item_ids.includes(id))
            await client.setItemMilestone(id, null);
      } else
        await client.createMilestone(projectId, {
          name: draft.name.trim(),
          due_on: draft.due_on,
          item_ids: draft.item_ids,
        });
      setDraft(null);
      await load();
      onChanged?.();
    } catch (e) {
      onError(e);
    } finally {
      mutation.current = false;
      setBusy(false);
    }
  };

  const remove = (m: ProjectMilestone) =>
    confirmAction(
      `Remove “${m.name}”?`,
      "Its tasks stay in the project, with their deadlines as they are.",
      "Remove",
      () => void act(() => client.deleteMilestone(projectId, m.id)),
    );

  if (list !== null && !list.length && !canWrite && !failed) return null;
  return (
    <View style={s.section}>
      <View style={s.head}>
        <Text style={s.heading}>Milestones</Text>
        {canWrite && !draft && (
          <SmallAction
            label="Add"
            disabled={busy}
            onPress={() =>
              setDraft({
                id: null,
                name: "",
                due_on: addDays(today, 7),
                item_ids: [],
              })
            }
          />
        )}
      </View>
      {failed && (
        <>
          <Text style={shared.small}>Milestones unavailable.</Text>
          <SmallAction
            label="Retry"
            disabled={busy}
            onPress={() => void load()}
          />
        </>
      )}
      {list === null && !failed && (
        <Text style={shared.small}>Loading milestones…</Text>
      )}
      {list !== null && !list.length && !draft && (
        <Text style={shared.small}>No milestones yet.</Text>
      )}
      {list?.map((m) => (
        <Pressable
          key={m.id}
          accessibilityRole={canWrite ? "button" : undefined}
          accessibilityLabel={`${m.name}, ${dayLabel(m.due_on)}, ${MILESTONE_STATUS_LABELS[m.status]}`}
          disabled={!canWrite || busy}
          onPress={() =>
            setDraft({
              id: m.id,
              name: m.name,
              due_on: m.due_on,
              item_ids: items
                .filter((i) => i.milestone_id === m.id)
                .map((i) => i.id),
            })
          }
          style={({ pressed }) => [s.row, pressed && { opacity: 0.7 }]}
        >
          <Icon name="flag" size={15} color={colors.accent} />
          <View style={s.main}>
            <Text style={s.name}>{m.name}</Text>
            <Text style={shared.small}>
              {dayLabel(m.due_on)} · {m.done_count} of {m.task_count} done
              {m.status === "not_planned" &&
              m.needed_minutes > m.planned_minutes
                ? ` · ${shortMinutes(m.needed_minutes - m.planned_minutes)} not planned`
                : ""}
            </Text>
          </View>
          <Pill
            label={MILESTONE_STATUS_LABELS[m.status]}
            tone={TONE[m.status]}
          />
        </Pressable>
      ))}
      {draft && (
        <BottomSheet
          visible
          title={draft.id ? "Milestone" : "New milestone"}
          onClose={() => {
            if (!busy) {
              setDraft(null);
              setPicking(false);
            }
          }}
        >
          <View style={s.form}>
            <TextInput
              editable={!busy}
              style={shared.input}
              value={draft.name}
              autoFocus
              maxLength={120}
              placeholder="Draft ready"
              placeholderTextColor={colors.faint}
              accessibilityLabel="Milestone name"
              onChangeText={(name) => setDraft({ ...draft, name })}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Date, ${dayLabel(draft.due_on)}`}
              disabled={busy}
              onPress={() => setPicking((p) => !p)}
              style={s.dateButton}
            >
              <Icon name="calendar" size={15} color={colors.accent} />
              <Text style={s.dateText}>{dayLabel(draft.due_on)}</Text>
            </Pressable>
            {picking && (
              <DateTimeControl
                value={new Date(`${draft.due_on}T12:00:00`)}
                mode="date"
                display={Platform.OS === "ios" ? "inline" : "default"}
                accentColor={colors.accent}
                textColor={colors.text}
                onChange={(event, date) => {
                  if (Platform.OS !== "ios") setPicking(false);
                  if (busy || event.type === "dismissed" || !date) return;
                  setDraft({ ...draft, due_on: keyOf(date) });
                }}
              />
            )}
            {tasks.length > 0 && (
              <View style={s.tasks}>
                <Text style={shared.label}>Its tasks</Text>
                {tasks.map((t) => (
                  <View key={t.id} style={s.taskRow}>
                    <Text style={s.taskTitle}>{t.title}</Text>
                    <Switch
                      disabled={busy}
                      trackColor={{ true: colors.accent }}
                      accessibilityLabel={`${t.title} in this milestone`}
                      value={draft.item_ids.includes(t.id)}
                      onValueChange={(on) =>
                        setDraft({
                          ...draft,
                          item_ids: on
                            ? [...draft.item_ids, t.id]
                            : draft.item_ids.filter((id) => id !== t.id),
                        })
                      }
                    />
                  </View>
                ))}
              </View>
            )}
            <Text style={shared.small}>Task deadlines stay unchanged.</Text>
            <View style={s.actions}>
              <SmallAction
                label="Save"
                disabled={busy || !draft.name.trim()}
                onPress={() => void save()}
              />
              <SmallAction
                label="Cancel"
                disabled={busy}
                onPress={() => {
                  setDraft(null);
                  setPicking(false);
                }}
              />
              {draft.id &&
                (() => {
                  const m = list?.find((x) => x.id === draft.id);
                  return m ? (
                    <>
                      <SmallAction
                        label={m.done_at ? "Not done yet" : "Mark done"}
                        disabled={busy}
                        onPress={() =>
                          void act(() =>
                            client.updateMilestone(projectId, m.id, {
                              done: !m.done_at,
                            }),
                          )
                        }
                      />
                      <SmallAction
                        label="Remove"
                        destructive
                        disabled={busy}
                        onPress={() => remove(m)}
                      />
                    </>
                  ) : null;
                })()}
            </View>
          </View>
        </BottomSheet>
      )}
    </View>
  );
}

const s = themed(() =>
  StyleSheet.create({
    section: {
      gap: 10,
      padding: 14,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.card,
      backgroundColor: colors.surface,
    },
    head: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      flexWrap: "wrap",
      gap: 8,
    },
    heading: { fontFamily: fonts.semibold, fontSize: 15, color: colors.text },
    row: {
      flexDirection: "row",
      flexWrap: "wrap",
      alignItems: "center",
      gap: 10,
      minHeight: 44,
    },
    main: { flex: 1, flexBasis: 160, minWidth: 0, gap: 2 },
    name: { fontFamily: fonts.medium, fontSize: 15, color: colors.text },
    form: { gap: 10 },
    dateButton: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      alignSelf: "flex-start",
      paddingHorizontal: 12,
      minHeight: 44,
      borderRadius: radii.pill,
      backgroundColor: colors.accentSoft,
    },
    dateText: {
      fontFamily: fonts.semibold,
      fontSize: 13,
      color: colors.accent,
    },
    tasks: { gap: 4 },
    taskRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 10,
      minHeight: 44,
    },
    taskTitle: {
      flex: 1,
      fontFamily: fonts.regular,
      fontSize: 15,
      color: colors.text,
    },
    actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  }),
);
