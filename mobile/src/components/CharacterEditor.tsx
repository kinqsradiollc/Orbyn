import React, { useState } from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import {
  CHARACTER_SECTIONS,
  CHARACTER_PRESETS,
  CHARACTER_LABELS,
  CHARACTER_STATE_LABELS,
  DEFAULT_CHARACTER,
  randomCharacterAppearance,
  type CharacterAppearance,
  type CharacterState,
} from "@orbyn/core";
import { usePaneWidth } from "../hooks/usePaneWidth";
import { ChoicePicker } from "./ChoicePicker";
import { Character } from "./Character";
import { Button } from "./Button";
import { Pressable } from "../motion";
import { colors, fonts, radii, themed } from "../theme";
import { shared } from "../styles";

/** Independent wearable slots and the same catalog as the web builder. */
export function CharacterEditor({
  value,
  onChange,
  name,
  disabled = false,
}: {
  value: CharacterAppearance;
  onChange: (value: CharacterAppearance) => void;
  name: string;
  disabled?: boolean;
}) {
  const pane = usePaneWidth();
  const { fontScale } = useWindowDimensions();
  const stacked = pane.width < 280 * Math.max(1, fontScale);
  const [greeting, setGreeting] = useState(0);
  const [state, setState] = useState<CharacterState>("ready");
  const [section, setSection] = useState<string>("shape");
  const current = CHARACTER_SECTIONS.find((item) => item.id === section);
  return (
    <View style={s.editor} onLayout={pane.onLayout}>
      <View style={[s.preview, stacked && s.stacked]}>
        <Character
          appearance={value}
          state={state}
          size={144}
          greeting={greeting}
          name={name || "Orbyn"}
          preview
        />
        <View style={s.caption}>
          <Text style={s.name}>{name.trim() || "Orbyn"}</Text>
          {value.presence === "hidden" && (
            <Text style={shared.small}>Hidden in chat.</Text>
          )}
          <Button
            title="Say hello"
            secondary
            disabled={disabled || value.presence !== "animated"}
            onPress={() => setGreeting((n) => n + 1)}
            style={s.action}
          />
        </View>
      </View>
      <ChoicePicker
        label="Customize"
        value={section}
        onChange={setSection}
        options={[
          { value: "presets", label: "Looks" },
          ...CHARACTER_SECTIONS.map((item) => ({
            value: item.id,
            label: item.label,
          })),
        ]}
      />
      {section === "presets" && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator
          contentContainerStyle={s.presets}
          accessibilityLabel="Character presets"
        >
          {CHARACTER_PRESETS.map((preset) => (
            <Pressable
              key={preset.name}
              accessibilityRole="button"
              accessibilityLabel={`Use ${preset.name} preset`}
              accessibilityState={{ disabled }}
              disabled={disabled}
              onPress={() =>
                onChange({
                  ...preset.appearance,
                  presence: value.presence,
                  movement: value.movement,
                })
              }
              style={[s.preset, disabled && { opacity: 0.5 }]}
            >
              <Character
                appearance={{ ...preset.appearance, presence: "static" }}
                name={preset.name}
                size={56}
                preview
              />
              <Text style={s.presetName}>{preset.name}</Text>
            </Pressable>
          ))}
        </ScrollView>
      )}
      <View style={s.fields}>
        {current?.fields.map(({ key, label, options }) => (
          <ChoicePicker
            key={key}
            label={label}
            options={options.map((option) => ({
              value: option,
              label: CHARACTER_LABELS[option],
            }))}
            value={value[key]}
            disabled={disabled}
            onChange={(next) => onChange({ ...value, [key]: next })}
          />
        ))}
        {section === "motion" && (
          <ChoicePicker
            label="Preview expression"
            options={Object.entries(CHARACTER_STATE_LABELS).map(
              ([key, label]) => ({ value: key as CharacterState, label }),
            )}
            value={state}
            onChange={setState}
          />
        )}
      </View>
      <View style={s.actions}>
        <Button
          title="Surprise me"
          secondary
          disabled={disabled}
          onPress={() => onChange(randomCharacterAppearance(value))}
          style={s.action}
        />
        <Button
          title="Reset look"
          secondary
          disabled={disabled}
          onPress={() =>
            onChange({
              ...DEFAULT_CHARACTER,
              presence: value.presence,
              movement: value.movement,
            })
          }
          style={s.action}
        />
      </View>
    </View>
  );
}
const s = themed(() =>
  StyleSheet.create({
    editor: { gap: 12, marginVertical: 12, minWidth: 0 },
    fields: { gap: 8 },
    preview: {
      flexDirection: "row",
      alignItems: "center",
      gap: 16,
      padding: 16,
      borderRadius: radii.card,
      backgroundColor: colors.surfaceMuted,
    },
    stacked: { flexDirection: "column", alignItems: "center" },
    caption: { flexShrink: 1, minWidth: 0, gap: 8 },
    name: { fontFamily: fonts.semibold, fontSize: 18, color: colors.text },
    presets: { gap: 8, paddingVertical: 4 },
    preset: {
      width: 104,
      minHeight: 100,
      alignItems: "center",
      gap: 4,
      padding: 8,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.card,
      backgroundColor: colors.surface,
    },
    presetName: {
      textAlign: "center",
      fontFamily: fonts.medium,
      fontSize: 13,
      color: colors.text,
    },
    actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    action: { marginBottom: 0, flexShrink: 1 },
  }),
);
