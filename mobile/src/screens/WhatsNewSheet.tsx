import React, { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import {
  CHANGELOG,
  CHANGELOG_HEADINGS,
  CHANGELOG_SECTIONS,
  latestRelease,
  releaseDate,
  type ChangelogRelease,
  type ChangelogSection,
} from "@orbyn/core";
import { Icon } from "../components/Icon";
import { Segmented } from "../components/Segmented";
import { Sheet, sheetStyles } from "../components/Sheet";
import { readLocal, saveLocal } from "../lib/localPrefs";
import { Pressable } from "../motion";
import { colors, controls, fonts, radii, themed } from "../theme";

const SEEN_KEY = "orbyn-whats-new-seen";

/** The newest release this phone has shown, or null before the first. */
export const seenRelease = () => readLocal(SEEN_KEY);
export const markReleaseSeen = () => saveLocal(SEEN_KEY, latestRelease().date);

type Filter = "all" | ChangelogSection;
const FILTERS: Filter[] = ["all", ...CHANGELOG_SECTIONS];
const FILTER_LABELS: Record<Filter, string> = {
  all: "All",
  new: "New",
  better: "Better",
  fixed: "Fixed",
};
const COUNT_WORDS: Record<ChangelogSection, string> = {
  new: "new",
  better: "better",
  fixed: "fixed",
};

const shownSections = (r: ChangelogRelease, filter: Filter) =>
  CHANGELOG_SECTIONS.filter(
    (k) => r[k].length && (filter === "all" || filter === k),
  );

/** Releases this phone hasn't shown yet, or the newest one. */
const freshIds = () => {
  const seen = seenRelease();
  const fresh = seen ? CHANGELOG.filter((r) => r.date > seen) : [];
  return (fresh.length ? fresh : CHANGELOG.slice(0, 1)).map((r) => r.id);
};

/**
 * What's new (DSN-03): every release, newest first, the same list as the
 * web's changelog. Each folds to its date, title and summary; the ones new
 * since this phone last looked start open, and a filter shows one heading
 * across every release. Opens by itself once after a release, and from
 * Settings.
 */
export function WhatsNewSheet({
  visible,
  onClose,
  onDismiss,
}: {
  visible: boolean;
  onClose: () => void;
  onDismiss?: () => void;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [open, setOpen] = useState<string[]>(freshIds);
  // Each time the sheet opens, start from what is new since last time.
  useEffect(() => {
    if (!visible) return;
    setFilter("all");
    setOpen(freshIds());
  }, [visible]);

  const choose = (next: Filter) => {
    setFilter(next);
    setOpen(
      next === "all"
        ? CHANGELOG.slice(0, 1).map((r) => r.id)
        : CHANGELOG.filter((r) => r[next].length).map((r) => r.id),
    );
  };
  const toggle = (id: string) =>
    setOpen((ids) =>
      ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id],
    );
  const shown = CHANGELOG.filter((r) => shownSections(r, filter).length);

  return (
    <Sheet
      visible={visible}
      title="What's new"
      onClose={() => {
        markReleaseSeen();
        onClose();
      }}
      onDismiss={onDismiss}
    >
      <ScrollView contentContainerStyle={sheetStyles.body}>
        <View style={[sheetStyles.column, s.column]}>
          <Segmented
            options={FILTERS}
            value={filter}
            onChange={choose}
            labels={FILTER_LABELS}
            accessibilityLabel="Show"
          />
          {shown.map((r) => (
            <Release
              key={r.id}
              release={r}
              filter={filter}
              open={open.includes(r.id)}
              onToggle={() => toggle(r.id)}
            />
          ))}
        </View>
      </ScrollView>
    </Sheet>
  );
}

function Release({
  release: r,
  filter,
  open,
  onToggle,
}: {
  release: ChangelogRelease;
  filter: Filter;
  open: boolean;
  onToggle: () => void;
}) {
  const sections = shownSections(r, filter);
  return (
    <View style={s.release}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${r.title}, ${releaseDate(r)}`}
        onPress={onToggle}
        style={({ pressed }) => [s.head, pressed && { opacity: 0.65 }]}
      >
        <View style={s.headText}>
          <Text style={s.date}>{releaseDate(r)}</Text>
          <Text style={s.title} accessibilityRole="header">
            {r.title}
          </Text>
        </View>
        <Icon
          name={open ? "chevronUp" : "chevronDown"}
          size={18}
          color={colors.muted}
        />
      </Pressable>
      <Text style={s.summary}>{r.summary}</Text>
      <View style={s.counts}>
        {sections.map((k) => (
          <View key={k} style={[s.count, k === "new" && s.countNew]}>
            <Text style={[s.countText, k === "new" && s.countTextNew]}>
              {r[k].length} {COUNT_WORDS[k]}
            </Text>
          </View>
        ))}
      </View>
      {open && (
        <View style={s.body}>
          {!!r.highlight && filter === "all" && (
            <View style={s.highlight}>
              <Icon name="sparkles" size={16} color={colors.accent} />
              <Text style={s.highlightText}>{r.highlight}</Text>
            </View>
          )}
          {sections.map((k) => (
            <View key={k} style={s.part}>
              <Text style={s.heading}>{CHANGELOG_HEADINGS[k]}</Text>
              {r[k].map((line) => (
                <View key={line} style={s.line}>
                  <Text style={s.bullet}>•</Text>
                  <Text style={s.text}>{line}</Text>
                </View>
              ))}
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const s = themed(() =>
  StyleSheet.create({
    column: { gap: 12 },
    release: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.card,
      backgroundColor: colors.surface,
      padding: 16,
    },
    head: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      minHeight: controls.tap,
    },
    headText: { flex: 1, minWidth: 0, gap: 2 },
    date: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted },
    title: { fontFamily: fonts.display, fontSize: 18, color: colors.text },
    summary: {
      marginTop: 6,
      fontFamily: fonts.regular,
      fontSize: 15,
      lineHeight: 22,
      color: colors.textSoft,
    },
    counts: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 10 },
    count: {
      borderRadius: radii.pill,
      paddingHorizontal: 10,
      paddingVertical: 3,
      backgroundColor: colors.surfaceMuted,
    },
    countNew: { backgroundColor: colors.accentSoft },
    countText: {
      fontFamily: fonts.semibold,
      fontSize: 11,
      color: colors.muted,
    },
    countTextNew: { color: colors.accent },
    body: {
      marginTop: 14,
      paddingTop: 4,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    highlight: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 10,
      marginTop: 12,
      padding: 12,
      borderRadius: radii.input,
      backgroundColor: colors.soft,
    },
    highlightText: {
      flex: 1,
      fontFamily: fonts.regular,
      fontSize: 15,
      lineHeight: 22,
      color: colors.text,
    },
    part: { gap: 6, marginTop: 14 },
    heading: {
      fontFamily: fonts.semibold,
      fontSize: 13,
      color: colors.textSoft,
    },
    line: { flexDirection: "row", gap: 8 },
    bullet: { fontSize: 15, lineHeight: 22, color: colors.muted },
    text: {
      flex: 1,
      fontFamily: fonts.regular,
      fontSize: 15,
      lineHeight: 22,
      color: colors.text,
    },
  }),
);
