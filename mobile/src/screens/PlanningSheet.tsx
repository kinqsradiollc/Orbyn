import React, { useEffect, useState } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  BREAK_LEVELS,
  PRIORITIES,
  type BreakLevel,
  type Frame,
  type Place,
  type PlannerPrefs,
  type Priority,
} from "@orbyn/core";
import { Button } from "../components/Button";
import { Chip, ChipRow } from "../components/Chip";
import { ErrorBanner } from "../components/ErrorBanner";
import { ClockField, Field, NumberInput } from "../components/Field";
import { Icon } from "../components/Icon";
import { Segmented } from "../components/Segmented";
import { Sheet, sheetStyles } from "../components/Sheet";
import { client } from "../lib/api";
import {
  clockDisplay,
  deviceTimeZone,
  parseMinutes,
  WEEK_ORDER,
  WEEKDAYS,
} from "../lib/planning";
import { useRun } from "../hooks/useRun";
import { FadeIn, animateLayout } from "../motion";
import { colors, fonts, radii } from "../theme";
import { shared } from "../styles";

const BREAK_LABELS: Record<BreakLevel, string> = {
  none: "None",
  light: "Light",
  normal: "Normal",
  intense: "Often",
};
const PRIORITY_LABELS: Record<Priority, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
};

type Form = {
  timezone: string;
  work_days: number[];
  work_start: string;
  work_end: string;
  pad: string;
  split: string;
  minBlock: string;
  break_level: BreakLevel;
  before: string;
  after: string;
  adaptive: boolean;
  travel: string;
};

const toForm = (p: PlannerPrefs): Form => ({
  timezone: p.timezone,
  work_days: p.work_days,
  work_start: p.work_start,
  work_end: p.work_end,
  pad: String(p.pad_percent),
  split: String(p.split_after_minutes),
  minBlock: String(p.min_block_minutes),
  break_level: p.break_level,
  before: String(p.buffer_before_minutes),
  after: String(p.buffer_after_minutes),
  adaptive: p.adaptive_buffers,
  travel: String(p.default_travel_minutes),
});

const daysLabel = (days: number[]) =>
  days.join(",") === "1,2,3,4,5"
    ? "Weekdays"
    : days.length === 7
      ? "Every day"
      : WEEK_ORDER.filter((d) => days.includes(d))
          .map((d) => WEEKDAYS[d])
          .join(", ");

/**
 * Settings → Planning: when you work and how the planner fills that time,
 * plus frames (time kept for a kind of work) and places (travel time).
 */
export function PlanningSheet({
  visible,
  onClose,
  onDismiss,
}: {
  visible: boolean;
  onClose: () => void;
  onDismiss?: () => void;
}) {
  return (
    <Sheet
      visible={visible}
      title="Planning"
      onClose={onClose}
      onDismiss={onDismiss}
    >
      <Body />
    </Sheet>
  );
}

function Body() {
  const { busy, error, setError, run } = useRun();
  const [form, setForm] = useState<Form | null>(null);
  const [frames, setFrames] = useState<Frame[]>([]);
  const [places, setPlaces] = useState<Place[]>([]);
  const [saved, setSaved] = useState(false);
  const [editingFrame, setEditingFrame] = useState<Frame | "new" | null>(null);
  const [editingPlace, setEditingPlace] = useState<Place | "new" | null>(null);
  const device = deviceTimeZone();

  useEffect(() => {
    void run(async () => {
      const [p, f, pl] = await Promise.all([
        client.getPlannerPrefs(),
        client.listFrames(),
        client.listPlaces(),
      ]);
      setForm(toForm(p));
      setFrames(f);
      setPlaces(pl);
    });
  }, [run]);

  const patch = (next: Partial<Form>) => {
    setSaved(false);
    setForm((f) => (f ? { ...f, ...next } : f));
  };

  const save = () =>
    run(async () => {
      if (!form) return;
      if (form.work_end <= form.work_start)
        throw new Error("Your working day ends after it starts.");
      const num = (text: string) => parseMinutes(text) ?? undefined;
      const p = await client.updatePlannerPrefs({
        timezone: form.timezone,
        work_days: form.work_days,
        work_start: form.work_start,
        work_end: form.work_end,
        pad_percent: num(form.pad),
        split_after_minutes: num(form.split),
        min_block_minutes: num(form.minBlock),
        break_level: form.break_level,
        buffer_before_minutes: num(form.before),
        buffer_after_minutes: num(form.after),
        adaptive_buffers: form.adaptive,
        default_travel_minutes: num(form.travel),
      });
      setForm(toForm(p));
      setSaved(true);
    });

  const reloadFrames = async () => setFrames(await client.listFrames());
  const reloadPlaces = async () => setPlaces(await client.listPlaces());

  return (
    <ScrollView
      contentContainerStyle={sheetStyles.body}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
      automaticallyAdjustKeyboardInsets
    >
      <View style={sheetStyles.column}>
        <ErrorBanner error={error} onDismiss={() => setError("")} />
        <Text style={[shared.subtitle, s.intro]}>
          Plan my day, buffers and travel time all follow these settings.
        </Text>
        {!form ? (
          <Text style={shared.small}>
            {busy ? "Loading your settings…" : "Settings aren’t available."}
          </Text>
        ) : (
          <>
            <Text style={[shared.eyebrow, s.eyebrow]}>WORKING TIME</Text>
            <View style={shared.card}>
              <Field label="Time zone">
                <Text style={s.value}>{form.timezone}</Text>
                {form.timezone !== device && (
                  <Button
                    secondary
                    title={`Use this device’s (${device})`}
                    style={s.inline}
                    onPress={() => patch({ timezone: device })}
                  />
                )}
              </Field>
              <Field label="Working days">
                <ChipRow label="Working days" multi>
                  {WEEK_ORDER.map((d) => {
                    const on = form.work_days.includes(d);
                    return (
                      <Chip
                        key={d}
                        multi
                        label={WEEKDAYS[d]}
                        selected={on}
                        onPress={() => {
                          const days = on
                            ? form.work_days.filter((x) => x !== d)
                            : [...form.work_days, d].sort((a, b) => a - b);
                          if (days.length) patch({ work_days: days });
                        }}
                      />
                    );
                  })}
                </ChipRow>
              </Field>
              <View style={s.pair}>
                <Field label="Start" style={s.half}>
                  <ClockField
                    label="Work starts"
                    value={form.work_start}
                    onChange={(work_start) => patch({ work_start })}
                  />
                </Field>
                <Field label="End" style={s.half}>
                  <ClockField
                    label="Work ends"
                    value={form.work_end}
                    onChange={(work_end) => patch({ work_end })}
                  />
                </Field>
              </View>
            </View>

            <Text style={[shared.eyebrow, s.eyebrow]}>THE PLANNER</Text>
            <View style={shared.card}>
              <Field
                label="Pad estimates by"
                hint="Extra time for the unexpected."
              >
                <NumberInput
                  value={form.pad}
                  onChangeText={(pad) => patch({ pad })}
                  suffix="%"
                  accessibilityLabel="Pad estimates by percent"
                />
              </Field>
              <Field
                label="Split tasks longer than"
                hint="Long tasks become several sessions."
              >
                <NumberInput
                  value={form.split}
                  onChangeText={(split) => patch({ split })}
                  suffix="minutes"
                  accessibilityLabel="Split tasks longer than, in minutes"
                />
              </Field>
              <Field label="Shortest block">
                <NumberInput
                  value={form.minBlock}
                  onChangeText={(minBlock) => patch({ minBlock })}
                  suffix="minutes"
                  accessibilityLabel="Shortest block, in minutes"
                />
              </Field>
              <Field label="Breaks between blocks" style={s.last}>
                <Segmented
                  accessibilityLabel="Breaks between blocks"
                  options={BREAK_LEVELS}
                  labels={BREAK_LABELS}
                  value={form.break_level}
                  onChange={(break_level) => patch({ break_level })}
                />
              </Field>
            </View>

            <Text style={[shared.eyebrow, s.eyebrow]}>BUFFERS AND TRAVEL</Text>
            <View style={shared.card}>
              <View style={s.pair}>
                <Field label="Before events" style={s.half}>
                  <NumberInput
                    value={form.before}
                    onChangeText={(before) => patch({ before })}
                    suffix="min"
                    accessibilityLabel="Buffer before events, in minutes"
                  />
                </Field>
                <Field label="After events" style={s.half}>
                  <NumberInput
                    value={form.after}
                    onChangeText={(after) => patch({ after })}
                    suffix="min"
                    accessibilityLabel="Buffer after events, in minutes"
                  />
                </Field>
              </View>
              <View style={s.switchRow}>
                <View style={{ flex: 1 }}>
                  <Text style={s.switchTitle}>Adaptive buffers</Text>
                  <Text style={shared.small}>
                    Longer events get a little more room around them.
                  </Text>
                </View>
                <Switch
                  value={form.adaptive}
                  trackColor={{ true: colors.accent }}
                  accessibilityLabel="Adaptive buffers"
                  onValueChange={(adaptive) => patch({ adaptive })}
                />
              </View>
              <Field
                label="Default travel time"
                hint="For events with a location that doesn’t match one of your places."
                style={s.last}
              >
                <NumberInput
                  value={form.travel}
                  onChangeText={(travel) => patch({ travel })}
                  suffix="minutes"
                  accessibilityLabel="Default travel time, in minutes"
                />
              </Field>
            </View>
            <Button
              title={
                busy ? "Saving…" : saved ? "Saved" : "Save planning settings"
              }
              icon="check"
              disabled={busy}
              onPress={() => void save()}
            />
          </>
        )}

        <Text style={[shared.eyebrow, s.eyebrow]}>FRAMES</Text>
        <Text style={[shared.small, s.sectionHint]}>
          Time kept for a kind of work, like high-priority tasks on weekday
          mornings. The planner puts matching tasks there first.
        </Text>
        <View style={s.card}>
          {frames.map((f, n) =>
            editingFrame !== "new" && editingFrame?.id === f.id ? (
              <FrameForm
                key={f.id}
                frame={f}
                busy={busy}
                first={n === 0}
                onCancel={() => setEditingFrame(null)}
                onSave={(input) =>
                  run(async () => {
                    await client.updateFrame(f.id, input);
                    await reloadFrames();
                    setEditingFrame(null);
                  })
                }
                onDelete={() =>
                  Alert.alert(`Delete ${f.name}?`, "Tasks aren’t affected.", [
                    { text: "Cancel", style: "cancel" },
                    {
                      text: "Delete",
                      style: "destructive",
                      onPress: () =>
                        void run(async () => {
                          await client.deleteFrame(f.id);
                          await reloadFrames();
                          setEditingFrame(null);
                        }),
                    },
                  ])
                }
              />
            ) : (
              <Row
                key={f.id}
                first={n === 0}
                title={f.name}
                detail={`${daysLabel(f.days)} · ${clockDisplay(f.start_time)} – ${clockDisplay(f.end_time)}${
                  f.filters.priorities.length
                    ? ` · ${f.filters.priorities.map((p) => PRIORITY_LABELS[p]).join(", ")} priority`
                    : ""
                }`}
                onPress={() => {
                  animateLayout();
                  setEditingFrame(f);
                }}
              />
            ),
          )}
          {editingFrame === "new" ? (
            <FrameForm
              busy={busy}
              first={!frames.length}
              onCancel={() => setEditingFrame(null)}
              onSave={(input) =>
                run(async () => {
                  await client.createFrame(input);
                  await reloadFrames();
                  setEditingFrame(null);
                })
              }
            />
          ) : (
            <AddRow
              first={!frames.length}
              label="Add a frame"
              onPress={() => {
                animateLayout();
                setEditingFrame("new");
              }}
            />
          )}
        </View>

        <Text style={[shared.eyebrow, s.eyebrow]}>PLACES</Text>
        <Text style={[shared.small, s.sectionHint]}>
          How long it takes to get somewhere. Events whose location contains the
          match text get that travel time before and after.
        </Text>
        <View style={s.card}>
          {places.map((p, n) =>
            editingPlace !== "new" && editingPlace?.id === p.id ? (
              <PlaceForm
                key={p.id}
                place={p}
                busy={busy}
                first={n === 0}
                onCancel={() => setEditingPlace(null)}
                onSave={(input) =>
                  run(async () => {
                    await client.updatePlace(p.id, input);
                    await reloadPlaces();
                    setEditingPlace(null);
                  })
                }
                onDelete={() =>
                  void run(async () => {
                    await client.deletePlace(p.id);
                    await reloadPlaces();
                    setEditingPlace(null);
                  })
                }
              />
            ) : (
              <Row
                key={p.id}
                first={n === 0}
                title={p.label}
                detail={`“${p.match}” · ${p.travel_minutes} min travel`}
                onPress={() => {
                  animateLayout();
                  setEditingPlace(p);
                }}
              />
            ),
          )}
          {editingPlace === "new" ? (
            <PlaceForm
              busy={busy}
              first={!places.length}
              onCancel={() => setEditingPlace(null)}
              onSave={(input) =>
                run(async () => {
                  await client.createPlace(input);
                  await reloadPlaces();
                  setEditingPlace(null);
                })
              }
            />
          ) : (
            <AddRow
              first={!places.length}
              label="Add a place"
              onPress={() => {
                animateLayout();
                setEditingPlace("new");
              }}
            />
          )}
        </View>
      </View>
    </ScrollView>
  );
}

function Row({
  title,
  detail,
  first,
  onPress,
}: {
  title: string;
  detail: string;
  first: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${detail}`}
      accessibilityHint="Edit"
      onPress={onPress}
      style={({ pressed }) => [
        s.row,
        !first && s.divider,
        pressed && s.pressed,
      ]}
    >
      <View style={{ flex: 1 }}>
        <Text style={s.rowTitle}>{title}</Text>
        <Text style={shared.small}>{detail}</Text>
      </View>
      <Icon name="chevronRight" size={16} color={colors.faint} />
    </Pressable>
  );
}

function AddRow({
  label,
  first,
  onPress,
}: {
  label: string;
  first: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        s.row,
        !first && s.divider,
        pressed && s.pressed,
      ]}
    >
      <Icon name="plus" size={16} color={colors.accent} />
      <Text style={s.addText}>{label}</Text>
    </Pressable>
  );
}

function FrameForm({
  frame,
  busy,
  first,
  onSave,
  onDelete,
  onCancel,
}: {
  frame?: Frame;
  busy: boolean;
  first: boolean;
  onSave: (input: {
    name: string;
    days: number[];
    start_time: string;
    end_time: string;
    filters: Frame["filters"] | { priorities: Priority[] };
  }) => void;
  onDelete?: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(frame?.name ?? "");
  const [days, setDays] = useState(frame?.days ?? [1, 2, 3, 4, 5]);
  const [start, setStart] = useState(frame?.start_time ?? "09:00");
  const [end, setEnd] = useState(frame?.end_time ?? "12:00");
  const [priorities, setPriorities] = useState<Priority[]>(
    frame?.filters.priorities ?? [],
  );
  return (
    <FadeIn style={[s.form, !first && s.divider]}>
      <Field label="Name">
        <TextInput
          style={shared.input}
          value={name}
          onChangeText={setName}
          maxLength={60}
          placeholder="Deep work"
          placeholderTextColor={colors.faint}
          accessibilityLabel="Frame name"
        />
      </Field>
      <Field label="Days">
        <ChipRow label="Frame days" multi>
          {WEEK_ORDER.map((d) => {
            const on = days.includes(d);
            return (
              <Chip
                key={d}
                multi
                label={WEEKDAYS[d]}
                selected={on}
                onPress={() => {
                  const next = on
                    ? days.filter((x) => x !== d)
                    : [...days, d].sort((a, b) => a - b);
                  if (next.length) setDays(next);
                }}
              />
            );
          })}
        </ChipRow>
      </Field>
      <View style={s.pair}>
        <Field label="From" style={s.half}>
          <ClockField label="Frame starts" value={start} onChange={setStart} />
        </Field>
        <Field label="To" style={s.half}>
          <ClockField label="Frame ends" value={end} onChange={setEnd} />
        </Field>
      </View>
      <Field label="Only these priorities" hint="None chosen means any task.">
        <ChipRow label="Priorities" multi>
          {PRIORITIES.map((p) => {
            const on = priorities.includes(p);
            return (
              <Chip
                key={p}
                multi
                label={PRIORITY_LABELS[p]}
                selected={on}
                onPress={() =>
                  setPriorities(
                    on ? priorities.filter((x) => x !== p) : [...priorities, p],
                  )
                }
              />
            );
          })}
        </ChipRow>
      </Field>
      {end <= start && (
        <Text style={[shared.small, s.warn]}>
          A frame ends after it starts.
        </Text>
      )}
      <Button
        title="Save frame"
        icon="check"
        disabled={busy || !name.trim() || end <= start}
        onPress={() =>
          onSave({
            name: name.trim(),
            days,
            start_time: start,
            end_time: end,
            filters: frame ? { ...frame.filters, priorities } : { priorities },
          })
        }
      />
      <View style={s.formActions}>
        <Button secondary title="Cancel" style={s.flex} onPress={onCancel} />
        {onDelete && (
          <Button
            destructive
            title="Delete"
            disabled={busy}
            style={s.flex}
            onPress={onDelete}
          />
        )}
      </View>
    </FadeIn>
  );
}

function PlaceForm({
  place,
  busy,
  first,
  onSave,
  onDelete,
  onCancel,
}: {
  place?: Place;
  busy: boolean;
  first: boolean;
  onSave: (input: {
    label: string;
    match: string;
    travel_minutes: number;
  }) => void;
  onDelete?: () => void;
  onCancel: () => void;
}) {
  const [label, setLabel] = useState(place?.label ?? "");
  const [match, setMatch] = useState(place?.match ?? "");
  const [travel, setTravel] = useState(String(place?.travel_minutes ?? 20));
  const minutes = parseMinutes(travel);
  return (
    <FadeIn style={[s.form, !first && s.divider]}>
      <Field label="Name">
        <TextInput
          style={shared.input}
          value={label}
          onChangeText={setLabel}
          maxLength={60}
          placeholder="Office"
          placeholderTextColor={colors.faint}
          accessibilityLabel="Place name"
        />
      </Field>
      <Field
        label="Match text"
        hint="Found in an event’s location, like “Collins St”."
      >
        <TextInput
          style={shared.input}
          value={match}
          onChangeText={setMatch}
          maxLength={200}
          placeholder="Collins St"
          placeholderTextColor={colors.faint}
          accessibilityLabel="Match text"
        />
      </Field>
      <Field label="Travel time">
        <NumberInput
          value={travel}
          onChangeText={setTravel}
          suffix="minutes"
          accessibilityLabel="Travel time in minutes"
        />
      </Field>
      <Button
        title="Save place"
        icon="check"
        disabled={busy || !label.trim() || !match.trim() || minutes === null}
        onPress={() =>
          onSave({
            label: label.trim(),
            match: match.trim(),
            travel_minutes: minutes ?? 0,
          })
        }
      />
      <View style={s.formActions}>
        <Button secondary title="Cancel" style={s.flex} onPress={onCancel} />
        {onDelete && (
          <Button
            destructive
            title="Delete"
            disabled={busy}
            style={s.flex}
            onPress={onDelete}
          />
        )}
      </View>
    </FadeIn>
  );
}

const s = StyleSheet.create({
  intro: { marginTop: 0, marginBottom: 18 },
  eyebrow: { marginTop: 8 },
  sectionHint: { marginTop: -2, marginBottom: 10 },
  value: { fontFamily: fonts.semibold, fontSize: 15, color: colors.text },
  inline: { marginTop: 10, marginBottom: 0 },
  pair: { flexDirection: "row", gap: 12 },
  half: { flex: 1 },
  last: { marginBottom: 0 },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    marginBottom: 18,
  },
  switchTitle: {
    fontFamily: fonts.semibold,
    fontSize: 15,
    color: colors.text,
    marginBottom: 3,
  },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.card,
    overflow: "hidden",
    marginBottom: 16,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 52,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  divider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  pressed: { backgroundColor: colors.surfaceMuted },
  rowTitle: {
    fontFamily: fonts.semibold,
    fontSize: 15,
    color: colors.text,
    marginBottom: 2,
  },
  addText: { fontFamily: fonts.semibold, fontSize: 14, color: colors.accent },
  form: { padding: 16 },
  formActions: { flexDirection: "row", gap: 10 },
  flex: { flex: 1 },
  warn: { color: colors.danger, marginBottom: 10 },
});
