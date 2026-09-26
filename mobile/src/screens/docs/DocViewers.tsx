import React, { useCallback, useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { viewersLabel, type DocViewer } from "@orbyn/core";
import { client } from "../../lib/api";
import { onLive, setOpenDoc } from "../../lib/live";
import { colors, fonts, themed } from "../../theme";

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");

/**
 * Who else has this page open, as small initials beside the save state.
 * Opening the page also tells the server this phone is on it.
 */
export function DocViewers({
  docId,
  register = true,
}: {
  docId: string;
  /**
   * Whether showing this also says this phone has the page open. The page
   * says so itself while it's open; the Info sheet only shows who's here.
   */
  register?: boolean;
}) {
  const [viewers, setViewers] = useState<DocViewer[]>([]);
  const load = useCallback(() => {
    client.docViewers(docId).then(setViewers, () => {});
  }, [docId]);
  useEffect(() => {
    if (register) setOpenDoc(docId);
    load();
    const stop = onLive((news) => {
      if (
        (news.kind === "doc_presence" && news.doc === docId) ||
        news.kind === "presence"
      )
        load();
    });
    const id = setInterval(load, 90_000);
    return () => {
      stop();
      clearInterval(id);
      if (register) setOpenDoc(null);
    };
  }, [docId, load, register]);

  if (!viewers.length) return null;
  const names = viewers.map((v) => v.name);
  return (
    <View
      style={s.row}
      accessible
      accessibilityLabel={`${viewersLabel(names)} ${names.length === 1 ? "is" : "are"} here`}
    >
      {viewers.slice(0, 3).map((v, n) => (
        <View key={v.user_id} style={[s.face, n > 0 && s.overlap]}>
          <Text style={s.initials}>{initials(v.name)}</Text>
        </View>
      ))}
      {viewers.length > 3 && <Text style={s.more}>+{viewers.length - 3}</Text>}
    </View>
  );
}

const s = themed(() =>
  StyleSheet.create({
    row: { flexDirection: "row", alignItems: "center" },
    face: {
      width: 24,
      height: 24,
      borderRadius: 12,
      borderWidth: 2,
      borderColor: colors.surface,
      backgroundColor: colors.accentSoft,
      alignItems: "center",
      justifyContent: "center",
    },
    overlap: { marginLeft: -6 },
    initials: {
      fontFamily: fonts.semibold,
      fontSize: 11,
      color: colors.accent,
    },
    more: {
      marginLeft: 4,
      fontFamily: fonts.medium,
      fontSize: 11,
      color: colors.textSoft,
    },
  }),
);
