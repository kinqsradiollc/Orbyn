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
  TRAVEL_MODES,
  isTimeZone,
  type BreakLevel,
  type BufferScope,
  type DigestPrefs,
  type EstimateModel,
  type TravelMode,
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
import { Disclosure } from "../components/Disclosure";
import { ScreenIntro } from "../components/ScreenIntro";
import { Segmented } from "../components/Segmented";
import { Sheet, sheetStyles } from "../components/Sheet";
import { SmallAction } from "../components/SmallAction";
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
import { TimeZonePicker } from "./booking/TimeZonePicker";

/** Days Plan my day covers unless you choose otherwise. */
const HORIZONS = ["1", "2", "3", "4", "5", "6", "7"] as const;
/** Most extra time zones beside the calendar's hours. */
const MAX_ZONES = 3;

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
  horizon: (typeof HORIZONS)[number];
  zones: string[];
  /** Which events get buffers; `team_ids` null means all your teams. */
  scope: Omit<BufferScope, "min_minutes"> & { min: string };
  travelPad: string;
  digest: DigestPrefs;
  learn_estimates: boolean;
};

/** Most minutes added to every travel time. */
const MAX_TRAVEL_PAD = 30;
const MODE_OPTIONS = ["none", ...TRAVEL_MODES] as const;
const MODE_LABELS: Record<(typeof MODE_OPTIONS)[number], string> = {
  none: "Not set",
  walk: "Walk",
  cycle: "Cycle",
  transit: "Transit",
  drive: "Drive",
};

const scopeForm = (b: BufferScope | undefined): Form["scope"] => ({
  personal: b?.personal ?? true,
  team_ids: b?.team_ids ?? null,
  list_ids: b?.list_ids ?? [],
  only_with_others: b?.only_with_others ?? false,
  min: String(b?.min_minutes ?? 0),
});

const toForm = (p: PlannerPrefs): Form => ({
  scope: scopeForm(p.buffer_scope),
  travelPad: String(p.travel_padding_minutes ?? 0),
  horizon: HORIZONS[Math.min(7, Math.max(1, p.horizon_days || 1)) - 1],
  zones: (p.extra_timezones ?? []).slice(0, MAX_ZONES),
  digest: p.digest ?? {
    morning: false,
    evening: false,
    morning_time: "07:00",
    evening_time: "17:00",
  },
  learn_estimates: p.learn_estimates ?? false,
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

/** How a frame repeats: preset rules, chosen weekdays, or a rule of your own. */
type Repeat =
  | "days"
  | "weekdays"
  | "biweekly"
  | "firstWeekday"
  | "lastWeekday"
  | "lastDay"
  | "custom";
const REPEATS: Repeat[] = [
  "days",
  "weekdays",
  "biweekly",
  "firstWeekday",
  "lastWeekday",
  "lastDay",
  "custom",
];
const REPEAT_LABELS: Record<Repeat, string> = {
  days: "On the days I choose",
  weekdays: "Every weekday",
  biweekly: "Every other week",
  firstWeekday: "First weekday of the month",
  lastWeekday: "Last weekday of the month",
  lastDay: "Last day of the month",
  custom: "Custom rule",
};
const BYDAY = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
const RULES: Partial<Record<Repeat, string>> = {
  firstWeekday: "FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=1",
  lastWeekday: "FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1",
  lastDay: "FREQ=MONTHLY;BYMONTHDAY=-1",
};

/** The rule to save for a repeat choice; null repeats on `days`. */
const ruleFor = (repeat: Repeat, days: number[], custom: string) =>
  repeat === "days" || repeat === "weekdays"
    ? null
    : repeat === "biweekly"
      ? `FREQ=WEEKLY;INTERVAL=2;BYDAY=${days.map((d) => BYDAY[d]).join(",")}`
      : repeat === "custom"
        ? custom.trim().toUpperCase() || null
        : (RULES[repeat] ?? null);

/** Which repeat choice a saved frame matches, and its weekdays. */
function repeatOf(frame?: Pick<Frame, "days" | "rrule">): {
  repeat: Repeat;
  days: number[];
} {
  const days = frame?.days?.length ? frame.days : [1, 2, 3, 4, 5];
  const rule = frame?.rrule?.trim().toUpperCase() ?? "";
  if (!rule)
    return {
      repeat: days.join(",") === "1,2,3,4,5" ? "weekdays" : "days",
      days,
    };
  const preset = REPEATS.find((r) => RULES[r] === rule);
  if (preset) return { repeat: preset, days };
  const biweekly = /^FREQ=WEEKLY;INTERVAL=2;BYDAY=([A-Z,]+)$/.exec(rule);
  const picked = (biweekly?.[1] ?? "")
    .split(",")
    .map((code) => BYDAY.indexOf(code))
    .filter((d) => d >= 0)
    .sort((a, b) => a - b);
  if (picked.length) return { repeat: "biweekly", days: picked };
  return { repeat: "custom", days };
}

/** "Tue, Sep 16" for "2026-09-16". */
const dayText = (key: string) => {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
};

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
  const { lists, listById, tagById } = usePlanning();
  const { busy, error, setError, run } = useRun();
  const [form, setForm] = useState<Form | null>(null);
  const [frames, setFrames] = useState<Frame[]>([]);
  const [places, setPlaces] = useState<Place[]>([]);
  const [saved, setSaved] = useState(false);
  const [editingFrame, setEditingFrame] = useState<Frame | "new" | null>(null);
  const [editingPlace, setEditingPlace] = useState<Place | "new" | null>(null);
  const [estimates, setEstimates] = useState<EstimateModel | null>(null);
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
    client.getEstimates().then(setEstimates, () => setEstimates(null));
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
      if (form.zones.some((z) => !isTimeZone(z)))
        throw new Error("Pick a zone for each extra time zone, or remove it.");
      if (new Set(form.zones).size !== form.zones.length)
        throw new Error("List each extra time zone once.");
      const num = (text: string) => parseMinutes(text) ?? undefined;
      const pad = parseMinutes(form.travelPad) ?? 0;
      if (pad < 0 || pad > MAX_TRAVEL_PAD)
        throw new Error(`Travel padding is 0 to ${MAX_TRAVEL_PAD} minutes.`);
      const shortest = parseMinutes(form.scope.min) ?? 0;
      if (shortest < 0 || shortest > 1440)
        throw new Error("The shortest event is 0 to 1440 minutes.");
      const { min: _min, ...scope } = form.scope;
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
        horizon_days: Number(form.horizon),
        extra_timezones: form.zones,
        buffer_scope: { ...scope, min_minutes: shortest },
        travel_padding_minutes: pad,
        digest: form.digest,
        learn_estimates: form.learn_estimates,
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
      `${f.rrule ? REPEAT_LABELS[repeatOf(f).repeat] : daysLabel(f.days)} · ${clockDisplay(f.start_time)} – ${clockDisplay(f.end_time)}`,
      priorities.length
        ? `${priorities.map((p) => PRIORITY_LABELS[p]).join(", ")} priority`
        : "",
      names(list_ids, (id) => listById.get(id)?.name),
      names(tag_ids, (id) => tagById.get(id)?.name),
      names(team_ids, (id) => teams.find((t) => t.id === id)?.name),
      sizeLabel(f.filters.min_minutes, f.filters.max_minutes),
      f.busy ? "Busy" : "",
    ]
      .filter(Boolean)
      .join(" · ");
  };

  const reloadFrames = async () => setFrames(await client.listFrames());
  const reloadPlaces = async () => setPlaces(await client.listPlaces());

  return (
    <>
      <ScrollView
        contentContainerStyle={sheetStyles.body}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
      >
        <View style={sheetStyles.column}>
          <ErrorBanner error={error} onDismiss={() => setError("")} />
          <ScreenIntro
            icon="calendar"
            title="Make time for what matters"
            detail="Shape your working day. Orbyn plans around your rhythm."
          />
          {!form ? (
            <Text style={shared.small}>
              {busy ? "Loading your settings…" : "Settings aren’t available."}
            </Text>
          ) : (
            <>
              <Disclosure
                title="Your working day"
                detail="Hours, days and your time zone"
                initiallyOpen
              >
                <View style={s.preferenceCard}>
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
              </Disclosure>
              <Disclosure
                title="Time zones"
                detail="Keep other locations in view"
              >
                <View style={s.preferenceCard}>
                  <Text style={[shared.small, s.zoneHint]}>
                    Shown beside the hours on the calendar, up to {MAX_ZONES}.
                  </Text>
                  {form.zones.map((zone, n) => (
                    <View key={n} style={[s.pair, s.zoneRow]}>
                      <View style={{ flex: 1 }}>
                        <TimeZonePicker
                          value={zone}
                          onChange={(next) =>
                            patch({
                              zones: form.zones.map((z, i) =>
                                i === n ? next : z,
                              ),
                            })
                          }
                        />
                      </View>
                      <SmallAction
                        destructive
                        label="Remove"
                        disabled={busy}
                        onPress={() => {
                          animateLayout();
                          patch({
                            zones: form.zones.filter((_, i) => i !== n),
                          });
                        }}
                      />
                    </View>
                  ))}
                  {form.zones.length < MAX_ZONES ? (
                    <Button
                      secondary
                      title="Add a time zone"
                      icon="plus"
                      style={s.inline}
                      onPress={() => {
                        animateLayout();
                        patch({ zones: [...form.zones, ""] });
                      }}
                    />
                  ) : (
                    <Text style={shared.small}>
                      That’s the most zones shown.
                    </Text>
                  )}
                </View>
              </Disclosure>
              <Disclosure
                title="Scheduling"
                detail="Focus blocks, breaks and planning horizon"
              >
                <View style={s.preferenceCard}>
                  <Field
                    label="Days to plan"
                    hint="How many days Plan my day covers unless you pick another number."
                  >
                    <Segmented
                      wrap
                      accessibilityLabel="Days to plan by default"
                      options={HORIZONS}
                      value={form.horizon}
                      onChange={(horizon) => patch({ horizon })}
                    />
                  </Field>
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
              </Disclosure>
              <Disclosure
                title="Buffers & travel"
                detail="Leave room between commitments"
              >
                <View style={s.preferenceCard}>
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
                  <Text style={[shared.label, s.subhead]}>
                    Which events get buffers
                  </Text>
                  <View style={s.switchRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={s.switchTitle}>Personal events</Text>
                      <Text style={shared.small}>
                        Events not shared with a team.
                      </Text>
                    </View>
                    <Switch
                      value={form.scope.personal}
                      trackColor={{ true: colors.accent }}
                      accessibilityLabel="Buffers around personal events"
                      onValueChange={(personal) =>
                        patch({ scope: { ...form.scope, personal } })
                      }
                    />
                  </View>
                  {teams.length > 0 && (
                    <Field
                      label="Team events"
                      hint="None chosen: no team events get buffers."
                    >
                      <ChipRow label="Teams whose events get buffers" multi>
                        {teams.map((t) => {
                          const all = teams.map((x) => x.id);
                          const ids = form.scope.team_ids ?? all;
                          return (
                            <Chip
                              key={t.id}
                              multi
                              label={t.name}
                              selected={ids.includes(t.id)}
                              onPress={() => {
                                const next = toggleId(ids, t.id);
                                patch({
                                  scope: {
                                    ...form.scope,
                                    // Every team: null, so new teams count too.
                                    team_ids: all.every((id) =>
                                      next.includes(id),
                                    )
                                      ? null
                                      : next,
                                  },
                                });
                              }}
                            />
                          );
                        })}
                      </ChipRow>
                    </Field>
                  )}
                  {lists.length > 0 && (
                    <Field
                      label="Only events in these lists"
                      hint="None chosen: events in any list."
                    >
                      <ChipRow label="Lists whose events get buffers" multi>
                        {lists.map((l) => (
                          <Chip
                            key={l.id}
                            multi
                            color={l.color}
                            label={l.name}
                            selected={form.scope.list_ids.includes(l.id)}
                            onPress={() =>
                              patch({
                                scope: {
                                  ...form.scope,
                                  list_ids: toggleId(form.scope.list_ids, l.id),
                                },
                              })
                            }
                          />
                        ))}
                      </ChipRow>
                    </Field>
                  )}
                  <Field
                    label="Shortest event"
                    hint="Shorter events get no buffer. 0 for every length."
                  >
                    <NumberInput
                      value={form.scope.min}
                      onChangeText={(min) =>
                        patch({ scope: { ...form.scope, min } })
                      }
                      suffix="minutes"
                      accessibilityLabel="Shortest event that gets buffers, in minutes"
                    />
                  </Field>
                  <View style={s.switchRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={s.switchTitle}>
                        Only meetings with others
                      </Text>
                      <Text style={shared.small}>
                        Events with people invited, a meeting link, or a team.
                      </Text>
                    </View>
                    <Switch
                      value={form.scope.only_with_others}
                      trackColor={{ true: colors.accent }}
                      accessibilityLabel="Buffers only around meetings with others"
                      onValueChange={(only_with_others) =>
                        patch({ scope: { ...form.scope, only_with_others } })
                      }
                    />
                  </View>
                  <Field
                    label="Default travel time"
                    hint="For events with a location that doesn’t match one of your places."
                  >
                    <NumberInput
                      value={form.travel}
                      onChangeText={(travel) => patch({ travel })}
                      suffix="minutes"
                      accessibilityLabel="Default travel time, in minutes"
                    />
                  </Field>
                  <Field
                    label="Travel padding"
                    hint={`Extra minutes added to every trip, 0 to ${MAX_TRAVEL_PAD}.`}
                    style={s.last}
                  >
                    <NumberInput
                      value={form.travelPad}
                      onChangeText={(travelPad) => patch({ travelPad })}
                      suffix="minutes"
                      accessibilityLabel={`Travel padding, 0 to ${MAX_TRAVEL_PAD} minutes`}
                    />
                  </Field>
                </View>
              </Disclosure>
              <Disclosure
                title="Learn from your pace"
                detail="Use past work to improve estimates"
              >
                <Text style={[shared.small, s.sectionHint]}>
                  {estimates && estimates.overall.samples >= 3
                    ? `You take about ${estimates.overall.ratio}× your estimate across ${estimates.overall.samples} finished tasks.`
                    : "The planner learns how long tasks really take once you finish a few with an estimate and logged time."}
                </Text>
                <View style={s.switchRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.switchTitle}>
                      Adjust estimates from history
                    </Text>
                    <Text style={shared.small}>
                      Scales planned time; your estimates aren’t changed.
                    </Text>
                  </View>
                  <Switch
                    value={form.learn_estimates}
                    accessibilityLabel="Adjust estimates from history"
                    onValueChange={(learn_estimates) =>
                      patch({ learn_estimates })
                    }
                  />
                </View>
              </Disclosure>
              <Disclosure
                title="Daily digest"
                detail="Your morning agenda and evening review"
              >
                <Text style={[shared.small, s.sectionHint]}>
                  A short email with your day, sent from the workspace’s own
                  mail server. Off until you turn it on.
                </Text>
                <View style={s.switchRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.switchTitle}>Morning agenda</Text>
                  </View>
                  <Switch
                    value={form.digest.morning}
                    accessibilityLabel="Morning agenda email"
                    onValueChange={(morning) =>
                      patch({ digest: { ...form.digest, morning } })
                    }
                  />
                </View>
                <Field label="Morning time">
                  <ClockField
                    label="Morning digest time"
                    value={form.digest.morning_time}
                    onChange={(morning_time) =>
                      patch({ digest: { ...form.digest, morning_time } })
                    }
                  />
                </Field>
                <View style={s.switchRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.switchTitle}>Evening review</Text>
                  </View>
                  <Switch
                    value={form.digest.evening}
                    accessibilityLabel="Evening review email"
                    onValueChange={(evening) =>
                      patch({ digest: { ...form.digest, evening } })
                    }
                  />
                </View>
                <Field label="Evening time" style={s.last}>
                  <ClockField
                    label="Evening digest time"
                    value={form.digest.evening_time}
                    onChange={(evening_time) =>
                      patch({ digest: { ...form.digest, evening_time } })
                    }
                  />
                </Field>
                <SmallAction
                  label="Email me a preview"
                  disabled={busy}
                  onPress={() =>
                    void run(async () => {
                      await client.sendTestDigest("morning");
                    })
                  }
                />
              </Disclosure>
            </>
          )}

          <Disclosure
            title="Focus frames"
            detail="Reserve time for the right kind of work"
          >
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
                    onUnskip={(date) =>
                      void run(async () => {
                        await client.unskipFrame(f.id, date);
                        await reloadFrames();
                      })
                    }
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
                      Alert.alert(
                        `Delete ${f.name}?`,
                        "Tasks aren’t affected.",
                        [
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
                        ],
                      )
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
          </Disclosure>
          <Disclosure
            title="Places"
            detail="Travel time for the places you visit"
          >
            <Text style={[shared.small, s.sectionHint]}>
              How long it takes to get somewhere. Events whose location contains
              the match text get that travel time before and after.
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
                    detail={[
                      `“${p.match}”`,
                      `${p.travel_minutes} min travel${p.peak_minutes != null ? ` (${p.peak_minutes} at rush hour)` : ""}`,
                      p.mode ? MODE_LABELS[p.mode] : "",
                    ]
                      .filter(Boolean)
                      .join(" · ")}
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
          </Disclosure>
        </View>
      </ScrollView>
      {form && (
        <View style={s.saveFooter}>
          <Button
            title={
              busy ? "Saving…" : saved ? "Saved" : "Save planning settings"
            }
            icon="check"
            disabled={busy}
            onPress={() => void save()}
          />
        </View>
      )}
    </>
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
 * Create or edit a frame: its name, how it repeats and its hours, whether it
 * counts as busy, its time zone, which tasks it takes (priorities, lists,
 * tags, teams, size; none chosen means any), its colour and skipped days.
 * Also used by the calendar's frame editor.
 */
export function FrameForm({
  frame,
  teams,
  busy,
  first,
  onSave,
  onDelete,
  onCancel,
  onUnskip,
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
    rrule: string | null;
    busy: boolean;
    timezone: string | null;
  }) => void;
  onDelete?: () => void;
  onCancel: () => void;
  /** Bring back a skipped day. */
  onUnskip?: (date: string) => void;
}) {
  const { lists, tags } = usePlanning();
  const initial = repeatOf(frame);
  const [name, setName] = useState(frame?.name ?? "");
  const [repeat, setRepeat] = useState<Repeat>(initial.repeat);
  const [rule, setRule] = useState(
    initial.repeat === "custom" ? (frame?.rrule ?? "") : "",
  );
  const [days, setDays] = useState(initial.days);
  const [blocking, setBlocking] = useState(frame?.busy ?? false);
  const [zone, setZone] = useState<string | null>(frame?.timezone ?? null);
  const device = deviceTimeZone();
  const zones: (string | null)[] = [
    null,
    device,
    ...(frame?.timezone && frame.timezone !== device ? [frame.timezone] : []),
  ];
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
      <Field label="Repeats">
        <ChipRow label="Repeats">
          {REPEATS.map((r) => (
            <Chip
              key={r}
              label={REPEAT_LABELS[r]}
              selected={repeat === r}
              onPress={() => setRepeat(r)}
            />
          ))}
        </ChipRow>
      </Field>
      {repeat === "custom" && (
        <Field
          label="Rule"
          hint="An iCalendar RRULE, like FREQ=WEEKLY;BYDAY=MO,TU,TH,FR. It’s checked when you save."
        >
          <TextInput
            style={shared.input}
            value={rule}
            onChangeText={setRule}
            maxLength={200}
            autoCapitalize="characters"
            autoCorrect={false}
            placeholder="FREQ=WEEKLY;BYDAY=MO,TU,TH,FR"
            placeholderTextColor={colors.faint}
            accessibilityLabel="Repeat rule"
          />
        </Field>
      )}
      {(repeat === "days" || repeat === "biweekly") && (
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
      )}
      <View style={s.pair}>
        <Field label="From" style={s.half}>
          <ClockField label="Frame starts" value={start} onChange={setStart} />
        </Field>
        <Field label="To" style={s.half}>
          <ClockField label="Frame ends" value={end} onChange={setEnd} />
        </Field>
      </View>
      <View style={s.switchRow}>
        <View style={{ flex: 1 }}>
          <Text style={s.switchTitle}>Busy</Text>
          <Text style={shared.small}>
            Busy frames block booking pages and team suggestions.
          </Text>
        </View>
        <Switch
          value={blocking}
          trackColor={{ true: colors.accent }}
          accessibilityLabel="Busy"
          onValueChange={setBlocking}
        />
      </View>
      <Field label="Time zone" hint="The frame keeps its hours in this zone.">
        <ChipRow label="Frame time zone">
          {zones.map((z) => (
            <Chip
              key={z ?? "planner"}
              label={z ?? "My planning time zone"}
              selected={zone === z}
              onPress={() => setZone(z)}
            />
          ))}
        </ChipRow>
      </Field>
      {!!frame?.exdates?.length && onUnskip && (
        <Field label="Skipped days" hint="Tap a day to bring it back.">
          <ChipRow label="Skipped days">
            {frame.exdates.map((d) => (
              <Chip
                key={d}
                label={`${dayText(d)} ×`}
                accessibilityLabel={`Bring back ${dayText(d)}`}
                disabled={busy}
                selected={false}
                onPress={() => onUnskip(d)}
              />
            ))}
          </ChipRow>
        </Field>
      )}
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
        disabled={
          busy ||
          !name.trim() ||
          end <= start ||
          !!sizeError ||
          (repeat === "custom" && !rule.trim())
        }
        onPress={() =>
          onSave({
            name: name.trim(),
            days: repeat === "weekdays" ? [1, 2, 3, 4, 5] : days,
            rrule: ruleFor(repeat, days, rule),
            busy: blocking,
            timezone: zone,
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
    mode: TravelMode | null;
    peak_minutes: number | null;
  }) => void;
  onDelete?: () => void;
  onCancel: () => void;
}) {
  const [label, setLabel] = useState(place?.label ?? "");
  const [match, setMatch] = useState(place?.match ?? "");
  const [travel, setTravel] = useState(String(place?.travel_minutes ?? 20));
  const [mode, setMode] = useState<(typeof MODE_OPTIONS)[number]>(
    place?.mode ?? "none",
  );
  const [peak, setPeak] = useState(
    place?.peak_minutes != null ? String(place.peak_minutes) : "",
  );
  const minutes = parseMinutes(travel);
  const peakMinutes = parseMinutes(peak);
  const tooLong =
    (minutes !== null && minutes > 240) ||
    (peakMinutes !== null && peakMinutes > 240);
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
      <Field
        label="Rush-hour minutes (optional)"
        hint="Used on weekdays 7–9 AM and 4–6 PM. Leave empty for the usual time."
      >
        <NumberInput
          value={peak}
          onChangeText={setPeak}
          placeholder="Same"
          suffix="minutes"
          accessibilityLabel="Travel time at rush hour, in minutes"
        />
      </Field>
      <Field label="How you get there" hint="A label only.">
        <Segmented
          wrap
          accessibilityLabel="How you get there"
          options={MODE_OPTIONS}
          labels={MODE_LABELS}
          value={mode}
          onChange={setMode}
        />
      </Field>
      {tooLong && (
        <Text style={[shared.small, s.problem]}>
          Travel times go up to 240 minutes.
        </Text>
      )}
      <Button
        title="Save place"
        icon="check"
        disabled={
          busy || !label.trim() || !match.trim() || minutes === null || tooLong
        }
        onPress={() =>
          onSave({
            label: label.trim(),
            match: match.trim(),
            travel_minutes: minutes ?? 0,
            mode: mode === "none" ? null : mode,
            peak_minutes: peakMinutes,
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
    saveFooter: {
      paddingHorizontal: 16,
      paddingTop: 12,
      backgroundColor: colors.surface,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    preferenceCard: { paddingBottom: 4 },
    intro: { marginTop: 0, marginBottom: 18 },
    eyebrow: { marginTop: 8 },
    sectionHint: { marginTop: 0, marginBottom: 12 },
    value: { fontFamily: fonts.semibold, fontSize: 15, color: colors.text },
    inline: { marginTop: 10, marginBottom: 0 },
    pair: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
    zoneHint: { marginBottom: 12 },
    subhead: { marginTop: 4, marginBottom: 12 },
    problem: { color: colors.danger, marginBottom: 12 },
    zoneRow: { alignItems: "center", marginBottom: 10 },
    half: { flex: 1, minWidth: 110 },
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
