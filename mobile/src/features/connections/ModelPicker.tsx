import React, { useMemo, useState } from "react";
import { FlatList, StyleSheet, Text, TextInput, View } from "react-native";
import { Sheet } from "../../components/Sheet";
import { SmallAction } from "../../components/SmallAction";
import { Pressable } from "../../motion";
import { colors, fonts, themed } from "../../theme";
import { shared } from "../../styles";

/** Full model values stay available; long catalogs use a bounded searchable list. */
export function ModelPicker({
  values,
  value,
  disabled,
  onChange,
}: {
  values: readonly string[];
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const matches = useMemo(
    () =>
      [...new Set(values)].filter((name) =>
        name.toLowerCase().includes(query.trim().toLowerCase()),
      ),
    [values, query],
  );
  return (
    <>
      <SmallAction
        label="Choose model"
        disabled={disabled || !values.length}
        onPress={() => {
          setQuery("");
          setOpen(true);
        }}
      />
      <Sheet visible={open} title="Choose model" onClose={() => setOpen(false)}>
        <View style={s.body}>
          <TextInput
            style={shared.input}
            accessibilityLabel="Search models"
            placeholder="Search models"
            placeholderTextColor={colors.faint}
            value={query}
            onChangeText={setQuery}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <FlatList
            data={matches}
            keyExtractor={(name) => name}
            keyboardShouldPersistTaps="handled"
            initialNumToRender={16}
            maxToRenderPerBatch={20}
            ListEmptyComponent={
              <Text style={shared.small}>No matching models.</Text>
            }
            renderItem={({ item }) => (
              <Pressable
                accessibilityRole="radio"
                accessibilityState={{
                  checked: value === item,
                  disabled: !!disabled,
                }}
                disabled={disabled}
                style={[s.row, value === item && s.selected]}
                onPress={() => {
                  if (disabled) return;
                  onChange(item);
                  setOpen(false);
                }}
              >
                <Text style={s.name}>{item}</Text>
              </Pressable>
            )}
          />
        </View>
      </Sheet>
    </>
  );
}
const s = themed(() =>
  StyleSheet.create({
    body: { flex: 1, minHeight: 0, padding: 16, gap: 12 },
    row: {
      minHeight: 44,
      padding: 12,
      justifyContent: "center",
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    selected: { backgroundColor: colors.surfaceMuted },
    name: { fontFamily: fonts.regular, fontSize: 15, color: colors.text },
  }),
);
