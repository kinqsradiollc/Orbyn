import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import type { ItemProof } from "@orbyn/core";
import { Icon } from "../Icon";
import { SmallAction } from "../SmallAction";
import { MoreMenu } from "../MoreMenu";
import { Sheet, sheetStyles } from "../Sheet";
import { client } from "../../lib/api";
import { Pressable } from "../../motion";
import { colors, fonts, themed } from "../../theme";
import { shared } from "../../styles";
import { errorText } from "../../lib/errors";

const hostOf = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

export function ProofSection(props: Parameters<typeof ProofSectionBody>[0]) {
  return <ProofSectionBody key={props.itemId} {...props} />;
}

/**
 * Proof of progress on a task: a link or a short note that shows it moved.
 * Anyone who can edit the task can add one.
 */
function ProofSectionBody({
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
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const mutation = useRef(false);
  const request = useRef(0);
  const mounted = useRef(true);
  const load = useCallback(async () => {
    if (!mounted.current) return;
    const version = ++request.current;
    setLoading(true);
    try {
      const rows = await client.listProofs(itemId);
      if (version === request.current) {
        setProofs(rows);
        setError("");
      }
    } catch (reason) {
      if (version === request.current) setError(errorText(reason));
    } finally {
      if (version === request.current) setLoading(false);
    }
  }, [itemId]);
  useEffect(() => {
    mounted.current = true;
    setProofs([]);
    setUrl("");
    setNote("");
    setAdding(false);
    void load();
    return () => {
      mounted.current = false;
      request.current += 1;
    };
  }, [load]);
  const remove = async (id: string) => {
    if (mutation.current || !canWrite) return;
    mutation.current = true;
    setBusy(true);
    setError("");
    try {
      await client.deleteProof(itemId, id);
      await load();
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      mutation.current = false;
      setBusy(false);
    }
  };
  const add = async () => {
    if (mutation.current || !canWrite || (!url.trim() && !note.trim())) return;
    mutation.current = true;
    setBusy(true);
    setError("");
    try {
      await client.addProof(itemId, {
        url: url.trim() || null,
        note: note.trim(),
      });
      setUrl("");
      setNote("");
      setAdding(false);
      await load();
    } catch (e) {
      setError(errorText(e));
    } finally {
      mutation.current = false;
      setBusy(false);
    }
  };
  return (
    <View style={[shared.card, s.card]}>
      <View style={s.head}>
        <Text style={shared.sectionTitle}>Proof</Text>
        {canWrite && !adding && (
          <SmallAction
            label="Add proof"
            disabled={busy}
            onPress={() => setAdding(true)}
          />
        )}
      </View>
      {proofs.length === 0 && !adding && !loading && !error && (
        <Text style={shared.small}>No proof yet.</Text>
      )}
      {proofs.map((p) => (
        <View key={p.id} style={s.row}>
          <Icon
            name={p.url ? "link" : "check"}
            size={15}
            color={colors.accent}
          />
          <Pressable
            style={{ flex: 1, minWidth: 0 }}
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
            <MoreMenu
              label="Proof options"
              title={p.note || (p.url ? hostOf(p.url) : "Proof")}
              disabled={busy}
              actions={[
                {
                  label: "Remove proof",
                  destructive: true,
                  onPress: () => {
                    void remove(p.id);
                  },
                },
              ]}
            />
          )}
        </View>
      ))}
      {loading && <Text style={shared.small}>Loading proof…</Text>}
      {adding && (
        <Sheet
          visible
          title="Add proof"
          hideClose={busy}
          onClose={() => {
            if (!busy) setAdding(false);
          }}
        >
          <ScrollView contentContainerStyle={sheetStyles.body}>
            <View style={s.form}>
              <TextInput
                style={shared.input}
                editable={!busy}
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
                editable={!busy}
                value={note}
                onChangeText={setNote}
                maxLength={1000}
                placeholder="What it shows"
                placeholderTextColor={colors.faint}
                accessibilityLabel="Note"
              />
              <View style={s.head}>
                <SmallAction
                  label="Add"
                  disabled={busy || (!url.trim() && !note.trim())}
                  onPress={() => void add()}
                />
                <SmallAction
                  label="Cancel"
                  disabled={busy}
                  onPress={() => setAdding(false)}
                />
              </View>
              {!!error && (
                <Text style={s.bad} accessibilityRole="alert">
                  {error}
                </Text>
              )}
            </View>
          </ScrollView>
        </Sheet>
      )}
      {!!error && !adding && (
        <View>
          <Text style={[shared.small, s.bad]} accessibilityRole="alert">
            {error}
          </Text>
          <SmallAction
            label="Retry"
            disabled={busy || loading}
            onPress={() => {
              void load();
            }}
          />
        </View>
      )}
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
      flexWrap: "wrap",
    },
    row: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
    proof: { fontFamily: fonts.medium, fontSize: 13, color: colors.text },
    link: { color: colors.accent },
    form: { gap: 8 },
    bad: { color: colors.danger },
  }),
);
