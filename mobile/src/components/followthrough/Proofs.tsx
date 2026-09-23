import React, { useCallback, useEffect, useState } from "react";
import {
  Linking,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import type { ItemProof } from "@orbyn/core";
import { Icon } from "../Icon";
import { SmallAction } from "../SmallAction";
import { client } from "../../lib/api";
import { animateLayout } from "../../motion";
import { colors, fonts, themed } from "../../theme";
import { shared } from "../../styles";

const hostOf = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

/**
 * Proof of progress on a task: a link or a short note that shows it moved.
 * Anyone who can edit the task can add one.
 */
export function ProofSection({
  itemId,
  canWrite,
}: {
  itemId: string;
  canWrite: boolean;
}) {
  const [proofs, setProofs] = useState<ItemProof[]>([]);
  const [adding, setAdding] = useState(false);
  const [url, setUrl] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const load = useCallback(() => {
    client.listProofs(itemId).then(setProofs, () => setProofs([]));
  }, [itemId]);
  useEffect(load, [load]);
  if (!proofs.length && !canWrite) return null;
  const add = async () => {
    setError("");
    try {
      await client.addProof(itemId, {
        url: url.trim() || null,
        note: note.trim(),
      });
      animateLayout();
      setUrl("");
      setNote("");
      setAdding(false);
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <View style={[shared.card, s.card]}>
      <View style={s.head}>
        <Text style={shared.sectionTitle}>Proof</Text>
        {canWrite && !adding && (
          <SmallAction
            label="Add proof"
            disabled={false}
            onPress={() => setAdding(true)}
          />
        )}
      </View>
      {proofs.length === 0 && !adding && (
        <Text style={shared.small}>
          A link or a note that shows this moved — a pull request, a sent file.
        </Text>
      )}
      {proofs.map((p) => (
        <View key={p.id} style={s.row}>
          <Icon
            name={p.url ? "link" : "check"}
            size={15}
            color={colors.accent}
          />
          <Pressable
            style={{ flex: 1 }}
            disabled={!p.url}
            accessibilityRole={p.url ? "link" : undefined}
            onPress={() => p.url && void Linking.openURL(p.url)}
          >
            <Text style={[s.proof, !!p.url && s.link]}>
              {p.note || (p.url ? hostOf(p.url) : "")}
            </Text>
            <Text style={shared.small}>
              {p.user_name}
              {p.url && p.note ? ` · ${hostOf(p.url)}` : ""}
            </Text>
          </Pressable>
          {canWrite && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Remove this proof"
              hitSlop={10}
              onPress={() =>
                void client
                  .deleteProof(itemId, p.id)
                  .then(load, (e: Error) => setError(e.message))
              }
            >
              <Icon name="x" size={15} color={colors.muted} />
            </Pressable>
          )}
        </View>
      ))}
      {adding && (
        <View style={s.form}>
          <TextInput
            style={shared.input}
            value={url}
            onChangeText={setUrl}
            autoCapitalize="none"
            keyboardType="url"
            placeholder="https://… (optional)"
            placeholderTextColor={colors.faint}
            accessibilityLabel="Link"
          />
          <TextInput
            style={shared.input}
            value={note}
            onChangeText={setNote}
            maxLength={1000}
            placeholder="What it shows, e.g. “PR #42 merged”"
            placeholderTextColor={colors.faint}
            accessibilityLabel="Note"
          />
          <View style={s.head}>
            <SmallAction
              label="Add"
              disabled={!url.trim() && !note.trim()}
              onPress={() => void add()}
            />
            <SmallAction
              label="Cancel"
              disabled={false}
              onPress={() => setAdding(false)}
            />
          </View>
        </View>
      )}
      {!!error && <Text style={[shared.small, s.bad]}>{error}</Text>}
    </View>
  );
}

const s = themed(() =>
  StyleSheet.create({
    card: { gap: 10 },
    head: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 8,
    },
    row: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
    proof: { fontFamily: fonts.medium, fontSize: 14, color: colors.text },
    link: { color: colors.accent },
    form: { gap: 8 },
    bad: { color: colors.danger },
  }),
);
