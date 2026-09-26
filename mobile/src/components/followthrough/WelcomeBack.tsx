import React, { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { ReentryBrief, ReentryLine } from "@orbyn/core";
import { SmallAction } from "../SmallAction";
import { client } from "../../lib/api";
import { animateLayout, Pressable } from "../../motion";
import { colors, fonts, themed } from "../../theme";
import { shared } from "../../styles";

const SECTIONS: { key: keyof ReentryBrief; label: string }[] = [
  { key: "asks", label: "Waiting for your answer" },
  { key: "assigned", label: "Handed to you" },
  { key: "due", label: "Due now" },
  { key: "changed", label: "Moved on your tasks" },
  { key: "mentions", label: "You were mentioned" },
  { key: "pages", label: "Pages that changed" },
];

/**
 * Back after a few days away: what happened meanwhile, most pressing first,
 * a few lines each. "Got it" puts it away.
 */
export function WelcomeBack({
  onOpenItem,
  onOpenDoc,
  onOpenAsks,
}: {
  onOpenItem: (itemId: string) => void;
  onOpenDoc: (docId: string) => void;
  onOpenAsks: () => void;
}) {
  const [brief, setBrief] = useState<ReentryBrief | null>(null);
  useEffect(() => {
    client.reentry().then(setBrief, () => setBrief(null));
  }, []);
  if (!brief) return null;
  const sections = SECTIONS.map((sct) => ({
    ...sct,
    lines: brief[sct.key] as ReentryLine[],
  })).filter((sct) => sct.lines.length);
  const open = (l: ReentryLine) =>
    l.ask_id
      ? onOpenAsks()
      : l.item_id
        ? onOpenItem(l.item_id)
        : l.doc_id
          ? onOpenDoc(l.doc_id)
          : undefined;
  return (
    <View style={[shared.card, s.card]}>
      <View style={s.head}>
        <View style={{ flex: 1 }}>
          <Text style={s.title} accessibilityRole="header">
            Welcome back
          </Text>
          <Text style={shared.small}>
            You were away {brief.days_away}{" "}
            {brief.days_away === 1 ? "day" : "days"}.
            {sections.length ? " Here's what happened." : " Nothing needs you."}
          </Text>
        </View>
        <SmallAction
          label="Got it"
          disabled={false}
          onPress={() => {
            animateLayout();
            setBrief(null);
            void client.dismissReentry().catch(() => {});
          }}
        />
      </View>
      {sections.map((sct) => (
        <View key={sct.key} style={s.section}>
          <Text style={[shared.eyebrow, s.sectionLabel]}>
            {sct.label.toUpperCase()} · {sct.lines.length}
          </Text>
          {sct.lines.slice(0, 3).map((l, n) => (
            <Pressable
              key={n}
              accessibilityRole="button"
              accessibilityLabel={`${l.title}. ${l.detail}`}
              onPress={() => open(l)}
              style={({ pressed }) => [s.line, pressed && s.pressed]}
            >
              <Text style={s.lineTitle} numberOfLines={1}>
                {l.title}
              </Text>
              <Text style={shared.small} numberOfLines={1}>
                {l.detail}
              </Text>
            </Pressable>
          ))}
        </View>
      ))}
    </View>
  );
}

const s = themed(() =>
  StyleSheet.create({
    card: { gap: 10, marginTop: 14 },
    head: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
    title: { fontFamily: fonts.bold, fontSize: 18, color: colors.text },
    section: { gap: 2, marginTop: 4 },
    sectionLabel: { marginBottom: 2 },
    line: { paddingVertical: 6, borderRadius: 8 },
    pressed: { backgroundColor: colors.surfaceMuted },
    lineTitle: { fontFamily: fonts.medium, fontSize: 15, color: colors.text },
  }),
);
