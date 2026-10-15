import React, { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { Pressable } from "../../motion";
import { MAX_ALIASES } from "@orbyn/core";
import { Icon } from "../../components/Icon";
import { errorText } from "../../lib/errors";
import {
  inputFontSize,
  colors,
  controls,
  fonts,
  radii,
  themed,
} from "../../theme";

/**
 * "Also called" (LNK-03) on the phone: other names a page or project goes
 * by, such as a course code, found by search and the link picker too.
 * Return adds one; × takes one off.
 */
export function AliasesField({
  aliases,
  canWrite,
  onSave,
  placeholder = "Add another name, like CS101",
}: {
  aliases: string[];
  canWrite: boolean;
  onSave: (next: string[]) => Promise<string[]>;
  placeholder?: string;
}) {
  const [list, setList] = useState(aliases);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => setList(aliases), [aliases]);
  const save = async (next: string[], added?: string) => {
    if (pending.current || !canWrite) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      const kept = await onSave(next);
      if (!mounted.current) return;
      setList(kept);
      if (added) setTyped((draft) => (draft.trim() === added ? "" : draft));
    } catch (failure) {
      if (mounted.current) setError(errorText(failure));
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const add = () => {
    const name = typed.trim();
    if (
      pending.current ||
      list.length >= MAX_ALIASES ||
      !name ||
      list.some((x) => x.toLowerCase() === name.toLowerCase())
    )
      return;
    void save([...list, name], name);
  };
  if (!canWrite && !list.length) return null;
  return (
    <View style={s.field}>
      {list.length > 0 && (
        <View style={s.chips}>
          {list.map((a) => (
            <View key={a} style={s.chip}>
              <Text style={s.chipText}>{a}</Text>
              {canWrite && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${a}`}
                  disabled={busy}
                  onPress={() => void save(list.filter((x) => x !== a))}
                  style={s.remove}
                >
                  <Icon name="x" size={13} color={colors.muted} />
                </Pressable>
              )}
            </View>
          ))}
        </View>
      )}
      {canWrite && list.length < MAX_ALIASES && (
        <View style={s.entry}>
          <TextInput
            value={typed}
            onChangeText={setTyped}
            onSubmitEditing={add}
            returnKeyType="done"
            editable={!busy}
            maxLength={80}
            placeholder={list.length ? "Add another" : placeholder}
            placeholderTextColor={colors.faint}
            accessibilityLabel="Add another name"
            style={s.input}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Add another name"
            disabled={busy || !typed.trim()}
            onPress={add}
            style={s.remove}
          >
            <Icon
              name="plus"
              size={18}
              color={busy || !typed.trim() ? colors.faint : colors.accent}
            />
          </Pressable>
        </View>
      )}
      {!!error && (
        <Text accessibilityRole="alert" style={s.error}>
          {error}
        </Text>
      )}
    </View>
  );
}

const s = themed(() =>
  StyleSheet.create({
    field: { gap: 8 },
    entry: { flexDirection: "row", alignItems: "center", gap: 6 },
    chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
    chip: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      minHeight: controls.compact,
      paddingHorizontal: 10,
      borderRadius: radii.pill,
      backgroundColor: colors.surfaceMuted,
      maxWidth: "100%",
    },
    chipText: {
      flexShrink: 1,
      color: colors.textSoft,
      fontFamily: fonts.medium,
      fontSize: 13,
    },
    remove: {
      minWidth: controls.tap,
      minHeight: controls.tap,
      alignItems: "center",
      justifyContent: "center",
    },
    error: { color: colors.danger, fontSize: 13 },
    input: {
      flex: 1,
      minWidth: 0,
      minHeight: controls.tap,
      paddingHorizontal: 12,
      borderRadius: radii.input,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      color: colors.text,
      fontFamily: fonts.regular,
      fontSize: inputFontSize,
    },
  }),
);
