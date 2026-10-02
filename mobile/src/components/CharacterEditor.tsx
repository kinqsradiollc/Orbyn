import React, { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
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
import { Segmented } from "./Segmented";
import { Character } from "./Character";
import { Button } from "./Button";
import { Field } from "./Field";
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
  const [greeting, setGreeting] = useState(0);
  const [state, setState] = useState<CharacterState>("ready");
  const [section, setSection] = useState<string>("shape");
  const current = CHARACTER_SECTIONS.find((item) => item.id === section)!;
  return (
    <View style={s.editor}>
      <View style={s.preview}>
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
          <Text style={shared.small}>
            {value.presence === "hidden"
              ? "Hidden in chat. Preview only."
              : "Make a little companion that's yours."}
          </Text>
          <Button
            title="Say hello"
            secondary
            disabled={disabled || value.presence !== "animated"}
            onPress={() => setGreeting((n) => n + 1)}
            style={s.action}
          />
        </View>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
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
      <Segmented
        options={CHARACTER_SECTIONS.map((item) => item.id)}
        value={section}
        onChange={setSection}
        labels={Object.fromEntries(
          CHARACTER_SECTIONS.map((item) => [item.id, item.label]),
        )}
        accessibilityLabel="Customization category"
      />
      {current.fields.map(({ key, label, options }) => (
        <Field key={key} label={label}>
          <Segmented
            options={options as readonly string[]}
            labels={CHARACTER_LABELS}
            value={value[key]}
            disabled={disabled}
            wrap
            accessibilityLabel={label}
            onChange={(next) => onChange({ ...value, [key]: next })}
          />
        </Field>
      ))}
      {section === "motion" && (
        <Field label="Preview expression">
          <Segmented
            options={Object.keys(CHARACTER_STATE_LABELS) as CharacterState[]}
            value={state}
            onChange={setState}
            wrap
            labels={CHARACTER_STATE_LABELS}
            accessibilityLabel="Preview expression"
          />
        </Field>
      )}
      <Text style={shared.small}>
        Mix hats, eyewear, outfits and more. Save to use your look across
        devices.
      </Text>
    </View>
  );
}
const s = themed(() =>
  StyleSheet.create({
    editor: { gap: 12, marginVertical: 12 },
    preview: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      padding: 12,
      borderRadius: radii.card,
      backgroundColor: colors.surfaceMuted,
    },
    caption: { flex: 1, gap: 4 },
    name: { fontFamily: fonts.semibold, fontSize: 18, color: colors.text },
    presets: { gap: 8, paddingVertical: 4 },
    preset: {
      width: 100,
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
      fontSize: 12,
      color: colors.text,
    },
    actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    action: { marginBottom: 0 },
  }),
);
