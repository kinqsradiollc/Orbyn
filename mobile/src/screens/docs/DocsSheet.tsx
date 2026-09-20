import React, { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { Doc, DocSummary } from "@orbyn/core";
import { ErrorBanner } from "../../components/ErrorBanner";
import { Icon } from "../../components/Icon";
import { Sheet, sheetStyles } from "../../components/Sheet";
import { client } from "../../lib/api";
import { useRun } from "../../hooks/useRun";
import { colors, fonts, radii, themed } from "../../theme";
import { DocBody } from "./DocBody";

const when = (iso: string) => {
  const date = new Date(iso);
  return date.toDateString() === new Date().toDateString()
    ? date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : date.toLocaleDateString([], { month: "short", day: "numeric" });
};

/**
 * Documents on the phone: the list, then one document to read, with its
 * checklist live so a line ticked here ticks its task too. Writing a document
 * stays on the desktop, where the editor and its typeset formulas live.
 */
export function DocsSheet({
  visible,
  onClose,
  onDismiss,
  onItemsChanged,
}: {
  visible: boolean;
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
    client.listDocs().then(setDocs, () => setDocs([]));
  }, [visible]);

  const toggle = (index: number) => {
    if (!open) return;
    const next = open.content.map((b, i) =>
      i === index && b.type === "todo" ? { ...b, done: !b.done } : b,
    );
    // Show the tick at once, then let the server settle it.
    setOpen({ ...open, content: next });
    void run(async () => {
      const saved = await client.updateDoc(open.id, {
        content: next,
        version: open.version,
      });
      setOpen(saved);
      onItemsChanged?.();
    });
  };

  return (
    <Sheet
      visible={visible}
      title={open ? open.title || "Untitled" : "Documents"}
      onClose={onClose}
      onBack={open ? () => setOpen(null) : undefined}
      onDismiss={onDismiss}
    >
      <ScrollView
        contentContainerStyle={sheetStyles.body}
        keyboardShouldPersistTaps="handled"
      >
        <View style={sheetStyles.column}>
          <ErrorBanner error={error} onDismiss={() => setError("")} />

          {open ? (
            <View style={styles.page}>
              <Text style={styles.title}>{open.title || "Untitled"}</Text>
              <Text style={styles.meta}>Edited {when(open.updated_at)}</Text>
              <DocBody content={open.content} onToggleTodo={toggle} />
              <Text style={styles.hint}>
                Formulas read as symbols here. Open this document on the desktop
                to edit it and see them typeset.
              </Text>
            </View>
          ) : docs === null ? (
            <Text style={styles.empty}>Loading…</Text>
          ) : docs.length === 0 ? (
            <Text style={styles.empty}>
              No documents yet. Make one on the desktop and it will show here.
            </Text>
          ) : (
            <View style={styles.list}>
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
