import React, { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { docPreview, type DraftNote } from "@orbyn/core";
import { Button } from "./Button";
import { SmallAction } from "./SmallAction";
import { client } from "../lib/api";
import { colors, fonts, radii, themed } from "../theme";

/**
 * Notes the assistant has drafted, waiting for someone to keep them.
 *
 * Shown as themselves — title, length, the start of what they say — because
 * the decision is whether this is worth keeping. Nothing is written until
 * Keep is pressed.
 */
export function DraftNotes({
  notes,
  onKept,
  report,
}: {
  notes: DraftNote[];
  onKept?: (docId: string) => void;
  report: (e: unknown) => void;
}) {
  const [kept, setKept] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  if (!notes.length) return null;

  const keep = (draft: DraftNote, at: number) => {
    setBusy(true);
    client
      .createDoc({
        title: draft.title,
        kind: "note",
        content: draft.content,
        project_id: draft.project_id,
        item_id: draft.item_id,
        team_id: draft.team_id,
      })
      .then((doc) => {
        setKept((all) => ({ ...all, [at]: doc.id }));
        onKept?.(doc.id);
      })
      .catch(report)
      .finally(() => setBusy(false));
  };

  return (
    <View style={s.wrap}>
      {notes.map((draft, at) => (
        <View key={at} style={s.card}>
          <Text style={s.title}>{draft.title || "Untitled"}</Text>
          {!!draft.project_name && (
            <Text style={s.where}>{draft.project_name}</Text>
          )}
          <Text style={s.preview}>{docPreview(draft.content, 180)}</Text>
          {!!draft.note && <Text style={s.why}>{draft.note}</Text>}
          <View style={s.actions}>
            <Text style={s.lines}>
              {draft.content.length} line{draft.content.length === 1 ? "" : "s"}
            </Text>
            {kept[at] ? (
              <SmallAction
                label="Kept — open it"
                disabled={false}
                onPress={() => onKept?.(kept[at])}
              />
            ) : (
              <Button
                title="Keep this note"
                disabled={busy}
                onPress={() => keep(draft, at)}
              />
            )}
          </View>
        </View>
      ))}
    </View>
  );
}

const s = themed(() =>
  StyleSheet.create({
    wrap: { gap: 8, marginTop: 8 },
    card: {
      gap: 6,
      padding: 12,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.card,
      backgroundColor: colors.surface,
    },
    title: { color: colors.text, fontSize: 15, fontFamily: fonts.semibold },
    where: { color: colors.accent, fontSize: 12 },
    preview: { color: colors.muted, fontSize: 13, lineHeight: 19 },
    why: { color: colors.muted, fontSize: 12, fontStyle: "italic" },
    actions: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 10,
      flexWrap: "wrap",
    },
    lines: { color: colors.muted, fontSize: 12 },
  }),
);
