import React, { useEffect, useState } from "react";
import {
  Alert,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { Doc, DocVersion } from "@orbyn/core";
import { Button } from "../../components/Button";
import { client } from "../../lib/api";
import { colors, fonts, radii, themed } from "../../theme";
import { DocBody } from "./DocBody";

const when = (iso: string) => {
  const date = new Date(iso);
  const today = date.toDateString() === new Date().toDateString();
  return today
    ? `Today, ${date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
    : date.toLocaleString([], {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
};

/**
 * The page as it was, on the phone. Folded away until asked for, since most
 * visits to a page are to read or write it, not to look back. Each entry is
 * a sitting; choosing one shows it read-only, and Restore puts it back as a
 * new version on top, so nothing is ever thrown away.
 */
export function DocHistory({
  doc,
  onRestored,
  canWrite = true,
  report,
}: {
  doc: Doc;
  canWrite?: boolean;
  onRestored: (doc: Doc) => void;
  report: (e: unknown) => void;
}) {
  const [open, setOpen] = useState(false);
  const [versions, setVersions] = useState<DocVersion[] | null>(null);
  const [chosen, setChosen] = useState<Required<DocVersion> | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setChosen(null);
    client.listDocVersions(doc.id).then(setVersions, (e) => {
      setVersions([]);
      report(e);
    });
  }, [open, doc.id, doc.version, report]);

  const pick = (v: DocVersion) => {
    setBusy(true);
    client
      .getDocVersion(doc.id, v.version)
      .then(setChosen)
      .catch(report)
      .finally(() => setBusy(false));
  };

  const restore = () => {
    if (!chosen || !canWrite) return;
    const go = () => {
      setBusy(true);
      client
        .restoreDocVersion(doc.id, chosen.version)
        .then((restored) => {
          onRestored(restored);
          setChosen(null);
        })
        .catch(report)
        .finally(() => setBusy(false));
    };
    const question = `Put the page back as it was at ${when(chosen.created_at)}? What is there now is kept in history.`;
    // Alert.alert does nothing in the web build, so the browser asks instead.
    if (Platform.OS === "web") {
      if (globalThis.confirm?.(question)) go();
      return;
    }
    Alert.alert("Put this version back?", question, [
      { text: "Cancel", style: "cancel" },
      { text: "Restore", onPress: go },
    ]);
  };

  return (
    <View style={styles.section}>
      <Pressable
        onPress={() => setOpen((v) => !v)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        style={styles.head}
      >
        <Text style={styles.title}>History</Text>
        <Text style={styles.toggle}>{open ? "Hide" : "Show"}</Text>
      </Pressable>

      {open &&
        (versions === null ? (
          <Text style={styles.empty}>Loading…</Text>
        ) : versions.length === 0 ? (
          <Text style={styles.empty}>
            Nothing to go back to yet. Each time you sit down and change the
            page, the version you started from is kept here.
          </Text>
        ) : (
          <View style={styles.list}>
            {versions.map((v) => (
              <Pressable
                key={v.version}
                disabled={busy || !canWrite}
                onPress={() => pick(v)}
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.item,
                  chosen?.version === v.version && styles.itemChosen,
                  pressed && styles.itemPressed,
                ]}
              >
                <Text style={styles.itemWhen}>{when(v.created_at)}</Text>
                <Text style={styles.itemMeta}>
                  {v.author ?? "Someone"} · {v.blocks}{" "}
                  {v.blocks === 1 ? "block" : "blocks"}
                </Text>
              </Pressable>
            ))}
          </View>
        ))}

      {open && chosen && (
        <View style={styles.preview}>
          <Text style={styles.previewLabel}>
            As it was at {when(chosen.created_at)}
          </Text>
          <Text style={styles.previewTitle}>{chosen.title || "Untitled"}</Text>
          <DocBody content={chosen.content} />
          <Button
            title="Restore this version"
            secondary
            disabled={busy || !canWrite}
            onPress={restore}
          />
        </View>
      )}
    </View>
  );
}

const styles = themed(() =>
  StyleSheet.create({
    section: {
      gap: 10,
      marginTop: 18,
      paddingTop: 14,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    head: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      minHeight: 36,
    },
    title: { color: colors.text, fontSize: 15, fontFamily: fonts.semibold },
    toggle: { color: colors.accent, fontSize: 13, fontFamily: fonts.semibold },
    list: { gap: 4 },
    item: {
      gap: 2,
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderRadius: radii.input,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    itemChosen: {
      backgroundColor: colors.accentSoft,
      borderColor: colors.accentSoft,
    },
    itemPressed: { backgroundColor: colors.surfaceMuted },
    itemWhen: { color: colors.text, fontSize: 14, fontFamily: fonts.semibold },
    itemMeta: { color: colors.muted, fontSize: 12 },
    preview: {
      gap: 10,
      padding: 12,
      borderRadius: radii.card,
      backgroundColor: colors.surfaceMuted,
    },
    previewLabel: { color: colors.muted, fontSize: 12 },
    previewTitle: {
      color: colors.text,
      fontSize: 18,
      fontFamily: fonts.display,
    },
    empty: { color: colors.muted, fontSize: 13, lineHeight: 19 },
  }),
);
