import React, { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { ReentryBrief, ReentryLine } from "@orbyn/core";
import { SmallAction } from "../SmallAction";
import { client } from "../../lib/api";
import { Pressable } from "../../motion";
import { colors, fonts, radii, themed } from "../../theme";
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
  const dismissing = useRef(false);
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    client.reentry().then(
      (value) => {
        if (alive) setBrief(value);
      },
      () => {},
    );
    return () => {
      alive = false;
    };
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
            {brief.days_away} {brief.days_away === 1 ? "day" : "days"} away
          </Text>
        </View>
        <SmallAction
          label="Got it"
          disabled={busy}
          onPress={() => {
            if (dismissing.current) return;
            dismissing.current = true;
            setBusy(true);
            setError("");
            void client.dismissReentry().then(
              () => setBrief(null),
              () => {
                setError("Could not dismiss. Try again.");
                dismissing.current = false;
                setBusy(false);
              },
            );
          }}
        />
      </View>
      {sections.map((sct) => (
        <View key={sct.key} style={s.section}>
          <Text style={[shared.eyebrow, s.sectionLabel]}>
            {sct.label} · {sct.lines.length}
          </Text>
          {(expanded ? sct.lines : sct.lines.slice(0, 3)).map((l, n) => (
            <Pressable
              key={n}
              accessibilityRole="button"
              accessibilityLabel={`${l.title}. ${l.detail}`}
              onPress={() => open(l)}
              style={({ pressed }) => [s.line, pressed && s.pressed]}
            >
              <Text style={s.lineTitle}>{l.title}</Text>
              <Text style={shared.small}>{l.detail}</Text>
            </Pressable>
          ))}
        </View>
      ))}
      {sections.some((section) => section.lines.length > 3) && (
        <SmallAction
          label={expanded ? "Show less" : "Show all updates"}
          disabled={busy}
          onPress={() => setExpanded(!expanded)}
        />
      )}
      {!!error && (
        <Text style={shared.small} accessibilityRole="alert">
          {error}
        </Text>
      )}
    </View>
  );
}

const s = themed(() =>
  StyleSheet.create({
    card: { gap: 10, marginTop: 14 },
    head: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
    title: { fontFamily: fonts.bold, fontSize: 16, color: colors.text },
    section: { gap: 2, marginTop: 4 },
    sectionLabel: { marginBottom: 2 },
    line: { paddingVertical: 10, minHeight: 44, borderRadius: radii.input },
    pressed: { backgroundColor: colors.surfaceMuted },
    lineTitle: { fontFamily: fonts.medium, fontSize: 13, color: colors.text },
  }),
);
