import React from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import {
  CHANGELOG,
  CHANGELOG_HEADINGS,
  latestRelease,
  releaseDate,
} from "@orbyn/core";
import { Sheet, sheetStyles } from "../components/Sheet";
import { readLocal, saveLocal } from "../lib/localPrefs";
import { colors, fonts, themed } from "../theme";

const SEEN_KEY = "orbyn-whats-new-seen";

/** The newest release this phone has shown, or null before the first. */
export const seenRelease = () => readLocal(SEEN_KEY);
export const markReleaseSeen = () => saveLocal(SEEN_KEY, latestRelease().date);

const SECTIONS = ["new", "better", "fixed"] as const;

/**
 * What's new (DSN-03): each release with its date and the headings New,
 * Better and No longer broken, one sentence each — the same list as the
 * web's changelog. Opens by itself once after a release, and from Settings.
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
          {CHANGELOG.map((r) => (
            <View key={r.date} style={s.release}>
              <Text style={s.date}>{releaseDate(r)}</Text>
              <Text style={s.title} accessibilityRole="header">
                {r.title}
              </Text>
              {SECTIONS.filter((k) => r[k].length).map((k) => (
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
          ))}
        </View>
      </ScrollView>
    </Sheet>
  );
}

const s = themed(() =>
  StyleSheet.create({
    column: { gap: 28 },
    release: { gap: 4 },
    date: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted },
    title: {
      fontFamily: fonts.display,
      fontSize: 18,
      color: colors.text,
      marginBottom: 4,
    },
    part: { gap: 6, marginTop: 8 },
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
