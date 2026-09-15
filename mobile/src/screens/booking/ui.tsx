import React, { useState } from "react";
import { Pressable, StyleSheet, Switch, Text, View } from "react-native";
import { Icon } from "../../components/Icon";
import { animateLayout } from "../../motion";
import { colors, fonts, radii } from "../../theme";
import { shared } from "../../styles";

/** A card with a tappable header that shows or hides its fields. */
export function Section({
  title,
  summary,
  initiallyOpen = false,
  children,
}: {
  title: string;
  /** One line under the title saying what's set, shown while closed. */
  summary?: string;
  initiallyOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  return (
    <View style={[shared.card, s.section]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityHint={summary}
        accessibilityState={{ expanded: open }}
        onPress={() => {
          animateLayout();
          setOpen((o) => !o);
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

export const bookingStyles = StyleSheet.create({
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
});

const s = StyleSheet.create({
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
});
