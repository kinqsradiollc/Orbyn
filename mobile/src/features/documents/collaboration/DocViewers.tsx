import React, { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { viewersLabel, type DocViewer } from "@orbyn/core";
import { SmallAction } from "../../../components/SmallAction";
import { client } from "../../../lib/api";
import { session } from "../../../lib/session";
import { onLive, setOpenDoc, currentDoc } from "../../../lib/live";
import { colors, fonts, radii, themed } from "../../../theme";

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
  const owner = session.token;
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState<{
    owner: string;
    docId: string;
    viewers: DocViewer[];
  } | null>(null);
  const [failure, setFailure] = useState<{
    owner: string;
    docId: string;
  } | null>(null);
  useEffect(() => {
    let live = true;
    let pending = false;
    let queued = false;
    const current = () => live && session.token === owner;
    const load = async () => {
      if (!current()) return;
      if (pending) {
        queued = true;
        return;
      }
      pending = true;
      try {
        const viewers = await client.docViewers(docId);
        if (current()) {
          setResult({ owner, docId, viewers });
          setFailure(null);
        }
      } catch {
        if (current()) {
          setResult(null);
          setFailure({ owner, docId });
        }
      } finally {
        pending = false;
        if (queued && current()) {
          queued = false;
          void load();
        }
      }
    };
    if (register) setOpenDoc(docId);
    void load();
    const stop = onLive((news) => {
      if (
        (news.kind === "doc_presence" && news.doc === docId) ||
        news.kind === "presence"
      )
        void load();
    });
    const timer = setInterval(() => void load(), 90_000);
    return () => {
      live = false;
      stop();
      clearInterval(timer);
      if (register && currentDoc() === docId) setOpenDoc(null);
    };
  }, [docId, owner, register, retry]);
  const viewers =
    result?.owner === owner && result.docId === docId ? result.viewers : [];
  if (failure?.owner === owner && failure.docId === docId)
    return (
      <View style={s.row}>
        <Text style={s.more}>Presence unavailable</Text>
        <SmallAction
          label="Retry"
          disabled={false}
          onPress={() => setRetry((n) => n + 1)}
        />
      </View>
    );

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
    row: {
      flexDirection: "row",
      flexWrap: "wrap",
      alignItems: "center",
      minWidth: 0,
    },
    face: {
      width: 24,
      height: 24,
      borderRadius: radii.pill,
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
