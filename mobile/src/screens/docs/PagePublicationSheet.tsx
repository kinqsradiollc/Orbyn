import React, { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { StyleSheet, Text, View, ScrollView } from "react-native";
import { Switch } from "../../components/Switch";
import { Chip, ChipRow } from "../../components/Chip";
import { PagePublicationStore } from "@orbyn/api-client";
import { blockText, type Doc } from "@orbyn/core";
import { BottomSheet } from "../../components/BottomSheet";
import { Button } from "../../components/Button";
import { Pressable } from "../../motion";
import { client, webOrigin } from "../../lib/api";
import { session } from "../../lib/session";
import { copyText } from "../../lib/share";
import { colors, fonts, themed } from "../../theme";

export function PagePublicationSheet({
  id,
  onClose,
  onChanged,
}: {
  id: string;
  onClose: () => void;
  onChanged?: (doc: Doc) => void;
}) {
  const changed = useRef(onChanged);
  changed.current = onChanged;
  const store = useMemo(
    () =>
      new PagePublicationStore(
        client,
        id,
        () => session.token,
        (doc) => changed.current?.(doc),
      ),
    [id],
  );
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  useEffect(() => {
    void store.prepare();
    return store.dispose;
  }, [store]);
  return (
    <BottomSheet
      visible
      title="Share page"
      onClose={() => {
        if (!state.busy) onClose();
      }}
    >
      <View style={s.body}>
        {!!state.error && (
          <>
            <Text accessibilityRole="alert" style={s.error}>
              {state.error}
            </Text>
            <Button
              title="Reload"
              secondary
              disabled={state.busy}
              onPress={() => void store.prepare()}
            />
          </>
        )}
        {!state.doc && !state.error && <Text style={s.help}>Loading…</Text>}
        {state.legacyPath && (
          <View style={s.group}>
            <Text style={s.help}>
              An older link still shares this whole page.
            </Text>
            <Button
              title="Revoke older link"
              secondary
              disabled={state.busy}
              onPress={() => void store.revokeLegacy()}
            />
          </View>
        )}
        {state.folderPath && (
          <Text style={s.help}>
            This page is also public through its folder. Manage that link in
            folder sharing.
          </Text>
        )}
        {state.publication && (
          <View style={s.group}>
            <Text style={s.label}>
              {state.publication.mode === "snapshot"
                ? "Saved snapshot"
                : "Live selected blocks"}
            </Text>
            <Text style={s.help}>
              {state.publication.expires_at
                ? `Expires ${new Date(state.publication.expires_at).toLocaleDateString()}`
                : "No expiry"}
            </Text>
            <Button
              title="Copy link"
              secondary
              onPress={() =>
                void copyText(`${webOrigin()}${state.publication!.path}`)
              }
            />
            <Button
              title="Revoke link"
              secondary
              disabled={state.busy}
              onPress={() => void store.revoke()}
            />
          </View>
        )}
        {state.doc && (
          <>
            <Text style={s.label}>Shared blocks</Text>
            <ScrollView
              style={s.blocks}
              contentContainerStyle={s.group}
              nestedScrollEnabled
            >
              {state.doc.content.map(
                (block, index) =>
                  block.id && (
                    <Pressable
                      key={block.id}
                      accessibilityRole="checkbox"
                      accessibilityState={{
                        checked: state.selected.includes(block.id),
                        disabled: state.busy,
                      }}
                      disabled={state.busy}
                      style={s.row}
                      onPress={() =>
                        store.configure({
                          selected: state.selected.includes(block.id!)
                            ? state.selected.filter((id) => id !== block.id)
                            : [...state.selected, block.id!],
                        })
                      }
                    >
                      <Text style={s.label}>
                        {state.selected.includes(block.id) ? "✓" : "○"}
                      </Text>
                      <Text style={s.block}>
                        {index + 1}. {blockText(block) || block.type}
                      </Text>
                    </Pressable>
                  ),
              )}
            </ScrollView>
            <Text style={s.label}>Updates</Text>
            <ChipRow label="Updates">
              {(["snapshot", "live"] as const).map((mode) => (
                <Chip
                  key={mode}
                  label={mode === "snapshot" ? "Saved snapshot" : "Live blocks"}
                  selected={state.mode === mode}
                  disabled={state.busy}
                  onPress={() => store.configure({ mode })}
                />
              ))}
            </ChipRow>
            <Text style={s.help}>
              {state.mode === "snapshot"
                ? "Later edits stay private until you update this link."
                : "Edits to selected blocks are public. New blocks stay private."}
            </Text>
            <Text style={s.label}>Expires</Text>
            <ChipRow label="Link expiry">
              {([7, 30, 0] as const).map((expiryDays) => (
                <Chip
                  key={expiryDays}
                  label={expiryDays ? `${expiryDays} days` : "Never"}
                  selected={state.expiryDays === expiryDays}
                  disabled={state.busy}
                  onPress={() => store.configure({ expiryDays })}
                />
              ))}
            </ChipRow>
            <View style={s.row}>
              <Text style={s.block}>
                Anyone with the link can read the title and selected blocks.
              </Text>
              <Switch
                accessibilityLabel="Allow public sharing"
                value={state.consent}
                disabled={state.busy}
                trackColor={{ true: colors.accent }}
                onValueChange={(consent) => store.configure({ consent })}
              />
            </View>
            <Button
              title={
                state.busy
                  ? "Saving…"
                  : state.publication
                    ? "Update shared page"
                    : "Create public link"
              }
              disabled={state.busy || !state.consent || !state.selected.length}
              onPress={() => void store.save()}
            />
          </>
        )}
      </View>
    </BottomSheet>
  );
}
const s = themed(() =>
  StyleSheet.create({
    body: { padding: 16, gap: 12 },
    group: { gap: 8 },
    blocks: { maxHeight: 220 },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      minHeight: 44,
      paddingVertical: 8,
    },
    label: { fontFamily: fonts.semibold, fontSize: 15, color: colors.text },
    block: {
      flex: 1,
      minWidth: 0,
      fontFamily: fonts.regular,
      fontSize: 15,
      color: colors.text,
    },
    help: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted },
    error: { fontFamily: fonts.regular, fontSize: 13, color: colors.danger },
  }),
);
