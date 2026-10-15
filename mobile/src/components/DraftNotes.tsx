import React, { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { docPreview, type DraftNote } from "@orbyn/core";
import { Button } from "./Button";
import { SmallAction } from "./SmallAction";
import { InlineDetails } from "./InlineDetails";
import { client } from "../lib/api";
import { colors, fonts, themed } from "../theme";
import { session } from "../lib/session";
import { errorText } from "../lib/errors";
import * as Crypto from "expo-crypto";

/**
 * Notes the assistant has drafted, waiting for someone to keep them.
 *
 * Shown as themselves — title, length, the start of what they say — because
 * the decision is whether this is worth keeping. Nothing is written until
 * Keep is pressed.
 */
export function DraftNotes(props: React.ComponentProps<typeof DraftNotesBody>) {
  return (
    <DraftNotesBody
      key={`${session.token}:${props.scope ?? "drafts"}`}
      {...props}
    />
  );
}

function DraftNotesBody({
  notes,
  onKept,
  report,
}: {
  scope?: string;
  notes: DraftNote[];
  onKept?: (docId: string) => void;
  report: (e: unknown) => void;
}) {
  const owner = useRef(session.token).current;
  const mounted = useRef(true);
  const pending = useRef(false);
  const owns = () => mounted.current && session.token === owner;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const keyOf = (draft: DraftNote, at: number) =>
    JSON.stringify([
      at,
      draft.title,
      draft.content,
      draft.project_id,
      draft.item_id,
      draft.team_id,
    ]);
  const keys = notes.map(keyOf);
  const currentKeys = useRef(keys);
  currentKeys.current = keys;
  const current = (key: string) => owns() && currentKeys.current.includes(key);
  const requests = useRef(new Map<string, string>());
  const [kept, setKept] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const teamIds = [
    ...new Set(
      notes.map((draft) => draft.team_id).filter((id): id is string => !!id),
    ),
  ].sort();
  const teamKey = teamIds.join(",");
  const [teams, setTeams] = useState<{
    key: string;
    names: Record<string, string>;
    error: string;
  } | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    if (!teamIds.length) return;
    Promise.all(
      teamIds.map((id) =>
        client.getTeam(id).then((team) => [id, team.name] as const),
      ),
    ).then(
      (rows) => {
        if (active && owns())
          setTeams({
            key: teamKey,
            names: Object.fromEntries(rows),
            error: "",
          });
      },
      (e) => {
        if (active && owns())
          setTeams({ key: teamKey, names: {}, error: errorText(e) });
      },
    );
    return () => {
      active = false;
    };
  }, [teamKey, retry]);
  const teamData = teams?.key === teamKey ? teams : null;
  const open = async (key: string) => {
    if (!current(key) || pending.current || !kept[key] || !onKept) return;
    pending.current = true;
    setBusy(true);
    setPendingKey(key);
    setErrors((all) => ({ ...all, [key]: "" }));
    try {
      await onKept(kept[key]);
    } catch (e) {
      if (current(key)) setErrors((all) => ({ ...all, [key]: errorText(e) }));
    } finally {
      pending.current = false;
      if (owns()) setBusy(false);
    }
  };
  const keep = async (draft: DraftNote, at: number) => {
    const key = keyOf(draft, at);
    if (
      !current(key) ||
      pending.current ||
      kept[key] ||
      (draft.team_id && !teamData?.names[draft.team_id])
    )
      return;
    pending.current = true;
    setBusy(true);
    setPendingKey(key);
    setErrors((all) => ({ ...all, [key]: "" }));
    const request = requests.current.get(key) ?? Crypto.randomUUID();
    requests.current.set(key, request);
    let saved: string | null = null;
    try {
      const doc = await client.once(request, () =>
        client.createDoc({
          title: draft.title,
          kind: "note",
          content: draft.content,
          project_id: draft.project_id,
          item_id: draft.item_id,
          team_id: draft.team_id,
        }),
      );
      saved = doc.id;
      if (!owns()) return;
      setKept((all) => ({ ...all, [key]: doc.id }));
      if (current(key)) await onKept?.(doc.id);
    } catch (e) {
      if (current(key)) {
        setErrors((all) => ({
          ...all,
          [key]: saved
            ? "Note kept. Couldn't open it. Try Open note."
            : errorText(e),
        }));
        report(e);
      }
    } finally {
      pending.current = false;
      if (owns()) setBusy(false);
    }
  };
  if (!notes.length) return null;

  return (
    <View style={s.wrap}>
      {teamData?.error && (
        <View accessibilityRole="alert">
          <Text style={s.error}>{teamData.error}</Text>
          <SmallAction
            label="Retry note destination"
            disabled={busy}
            onPress={() => setRetry((n) => n + 1)}
          />
        </View>
      )}
      {notes.map((draft, at) => (
        <View key={at} style={s.card}>
          <Text style={s.title}>{draft.title || "Untitled"}</Text>
          {!!draft.project_name && (
            <Text style={s.where}>{draft.project_name}</Text>
          )}
          <Text style={s.where}>
            {draft.team_id
              ? (teamData?.names[draft.team_id] ??
                (teamData?.error ? "Team unavailable" : "Loading team…"))
              : "Personal"}
          </Text>
          <Text style={s.preview}>{docPreview(draft.content, 180)}</Text>
          <InlineDetails title="Read draft">
            <Text selectable style={s.preview}>
              {docPreview(draft.content, Infinity)}
            </Text>
            {!!draft.note && <Text style={s.why}>{draft.note}</Text>}
          </InlineDetails>
          {!!errors[keys[at]] && (
            <Text accessibilityRole="alert" style={s.error}>
              {errors[keys[at]]}
            </Text>
          )}
          <View style={s.actions}>
            <Text style={s.lines}>
              {draft.content.length} line{draft.content.length === 1 ? "" : "s"}
            </Text>
            {kept[keys[at]] ? (
              onKept ? (
                <SmallAction
                  label={
                    busy && pendingKey === keys[at] ? "Opening…" : "Open note"
                  }
                  disabled={busy}
                  onPress={() => {
                    void open(keys[at]);
                  }}
                />
              ) : (
                <Text style={s.where}>Note kept</Text>
              )
            ) : (
              <Button
                title={
                  busy && pendingKey === keys[at] ? "Keeping…" : "Keep note"
                }
                disabled={
                  busy || (!!draft.team_id && !teamData?.names[draft.team_id])
                }
                onPress={() => {
                  void keep(draft, at);
                }}
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
      paddingVertical: 12,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.divider,
    },
    title: { color: colors.text, fontSize: 15, fontFamily: fonts.semibold },
    where: { color: colors.accent, fontSize: 13 },
    preview: { color: colors.muted, fontSize: 13, lineHeight: 19 },
    error: { color: colors.danger, fontSize: 13, lineHeight: 19 },
    why: { color: colors.muted, fontSize: 13, fontStyle: "italic" },
    actions: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 10,
      flexWrap: "wrap",
    },
    lines: { color: colors.muted, fontSize: 13 },
  }),
);
