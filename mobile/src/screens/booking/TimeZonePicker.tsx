import React, { useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { isTimeZone } from "@orbyn/core";
import { Icon } from "../../components/Icon";
import { Pressable } from "../../motion";
import { colors, fonts, radii, themed } from "../../theme";
import { shared } from "../../styles";
import { timeZones, zoneLabel } from "./helpers";

/** Most matches listed at once; typing narrows the rest. */
const SHOWN = 60;

/**
 * The chosen time zone; tapping it opens a searchable list of zones. When
 * the device can't list every zone, any valid zone name can be typed.
 */
export function TimeZonePicker({
  value,
  onChange,
  disabled = false,
}: {
  disabled?: boolean;
  value: string;
  onChange: (zone: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const zones = useMemo(timeZones, []);
  const needle = q.trim().toLowerCase().replace(/\s+/g, "_");
  const matches = zones.filter((z) => z.toLowerCase().includes(needle));
  const typed = q.trim();
  const other =
    !!typed && !zones.includes(typed) && isTimeZone(typed) ? typed : null;
  const valid = isTimeZone(value);

  const pick = (zone: string) => {
    if (disabled) return;

    onChange(zone);
    setOpen(false);
    setQ("");
  };

  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Time zone: ${valid ? zoneLabel(value) : "not set"}`}
        accessibilityHint="Opens a list of time zones"
        disabled={disabled}
        accessibilityState={{ expanded: open, disabled }}
        onPress={() => {
          setOpen((o) => !o);
        }}
        style={({ pressed }) => [
          s.field,
          open && s.fieldOpen,
          pressed && { backgroundColor: colors.surfaceMuted },
        ]}
      >
        <Icon name="clock" size={16} color={colors.accent} />
        <Text style={[s.value, !valid && s.invalid]}>
          {valid ? zoneLabel(value) : value || "Pick a time zone"}
        </Text>
        <View style={open && s.turned}>
          <Icon name="chevronRight" size={16} color={colors.faint} />
        </View>
      </Pressable>
      {open && !disabled && (
        <View style={s.panel}>
          <TextInput
            style={shared.input}
            value={q}
            onChangeText={setQ}
            autoFocus
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={80}
            placeholder="Search, e.g. London or Tokyo"
            placeholderTextColor={colors.faint}
            accessibilityLabel="Search time zones"
          />
          <ScrollView
            style={s.list}
            nestedScrollEnabled
            keyboardShouldPersistTaps="handled"
          >
            {other && <ZoneRow zone={other} selected={false} onPick={pick} />}
            {matches.slice(0, SHOWN).map((z) => (
              <ZoneRow key={z} zone={z} selected={z === value} onPick={pick} />
            ))}
            {!matches.length && !other && (
              <Text style={[shared.small, s.none]}>
                No time zone matches “{typed}”.
              </Text>
            )}
            {matches.length > SHOWN && (
              <Text style={[shared.small, s.none]}>
                {matches.length - SHOWN} more. Type to narrow the list.
              </Text>
            )}
          </ScrollView>
        </View>
      )}
    </View>
  );
}

function ZoneRow({
  zone,
  selected,
  onPick,
}: {
  zone: string;
  selected: boolean;
  onPick: (zone: string) => void;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={zoneLabel(zone)}
      accessibilityState={{ checked: selected }}
      onPress={() => onPick(zone)}
      style={({ pressed }) => [s.row, pressed && s.rowPressed]}
    >
      <Text style={[s.rowText, selected && s.rowOn]}>{zoneLabel(zone)}</Text>
      {selected && <Icon name="check" size={16} color={colors.accent} />}
    </Pressable>
  );
}

const s = themed(() =>
  StyleSheet.create({
    field: {
      minHeight: 44,
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.input,
      paddingHorizontal: 12,
      paddingVertical: 8,
    },
    fieldOpen: { borderColor: colors.accent },
    value: {
      flex: 1,
      fontFamily: fonts.medium,
      fontSize: 15,
      color: colors.text,
    },
    invalid: { color: colors.danger },
    turned: { transform: [{ rotate: "90deg" }] },
    panel: {
      marginTop: 10,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.input,
      padding: 10,
      backgroundColor: colors.surface,
    },
    list: { maxHeight: 260, marginTop: 8 },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      minHeight: 44,
      paddingHorizontal: 6,
      borderRadius: radii.input,
    },
    rowPressed: { backgroundColor: colors.surfaceMuted },
    rowText: {
      flex: 1,
      fontFamily: fonts.medium,
      fontSize: 15,
      color: colors.text,
    },
    rowOn: { color: colors.accent },
    none: { paddingVertical: 10, paddingHorizontal: 6 },
  }),
);
