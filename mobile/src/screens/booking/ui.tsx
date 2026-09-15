import React, { useState } from "react";
import {
  Pressable,
  StyleSheet,
  Switch,
  Text,
  View,
  type LayoutChangeEvent,
} from "react-native";
import { Chip, ChipRow } from "../../components/Chip";
import { NumberInput } from "../../components/Field";
import { Icon } from "../../components/Icon";
import { animateLayout } from "../../motion";
import { colors, fonts, radii, themed } from "../../theme";
import { shared } from "../../styles";

/**
 * A card with a tappable header that shows or hides its fields. Pass `open`
 * and `onOpenChange` to open it from outside (e.g. when Save finds a problem).
 */
export function Section({
  title,
  summary,
  initiallyOpen = false,
  open: controlled,
  onOpenChange,
  onLayout,
  children,
}: {
  title: string;
  /** One line under the title saying what's set, shown while closed. */
  summary?: string;
  initiallyOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onLayout?: (e: LayoutChangeEvent) => void;
  children: React.ReactNode;
}) {
  const [own, setOwn] = useState(initiallyOpen);
  const open = controlled ?? own;
  return (
    <View style={[shared.card, s.section]} onLayout={onLayout}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityHint={summary}
        accessibilityState={{ expanded: open }}
        onPress={() => {
          animateLayout();
          setOwn(!open);
          onOpenChange?.(!open);
        }}
        style={({ pressed }) => [s.header, pressed && s.pressed]}
      >
        <View style={{ flex: 1 }}>
          <Text style={s.title}>{title}</Text>
          {!open && !!summary && (
            <Text style={shared.small} numberOfLines={2}>
              {summary}
            </Text>
          )}
        </View>
        <View style={open && s.open}>
          <Icon name="chevronRight" size={16} color={colors.faint} />
        </View>
      </Pressable>
      {open && <View style={s.body}>{children}</View>}
    </View>
  );
}

/** A title, a line of explanation and a switch. */
export function SwitchRow({
  title,
  hint,
  value,
  onValueChange,
  disabled,
}: {
  title: string;
  hint?: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <View style={s.switchRow}>
      <View style={{ flex: 1 }}>
        <Text style={s.rowTitle}>{title}</Text>
        {!!hint && <Text style={shared.small}>{hint}</Text>}
      </View>
      <Switch
        value={value}
        disabled={disabled}
        trackColor={{ true: colors.accent }}
        accessibilityLabel={title}
        onValueChange={onValueChange}
      />
    </View>
  );
}

/** A square icon button for removing a row. */
export function RemoveButton({
  label,
  onPress,
}: {
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={6}
      onPress={onPress}
      style={({ pressed }) => [s.remove, pressed && s.pressed]}
    >
      <Icon name="x" size={16} color={colors.muted} />
    </Pressable>
  );
}

/**
 * Preset minute chips plus Custom, which shows a number field. A cleared
 * custom field reports NaN so the form can say what's missing.
 */
export function PresetMinutes({
  label,
  presets,
  value,
  onChange,
  max,
}: {
  label: string;
  presets: { value: number; label: string }[];
  value: number;
  onChange: (minutes: number) => void;
  max: number;
}) {
  const [custom, setCustom] = useState(
    () => !presets.some((p) => p.value === value),
  );
  const [text, setText] = useState(Number.isFinite(value) ? String(value) : "");
  return (
    <>
      <ChipRow label={label}>
        {presets.map((p) => (
          <Chip
            key={p.value}
            label={p.label}
            selected={!custom && value === p.value}
            onPress={() => {
              animateLayout();
              setCustom(false);
              setText(String(p.value));
              onChange(p.value);
            }}
          />
        ))}
        <Chip
          label="Custom"
          selected={custom}
          onPress={() => {
            animateLayout();
            setCustom(true);
          }}
        />
      </ChipRow>
      {custom && (
        <View style={s.custom}>
          <NumberInput
            value={text}
            onChangeText={(t) => {
              setText(t);
              onChange(t ? Number(t) : NaN);
            }}
            suffix={`minutes, 0 to ${max}`}
            accessibilityLabel={`${label}, in minutes from 0 to ${max}`}
          />
        </View>
      )}
    </>
  );
}

export const bookingStyles = themed(() =>
  StyleSheet.create({
    rowTitle: {
      fontFamily: fonts.semibold,
      fontSize: 15,
      color: colors.text,
      marginBottom: 2,
    },
    divider: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    list: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.card,
      overflow: "hidden",
      marginBottom: 16,
    },
    pressed: { backgroundColor: colors.surfaceMuted },
    eyebrow: { marginTop: 8 },
    top: { marginTop: 6 },
    gap: { marginBottom: 12 },
    last: { marginBottom: 0 },
    pair: { flexDirection: "row", alignItems: "center", gap: 8 },
    half: { flex: 1 },
    multiline: { minHeight: 80 },
    warn: { color: colors.danger },
  }),
);

const s = themed(() =>
  StyleSheet.create({
    section: { padding: 0, overflow: "hidden" },
    header: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      paddingHorizontal: 18,
      paddingVertical: 16,
    },
    pressed: { backgroundColor: colors.surfaceMuted },
    title: {
      fontFamily: fonts.display,
      fontSize: 16,
      letterSpacing: -0.3,
      color: colors.text,
      marginBottom: 2,
    },
    open: { transform: [{ rotate: "90deg" }] },
    body: { paddingHorizontal: 18, paddingBottom: 18, paddingTop: 2 },
    switchRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 16,
      marginBottom: 18,
    },
    rowTitle: {
      fontFamily: fonts.semibold,
      fontSize: 15,
      color: colors.text,
      marginBottom: 2,
    },
    remove: {
      width: 44,
      height: 50,
      borderRadius: radii.input,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      alignItems: "center",
      justifyContent: "center",
    },
    custom: { marginTop: 10 },
  }),
);
