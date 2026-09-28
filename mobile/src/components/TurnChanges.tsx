import React, { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { AgentActivity } from "@orbyn/core";
import { openAppUrl } from "../hooks/useAppLinks";
import { errorText } from "../lib/errors";
import { PressableScale } from "../motion";
import { colors, controls, fonts, radii, themed } from "../theme";
import { CONCEPT_ICON, Icon } from "./Icon";
import { SmallAction } from "./SmallAction";

const SHOWN = 8;

/**
 * What one assistant reply changed directly, with Undo for all of it. The
 * list is the assistant's own activity for the reply's job.
 */
export function TurnChanges({
  job,
  load,
  undo,
}: {
  job: string;
  load: (job: string) => Promise<AgentActivity[]>;
  undo: (job: string) => Promise<number>;
}) {
  const [changes, setChanges] = useState<AgentActivity[] | null>(null);
  const [undoing, setUndoing] = useState(false);
  const [undone, setUndone] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    load(job).then(
      (list) => live && setChanges(list),
      () => live && setChanges([]),
    );
    return () => {
      live = false;
    };
  }, [job]);
  if (!changes?.length) return null;
  const wasUndone = undone || changes.every((c) => c.undone_at);
  const canUndo = !wasUndone && changes.some((c) => c.undoable);
  const run = async () => {
    setUndoing(true);
    setError("");
    try {
      await undo(job);
      setUndone(true);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setUndoing(false);
    }
  };
  return (
    <View style={s.box} accessibilityLabel="What this reply changed">
      <View style={s.head}>
        <Text style={s.title}>Changed</Text>
        {wasUndone ? (
          <Text style={s.done} accessibilityLiveRegion="polite">
            Undone
          </Text>
        ) : (
          canUndo && (
            <SmallAction
              label={undoing ? "Undoing…" : "Undo"}
              disabled={undoing}
              onPress={() => void run()}
            />
          )
        )}
      </View>
      {changes.slice(0, SHOWN).map((change) => (
        <View key={change.id} style={s.row}>
          <Text style={s.text}>• {change.summary}</Text>
          {!!change.links?.length && (
            <View style={s.links}>
              {change.links.map((l) => (
                <PressableScale
                  key={`${l.kind}:${l.id}`}
                  accessibilityRole="link"
                  accessibilityLabel={`Open ${l.title || "Untitled"}`}
                  hitSlop={{ top: 5, bottom: 5 }}
                  onPress={() => openAppUrl(`orbyn://${l.kind}/${l.id}`)}
                  style={s.link}
                >
                  <Icon
                    name={CONCEPT_ICON[l.kind === "doc" ? "page" : l.kind]}
                    size={13}
                    color={colors.accent}
                  />
                  <Text style={s.linkText} numberOfLines={1}>
                    {l.title || "Untitled"}
                  </Text>
                </PressableScale>
              ))}
            </View>
          )}
        </View>
      ))}
      {changes.length > SHOWN && (
        <Text style={s.text}>and {changes.length - SHOWN} more</Text>
      )}
      {!!error && (
        <Text accessibilityRole="alert" style={s.error}>
          {error}
        </Text>
      )}
    </View>
  );
}

const s = themed(() =>
  StyleSheet.create({
    box: {
      marginTop: 8,
      paddingTop: 8,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
      gap: 6,
    },
    head: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 12,
    },
    title: { fontFamily: fonts.medium, fontSize: 13, color: colors.text },
    done: { fontFamily: fonts.medium, fontSize: 13, color: colors.textSoft },
    row: { gap: 4 },
    text: {
      fontFamily: fonts.regular,
      fontSize: 13,
      lineHeight: 18,
      color: colors.textSoft,
    },
    links: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
    link: {
      minHeight: controls.tap - 10,
      maxWidth: "100%",
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      paddingVertical: 6,
      paddingHorizontal: 12,
      borderRadius: radii.pill,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    linkText: {
      flexShrink: 1,
      fontFamily: fonts.medium,
      fontSize: 13,
      color: colors.accent,
    },
    error: { fontFamily: fonts.medium, fontSize: 13, color: colors.danger },
  }),
);
