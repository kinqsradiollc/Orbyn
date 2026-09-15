import React, { useEffect, useRef, useState } from "react";
import {
  Animated,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  dateLabel,
  hasTeamPermission,
  statusLabels,
  statusOrder,
  type Item,
  type ItemDetail,
  type ItemStep,
  type ItemUpdate,
  type Priority,
  type Status,
  type Team,
} from "@orbyn/core";
import { Button } from "../components/Button";
import { CelebrationHost, celebrate } from "../components/Celebration";
import { ErrorBanner } from "../components/ErrorBanner";
import { Icon } from "../components/Icon";
import { StatusPill } from "../components/Pill";
import { PlanningMeta } from "../components/PlanningMeta";
import { ProgressBar } from "../components/ProgressBar";
import { SchedulePanel } from "../components/SchedulePanel";
import { Sheet, sheetStyles } from "../components/Sheet";
import { useKeyboardInset } from "../hooks/useKeyboardInset";
import { useNow } from "../hooks/useNow";
import { client } from "../lib/api";
import { canJoin } from "../lib/planning";
import { percentOf, stepsLabel, timeAgo } from "../lib/progress";
import {
  animateLayout,
  FadeIn,
  pop,
  PressableScale,
  useReducedMotion,
} from "../motion";
import { colors, fonts, radii, spacing, themed, statusTones } from "../theme";
import { shared } from "../styles";

const PROGRESS_STEPS = [0, 25, 50, 75, 100];

const PRIORITY = themed<
  Record<Priority, { bg: string; fg: string; label: string }>
>(() => ({
  high: { bg: colors.highBg, fg: colors.highText, label: "High priority" },
  medium: {
    bg: colors.mediumBg,
    fg: colors.mediumText,
    label: "Medium priority",
  },
  low: { bg: colors.lowBg, fg: colors.lowText, label: "Low priority" },
}));

/**
 * Task detail sheet: status, progress, checklist and the updates timeline.
 * Opened by tapping a task anywhere. "Edit details" hands off to ItemEditor
 * (RootScreen closes this sheet first and reopens it afterwards).
 */
export function TaskDetail({
  visible,
  item,
  teams,
  onClose,
  onDismiss,
  onEdit,
  onFocus,
  onChanged,
}: {
  visible: boolean;
  /** The row that was tapped; shown straight away while the detail loads. */
  item: Item | null;
  teams: Team[];
  onClose: () => void;
  /** iOS: called once the dismiss animation has finished. */
  onDismiss?: () => void;
  /** Opens the full editor for this item. */
  onEdit: (item: Item) => void;
  /** Opens focus mode for this task. */
  onFocus: (item: Item) => void;
  /** Called after every change so lists and counts refresh. */
  onChanged: () => void;
}) {
  return (
    <Sheet
      visible={visible}
      title={item?.kind === "event" ? "Event" : "Task"}
      onClose={onClose}
      onDismiss={onDismiss}
    >
      {item && (
        <Body
          key={item.id}
          seed={item}
          teams={teams}
          onEdit={onEdit}
          onFocus={onFocus}
          onChanged={onChanged}
        />
      )}
      <CelebrationHost />
    </Sheet>
  );
}

function Body({
  seed,
  teams,
  onEdit,
  onFocus,
  onChanged,
}: {
  seed: Item;
  teams: Team[];
  onEdit: (item: Item) => void;
  onFocus: (item: Item) => void;
  onChanged: () => void;
}) {
  const [detail, setDetail] = useState<ItemDetail | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [newStep, setNewStep] = useState("");
  const [note, setNote] = useState("");
  const [noteStatus, setNoteStatus] = useState<Status | null>(null);
  /** The update box has focus: its status choices show above it. */
  const [composing, setComposing] = useState(false);
  const area = useRef<React.ComponentRef<typeof View>>(null);
  const keyboard = useKeyboardInset(area);
  /** Progress being chosen, saved half a second after the last tap. */
  const [draft, setDraft] = useState<number | null>(null);
  const progressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (progressTimer.current) clearTimeout(progressTimer.current);
    },
    [],
  );

  useEffect(() => {
    let alive = true;
    client
      .getItem(seed.id)
      .then((d) => {
        if (!alive) return;
        animateLayout();
        setDetail(d);
      })
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
    // Reload when the task changes elsewhere, not only when another opens.
  }, [
    seed.id,
    seed.version,
    seed.status,
    seed.steps_done,
    seed.steps_total,
    seed.updates_count,
    seed.last_update_at,
  ]);

  const item: Item = detail ?? seed;
  const team = item.team_id
    ? teams.find((t) => t.id === item.team_id)
    : undefined;
  const readOnly = !!team && !hasTeamPermission(team.role, "items:write");
  const teamName = item.team_name ?? team?.name ?? seed.team_name;
  const steps = (detail?.steps ?? [])
    .slice()
    .sort((a, b) => a.position - b.position);
  const updates = detail?.updates ?? [];
  const stepsDone = detail
    ? steps.filter((st) => st.done).length
    : (seed.steps_done ?? 0);
  const stepsTotal = detail ? steps.length : (seed.steps_total ?? 0);
  const percent = draft ?? percentOf(item);
  const tone = statusTones[item.status];
  const priority = PRIORITY[item.priority];
  const meetingUrl = item.meeting_url ?? "";
  const now = useNow(30_000, !!meetingUrl);
  const joinable = canJoin(
    { meeting_url: meetingUrl, start_at: item.due_at, end_at: item.end_at },
    now,
  );
  const canWork = item.kind === "task" && item.status !== "done" && !readOnly;

  /** Run a change; the server answers with the fresh detail. */
  const run = async (fn: () => Promise<ItemDetail>) => {
    setBusy(true);
    setError("");
    const before = item.status;
    try {
      const next = await fn();
      animateLayout();
      setDetail(next);
      // A status change, an update or the last checklist step can finish it.
      if (next.status === "done" && before !== "done") celebrate(next.title);
      onChanged();
      return true;
    } catch (e) {
      setError((e as Error).message);
      // The task changed elsewhere (steps added, a newer version): reload it.
      if ((e as { status?: number }).status === 409)
        client.getItem(seed.id).then(setDetail, () => {});
      return false;
    } finally {
      setBusy(false);
    }
  };

  const setStatus = (status: Status) => {
    if (status !== item.status)
      void run(() => client.postItemUpdate(item.id, { status }));
  };
  /** Set progress by hand; saved half a second after the last change. */
  const setProgress = (value: number) => {
    const next = Math.max(0, Math.min(100, Math.round(value)));
    setDraft(next);
    if (progressTimer.current) clearTimeout(progressTimer.current);
    progressTimer.current = setTimeout(() => {
      progressTimer.current = null;
      void run(() => client.postItemUpdate(item.id, { progress: next })).then(
        () => setDraft(null),
      );
    }, 500);
  };
  const addStep = async () => {
    const title = newStep.trim();
    if (!title) return;
    if (await run(() => client.addStep(item.id, { title }))) setNewStep("");
  };
  const postNote = async () => {
    const body = note.trim();
    const status = noteStatus && noteStatus !== item.status ? noteStatus : null;
    if (!body && !status) return;
    const ok = await run(() =>
      client.postItemUpdate(item.id, {
        ...(body ? { body } : {}),
        ...(status ? { status } : {}),
      }),
    );
    if (ok) {
      setNote("");
      setNoteStatus(null);
    }
  };
  const openEditor = () => {
    const {
      steps: _steps,
      updates: _updates,
      ...rest
    } = detail ?? ({ ...seed, steps: [], updates: [] } as ItemDetail);
    onEdit({ ...rest, team_name: teamName });
  };
  const canPost =
    !busy && (!!note.trim() || (!!noteStatus && noteStatus !== item.status));

  return (
    <View
      ref={area}
      collapsable={false}
      onLayout={keyboard.onLayout}
      style={[s.fill, { paddingBottom: keyboard.inset }]}
    >
      <ScrollView
        style={s.fill}
        contentContainerStyle={sheetStyles.body}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
      >
        <View style={sheetStyles.column}>
          <ErrorBanner error={error} onDismiss={() => setError("")} />

          {/* Header */}
          <FadeIn style={s.header}>
            <View style={s.headerTop}>
              <StatusPill status={item.status} />
              {item.kind === "event" && <Text style={s.kind}>Event</Text>}
            </View>
            <Text style={s.title} accessibilityRole="header">
              {item.title}
            </Text>
            <View style={s.metaRow}>
              <View style={s.metaItem}>
                <Icon name="clock" size={14} color={colors.muted} />
                <Text style={s.metaText}>
                  {dateLabel(item.due_at)}
                  {item.end_at
                    ? ` – ${new Date(item.end_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
                    : ""}
                </Text>
              </View>
              <View style={[s.chip, { backgroundColor: priority.bg }]}>
                <Text style={[s.chipText, { color: priority.fg }]}>
                  {priority.label}
                </Text>
              </View>
              {!!teamName && (
                <View
                  style={[s.chip, s.teamChip]}
                  accessibilityLabel={`Team: ${teamName}`}
                >
                  <Icon name="users" size={11} color={colors.accent} />
                  <Text style={[s.chipText, { color: colors.accent }]}>
                    {teamName}
                  </Text>
                </View>
              )}
            </View>
            <PlanningMeta item={item} large />
            {!!item.location && (
              <View style={[s.metaItem, s.metaLine]}>
                <Icon name="mapPin" size={14} color={colors.muted} />
                <Text style={s.metaText}>{item.location}</Text>
              </View>
            )}
            {!!item.notes && <Text style={s.notes}>{item.notes}</Text>}
            {!!meetingUrl && (
              <View style={s.meeting}>
                <Button
                  title="Join"
                  icon="video"
                  disabled={!joinable}
                  style={s.join}
                  onPress={() =>
                    void Linking.openURL(meetingUrl).catch(() =>
                      setError("That meeting link couldn’t be opened."),
                    )
                  }
                />
                {!joinable && (
                  <Text style={shared.small}>
                    Join opens 5 minutes before the start.
                  </Text>
                )}
              </View>
            )}
          </FadeIn>

          {canWork && (
            <View>
              <Button
                title="Focus on this"
                icon="target"
                onPress={() => onFocus(item)}
              />
              <SchedulePanel item={item} onBooked={onChanged} />
            </View>
          )}

          {readOnly && (
            <View style={s.viewOnly}>
              <Icon name="users" size={16} color={colors.accent} />
              <Text style={s.viewOnlyText}>
                View only — you’re a viewer in {teamName}. You can read steps
                and updates but not change them.
              </Text>
            </View>
          )}

          {/* Status */}
          <Text style={shared.label}>Status</Text>
          <StatusChoice
            value={item.status}
            disabled={readOnly || busy}
            onChange={setStatus}
            accessibilityLabel="Task status"
          />

          {/* Progress */}
          <FadeIn index={1} style={[shared.card, s.progressCard]}>
            <View style={s.progressTop}>
              <Text style={shared.sectionTitle}>Progress</Text>
              <Text style={[s.bigPercent, { color: tone.fg }]}>{percent}%</Text>
            </View>
            <ProgressBar
              value={percent}
              height={10}
              color={tone.fg}
              track={colors.surfaceMuted}
              label={`${item.title} progress`}
            />
            {stepsTotal > 0 ? (
              <Text style={[shared.small, s.progressHint]}>
                {stepsLabel(stepsDone, stepsTotal)} · Progress follows the
                checklist
              </Text>
            ) : readOnly ? null : item.status === "done" ? (
              <Text style={[shared.small, s.progressHint]}>
                Reopen the task to change its progress.
              </Text>
            ) : (
              <>
                <Text style={[shared.small, s.progressHint]}>
                  No checklist yet. Set progress by hand:
                </Text>
                <View style={s.segments} accessibilityRole="radiogroup">
                  {PROGRESS_STEPS.map((value) => {
                    const active = percent === value;
                    const filled = value > 0 && percent >= value;
                    return (
                      <PressableScale
                        key={value}
                        accessibilityRole="radio"
                        accessibilityLabel={`Set progress to ${value}%`}
                        accessibilityState={{ checked: active, disabled: busy }}
                        disabled={busy}
                        onPress={() => !active && setProgress(value)}
                        style={[
                          s.segment,
                          filled && { backgroundColor: tone.bg },
                          active && { borderColor: tone.fg },
                        ]}
                      >
                        <Text
                          style={[
                            s.segmentText,
                            (filled || active) && { color: tone.fg },
                          ]}
                        >
                          {value}%
                        </Text>
                      </PressableScale>
                    );
                  })}
                </View>
                <View style={s.stepper}>
                  <PressableScale
                    accessibilityRole="button"
                    accessibilityLabel="5% less"
                    accessibilityState={{ disabled: busy || percent <= 0 }}
                    disabled={busy || percent <= 0}
                    onPress={() => setProgress(percent - 5)}
                    style={[s.stepperButton, (busy || percent <= 0) && s.faded]}
                  >
                    <Text style={s.stepperText}>−5%</Text>
                  </PressableScale>
                  <Text style={s.stepperValue} accessibilityLiveRegion="polite">
                    {percent}%
                  </Text>
                  <PressableScale
                    accessibilityRole="button"
                    accessibilityLabel="5% more"
                    accessibilityState={{ disabled: busy || percent >= 100 }}
                    disabled={busy || percent >= 100}
                    onPress={() => setProgress(percent + 5)}
                    style={[
                      s.stepperButton,
                      (busy || percent >= 100) && s.faded,
                    ]}
                  >
                    <Text style={s.stepperText}>+5%</Text>
                  </PressableScale>
                </View>
              </>
            )}
          </FadeIn>

          {/* Checklist */}
          <FadeIn index={2} style={shared.card}>
            <View style={s.cardHeading}>
              <Text style={shared.sectionTitle} accessibilityRole="header">
                Checklist
              </Text>
              {stepsTotal > 0 && (
                <Text style={s.counter}>
                  {stepsDone} of {stepsTotal}
                </Text>
              )}
            </View>
            {!detail && stepsTotal > 0 && (
              <Text style={shared.small}>Loading steps…</Text>
            )}
            {detail && !steps.length && (
              <Text style={[shared.small, s.gapBelow]}>
                Break this into small steps. Progress updates as you tick them
                off.
              </Text>
            )}
            {steps.map((step, n) => (
              <StepRow
                key={step.id}
                step={step}
                first={n === 0}
                disabled={readOnly || busy}
                readOnly={readOnly}
                onToggle={() =>
                  void run(() =>
                    client.updateStep(item.id, step.id, { done: !step.done }),
                  )
                }
                onDelete={() =>
                  void run(() => client.deleteStep(item.id, step.id))
                }
                onRename={(title) =>
                  void run(() => client.updateStep(item.id, step.id, { title }))
                }
              />
            ))}
            {!readOnly && (
              <View style={s.addRow}>
                <TextInput
                  style={[shared.input, s.addInput]}
                  value={newStep}
                  onChangeText={setNewStep}
                  maxLength={200}
                  placeholder="Add a step"
                  placeholderTextColor={colors.faint}
                  returnKeyType="done"
                  submitBehavior="submit"
                  onSubmitEditing={() => void addStep()}
                  accessibilityLabel="New step title"
                />
                <PressableScale
                  accessibilityRole="button"
                  accessibilityLabel="Add step"
                  accessibilityState={{ disabled: busy || !newStep.trim() }}
                  disabled={busy || !newStep.trim()}
                  onPress={() => void addStep()}
                  style={[
                    s.addButton,
                    (busy || !newStep.trim()) && { opacity: 0.45 },
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
          </FadeIn>

          {/* Updates */}
          <FadeIn index={3} style={shared.card}>
            <View style={s.cardHeading}>
              <Text style={shared.sectionTitle} accessibilityRole="header">
                Updates
              </Text>
              {updates.length > 0 && (
                <Text style={s.counter}>{updates.length}</Text>
              )}
            </View>
            {detail && !updates.length && (
              <Text style={shared.small}>
                No updates yet.
                {readOnly ? "" : " Post one to keep everyone in the loop."}
              </Text>
            )}
            {updates.map((u, n) => (
              <UpdateRow key={u.id} update={u} first={n === 0} />
            ))}
          </FadeIn>

          <Button
            secondary
            title={readOnly ? "View all details" : "Edit details"}
            icon="arrowRight"
            onPress={openEditor}
          />
        </View>
      </ScrollView>
      {/* Fixed under the scrolling detail, and above the keyboard. */}
      {!readOnly && (
        <View style={s.footer}>
          <View style={sheetStyles.column}>
            {(composing || !!note.trim() || !!noteStatus) && (
              <>
                <Text style={[shared.label, s.composerLabel]}>
                  Change status (optional)
                </Text>
                <StatusChoice
                  compact
                  value={noteStatus}
                  disabled={busy}
                  onChange={(st) =>
                    setNoteStatus((prev) => (prev === st ? null : st))
                  }
                  accessibilityLabel="Status to set with this update"
                />
              </>
            )}
            <View style={s.footerRow}>
              <TextInput
                style={[shared.input, s.noteInput]}
                value={note}
                onChangeText={setNote}
                onFocus={() => setComposing(true)}
                onBlur={() => setComposing(false)}
                multiline
                maxLength={2000}
                textAlignVertical="top"
                placeholder="Share progress, a blocker or a win…"
                placeholderTextColor={colors.faint}
                accessibilityLabel="Update text"
              />
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel={busy ? "Posting update" : "Post update"}
                accessibilityState={{ disabled: !canPost }}
                disabled={!canPost}
                onPress={() => void postNote()}
                style={({ pressed }) => [
                  s.send,
                  pressed && { backgroundColor: colors.accentPressed },
                  !canPost && { opacity: 0.4 },
                ]}
              >
                <Icon
                  name="arrowRight"
                  size={18}
                  color={colors.white}
                  strokeWidth={2.2}
                />
              </PressableScale>
            </View>
          </View>
        </View>
      )}
    </View>
  );
}

/** Four colored status chips. `value` null means none chosen (composer). */
function StatusChoice({
  value,
  onChange,
  disabled,
  compact = false,
  accessibilityLabel,
}: {
  value: Status | null;
  onChange: (status: Status) => void;
  disabled: boolean;
  compact?: boolean;
  accessibilityLabel: string;
}) {
  return (
    <View
      style={[s.statusRow, compact && s.statusRowCompact]}
      accessibilityRole="radiogroup"
      accessibilityLabel={accessibilityLabel}
    >
      {statusOrder.map((status) => {
        const active = status === value;
        const t = statusTones[status];
        return (
          <PressableScale
            key={status}
            accessibilityRole="radio"
            accessibilityLabel={statusLabels[status]}
            accessibilityState={{ checked: active, disabled }}
            disabled={disabled}
            onPress={() => onChange(status)}
            style={[
              s.statusChip,
              compact && s.statusChipCompact,
              active && { backgroundColor: t.bg, borderColor: t.fg },
              disabled && !active && { opacity: 0.55 },
            ]}
          >
            <View style={[s.statusDot, { backgroundColor: t.fg }]} />
            <Text
              numberOfLines={1}
              style={[s.statusText, active && { color: t.fg }]}
            >
              {statusLabels[status]}
            </Text>
          </PressableScale>
        );
      })}
    </View>
  );
}

/**
 * One checklist step: tick with a pop, tap its title to rename it, delete
 * with the trash button.
 */
function StepRow({
  step,
  first,
  disabled,
  readOnly,
  onToggle,
  onDelete,
  onRename,
}: {
  step: ItemStep;
  first: boolean;
  disabled: boolean;
  readOnly: boolean;
  onToggle: () => void;
  onDelete: () => void;
  onRename: (title: string) => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(step.title);
  // Submitting blurs the field too; save once.
  const saving = useRef(false);
  const startRename = () => {
    setTitle(step.title);
    saving.current = false;
    setRenaming(true);
  };
  const finishRename = () => {
    if (saving.current) return;
    saving.current = true;
    setRenaming(false);
    const next = title.trim();
    if (next && next !== step.title) onRename(next);
  };
  const reduced = useReducedMotion();
  const scale = useRef(new Animated.Value(1)).current;
  const was = useRef(step.done);
  useEffect(() => {
    if (step.done && !was.current && !reduced) {
      scale.setValue(0.6);
      pop(scale, 1.2).start();
    }
    was.current = step.done;
  }, [step.done, reduced, scale]);
  return (
    <View style={[s.step, !first && s.stepDivider]}>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityLabel={step.title}
        accessibilityState={{ checked: step.done, disabled }}
        disabled={disabled}
        hitSlop={8}
        onPress={onToggle}
      >
        <Animated.View
          style={[s.check, step.done && s.checked, { transform: [{ scale }] }]}
        >
          {step.done && (
            <Icon name="check" size={12} color={colors.white} strokeWidth={3} />
          )}
        </Animated.View>
      </Pressable>
      {renaming ? (
        <TextInput
          style={[shared.input, s.stepRename]}
          value={title}
          onChangeText={setTitle}
          autoFocus
          maxLength={200}
          returnKeyType="done"
          onSubmitEditing={finishRename}
          onBlur={finishRename}
          accessibilityLabel={`Rename step ${step.title}`}
        />
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={step.title}
          accessibilityHint={readOnly ? undefined : "Renames this step"}
          disabled={readOnly || disabled}
          onPress={startRename}
          style={s.stepTitle}
        >
          <Text style={[s.stepText, step.done && s.stepDone]}>
            {step.title}
          </Text>
        </Pressable>
      )}
      {!readOnly && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Delete step ${step.title}`}
          disabled={disabled}
          hitSlop={8}
          onPress={onDelete}
          style={({ pressed }) => [s.trash, pressed && s.trashPressed]}
        >
          <Icon name="trash" size={16} color={colors.muted} />
        </Pressable>
      )}
    </View>
  );
}

/** A timeline entry: avatar initial, name, time, body and change chips. */
function UpdateRow({ update, first }: { update: ItemUpdate; first: boolean }) {
  const initial = (update.author_name || "?").trim().charAt(0).toUpperCase();
  return (
    <FadeIn style={[s.update, !first && s.stepDivider]}>
      <View style={s.avatar}>
        <Text style={s.avatarText}>{initial}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <View style={s.updateTop}>
          <Text style={s.author} numberOfLines={1}>
            {update.author_name || "Someone"}
          </Text>
          <Text style={shared.small}>{timeAgo(update.created_at)}</Text>
        </View>
        {!!update.body && <Text style={s.updateBody}>{update.body}</Text>}
        {(update.status || update.progress !== null) && (
          <View style={s.changes}>
            {update.status && <StatusPill status={update.status} />}
            {update.progress !== null && (
              <View style={[s.chip, s.progressChip]}>
                <Text style={[s.chipText, { color: colors.textSoft }]}>
                  Progress {update.progress}%
                </Text>
              </View>
            )}
          </View>
        )}
      </View>
    </FadeIn>
  );
}

const s = themed(() =>
  StyleSheet.create({
    header: { marginBottom: 18 },
    headerTop: { flexDirection: "row", alignItems: "center", gap: 8 },
    kind: { fontFamily: fonts.semibold, fontSize: 11, color: colors.muted },
    title: {
      fontFamily: fonts.display,
      fontSize: 24,
      lineHeight: 30,
      letterSpacing: -0.6,
      color: colors.text,
      marginTop: 10,
    },
    metaRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      alignItems: "center",
      gap: 8,
      marginTop: 10,
    },
    metaItem: { flexDirection: "row", alignItems: "center", gap: 5 },
    metaLine: { marginTop: 10 },
    meeting: { marginTop: 14, gap: 6 },
    join: { marginBottom: 0 },
    metaText: {
      fontFamily: fonts.medium,
      fontSize: 13,
      color: colors.textSoft,
    },
    chip: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      borderRadius: radii.pill,
      paddingHorizontal: 9,
      paddingVertical: 3,
    },
    teamChip: { backgroundColor: colors.accentSoft },
    progressChip: { backgroundColor: colors.surfaceMuted },
    chipText: { fontFamily: fonts.semibold, fontSize: 11 },
    notes: { ...shared.body, marginTop: 12 },
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
      lineHeight: 18,
      color: colors.accent,
    },
    statusRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
      marginBottom: 18,
    },
    statusRowCompact: { marginBottom: 12, gap: 6 },
    statusChip: {
      flexGrow: 1,
      flexBasis: "45%",
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 7,
      minHeight: 44,
      borderRadius: radii.input,
      borderWidth: 1.5,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      paddingHorizontal: 10,
    },
    statusChipCompact: { flexBasis: "auto", minHeight: 36, flexGrow: 0 },
    statusDot: { width: 8, height: 8, borderRadius: 4 },
    statusText: {
      fontFamily: fonts.semibold,
      fontSize: 13,
      color: colors.textSoft,
    },
    progressCard: { gap: 12 },
    progressTop: { flexDirection: "row", alignItems: "baseline" },
    bigPercent: {
      marginLeft: "auto",
      fontFamily: fonts.display,
      fontSize: 26,
      letterSpacing: -0.6,
    },
    progressHint: { marginTop: -2 },
    segments: { flexDirection: "row", gap: 6 },
    segment: {
      flex: 1,
      minHeight: 40,
      borderRadius: 10,
      borderWidth: 1.5,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      alignItems: "center",
      justifyContent: "center",
    },
    stepper: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 16,
    },
    stepperButton: {
      minWidth: 64,
      minHeight: 40,
      borderRadius: 10,
      borderWidth: 1.5,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      alignItems: "center",
      justifyContent: "center",
    },
    stepperText: {
      fontFamily: fonts.semibold,
      fontSize: 13,
      color: colors.textSoft,
    },
    stepperValue: {
      minWidth: 48,
      textAlign: "center",
      fontFamily: fonts.semibold,
      fontSize: 15,
      color: colors.text,
    },
    faded: { opacity: 0.45 },
    stepTitle: { flex: 1, paddingVertical: 4 },
    stepRename: { flex: 1, minHeight: 40, paddingVertical: 8 },
    segmentText: {
      fontFamily: fonts.semibold,
      fontSize: 12,
      color: colors.muted,
    },
    cardHeading: {
      flexDirection: "row",
      alignItems: "center",
      marginBottom: 10,
    },
    counter: {
      marginLeft: "auto",
      fontFamily: fonts.semibold,
      fontSize: 12,
      color: colors.muted,
      backgroundColor: colors.surfaceMuted,
      borderRadius: 6,
      overflow: "hidden",
      paddingHorizontal: 8,
      paddingVertical: 2,
    },
    gapBelow: { marginBottom: 12 },
    step: { flexDirection: "row", alignItems: "center", minHeight: 46 },
    stepDivider: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    stepMain: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      paddingVertical: 10,
    },
    check: {
      width: 22,
      height: 22,
      borderRadius: 7,
      borderWidth: 1.5,
      borderColor: colors.checkBorder,
      backgroundColor: colors.surface,
      alignItems: "center",
      justifyContent: "center",
    },
    checked: { backgroundColor: colors.accent, borderColor: colors.accent },
    stepText: {
      flex: 1,
      fontFamily: fonts.medium,
      fontSize: 15,
      lineHeight: 20,
      color: colors.text,
    },
    stepDone: { color: colors.faint, textDecorationLine: "line-through" },
    trash: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: "center",
      justifyContent: "center",
    },
    trashPressed: { backgroundColor: colors.dangerSoft },
    addRow: { flexDirection: "row", gap: 8, marginTop: 10 },
    addInput: { flex: 1, minHeight: 44, paddingVertical: 10 },
    addButton: {
      width: 44,
      height: 44,
      borderRadius: radii.input,
      backgroundColor: colors.accent,
      alignItems: "center",
      justifyContent: "center",
    },
    fill: { flex: 1 },
    footer: {
      backgroundColor: colors.background,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
      paddingHorizontal: spacing.page,
      paddingTop: 10,
      paddingBottom: 10,
    },
    footerRow: { flexDirection: "row", alignItems: "flex-end", gap: 8 },
    /** Grows to five lines of 21 pt, then scrolls inside. */
    noteInput: {
      flex: 1,
      minHeight: 50,
      maxHeight: 21 * 5 + 26,
      lineHeight: 21,
    },
    composerLabel: { marginTop: 0 },
    send: {
      width: 50,
      height: 50,
      borderRadius: 25,
      backgroundColor: colors.accent,
      alignItems: "center",
      justifyContent: "center",
    },
    update: { flexDirection: "row", gap: 12, paddingVertical: 12 },
    avatar: {
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: colors.accentSoft,
      alignItems: "center",
      justifyContent: "center",
    },
    avatarText: { fontFamily: fonts.bold, fontSize: 14, color: colors.accent },
    updateTop: { flexDirection: "row", alignItems: "baseline", gap: 8 },
    author: {
      flexShrink: 1,
      fontFamily: fonts.semibold,
      fontSize: 14,
      color: colors.text,
    },
    updateBody: { ...shared.body, marginTop: 3 },
    changes: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 },
  }),
);
