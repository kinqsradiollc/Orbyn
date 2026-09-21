import React, { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { DocSummary } from "@orbyn/core";
import { Button } from "../../components/Button";
import { Icon } from "../../components/Icon";
import { client } from "../../lib/api";
import { colors, fonts, radii, themed } from "../../theme";

const when = (iso: string) =>
  new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });

/**
 * The notes kept about a project, newest first.
 *
 * A note is an ordinary page, so opening one from here opens the same
 * editor as everywhere else — with its comments, its history and everyone
 * else's proposals already on it.
 */
export function ProjectNotes({
  projectId,
  teamId,
  busy,
  report,
  onOpen,
}: {
  projectId: string;
  teamId: string | null;
  busy: boolean;
  report: (e: unknown) => void;
  onOpen: (docId: string) => void;
}) {
  const [notes, setNotes] = useState<DocSummary[] | null>(null);
  const [working, setWorking] = useState(false);

  const load = useCallback(() => {
    client.listDocs({ project: projectId }).then(setNotes, () => setNotes([]));
  }, [projectId]);

  useEffect(() => load(), [load]);

  const create = () => {
    setWorking(true);
    client
      .createDoc({
        title: "",
        kind: "note",
        project_id: projectId,
        team_id: teamId,
        content: [{ type: "paragraph", text: "" }],
      })
      .then((doc) => {
        load();
        onOpen(doc.id);
      })
      .catch(report)
      .finally(() => setWorking(false));
  };

  return (
    <View style={s.wrap}>
      <Text style={s.eyebrow}>NOTES</Text>
      {notes === null ? (
        <Text style={s.empty}>Loading…</Text>
      ) : notes.length === 0 ? (
        <Text style={s.empty}>
          Nothing written down yet. A note here keeps the thinking beside the
          work.
        </Text>
      ) : (
        notes.map((note) => (
          <Pressable
            key={note.id}
            onPress={() => onOpen(note.id)}
            accessibilityRole="button"
            style={({ pressed }) => [s.row, pressed && s.rowPressed]}
          >
            <Icon name="fileText" size={15} color={colors.muted} />
            <View style={s.rowMain}>
              <Text style={s.rowTitle} numberOfLines={1}>
                {note.title || "Untitled"}
              </Text>
              <Text style={s.rowPreview} numberOfLines={1}>
                {note.preview || "Empty note"}
              </Text>
            </View>
            <Text style={s.rowWhen}>{when(note.updated_at)}</Text>
          </Pressable>
        ))
      )}
      <Button
        title="New note here"
        secondary
        disabled={busy || working}
        onPress={create}
      />
    </View>
  );
}

const s = themed(() =>
  StyleSheet.create({
    wrap: {
      gap: 8,
      marginTop: 14,
      padding: 12,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.card,
      backgroundColor: colors.surface,
    },
    eyebrow: {
      color: colors.muted,
      fontSize: 11,
      letterSpacing: 0.8,
      fontFamily: fonts.semibold,
    },
    empty: { color: colors.muted, fontSize: 13, lineHeight: 19 },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      paddingVertical: 8,
      paddingHorizontal: 10,
      borderRadius: radii.input,
      backgroundColor: colors.surfaceMuted,
    },
    rowPressed: { opacity: 0.7 },
    rowMain: { flex: 1, minWidth: 0, gap: 1 },
    rowTitle: { color: colors.text, fontSize: 14, fontFamily: fonts.semibold },
    rowPreview: { color: colors.muted, fontSize: 12 },
    rowWhen: { color: colors.muted, fontSize: 11 },
  }),
);
