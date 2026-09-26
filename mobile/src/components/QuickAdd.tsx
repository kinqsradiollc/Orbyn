import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  describeRrule,
  parseQuickAdd,
  type Item,
  type QuickAddChip,
} from "@orbyn/core";
import { ErrorBanner } from "./ErrorBanner";
import { Icon, type IconName } from "./Icon";
import { SmallAction } from "./SmallAction";
import { client } from "../lib/api";
import {
  clockDisplay,
  deviceTimeZone,
  minutesLabel,
  shortDay,
} from "../lib/planning";
import { usePlanning } from "../lib/planningContext";
import { useRun } from "../hooks/useRun";
import { FadeIn, PressableScale } from "../motion";
import { colors, fonts, radii, themed } from "../theme";
import { shared } from "../styles";

const CHIP_ICONS: Record<QuickAddChip["kind"], IconName> = {
  kind: "sparkles",
  date: "calendar",
  time: "clock",
  duration: "clock",
  estimate: "target",
  all_day: "sun",
  location: "mapPin",
  person: "users",
  list: "list",
  tag: "tag",
  priority: "alert",
  repeat: "repeat",
  habit: "repeat",
};

/** What a recognised part of the text means, in words. */
function chipText(chip: QuickAddChip) {
  switch (chip.kind) {
    case "kind":
      return chip.value === "event"
        ? "Event"
        : chip.value === "habit"
          ? "Habit"
          : "Task";
    case "date": {
      const [y, m, d] = chip.value.split("-").map(Number);
      return y && m && d ? shortDay(new Date(y, m - 1, d)) : chip.text;
    }
    case "time":
      return chip.value.split("-").map(clockDisplay).join(" – ");
    case "duration":
      return `For ${minutesLabel(Number(chip.value)) || chip.text}`;
    case "estimate":
      return `About ${minutesLabel(Number(chip.value)) || chip.text}`;
    case "all_day":
      return "All day";
    case "priority":
      return `${chip.value.charAt(0).toUpperCase()}${chip.value.slice(1)} priority`;
    case "location":
      return chip.value || chip.text;
    case "repeat":
      return describeRrule(chip.value);
    case "habit":
      return chip.value;
    default:
      return chip.text;
  }
}

/**
 * Add a task or event in one line ("Lunch with @anna tomorrow 1pm ;Cafe
 * Roma"). What's recognised shows as chips while typing (the same parser the
 * server uses, no AI); Add creates it straight away. Anything it can't make
 * sense of can go to the assistant instead.
 */
export function QuickAdd({
  userId,
  onCreated,
  onAsk,
  prefill,
}: {
  userId?: string;
  /**
   * Words from a link (orbyn://add?text=…): put in the box to check and
   * add with a tap, never added on their own. A new `key` fills it again.
   */
  prefill?: { text: string; key: number } | null;
  /** The item it made, or null when the text made a habit. */
  onCreated: (item: Item | null) => void;
  /** Hand the text to the assistant. */
  onAsk: (text: string) => void;
}) {
  const { lists, tags } = usePlanning();
  const { busy, error, setError, run } = useRun();
  const [text, setText] = useState("");
  const field = useRef<TextInput>(null);
  useEffect(() => {
    if (!prefill) return;
    setText(prefill.text.slice(0, 500));
    field.current?.focus();
  }, [prefill?.key]); // eslint-disable-line react-hooks/exhaustive-deps
  const zone = deviceTimeZone();
  const parsed = useMemo(() => {
    if (!text.trim()) return null;
    try {
      return parseQuickAdd(text, {
        timeZone: zone,
        lists: lists.map((l) => ({
          id: l.id,
          name: l.name,
          team_id: l.team_id,
        })),
        tags: tags.map((t) => ({ id: t.id, name: t.name, team_id: t.team_id })),
        selfId: userId,
      });
    } catch {
      return null;
    }
  }, [text, zone, lists, tags, userId]);
  const title = parsed?.input.title.trim() ?? "";
  const canAdd = !!title && !busy;

  const submit = () => {
    if (!canAdd) return;
    void run(async () => {
      const created = await client.quickAdd(text.trim(), zone);
      setText("");
      AccessibilityInfo.announceForAccessibility(
        created.item
          ? `Added ${created.item.title}`
          : `Added the habit ${created.habit.name}. Planning finds time for it.`,
      );
      onCreated(created.item);
    });
  };

  return (
    <View style={[shared.card, s.card]}>
      <View style={s.row}>
        <TextInput
          ref={field}
          style={[shared.input, s.input]}
          value={text}
          onChangeText={setText}
          placeholder="Add anything: lunch with Anna tomorrow 1pm"
          placeholderTextColor={colors.faint}
          returnKeyType="done"
          submitBehavior="blurAndSubmit"
          onSubmitEditing={submit}
          maxLength={500}
          accessibilityLabel="Quick add"
          accessibilityHint="Type a task or event in your own words. Dates, times and places are picked up as you type."
        />
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel="Add"
          accessibilityState={{ disabled: !canAdd }}
          disabled={!canAdd}
          onPress={submit}
          style={({ pressed }) => [
            s.add,
            pressed && { backgroundColor: colors.accentPressed },
            !canAdd && { opacity: 0.4 },
          ]}
        >
          <Icon name="plus" size={18} color={colors.white} strokeWidth={2.2} />
        </PressableScale>
      </View>
      {parsed && (
        <FadeIn style={s.preview}>
          <Text style={shared.small} numberOfLines={2}>
            {title
              ? `Adds ${parsed.habit ? "a habit" : parsed.input.kind === "event" ? "an event" : "a task"}: “${title}”`
              : "Add a few words for the title."}
          </Text>
          {parsed.chips.length > 0 && (
            <View style={s.chips}>
              {parsed.chips.map((chip, n) => (
                <View key={`${chip.kind}-${n}`} style={s.chip}>
                  <Icon
                    name={CHIP_ICONS[chip.kind]}
                    size={11}
                    color={colors.accent}
                  />
                  <Text style={s.chipText} numberOfLines={1}>
                    {chipText(chip)}
                  </Text>
                </View>
              ))}
            </View>
          )}
          <View style={s.actions}>
            <SmallAction
              label="Ask the assistant instead"
              disabled={busy}
              onPress={() => {
                onAsk(text.trim());
                setText("");
              }}
            />
          </View>
        </FadeIn>
      )}
      <ErrorBanner error={error} onDismiss={() => setError("")} />
    </View>
  );
}

const s = themed(() =>
  StyleSheet.create({
    card: { padding: 12 },
    row: { flexDirection: "row", alignItems: "center", gap: 8 },
    input: { flex: 1, minHeight: 46, paddingVertical: 11 },
    add: {
      width: 46,
      height: 46,
      borderRadius: radii.input,
      backgroundColor: colors.accent,
      alignItems: "center",
      justifyContent: "center",
    },
    preview: { marginTop: 10, gap: 8 },
    chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
    chip: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      maxWidth: "100%",
      backgroundColor: colors.accentSoft,
      borderRadius: radii.pill,
      paddingHorizontal: 9,
      paddingVertical: 4,
    },
    chipText: {
      flexShrink: 1,
      fontFamily: fonts.semibold,
      fontSize: 12,
      color: colors.accent,
    },
    actions: { flexDirection: "row" },
  }),
);
