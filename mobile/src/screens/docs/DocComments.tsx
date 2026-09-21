import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors, fonts, themed } from "../../theme";
import { DocThread } from "./DocThread";
import type { DocCommentsState } from "./useDocComments";

/**
 * Remarks about the page as a whole, and remarks whose line has since gone.
 *
 * Remarks about a line are not here: on a phone they are shown under the
 * line they are about, which is as close to a margin as a narrow screen
 * gets. What is left is everything with nowhere else to be — including
 * comments whose line was deleted, which keep the words they were written
 * about so they still read.
 */
export function DocComments({
  state,
  userId,
}: {
  state: DocCommentsState;
  userId?: string;
}) {
  if (state.loading)
    return (
      <View style={styles.section}>
        <Text style={styles.empty}>Loading…</Text>
      </View>
    );

  return (
    <View style={styles.section}>
      <Text style={styles.title}>On the page</Text>

      {state.loose.length === 0 && (
        <Text style={styles.empty}>
          No comments about the page as a whole. To remark on one line, open it
          and choose Comment.
        </Text>
      )}

      {state.loose.map((c) => (
        <DocThread
          key={c.id}
          comments={[c]}
          state={state}
          userId={userId}
          quote={c.quote}
          placeholder="Reply…"
        />
      ))}

      <DocThread
        comments={[]}
        state={state}
        userId={userId}
        placeholder="Comment on the whole page…"
      />

      {state.resolvedCount > 0 && (
        <Pressable
          onPress={() => state.setShowResolved(!state.showResolved)}
          accessibilityRole="button"
        >
          <Text style={styles.toggle}>
            {state.showResolved ? "Hide" : "Show"} {state.resolvedCount}{" "}
            resolved
          </Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    section: {
      gap: 12,
      marginTop: 18,
      paddingTop: 14,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    title: { color: colors.text, fontSize: 15, fontFamily: fonts.semibold },
    toggle: { color: colors.accent, fontSize: 13, fontFamily: fonts.semibold },
    empty: { color: colors.muted, fontSize: 13, lineHeight: 19 },
  }),
);
