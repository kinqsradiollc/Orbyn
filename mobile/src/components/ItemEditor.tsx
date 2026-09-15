import React, { useEffect, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import DateTimePicker from "@react-native-community/datetimepicker";
import {
  dateLabel,
  hasTeamPermission,
  statusLabels,
  statusOrder,
  type Item,
  type ItemInput,
  type Team,
  type TeamMember,
} from "@orbyn/core";
import { Button } from "./Button";
import { Chip, ChipRow } from "./Chip";
import { NumberInput } from "./Field";
import { Icon } from "./Icon";
import { RepeatPicker } from "./RepeatPicker";
import { Segmented } from "./Segmented";
import { client } from "../lib/api";
import { deviceTimeZone, ESTIMATES, minutesLabel } from "../lib/planning";
import { usePlanning } from "../lib/planningContext";
import { PressableScale } from "../motion";
import { colors, fonts, radii, spacing, themed } from "../theme";
import { shared } from "../styles";

/** A saved item being edited, or the draft of a new one. */
export type Editing = Item | ItemInput;

type DateField = "due_at" | "end_at";
type Picker = { field: DateField; mode: "date" | "time" };

type Props = {
  editing: Editing | null;
  /** Your teams, for the "Share with" picker and the viewer read-only check. */
  teams: Team[];
  busy: boolean;
  error: string;
  /** Only the fields that changed; the parent merges them into its latest copy. */
  onChange: (patch: Partial<ItemInput>) => void;
  onSave: () => void;
  onDelete: () => void;
  onClose: () => void;
  /** iOS: called after the sheet has finished animating away. */
  onDismissed?: () => void;
};

const PERSONAL = "personal";

/** Native sheet on iOS, full-screen modal on Android; both respect safe areas. */
export function ItemEditor({ editing, onClose, onDismissed, ...form }: Props) {
  return (
    <Modal
      visible={!!editing}
      animationType="slide"
      presentationStyle={Platform.OS === "ios" ? "pageSheet" : "fullScreen"}
      onRequestClose={onClose}
      onDismiss={onDismissed}
    >
      <SafeAreaProvider>
        <SafeAreaView
          edges={["top", "bottom", "left", "right"]}
          style={s.sheet}
        >
          {editing && <Form editing={editing} onClose={onClose} {...form} />}
        </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
}

/** Mounted only while something is being edited, so picker state resets on close. */
function Form({
  editing,
  teams,
  busy,
  error,
  onChange,
  onSave,
  onDelete,
  onClose,
}: Omit<Props, "editing"> & { editing: Editing }) {
  const [picker, setPicker] = useState<Picker | null>(null);
  const setDate = (field: DateField, value: string | null) =>
    onChange(field === "due_at" ? { due_at: value } : { end_at: value });
  // The team the item was saved in when the editor opened; moving it out needs members:manage there.
  const [savedTeamId] = useState(editing.team_id ?? null);
  const exists = "id" in editing;
  const teamId = editing.team_id ?? null;
  const team = teams.find((t) => t.id === teamId);
  const savedTeam = teams.find((t) => t.id === savedTeamId);
  const readOnly = !!team && !hasTeamPermission(team.role, "items:write");
  const lockedToTeam =
    exists &&
    !!savedTeam &&
    !hasTeamPermission(savedTeam.role, "members:manage");
  const shareTargets = lockedToTeam
    ? [savedTeam]
    : teams.filter((t) => hasTeamPermission(t.role, "items:write"));
  const shareOptions = [
    ...(lockedToTeam ? [] : [PERSONAL]),
    ...shareTargets.map((t) => t.id),
  ];
  const shareLabels: Record<string, string> = { [PERSONAL]: "Personal" };
  for (const t of shareTargets) shareLabels[t.id] = t.name;

  // Lists and tags must belong where the item lives: yours for a personal
  // item, the team's for a team item (the server checks this too).
  const { lists, tags, reload } = usePlanning();
  const scopeLists = lists.filter((l) => (l.team_id ?? null) === teamId);
  const scopeTags = tags.filter((t) => (t.team_id ?? null) === teamId);
  const tagIds = editing.tag_ids ?? [];
  const [members, setMembers] = useState<TeamMember[]>([]);
  useEffect(() => {
    if (!teamId) {
      setMembers([]);
      return;
    }
    let alive = true;
    client
      .getTeam(teamId)
      .then((d) => alive && setMembers(d.members))
      .catch(() => alive && setMembers([]));
    return () => {
      alive = false;
    };
  }, [teamId]);
  const estimate = editing.estimate_minutes ?? null;
  const [customEstimate, setCustomEstimate] = useState(
    () => !!estimate && !(ESTIMATES as readonly number[]).includes(estimate),
  );
  const [newTag, setNewTag] = useState("");
  const [tagBusy, setTagBusy] = useState(false);
  const [tagError, setTagError] = useState("");
  const addTag = async () => {
    const name = newTag.trim();
    if (!name) return;
    const existing = scopeTags.find(
      (t) => t.name.toLowerCase() === name.toLowerCase(),
    );
    if (existing) {
      if (!tagIds.includes(existing.id))
        onChange({ tag_ids: [...tagIds, existing.id] });
      setNewTag("");
      return;
    }
    setTagBusy(true);
    setTagError("");
    try {
      const tag = await client.createTag({ name, team_id: teamId });
      await reload();
      onChange({ tag_ids: [...tagIds, tag.id] });
      setNewTag("");
    } catch (e) {
      setTagError((e as Error).message);
    } finally {
      setTagBusy(false);
    }
  };
  return (
    <>
      <View style={s.header}>
        <Text style={s.headerTitle}>
          {readOnly
            ? "View plan"
            : exists
              ? "Edit your plan"
              : "Make a little plan"}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close editor"
          hitSlop={10}
          onPress={onClose}
          style={s.close}
        >
          <Icon name="x" size={18} color={colors.textSoft} />
        </Pressable>
      </View>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={s.body}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
        >
          <View style={s.column}>
            {readOnly && (
              <View style={s.viewOnly}>
                <Icon name="users" size={16} color={colors.accent} />
                <Text style={s.viewOnlyText}>
                  View only — you’re a viewer in {team?.name}
                </Text>
              </View>
            )}
            <Section label="What’s the plan?">
              <TextInput
                editable={!readOnly}
                style={[shared.input, s.titleInput]}
                value={editing.title}
                onChangeText={(title) => onChange({ title })}
                maxLength={200}
                placeholder="Something worth making time for"
                placeholderTextColor={colors.faint}
                autoFocus={!exists}
              />
            </Section>
            {!readOnly && shareOptions.length > 1 && (
              <Section label="Share with">
                <Segmented
                  wrap
                  accessibilityLabel="Share with"
                  options={shareOptions}
                  labels={shareLabels}
                  value={teamId ?? PERSONAL}
                  onChange={(value) => {
                    const next = value === PERSONAL ? null : value;
                    if (next === teamId) return;
                    // A list, tags or assignee from elsewhere don't carry over.
                    onChange({
                      team_id: next,
                      list_id: null,
                      tag_ids: [],
                      assignee_id: null,
                    });
                  }}
                />
                {lockedToTeam && (
                  <Text style={[shared.small, s.hint]}>
                    Only team admins can move this out of {savedTeam.name}.
                  </Text>
                )}
              </Section>
            )}
            <Section label="Type">
              <Segmented
                disabled={readOnly}
                accessibilityLabel="Type"
                options={["task", "event"] as const}
                value={editing.kind}
                onChange={(kind) => onChange({ kind })}
              />
            </Section>
            <Section label="Priority">
              <Segmented
                disabled={readOnly}
                accessibilityLabel="Priority"
                options={["low", "medium", "high"] as const}
                value={editing.priority}
                onChange={(priority) => onChange({ priority })}
              />
            </Section>
            <Section label="Status">
              <Segmented
                wrap
                disabled={readOnly}
                accessibilityLabel="Status"
                options={statusOrder}
                labels={statusLabels}
                value={editing.status}
                onChange={(status) => onChange({ status })}
              />
            </Section>
            {(["due_at", "end_at"] as const).map((field) => (
              <Section
                key={field}
                label={field === "due_at" ? "Due / start" : "End (optional)"}
              >
                <View style={s.dateRow}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={
                      (field === "due_at" ? "Due date: " : "End date: ") +
                      dateLabel(editing[field])
                    }
                    disabled={readOnly}
                    onPress={() => setPicker({ field, mode: "date" })}
                    style={({ pressed }) => [
                      s.dateButton,
                      picker?.field === field && s.dateActive,
                      pressed && { backgroundColor: colors.surfaceMuted },
                    ]}
                  >
                    <Icon
                      name={field === "due_at" ? "clock" : "calendar"}
                      size={16}
                      color={colors.accent}
                    />
                    <Text
                      style={[
                        s.dateText,
                        !editing[field] && { color: colors.faint },
                      ]}
                    >
                      {dateLabel(editing[field])}
                    </Text>
                  </Pressable>
                  {editing[field] && !readOnly && (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Clear time"
                      hitSlop={8}
                      onPress={() => {
                        if (picker?.field === field) setPicker(null);
                        setDate(field, null);
                      }}
                      style={s.clear}
                    >
                      <Icon name="x" size={16} color={colors.muted} />
                    </Pressable>
                  )}
                </View>
              </Section>
            ))}
            {picker && (
              <View style={s.pickerCard}>
                <DateTimePicker
                  value={new Date(editing[picker.field] || Date.now())}
                  mode={picker.mode}
                  display={Platform.OS === "ios" ? "spinner" : "default"}
                  accentColor={colors.accent}
                  textColor={colors.text}
                  onChange={(event, date) => {
                    if (event.type === "dismissed") {
                      setPicker(null);
                      return;
                    }
                    if (date) {
                      const current = new Date(
                        editing[picker.field] || Date.now(),
                      );
                      if (picker.mode === "date")
                        current.setFullYear(
                          date.getFullYear(),
                          date.getMonth(),
                          date.getDate(),
                        );
                      else
                        current.setHours(
                          date.getHours(),
                          date.getMinutes(),
                          0,
                          0,
                        );
                      setDate(picker.field, current.toISOString());
                      if (Platform.OS === "android")
                        setPicker(
                          picker.mode === "date"
                            ? { ...picker, mode: "time" }
                            : null,
                        );
                    }
                  }}
                />
                {Platform.OS === "ios" && (
                  <Button
                    title={picker.mode === "date" ? "Choose time" : "Done"}
                    icon={picker.mode === "date" ? "arrowRight" : "check"}
                    style={{ marginBottom: 0 }}
                    onPress={() => {
                      if (!editing[picker.field])
                        setDate(picker.field, new Date().toISOString());
                      setPicker(
                        picker.mode === "date"
                          ? { ...picker, mode: "time" }
                          : null,
                      );
                    }}
                  />
                )}
              </View>
            )}
            <Section label="Repeat">
              <RepeatPicker
                rrule={editing.rrule}
                dueAt={editing.due_at}
                disabled={readOnly}
                onChange={(rrule) =>
                  onChange(
                    rrule
                      ? { rrule, timezone: deviceTimeZone() }
                      : { rrule: null },
                  )
                }
              />
            </Section>
            {editing.kind === "task" && (
              <Section label="How long will it take?">
                <ChipRow label="Estimate">
                  <Chip
                    label="Not sure"
                    selected={!estimate && !customEstimate}
                    disabled={readOnly}
                    onPress={() => {
                      setCustomEstimate(false);
                      onChange({ estimate_minutes: null });
                    }}
                  />
                  {ESTIMATES.map((m) => (
                    <Chip
                      key={m}
                      label={minutesLabel(m)}
                      accessibilityLabel={`${minutesLabel(m)} estimate`}
                      selected={!customEstimate && estimate === m}
                      disabled={readOnly}
                      onPress={() => {
                        setCustomEstimate(false);
                        onChange({ estimate_minutes: m });
                      }}
                    />
                  ))}
                  <Chip
                    label="Custom"
                    selected={customEstimate}
                    disabled={readOnly}
                    onPress={() => setCustomEstimate(true)}
                  />
                </ChipRow>
                {customEstimate && (
                  <View style={s.below}>
                    <NumberInput
                      value={estimate ? String(estimate) : ""}
                      editable={!readOnly}
                      placeholder="50"
                      suffix="minutes"
                      accessibilityLabel="Estimate in minutes"
                      onChangeText={(text) =>
                        onChange({
                          estimate_minutes:
                            Math.min(10080, Number(text) || 0) || null,
                        })
                      }
                    />
                  </View>
                )}
              </Section>
            )}
            <Section label="List">
              {scopeLists.length ? (
                <ChipRow label="List">
                  <Chip
                    label="No list"
                    selected={!editing.list_id}
                    disabled={readOnly}
                    onPress={() => onChange({ list_id: null })}
                  />
                  {scopeLists.map((l) => (
                    <Chip
                      key={l.id}
                      label={l.name}
                      color={l.color}
                      selected={editing.list_id === l.id}
                      disabled={readOnly}
                      onPress={() => onChange({ list_id: l.id })}
                    />
                  ))}
                </ChipRow>
              ) : (
                <Text style={shared.small}>
                  {teamId
                    ? "This team has no lists yet. Add them from My tasks → Lists."
                    : "No lists yet. Add them from My tasks → Lists."}
                </Text>
              )}
            </Section>
            <Section label="Tags">
              {scopeTags.length > 0 && (
                <ChipRow label="Tags" multi>
                  {scopeTags.map((t) => {
                    const on = tagIds.includes(t.id);
                    return (
                      <Chip
                        key={t.id}
                        multi
                        label={t.name}
                        color={t.color}
                        selected={on}
                        disabled={readOnly}
                        onPress={() =>
                          onChange({
                            tag_ids: on
                              ? tagIds.filter((id) => id !== t.id)
                              : [...tagIds, t.id],
                          })
                        }
                      />
                    );
                  })}
                </ChipRow>
              )}
              {!readOnly && (
                <View style={[s.tagRow, scopeTags.length > 0 && s.below]}>
                  <TextInput
                    style={[shared.input, s.tagInput]}
                    value={newTag}
                    onChangeText={setNewTag}
                    maxLength={40}
                    placeholder={teamId ? "New team tag" : "New tag"}
                    placeholderTextColor={colors.faint}
                    returnKeyType="done"
                    submitBehavior="submit"
                    onSubmitEditing={() => void addTag()}
                    accessibilityLabel="New tag name"
                  />
                  <PressableScale
                    accessibilityRole="button"
                    accessibilityLabel="Create tag"
                    accessibilityState={{
                      disabled: tagBusy || !newTag.trim(),
                    }}
                    disabled={tagBusy || !newTag.trim()}
                    onPress={() => void addTag()}
                    style={[
                      s.tagAdd,
                      (tagBusy || !newTag.trim()) && { opacity: 0.45 },
                    ]}
                  >
                    <Icon
                      name="plus"
                      size={18}
                      color={colors.white}
                      strokeWidth={2.2}
                    />
                  </PressableScale>
                </View>
              )}
              {!!tagError && (
                <Text accessibilityRole="alert" style={[s.error, s.below]}>
                  {tagError}
                </Text>
              )}
            </Section>
            {!!teamId && members.length > 0 && (
              <Section label="Assigned to">
                <ChipRow label="Assigned to">
                  <Chip
                    label="Nobody"
                    selected={!editing.assignee_id}
                    disabled={readOnly}
                    onPress={() => onChange({ assignee_id: null })}
                  />
                  {members.map((m) => (
                    <Chip
                      key={m.user_id}
                      label={m.name}
                      selected={editing.assignee_id === m.user_id}
                      disabled={readOnly}
                      onPress={() => onChange({ assignee_id: m.user_id })}
                    />
                  ))}
                </ChipRow>
              </Section>
            )}
            {editing.kind === "event" && (
              <>
                <Section label="Location">
                  <TextInput
                    style={shared.input}
                    editable={!readOnly}
                    value={editing.location ?? ""}
                    maxLength={300}
                    placeholder="Where it happens"
                    placeholderTextColor={colors.faint}
                    onChangeText={(location) => onChange({ location })}
                  />
                </Section>
                <Section label="Meeting link">
                  <TextInput
                    style={shared.input}
                    editable={!readOnly}
                    value={editing.meeting_url ?? ""}
                    maxLength={500}
                    placeholder="https://"
                    placeholderTextColor={colors.faint}
                    keyboardType="url"
                    autoCapitalize="none"
                    autoCorrect={false}
                    onChangeText={(meeting_url) => onChange({ meeting_url })}
                  />
                </Section>
              </>
            )}
            <Section label="Notes">
              <TextInput
                style={[shared.input, s.notes]}
                editable={!readOnly}
                multiline
                textAlignVertical="top"
                value={editing.notes}
                maxLength={10000}
                placeholder="Anything worth remembering"
                placeholderTextColor={colors.faint}
                onChangeText={(notes) => onChange({ notes })}
              />
            </Section>
            <Section label="Remind me before (minutes)">
              <TextInput
                style={shared.input}
                keyboardType="number-pad"
                editable={!readOnly}
                value={String(editing.reminder_minutes)}
                onChangeText={(value) =>
                  onChange({ reminder_minutes: Number(value) || 0 })
                }
              />
            </Section>
            {!!error && (
              <Text accessibilityRole="alert" style={s.error}>
                {error}
              </Text>
            )}
            {!readOnly && (
              <Button
                title={busy ? "Saving…" : "Save item"}
                icon={busy ? undefined : "check"}
                disabled={busy}
                onPress={onSave}
              />
            )}
            {exists && !readOnly && (
              <Button
                destructive
                title="Delete item"
                disabled={busy}
                onPress={() =>
                  Alert.alert(
                    "Delete this item?",
                    "This removes it from your planner.",
                    [
                      { text: "Cancel", style: "cancel" },
                      {
                        text: "Delete",
                        style: "destructive",
                        onPress: onDelete,
                      },
                    ],
                  )
                }
              />
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}

function Section({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <View style={s.section}>
      <Text style={shared.label}>{label}</Text>
      {children}
    </View>
  );
}

const s = themed(() =>
  StyleSheet.create({
    sheet: { flex: 1, backgroundColor: colors.background },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: spacing.page,
      paddingVertical: 14,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    headerTitle: {
      fontFamily: fonts.display,
      fontSize: 18,
      letterSpacing: -0.4,
      color: colors.text,
    },
    close: {
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: colors.surfaceMuted,
      alignItems: "center",
      justifyContent: "center",
    },
    body: { padding: spacing.page, paddingBottom: 40 },
    column: { width: "100%", maxWidth: 600, alignSelf: "center" },
    section: { marginBottom: 18 },
    titleInput: { fontFamily: fonts.medium, fontSize: 17 },
    dateRow: { flexDirection: "row", alignItems: "center", gap: 8 },
    dateButton: {
      flex: 1,
      minHeight: 50,
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.input,
      paddingHorizontal: 15,
    },
    dateActive: { borderColor: colors.accent },
    dateText: { fontFamily: fonts.medium, fontSize: 15, color: colors.text },
    clear: {
      width: 44,
      height: 50,
      borderRadius: radii.input,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      alignItems: "center",
      justifyContent: "center",
    },
    pickerCard: {
      backgroundColor: colors.surface,
      borderRadius: radii.card,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 12,
      marginBottom: 18,
    },
    notes: { minHeight: 100 },
    hint: { marginTop: 8 },
    viewOnly: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      backgroundColor: colors.accentSoft,
      borderRadius: radii.input,
      padding: 12,
      marginBottom: 18,
    },
    viewOnlyText: {
      flex: 1,
      fontFamily: fonts.medium,
      fontSize: 13,
      color: colors.accent,
    },
    error: {
      fontFamily: fonts.medium,
      fontSize: 13,
      color: colors.danger,
      backgroundColor: colors.dangerSoft,
      borderRadius: radii.input,
      padding: 12,
      marginBottom: 14,
    },
    below: { marginTop: 10 },
    tagRow: { flexDirection: "row", gap: 8 },
    tagInput: { flex: 1, minHeight: 44, paddingVertical: 10 },
    tagAdd: {
      width: 44,
      height: 44,
      borderRadius: radii.input,
      backgroundColor: colors.accent,
      alignItems: "center",
      justifyContent: "center",
    },
  }),
);
