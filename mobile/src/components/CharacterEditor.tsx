import React, { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import {
  CHARACTER_BODIES,
  CHARACTER_PALETTES,
  CHARACTER_EYES,
  CHARACTER_RINGS,
  CHARACTER_ACCESSORIES,
  CHARACTER_PRESENCE,
  CHARACTER_LABELS,
  type CharacterAppearance,
  type CharacterState,
} from "@orbyn/core";
import { Segmented } from "./Segmented";
import { Character } from "./Character";
import { Button } from "./Button";
import { Field } from "./Field";
import { colors, fonts, radii, themed } from "../theme";
import { shared } from "../styles";

const fields = [
  ["body", "Body", CHARACTER_BODIES],
  ["palette", "Palette", CHARACTER_PALETTES],
  ["eyes", "Eyes", CHARACTER_EYES],
  ["ring", "Ring", CHARACTER_RINGS],
  ["accessory", "Accessory", CHARACTER_ACCESSORIES],
  ["presence", "Presence", CHARACTER_PRESENCE],
] as const;

/** Curated parts and an immediate native preview, saved with the identity form. */
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
              : "Your companion across Orbyn."}
          </Text>
          <Button
            title="Say hello"
            secondary
            disabled={disabled || value.presence !== "animated"}
            onPress={() => setGreeting((n) => n + 1)}
            style={{ marginBottom: 0, marginTop: 6 }}
          />
        </View>
      </View>
      {fields.map(([key, label, options]) => (
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
      <Field label="Preview expression">
        <Segmented
          options={
            [
              "ready",
              "working",
              "waiting",
              "done",
              "error",
              "interrupted",
            ] as const
          }
          value={state}
          onChange={setState}
          wrap
          labels={{
            ready: "Ready",
            working: "Working",
            waiting: "Needs your decision",
            done: "Finished",
            error: "Error",
            interrupted: "Stopped",
          }}
          accessibilityLabel="Preview expression"
        />
      </Field>
    </View>
  );
}
const s = themed(() =>
  StyleSheet.create({
    editor: { gap: 10, marginVertical: 12 },
    preview: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      padding: 12,
      borderRadius: radii.card,
      backgroundColor: colors.surfaceMuted,
    },
    caption: { flex: 1, gap: 4 },
    name: { fontFamily: fonts.semibold, fontSize: 18, color: colors.text },
  }),
);
