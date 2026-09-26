import React, { useEffect, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { Pressable } from "../../motion";
import { MAX_ALIASES } from "@orbyn/core";
import { Icon } from "../../components/Icon";
import { colors, controls, fonts, radii, themed } from "../../theme";

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
  useEffect(() => setList(aliases), [aliases]);
  const save = (next: string[]) => {
    setBusy(true);
    void onSave(next)
      .then((kept) => setList(kept))
      .finally(() => setBusy(false));
  };
  const add = () => {
    const name = typed.trim();
    setTyped("");
    if (!name || list.some((x) => x.toLowerCase() === name.toLowerCase()))
      return;
    save([...list, name]);
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
                  hitSlop={10}
                  onPress={() => save(list.filter((x) => x !== a))}
                >
                  <Icon name="x" size={13} color={colors.muted} />
                </Pressable>
              )}
            </View>
          ))}
        </View>
      )}
      {canWrite && list.length < MAX_ALIASES && (
        <TextInput
          value={typed}
          onChangeText={setTyped}
          onSubmitEditing={add}
          onEndEditing={add}
          returnKeyType="done"
          editable={!busy}
          maxLength={80}
          placeholder={list.length ? "Add another" : placeholder}
          placeholderTextColor={colors.faint}
          accessibilityLabel="Add another name"
          style={s.input}
        />
      )}
    </View>
  );
}

const s = themed(() =>
  StyleSheet.create({
    field: { gap: 8 },
    chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
    chip: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      minHeight: controls.compact,
      paddingHorizontal: 10,
      borderRadius: radii.pill,
      backgroundColor: colors.surfaceMuted,
    },
    chipText: {
      color: colors.textSoft,
      fontFamily: fonts.medium,
      fontSize: 13,
    },
    input: {
      minHeight: controls.tap,
      paddingHorizontal: 12,
      borderRadius: radii.input,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      color: colors.text,
      fontFamily: fonts.regular,
      fontSize: 15,
    },
  }),
);
