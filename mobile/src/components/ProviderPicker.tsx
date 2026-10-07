import React, { useEffect, useState } from "react";
import { FlatList, StyleSheet, Text, TextInput, View } from "react-native";
import {
  AI_PROVIDER_KINDS,
  AI_PROVIDERS,
  filterChoices,
  type AiProviderKind,
} from "@orbyn/core";
import { Pressable } from "../motion";
import { shared } from "../styles";
import { colors, controls, fonts, themed } from "../theme";
import { Icon } from "./Icon";
import { Sheet } from "./Sheet";

/** A compact provider control with a searchable native sheet; opening it changes no settings. */
export function ProviderPicker({
  value,
  onChange,
  disabled = false,
}: {
  value: AiProviderKind;
  onChange: (kind: AiProviderKind) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);
  const choices = filterChoices(
    AI_PROVIDER_KINDS.filter(
      (kind) => AI_PROVIDERS[kind].pickerVisible || kind === value,
    ).map((kind) => ({
      value: kind,
      label: AI_PROVIDERS[kind].label,
      searchText: AI_PROVIDERS[kind].hint,
    })),
    query,
  );
  const close = () => {
    setOpen(false);
    setQuery("");
  };
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Provider"
        accessibilityState={{ disabled, expanded: open }}
        disabled={disabled}
        onPress={() => {
          if (!disabled) {
            setQuery("");
            setOpen(true);
          }
        }}
        style={[shared.input, s.trigger, disabled && s.disabled]}
      >
        <Text style={[shared.body, s.label]} numberOfLines={1}>
          {AI_PROVIDERS[value].label}
        </Text>
        <Icon name="chevronDown" size={16} color={colors.textSoft} />
      </Pressable>
      <Sheet visible={open} title="Choose provider" onClose={close}>
        <View style={s.search}>
          <TextInput
            style={shared.input}
            value={query}
            onChangeText={setQuery}
            placeholder="Search providers"
            placeholderTextColor={colors.faint}
            accessibilityLabel="Search providers"
            autoCapitalize="none"
            autoCorrect={false}
            clearButtonMode="while-editing"
            maxLength={256}
            editable={!disabled}
          />
        </View>
        <FlatList
          data={choices}
          keyExtractor={(item) => item.value}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          contentContainerStyle={s.list}
          ListEmptyComponent={
            <Text style={shared.small}>No providers match.</Text>
          }
          renderItem={({ item }) => {
            const selected = item.value === value;
            const definition = AI_PROVIDERS[item.value];
            return (
              <Pressable
                accessibilityRole="radio"
                accessibilityLabel={item.label}
                accessibilityState={{ checked: selected, disabled }}
                disabled={disabled}
                onPress={() => {
                  if (disabled) return;
                  onChange(item.value);
                  close();
                }}
                style={s.option}
              >
                <View style={s.label}>
                  <Text style={s.optionLabel}>{item.label}</Text>
                  <Text style={shared.small}>
                    {definition.local ? "Local" : "Cloud"}
                  </Text>
                </View>
                {selected && (
                  <Icon name="check" size={18} color={colors.accent} />
                )}
              </Pressable>
            );
          }}
        />
      </Sheet>
    </>
  );
}
const s = themed(() =>
  StyleSheet.create({
    trigger: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      marginBottom: 10,
    },
    label: { flex: 1, minWidth: 0 },
    disabled: { opacity: 0.45 },
    search: { padding: 16 },
    list: { paddingHorizontal: 16, paddingBottom: 16 },
    option: {
      minHeight: controls.tap,
      paddingHorizontal: 10,
      paddingVertical: 12,
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    optionLabel: { fontFamily: fonts.medium, fontSize: 16, color: colors.text },
  }),
);
