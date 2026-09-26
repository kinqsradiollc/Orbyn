import React, { useEffect, useState } from "react";
import { StyleSheet, Switch, Text, View } from "react-native";
import { fileSizeLabel, type Doc, type OriginalsOverview } from "@orbyn/core";
import { client } from "../../lib/api";
import { confirmAction } from "../../lib/confirm";
import { saveFile, takeAwayLabel } from "../../lib/download";
import { SmallAction } from "../../components/SmallAction";
import { colors, fonts, themed } from "../../theme";

/**
 * The file an imported page came from, when it was kept: take it away, or
 * delete it and keep only the page. In the page's Info.
 */
export function OriginalSection({
  doc,
  canWrite,
  report,
}: {
  doc: Pick<Doc, "id" | "original">;
  canWrite: boolean;
  report: (e: unknown) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [gone, setGone] = useState<string | null>(null);
  const original = doc.original;
  if (!original || gone === doc.id) return null;
  return (
    <View style={s.section}>
      <Text style={s.label}>Original file</Text>
      <Text style={s.text}>
        {original.file_name} · {fileSizeLabel(Number(original.bytes))}
      </Text>
      <View style={s.actions}>
        <SmallAction
          label={takeAwayLabel()}
          disabled={busy}
          onPress={() => {
            setBusy(true);
            void client
              .downloadOriginal(doc.id)
              .then(({ blob, name }) =>
                saveFile(name, blob, blob.type || "application/octet-stream"),
              )
              .catch(report)
              .finally(() => setBusy(false));
          }}
        />
        {canWrite && (
          <SmallAction
            label="Delete original"
            destructive
            disabled={busy}
            onPress={() =>
              confirmAction(
                `Delete “${original.file_name}”?`,
                "The page stays as it is. The file can't be brought back.",
                "Delete",
                () =>
                  void client
                    .deleteOriginal(doc.id)
                    .then(() => setGone(doc.id))
                    .catch(report),
              )
            }
          />
        )}
      </View>
    </View>
  );
}

/** "Keep the original", where files come in: off by default. */
export function KeepOriginals({ report }: { report: (e: unknown) => void }) {
  const [state, setState] = useState<OriginalsOverview | null>(null);
  useEffect(() => {
    client.originals().then(setState, () => setState(null));
  }, []);
  if (!state) return null;
  return (
    <View style={s.switchRow}>
      <View style={{ flex: 1 }}>
        <Text style={s.title}>Keep the original</Text>
        <Text style={s.small}>
          New imports keep their file beside the page, encrypted, until you
          delete it. {fileSizeLabel(state.used_bytes)} of{" "}
          {fileSizeLabel(state.quota_bytes)} used.
        </Text>
      </View>
      <Switch
        trackColor={{ true: colors.accent }}
        accessibilityLabel="Keep the original of new imports"
        value={state.keep}
        onValueChange={(keep) => {
          setState({ ...state, keep });
          client.setKeepOriginals(keep).catch((e) => {
            setState({ ...state, keep: !keep });
            report(e);
          });
        }}
      />
    </View>
  );
}

const s = themed(() =>
  StyleSheet.create({
    section: { gap: 8 },
    label: {
      fontFamily: fonts.semibold,
      fontSize: 11,
      letterSpacing: 0.6,
      textTransform: "uppercase",
      color: colors.muted,
    },
    text: { fontFamily: fonts.regular, fontSize: 15, color: colors.text },
    small: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted },
    title: { fontFamily: fonts.medium, fontSize: 15, color: colors.text },
    actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    switchRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      paddingVertical: 8,
    },
  }),
);
