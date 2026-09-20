import React, { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { starterDoc, type Doc, type DocSummary } from "@orbyn/core";
import { ErrorBanner } from "../../components/ErrorBanner";
import { Icon } from "../../components/Icon";
import { Sheet, sheetStyles } from "../../components/Sheet";
import { client } from "../../lib/api";
import { useRun } from "../../hooks/useRun";
import { colors, fonts, radii, themed } from "../../theme";
import { DocComments } from "./DocComments";
import { DocEditor } from "./DocEditor";
import { SmallAction } from "../../components/SmallAction";

const when = (iso: string) => {
  const date = new Date(iso);
  return date.toDateString() === new Date().toDateString()
    ? date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : date.toLocaleDateString([], { month: "short", day: "numeric" });
};

/**
 * Documents on the phone: the list, then one document to read and write,
 * with its checklist live so a line ticked here ticks its task too. Formulas
 * read as symbols here and are typeset on the desktop; the source is the
 * same either way.
 */
export function DocsSheet({
  visible,
  agenda,
  userId,
  onClose,
  onDismiss,
  onItemsChanged,
}: {
  visible: boolean;
  /** Opens straight onto today's agenda instead of the list. */
  agenda?: boolean;
  /** Whose comments offer a remove button. */
  userId?: string;
  onClose: () => void;
  onDismiss?: () => void;
  /** Called when ticking a line changed a task in the planner. */
  onItemsChanged?: () => void;
}) {
  const [docs, setDocs] = useState<DocSummary[] | null>(null);
  const [open, setOpen] = useState<Doc | null>(null);
  const { busy, error, setError, run } = useRun();

  useEffect(() => {
    if (!visible) return;
    if (agenda) {
      // Today's page is written on the server the first time it is asked for.
      client.agendaToday().then(setOpen, () => setOpen(null));
      return;
    }
    client.listDocs().then(setDocs, () => setDocs([]));
  }, [visible, agenda]);

  /** Start a page here rather than having to reach for a desktop. */
  const create = () =>
    void run(async () => {
      const made = await client.createDoc({
        title: "Untitled",
        content: starterDoc(),
      });
      setDocs(null);
      setOpen(made);
    });

  // Coming back to the list should show what was just written.
  const backToList = () => {
    setOpen(null);
    client.listDocs().then(setDocs, () => setDocs([]));
  };

  // Leaving a sheet that opened on the agenda should close it, not show a list.
  const back = agenda ? undefined : open ? backToList : undefined;

  /** The editor hands back whatever went wrong; show it where they are. */
  const report = (e: unknown) => setError((e as Error).message || "Not saved");

  return (
    <Sheet
      visible={visible}
      title={open ? open.title || "Untitled" : agenda ? "Agenda" : "Documents"}
      onClose={onClose}
      onBack={back}
      onDismiss={onDismiss}
    >
      <ScrollView
        contentContainerStyle={sheetStyles.body}
        keyboardShouldPersistTaps="handled"
      >
        <View style={sheetStyles.column}>
          <ErrorBanner error={error} onDismiss={() => setError("")} />

          {open ? (
            <>
              <DocEditor
                doc={open}
                onChanged={setOpen}
                onItemsChanged={onItemsChanged}
                report={report}
              />
              <DocComments docId={open.id} userId={userId} report={report} />
            </>
          ) : docs === null ? (
            <Text style={styles.empty}>Loading…</Text>
          ) : docs.length === 0 ? (
            <View style={styles.list}>
              <Text style={styles.empty}>
                No documents yet. Start one and it is on every device.
              </Text>
              <SmallAction
                label="New document"
                disabled={busy}
                onPress={create}
              />
            </View>
          ) : (
            <View style={styles.list}>
              <SmallAction
                label="New document"
                disabled={busy}
                onPress={create}
              />
              {docs.map((doc) => (
                <Pressable
                  key={doc.id}
                  style={({ pressed }) => [
                    styles.row,
                    pressed && styles.rowPressed,
                  ]}
                  onPress={() =>
                    void run(async () => setOpen(await client.getDoc(doc.id)))
                  }
                >
                  <Icon name="fileText" size={16} color={colors.muted} />
                  <View style={styles.rowMain}>
                    <Text style={styles.rowTitle} numberOfLines={1}>
                      {doc.title || "Untitled"}
                    </Text>
                    <Text style={styles.rowPreview} numberOfLines={1}>
                      {doc.preview || "Empty document"}
                    </Text>
                  </View>
                  <Text style={styles.rowWhen}>{when(doc.updated_at)}</Text>
                </Pressable>
              ))}
            </View>
          )}
        </View>
      </ScrollView>
    </Sheet>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    list: { gap: 8 },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      padding: 12,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.card,
      backgroundColor: colors.surface,
    },
    rowPressed: { backgroundColor: colors.surfaceMuted },
    rowMain: { flex: 1, gap: 2 },
    rowTitle: { color: colors.text, fontSize: 15, fontFamily: fonts.semibold },
    rowPreview: { color: colors.muted, fontSize: 13 },
    rowWhen: { color: colors.muted, fontSize: 12 },
    page: { gap: 12 },
    title: { color: colors.text, fontSize: 22, fontFamily: fonts.display },
    meta: { color: colors.muted, fontSize: 12, marginTop: -6 },
    hint: {
      color: colors.muted,
      fontSize: 12,
      lineHeight: 18,
      borderTopWidth: 1,
      borderTopColor: colors.border,
      paddingTop: 10,
    },
    empty: { color: colors.muted, fontSize: 14, lineHeight: 20 },
  }),
);
