import React, { useEffect, useMemo, useRef, useState } from "react";
import { FlatList, StyleSheet, Text, TextInput, View } from "react-native";
import { session } from "../lib/session";
import { Sheet } from "./Sheet";
import { Icon } from "./Icon";
import { Pressable } from "../motion";
import { colors, fonts, radii, themed } from "../theme";
import { shared } from "../styles";

/** A compact value with full, searchable choices in an owned sheet. */
export function ChoicePicker<T extends string>({
  label,
  value,
  options,
  disabled = false,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string; detail?: string }[];
  disabled?: boolean;
  onChange: (value: T) => void;
}) {
  const owner = useRef(session.token).current;
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);
  const [query, setQuery] = useState("");
  const latest = useRef({ options, disabled, onChange });
  latest.current = { options, disabled, onChange };
  const selected = options.find((option) => option.value === value);
  const matches = useMemo(
    () =>
      options.filter((option) =>
        `${option.label} ${option.detail ?? ""}`
          .toLocaleLowerCase()
          .includes(query.trim().toLocaleLowerCase()),
      ),
    [options, query],
  );
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${selected?.label ?? "Unavailable"}`}
        accessibilityState={{ disabled, expanded: open }}
        disabled={disabled}
        style={[s.control, disabled && s.disabled]}
        onPress={() => {
          if (session.token !== owner || latest.current.disabled) return;
          setQuery("");
          setOpen(true);
        }}
      >
        <View style={s.value}>
          <Text style={s.label}>{label}</Text>
          <Text style={s.text}>{selected?.label ?? "Unavailable"}</Text>
        </View>
        <Icon name="chevronDown" size={16} color={colors.muted} />
      </Pressable>
      <Sheet visible={open} title={label} onClose={() => setOpen(false)}>
        <View style={s.body}>
          <TextInput
            style={shared.input}
            accessibilityLabel={`Search ${label.toLocaleLowerCase()}`}
            placeholder="Search choices"
            placeholderTextColor={colors.faint}
            value={query}
            onChangeText={setQuery}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <FlatList
            data={matches}
            keyExtractor={(option) => option.value}
            keyboardShouldPersistTaps="handled"
            initialNumToRender={16}
            maxToRenderPerBatch={20}
            ListEmptyComponent={
              <Text style={shared.small}>No matching choices.</Text>
            }
            renderItem={({ item }) => (
              <Pressable
                accessibilityRole="radio"
                accessibilityState={{ checked: item.value === value, disabled }}
                disabled={disabled}
                style={[s.row, item.value === value && s.selected]}
                onPress={() => {
                  const current = latest.current;
                  if (
                    session.token !== owner ||
                    current.disabled ||
                    !current.options.some(
                      (option) => option.value === item.value,
                    )
                  )
                    return;
                  current.onChange(item.value);
                  setOpen(false);
                }}
              >
                <View style={s.optionText}>
                  <Text style={s.text}>{item.label}</Text>
                  {!!item.detail && (
                    <Text style={shared.small}>{item.detail}</Text>
                  )}
                </View>
                {item.value === value && (
                  <Icon name="check" size={16} color={colors.accent} />
                )}
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
    control: {
      minHeight: 44,
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      padding: 12,
      borderRadius: radii.input,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    disabled: { opacity: 0.5 },
    value: { flex: 1, minWidth: 0, gap: 3 },
    label: { fontFamily: fonts.medium, fontSize: 13, color: colors.muted },
    text: {
      fontFamily: fonts.regular,
      fontSize: 15,
      color: colors.text,
      flexShrink: 1,
    },
    body: { flex: 1, minHeight: 0, padding: 16, gap: 12 },
    row: {
      minHeight: 44,
      padding: 12,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    selected: { backgroundColor: colors.surfaceMuted },
    optionText: { flex: 1, minWidth: 0, gap: 3 },
  }),
);
