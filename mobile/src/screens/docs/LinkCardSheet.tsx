import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  addDays,
  itemBody,
  localDateKey,
  viewDueChange,
  type LinkCard,
  type ObjectRef,
} from "@orbyn/core";
import { BottomSheet } from "../../components/BottomSheet";
import { DateTimeControl } from "../../components/DateTimeControl";
import { Icon } from "../../components/Icon";
import { ProgressBar } from "../../components/ProgressBar";
import { client } from "../../lib/api";
import { deviceTimeZone } from "../../lib/planning";
import { colors, controls, fonts, radii, themed } from "../../theme";
import { openObject } from "./links";

/**
 * A link's card on the phone (LNK-07): a long press on a link pill opens it
 * as a half sheet, with what the thing is and the few things worth doing
 * from the page — tick a task, give it a new deadline, open it.
 */

const when = (iso: string, allDay = false) => {
  const d = new Date(iso);
  const day = d.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
  return allDay
    ? day
    : `${day} ${d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
};
const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });
const duration = (minutes: number) => {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return [h ? `${h}h` : "", m ? `${m}m` : ""].filter(Boolean).join(" ");
};

export function LinkCardSheet({
  target,
  onClose,
  onChanged,
  report,
}: {
  /** What was pressed; null when the sheet is put away. */
  target: ObjectRef | null;
  onClose: () => void;
  /** Something was ticked or moved: the page's pills read afresh. */
  onChanged: () => void;
  report: (e: unknown) => void;
}) {
  const [card, setCard] = useState<LinkCard | null>(null);
  const [picking, setPicking] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const kind =
    target &&
    (target.kind === "doc" ||
      target.kind === "task" ||
      target.kind === "event" ||
      target.kind === "project")
      ? target.kind
      : null;
  const load = () => {
    if (!target || !kind) return;
    client
      .linkCard({ kind, id: target.id, block: target.block })
      .then(setCard, report);
  };
  useEffect(() => {
    setCard(null);
    setPicking(false);
    setNote("");
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.kind, target?.id, target?.block]);

  const run = (work: () => Promise<unknown>, said?: string) => {
    setBusy(true);
    setNote("");
    void work()
      .then(() => {
        if (said) setNote(said);
        load();
        onChanged();
      })
      .catch((e) => {
        const message = e instanceof Error ? e.message : "";
        if (message) setNote(message);
        else report(e);
      })
      .finally(() => setBusy(false));
  };
  const tick = () =>
    card &&
    run(() =>
      client.postItemUpdate(card.id, { status: card.done ? "todo" : "done" }),
    );
  /** Your account's time zone, as views use (the device's until the card is here). */
  const zone = card?.time_zone ?? deviceTimeZone();
  const moveTo = (day: string | null) =>
    card &&
    run(
      async () => {
        const item = await client.getItem(card.id);
        const moved = viewDueChange(item, day, zone);
        if (!moved.ok) throw new Error(moved.reason);
        await client.updateItem(card.id, {
          ...itemBody(item),
          ...moved.change,
        });
        setPicking(false);
      },
      day ? "Deadline moved." : "Deadline cleared.",
    );
  const today = localDateKey(new Date(), zone);
  const open = () => {
    if (!target) return;
    onClose();
    // A merged page opens the page it went into.
    openObject(card?.moved_from ? { ...target, id: card.id } : target);
  };
  const openNote = () =>
    card &&
    run(async () => {
      const doc = card.note_id
        ? { id: card.note_id }
        : await client.itemNote(card.id);
      onClose();
      openObject({ kind: "doc", id: doc.id });
    });

  const rows: string[] = [];
  if (card?.state === "ok") {
    if (card.kind === "task") {
      rows.push(
        card.due_at ? `Due ${when(card.due_at, card.all_day)}` : "No deadline",
      );
      if (card.estimate_minutes)
        rows.push(`Estimate ${duration(card.estimate_minutes)}`);
      if (card.project) rows.push(card.project.name);
      if (card.planned)
        rows.push(
          `Planned ${when(card.planned.start_at)}–${clock(card.planned.end_at)}`,
        );
    } else if (card.kind === "event") {
      if (card.start_at)
        rows.push(
          when(card.start_at, card.all_day) +
            (card.end_at && !card.all_day ? `–${clock(card.end_at)}` : ""),
        );
      if (card.project) rows.push(card.project.name);
    } else if (card.kind === "doc") {
      if (card.moved_from) rows.push("That page was merged into this one.");
      rows.push(
        [card.kind_label, card.folder, card.project?.name]
          .filter(Boolean)
          .join(" · "),
      );
      if (card.section !== undefined)
        rows.push(
          card.section === null
            ? "The line this pointed at has gone."
            : `At “${card.section}”`,
        );
    } else if (card.kind === "project" && card.progress) {
      rows.push(`${card.progress.done} of ${card.progress.total} tasks done`);
      if (card.next)
        rows.push(
          `Next: ${card.next.title}${card.next.due_at ? ` · ${when(card.next.due_at)}` : ""}`,
        );
      if (card.deadline) rows.push(`Latest date ${when(card.deadline, true)}`);
    }
  }

  return (
    <BottomSheet
      visible={!!target && !!kind}
      label="Link"
      onClose={onClose}
      footer={
        card?.state === "ok" ? (
          <View style={s.actions}>
            {card.kind === "task" && card.can_write && (
              <>
                <Action
                  label={card.done ? "Untick" : "Tick"}
                  disabled={busy}
                  onPress={tick}
                />
                <Action
                  label="Reschedule"
                  on={picking}
                  disabled={busy || !!card.repeats}
                  onPress={() => setPicking((v) => !v)}
                />
              </>
            )}
            {card.kind === "event" && (
              <Action
                label={card.note_id ? "Meeting note" : "Start a note"}
                disabled={busy}
                onPress={openNote}
              />
            )}
            <Action label="Open" primary onPress={open} />
          </View>
        ) : undefined
      }
    >
      {!card ? (
        <Text style={s.muted}>Loading…</Text>
      ) : card.state !== "ok" ? (
        <Text style={s.muted}>
          {card.state === "deleted"
            ? `“${card.title}” is in Trash.`
            : "This isn't there, or isn't yours to open."}
        </Text>
      ) : (
        <View style={s.body}>
          <View style={s.head}>
            {card.kind === "task" ? (
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{
                  checked: !!card.done,
                  disabled: !card.can_write,
                }}
                accessibilityLabel={card.done ? "Mark not done" : "Mark done"}
                disabled={!card.can_write || busy}
                hitSlop={12}
                onPress={tick}
                style={[s.check, card.done && s.checkDone]}
              >
                {card.done && (
                  <Icon name="check" size={14} color={colors.white} />
                )}
              </Pressable>
            ) : (
              <Icon
                name={
                  card.kind === "event"
                    ? "calendar"
                    : card.kind === "project"
                      ? "folder"
                      : "fileText"
                }
                size={18}
                color={colors.muted}
              />
            )}
            <Text
              style={[s.title, card.done && s.done]}
              accessibilityRole="header"
            >
              {card.title}
            </Text>
          </View>
          {rows.map((r, i) => (
            <Text key={i} style={s.row}>
              {r}
            </Text>
          ))}
          {card.kind === "project" && card.progress && (
            <ProgressBar
              value={
                card.progress.total
                  ? Math.round((card.progress.done / card.progress.total) * 100)
                  : 0
              }
            />
          )}
          {card.kind === "doc" && !!card.preview && (
            <Text style={s.preview} numberOfLines={4}>
              {card.preview}
            </Text>
          )}
          {card.repeats && card.kind === "task" && (
            <Text style={s.muted}>
              A repeating task's dates change from the task itself.
            </Text>
          )}
          {picking && (
            <View style={s.move}>
              <View style={s.chips}>
                <Action label="Today" onPress={() => moveTo(today)} />
                <Action
                  label="Tomorrow"
                  onPress={() => moveTo(addDays(today, 1))}
                />
                <Action
                  label="Next week"
                  onPress={() => moveTo(addDays(today, 7))}
                />
              </View>
              <DateTimeControl
                mode="date"
                value={card.due_at ? new Date(card.due_at) : new Date()}
                onChange={(_e, date) => {
                  // The picker shows the device's days; the day picked
                  // is then moved to in your account's time zone.
                  if (date) moveTo(localDateKey(date, deviceTimeZone()));
                }}
              />
            </View>
          )}
          {!!note && <Text style={s.note}>{note}</Text>}
        </View>
      )}
    </BottomSheet>
  );
}

function Action({
  label,
  onPress,
  primary = false,
  on = false,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  primary?: boolean;
  on?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled, selected: on }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        s.action,
        on && s.actionOn,
        primary && s.primary,
        pressed && (primary ? s.primaryPressed : s.pressed),
        disabled && { opacity: 0.45 },
      ]}
    >
      <Text style={[s.actionText, primary && s.primaryText]}>{label}</Text>
    </Pressable>
  );
}

const s = themed(() =>
  StyleSheet.create({
    body: { gap: 6 },
    head: { flexDirection: "row", alignItems: "center", gap: 10 },
    title: {
      flex: 1,
      color: colors.text,
      fontFamily: fonts.semibold,
      fontSize: 18,
    },
    done: { color: colors.muted, textDecorationLine: "line-through" },
    row: { color: colors.textSoft, fontSize: 15, lineHeight: 22 },
    preview: { color: colors.muted, fontSize: 13, lineHeight: 19 },
    muted: { color: colors.muted, fontSize: 13, lineHeight: 19 },
    note: { color: colors.textSoft, fontSize: 13 },
    move: { gap: 10, marginTop: 6 },
    chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    check: {
      width: 22,
      height: 22,
      borderRadius: radii.check,
      borderWidth: 1.5,
      borderColor: colors.checkBorder,
      alignItems: "center",
      justifyContent: "center",
    },
    checkDone: { backgroundColor: colors.accent, borderColor: colors.accent },
    actions: { flexDirection: "row", gap: 8 },
    action: {
      flex: 1,
      minHeight: controls.tap,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 12,
      borderRadius: radii.pill,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    actionOn: {
      backgroundColor: colors.accentSoft,
      borderColor: colors.accent,
    },
    pressed: { backgroundColor: colors.surfaceMuted },
    primary: { backgroundColor: colors.accent, borderColor: colors.accent },
    primaryPressed: { backgroundColor: colors.accentPressed },
    actionText: { color: colors.text, fontFamily: fonts.medium, fontSize: 13 },
    primaryText: { color: colors.white },
  }),
);
