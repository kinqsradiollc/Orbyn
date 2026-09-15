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
  type FrameFilters,
  type PlannerPrefs,
  type Priority,
  type Team,
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
  LIST_COLORS,
  minutesLabel,
  parseMinutes,
  WEEK_ORDER,
  WEEKDAYS,
} from "../lib/planning";
import { usePlanning } from "../lib/planningContext";
import { useRun } from "../hooks/useRun";
import { FadeIn, animateLayout } from "../motion";
import { colors, fonts, radii, themed } from "../theme";
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

/** "30m or longer", "Up to 1h", "15m to 45m", or "" for any size. */
const sizeLabel = (min: number | null, max: number | null) =>
  min && max
    ? `${minutesLabel(min)} to ${minutesLabel(max)}`
    : min
      ? `${minutesLabel(min)} or longer`
      : max
        ? `Up to ${minutesLabel(max)}`
        : "";

const toggleId = (ids: string[], id: string) =>
  ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];

/**
 * Settings → Planning: when you work and how the planner fills that time,
 * plus frames (time kept for a kind of work) and places (travel time).
 */
export function PlanningSheet({
  visible,
  teams,
  onClose,
  onDismiss,
}: {
  visible: boolean;
  /** For frames that take one team's tasks. */
  teams: Team[];
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
      <Body teams={teams} />
    </Sheet>
  );
}

function Body({ teams }: { teams: Team[] }) {
  const { listById, tagById } = usePlanning();
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

  /** When a frame runs and which tasks it takes. */
  const frameDetail = (f: Frame) => {
    const { priorities, list_ids, tag_ids, team_ids } = f.filters;
    const names = (ids: string[], name: (id: string) => string | undefined) =>
      ids.map(name).filter(Boolean).join(", ");
    return [
      `${daysLabel(f.days)} · ${clockDisplay(f.start_time)} – ${clockDisplay(f.end_time)}`,
      priorities.length
        ? `${priorities.map((p) => PRIORITY_LABELS[p]).join(", ")} priority`
        : "",
      names(list_ids, (id) => listById.get(id)?.name),
      names(tag_ids, (id) => tagById.get(id)?.name),
      names(team_ids, (id) => teams.find((t) => t.id === id)?.name),
      sizeLabel(f.filters.min_minutes, f.filters.max_minutes),
    ]
      .filter(Boolean)
      .join(" · ");
  };

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
                teams={teams}
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
                detail={frameDetail(f)}
                color={f.color}
                onPress={() => {
                  animateLayout();
                  setEditingFrame(f);
                }}
              />
            ),
          )}
          {editingFrame === "new" ? (
            <FrameForm
              teams={teams}
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
  color,
  first,
  onPress,
}: {
  title: string;
  detail: string;
  /** A colour dot before the title (frames). */
  color?: string;
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
      {!!color && <View style={[s.colorDot, { backgroundColor: color }]} />}
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

/**
 * Create or edit a frame: its name, days and hours, which tasks it takes
 * (priorities, lists, tags, teams, size; none chosen means any) and its colour.
 */
function FrameForm({
  frame,
  teams,
  busy,
  first,
  onSave,
  onDelete,
  onCancel,
}: {
  frame?: Frame;
  teams: Team[];
  busy: boolean;
  first: boolean;
  onSave: (input: {
    name: string;
    days: number[];
    start_time: string;
    end_time: string;
    filters: FrameFilters;
    color: string;
  }) => void;
  onDelete?: () => void;
  onCancel: () => void;
}) {
  const { lists, tags } = usePlanning();
  const [name, setName] = useState(frame?.name ?? "");
  const [days, setDays] = useState(frame?.days ?? [1, 2, 3, 4, 5]);
  const [start, setStart] = useState(frame?.start_time ?? "09:00");
  const [end, setEnd] = useState(frame?.end_time ?? "12:00");
  const [priorities, setPriorities] = useState<Priority[]>(
    frame?.filters.priorities ?? [],
  );
  const [listIds, setListIds] = useState(frame?.filters.list_ids ?? []);
  const [tagIds, setTagIds] = useState(frame?.filters.tag_ids ?? []);
  const [teamIds, setTeamIds] = useState(frame?.filters.team_ids ?? []);
  const [min, setMin] = useState(String(frame?.filters.min_minutes ?? ""));
  const [max, setMax] = useState(String(frame?.filters.max_minutes ?? ""));
  const [color, setColor] = useState<string>(frame?.color ?? LIST_COLORS[0]);
  const minMinutes = parseMinutes(min);
  const maxMinutes = parseMinutes(max);
  const outOfRange = (m: number | null) => m !== null && (m < 1 || m > 10080);
  const sizeError =
    outOfRange(minMinutes) || outOfRange(maxMinutes)
      ? "Sizes run from 1 to 10080 minutes."
      : minMinutes !== null && maxMinutes !== null && maxMinutes < minMinutes
        ? "The longest size is at least the shortest."
        : "";
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
      <Field
        label="Only these lists"
        hint={lists.length ? "None chosen means any list." : "No lists yet."}
      >
        {lists.length > 0 && (
          <ChipRow label="Lists" multi>
            {lists.map((l) => (
              <Chip
                key={l.id}
                multi
                color={l.color}
                label={l.team_name ? `${l.name} · ${l.team_name}` : l.name}
                selected={listIds.includes(l.id)}
                onPress={() => setListIds(toggleId(listIds, l.id))}
              />
            ))}
          </ChipRow>
        )}
      </Field>
      <Field
        label="Only these tags"
        hint={tags.length ? "None chosen means any tag." : "No tags yet."}
      >
        {tags.length > 0 && (
          <ChipRow label="Tags" multi>
            {tags.map((t) => (
              <Chip
                key={t.id}
                multi
                color={t.color}
                label={t.name}
                selected={tagIds.includes(t.id)}
                onPress={() => setTagIds(toggleId(tagIds, t.id))}
              />
            ))}
          </ChipRow>
        )}
      </Field>
      {teams.length > 0 && (
        <Field
          label="Only these teams"
          hint="None chosen means personal and team tasks alike."
        >
          <ChipRow label="Teams" multi>
            {teams.map((t) => (
              <Chip
                key={t.id}
                multi
                label={t.name}
                selected={teamIds.includes(t.id)}
                onPress={() => setTeamIds(toggleId(teamIds, t.id))}
              />
            ))}
          </ChipRow>
        </Field>
      )}
      <View style={s.pair}>
        <Field label="Shortest task" style={s.half}>
          <NumberInput
            value={min}
            onChangeText={setMin}
            suffix="min"
            placeholder="Any"
            accessibilityLabel="Only tasks estimated at least this many minutes"
          />
        </Field>
        <Field label="Longest task" style={s.half}>
          <NumberInput
            value={max}
            onChangeText={setMax}
            suffix="min"
            placeholder="Any"
            accessibilityLabel="Only tasks estimated at most this many minutes"
          />
        </Field>
      </View>
      {!!sizeError && (
        <Text style={[shared.small, s.warn, s.sizeWarn]}>{sizeError}</Text>
      )}
      <Field label="Colour">
        <View
          style={s.swatches}
          accessibilityRole="radiogroup"
          accessibilityLabel="Frame colour"
        >
          {LIST_COLORS.map((c, n) => (
            <Pressable
              key={c}
              accessibilityRole="radio"
              accessibilityLabel={`Colour ${n + 1} of ${LIST_COLORS.length}`}
              accessibilityState={{ checked: color === c }}
              hitSlop={4}
              onPress={() => setColor(c)}
              style={[s.swatch, { backgroundColor: c }]}
            >
              {color === c && (
                <Icon
                  name="check"
                  size={14}
                  color={colors.white}
                  strokeWidth={3}
                />
              )}
            </Pressable>
          ))}
        </View>
      </Field>
      {end <= start && (
        <Text style={[shared.small, s.warn]}>
          A frame ends after it starts.
        </Text>
      )}
      <Button
        title="Save frame"
        icon="check"
        disabled={busy || !name.trim() || end <= start || !!sizeError}
        onPress={() =>
          onSave({
            name: name.trim(),
            days,
            start_time: start,
            end_time: end,
            filters: {
              priorities,
              list_ids: listIds,
              tag_ids: tagIds,
              team_ids: teamIds,
              min_minutes: minMinutes,
              max_minutes: maxMinutes,
            },
            color,
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

const s = themed(() =>
  StyleSheet.create({
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
    sizeWarn: { marginTop: -8 },
    colorDot: { width: 10, height: 10, borderRadius: 5 },
    swatches: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
    swatch: {
      width: 34,
      height: 34,
      borderRadius: 17,
      alignItems: "center",
      justifyContent: "center",
    },
  }),
);
