import React, { useEffect, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
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
  type Attendee,
  type AttendeeStatus,
  type Item,
  type ItemInput,
  type Team,
  type TeamMember,
} from "@orbyn/core";
import { Button } from "./Button";
import { Chip, ChipRow } from "./Chip";
import { AlertsField, ColorField, InviteesField } from "./EventFields";
import { DateField, NumberInput } from "./Field";
import { Icon } from "./Icon";
import { RepeatPicker } from "./RepeatPicker";
import { Segmented } from "./Segmented";
import { client } from "../lib/api";
import {
  deviceTimeZone,
  ESTIMATES,
  LIST_COLORS,
  minutesLabel,
} from "../lib/planning";
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
/** The server's cap on tags per item. */
const MAX_TAGS = 20;

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
  /** From the repeat picker: an ending chosen without its date. */
  const [repeatProblem, setRepeatProblem] = useState<string | null>(null);
  const [formError, setFormError] = useState("");
  /** The web's checks before saving: a repeat needs a date, and its last date. */
  const save = () => {
    const problem =
      editing.rrule && !editing.due_at
        ? "Repeating items need a date. Add a start time."
        : repeatProblem;
    setFormError(problem ?? "");
    if (!problem) onSave();
  };

  // Invitees and their answers come from the saved event (lists don't carry them).
  const itemId = "id" in editing ? editing.id : null;
  const [savedPeople, setSavedPeople] = useState<
    { email: string; name?: string }[]
  >([]);
  const [statuses, setStatuses] = useState<Map<string, AttendeeStatus>>(
    () => new Map(),
  );
  useEffect(() => {
    if (!itemId) return;
    let alive = true;
    client
      .getItem(itemId)
      .then((d) => {
        if (!alive) return;
        // The detail carries full invitees (with answers), not the input shape.
        const people = (d.attendees ?? []) as Attendee[];
        setSavedPeople(
          people.map((a) => ({ email: a.email, name: a.name || undefined })),
        );
        setStatuses(new Map(people.map((a) => [a.email, a.status])));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [itemId]);
  // Sent only once changed: the list replaces the saved invitees.
  const people = editing.attendees ?? savedPeople;
  const alerts =
    editing.alerts ??
    (editing.reminder_minutes != null ? [editing.reminder_minutes] : []);
  const colorChoices = [
    ...new Set([
      ...LIST_COLORS,
      ...lists.map((l) => l.color),
      ...tags.map((t) => t.color),
    ]),
  ];

  // All-day items keep dates only: local midnight to the midnight after the last day.
  const allDay = !!editing.all_day;
  const dayOf = (iso: string | null | undefined) => {
    const d = iso ? new Date(iso) : new Date();
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  };
  const nextDay = (d: Date) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
  const keyOf = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const fromKey = (key: string) => {
    const [y, m, d] = key.split("-").map(Number);
    return new Date(y, m - 1, d);
  };
  const firstDay = dayOf(editing.due_at);
  const lastDay = editing.end_at
    ? dayOf(new Date(Date.parse(editing.end_at) - 1).toISOString())
    : firstDay;
  const setAllDay = (on: boolean) => {
    if (picker) setPicker(null);
    if (on) {
      const last = lastDay < firstDay ? firstDay : lastDay;
      onChange({
        all_day: true,
        timezone: deviceTimeZone(),
        due_at: firstDay.toISOString(),
        end_at: editing.kind === "event" ? nextDay(last).toISOString() : null,
      });
    } else {
      const start = new Date(firstDay);
      start.setHours(9);
      onChange({
        all_day: false,
        due_at: start.toISOString(),
        end_at:
          editing.kind === "event"
            ? new Date(start.getTime() + 3_600_000).toISOString()
            : null,
      });
    }
  };

  const addTag = async () => {
    const name = newTag.trim();
    if (!name) return;
    if (tagIds.length >= MAX_TAGS) {
      setTagError("Up to 20 tags.");
      return;
    }
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
                {teamId !== savedTeamId && (
                  <Text style={[shared.small, s.hint]}>
                    Moving it clears its list, tags and assignee.
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
            <Section label="All day">
              <View style={s.switchRow}>
                <Text style={[shared.small, { flex: 1 }]}>
                  Just dates, no times. All-day items never count as busy.
                </Text>
                <Switch
                  value={allDay}
                  disabled={readOnly}
                  trackColor={{ true: colors.accent }}
                  accessibilityLabel="All day"
                  onValueChange={setAllDay}
                />
              </View>
            </Section>
            {allDay && (
              <>
                <Section label={editing.kind === "event" ? "First day" : "Day"}>
                  <DateField
                    label={editing.kind === "event" ? "First day" : "Day"}
                    value={keyOf(firstDay)}
                    onChange={(key) => {
                      if (!key) return;
                      const start = fromKey(key);
                      const days = Math.round(
                        (lastDay.getTime() - firstDay.getTime()) / 86_400_000,
                      );
                      onChange({
                        due_at: start.toISOString(),
                        end_at:
                          editing.kind === "event"
                            ? nextDay(
                                new Date(
                                  start.getFullYear(),
                                  start.getMonth(),
                                  start.getDate() + Math.max(0, days),
                                ),
                              ).toISOString()
                            : null,
                      });
                    }}
                  />
                </Section>
                {editing.kind === "event" && (
                  <Section label="Last day">
                    <DateField
                      label="Last day"
                      value={keyOf(lastDay < firstDay ? firstDay : lastDay)}
                      minimumDate={firstDay}
                      onChange={(key) =>
                        key &&
                        onChange({
                          end_at: nextDay(fromKey(key)).toISOString(),
                        })
                      }
                    />
                  </Section>
                )}
              </>
            )}
            {!allDay && (
              <>
                {(["due_at", "end_at"] as const).map((field) => (
                  <Section
                    key={field}
                    label={
                      field === "due_at" ? "Due / start" : "End (optional)"
                    }
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
              </>
            )}
            <Section label="Repeat">
              <RepeatPicker
                rrule={editing.rrule}
                dueAt={editing.due_at}
                disabled={readOnly}
                onProblem={setRepeatProblem}
                onChange={(rrule) =>
                  onChange(
                    rrule
                      ? { rrule, timezone: deviceTimeZone() }
                      : { rrule: null },
                  )
                }
              />
              {exists && !!editing.rrule && (
                <Text style={[shared.small, s.hint]}>
                  When you save or delete, you choose this one, this and
                  following, or all of them.
                </Text>
              )}
            </Section>
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
                        disabled={
                          readOnly || (!on && tagIds.length >= MAX_TAGS)
                        }
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
              {tagIds.length >= MAX_TAGS && (
                <Text style={[shared.small, s.hint]}>Up to 20 tags.</Text>
              )}
              {!!tagError && (
                <Text accessibilityRole="alert" style={[s.error, s.below]}>
                  {tagError}
                </Text>
              )}
            </Section>
            <Section label="Colour on the calendar">
              <ColorField
                value={editing.color ?? null}
                choices={colorChoices}
                disabled={readOnly}
                onChange={(color) => onChange({ color })}
              />
              <Text style={[shared.small, s.hint]}>
                With no colour of its own it takes its list’s.
              </Text>
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
                  {/* Someone who left the team stays until you pick another. */}
                  {!!editing.assignee_id &&
                    !members.some((m) => m.user_id === editing.assignee_id) && (
                      <Chip
                        label={
                          ("assignee_name" in editing &&
                            editing.assignee_name) ||
                          "Current assignee"
                        }
                        selected
                        disabled={readOnly}
                        onPress={() => {}}
                      />
                    )}
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
                {!allDay && (
                  <Section label="Show as">
                    <Segmented
                      disabled={readOnly}
                      accessibilityLabel="Show as"
                      options={["busy", "free"] as const}
                      labels={{ busy: "Busy", free: "Free" }}
                      value={editing.busy === false ? "free" : "busy"}
                      onChange={(value) => onChange({ busy: value === "busy" })}
                    />
                    <Text style={[shared.small, s.hint]}>
                      Free events don’t block your planner, booking pages or
                      teammates.
                    </Text>
                  </Section>
                )}
                <Section label="Invite people">
                  <InviteesField
                    people={people}
                    statuses={statuses}
                    disabled={readOnly}
                    onChange={(attendees) => onChange({ attendees })}
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
            <Section label="Alerts">
              <AlertsField
                alerts={alerts}
                disabled={readOnly}
                onChange={(next) =>
                  onChange({ alerts: next, reminder_minutes: undefined })
                }
              />
            </Section>
            {!!formError && (
              <Text accessibilityRole="alert" style={s.error}>
                {formError}
              </Text>
            )}
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
                onPress={save}
              />
            )}
            {exists && !readOnly && (
              <Button
                destructive
                title="Delete item"
                disabled={busy}
                onPress={() =>
                  // A repeating item asks which ones to delete instead.
                  editing.rrule
                    ? onDelete()
                    : Alert.alert(
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
    switchRow: { flexDirection: "row", alignItems: "center", gap: 12 },
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
