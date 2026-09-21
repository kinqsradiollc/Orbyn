import React, { useState } from "react";
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { Button } from "./Button";
import { Icon } from "./Icon";
import { clockDisplay, clockText } from "../lib/planning";
import { colors, fonts, radii, themed } from "../theme";
import { shared } from "../styles";

/** A labelled form row with an optional hint underneath. */
export function Field({
  label,
  hint,
  children,
  style,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[s.field, style]}>
      <Text style={shared.label}>{label}</Text>
      {children}
      {!!hint && <Text style={[shared.small, s.hint]}>{hint}</Text>}
    </View>
  );
}

/** Whole-number input kept as text while typing, with a unit after it. */
export function NumberInput({
  value,
  onChangeText,
  suffix,
  accessibilityLabel,
  placeholder,
  editable = true,
}: {
  value: string;
  onChangeText: (text: string) => void;
  suffix?: string;
  accessibilityLabel: string;
  placeholder?: string;
  editable?: boolean;
}) {
  return (
    <View style={s.numberRow}>
      <TextInput
        style={[shared.input, s.number]}
        keyboardType="number-pad"
        value={value}
        editable={editable}
        onChangeText={(text) => onChangeText(text.replace(/[^0-9]/g, ""))}
        placeholder={placeholder}
        placeholderTextColor={colors.faint}
        maxLength={5}
        accessibilityLabel={accessibilityLabel}
      />
      {!!suffix && <Text style={s.suffix}>{suffix}</Text>}
    </View>
  );
}

/**
 * A button showing a date or time that opens the native picker: inline with a
 * Done button on iOS, the system dialog on Android.
 */
function PickerField({
  mode,
  value,
  text,
  label,
  onPick,
  onClear,
  disabled = false,
  minimumDate,
}: {
  mode: "date" | "time";
  value: Date | null;
  text: string;
  label: string;
  onPick: (date: Date) => void;
  onClear?: () => void;
  disabled?: boolean;
  minimumDate?: Date;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <View style={s.pickRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${label}: ${text}`}
          accessibilityHint={`Opens a ${mode} picker`}
          accessibilityState={{ disabled, expanded: open }}
          disabled={disabled}
          onPress={() => setOpen((o) => !o)}
          style={({ pressed }) => [
            s.pick,
            open && s.pickActive,
            pressed && { backgroundColor: colors.surfaceMuted },
            disabled && { opacity: 0.5 },
          ]}
        >
          <Icon
            name={mode === "date" ? "calendar" : "clock"}
            size={16}
            color={colors.accent}
          />
          <Text style={[s.pickText, !value && { color: colors.faint }]}>
            {text}
          </Text>
        </Pressable>
        {onClear && value && !disabled && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Clear ${label.toLowerCase()}`}
            hitSlop={8}
            onPress={() => {
              setOpen(false);
              onClear();
            }}
            style={s.clear}
          >
            <Icon name="x" size={16} color={colors.muted} />
          </Pressable>
        )}
      </View>
      {open && Platform.OS === "web" && (
        /* @react-native-community/datetimepicker has no web build, so in the
           web build every date and time field opened nothing at all: the
           button lit up and that was that. The browser has a picker of its
           own, and it is the one a browser's user expects. */
        <View style={s.webPicker}>
          {React.createElement("input", {
            type: mode,
            autoFocus: true,
            "aria-label": label,
            value:
              mode === "date"
                ? dayKeyOf(value ?? new Date())
                : timeOf(value ?? new Date()),
            min:
              mode === "date" && minimumDate
                ? dayKeyOf(minimumDate)
                : undefined,
            onChange: (event: { target: { value: string } }) => {
              const next = event.target.value;
              if (!next) return;
              if (mode === "date") {
                const [y, mo, d] = next.split("-").map(Number);
                onPick(new Date(y, mo - 1, d));
                return;
              }
              const [h, mi] = next.split(":").map(Number);
              const on = new Date(value ?? new Date());
              on.setHours(h, mi, 0, 0);
              onPick(on);
            },
            style: {
              width: "100%",
              boxSizing: "border-box",
              padding: "12px 14px",
              color: colors.text,
              background: colors.surface,
              border: `1px solid ${colors.border}`,
              borderRadius: 12,
              font: "inherit",
              fontSize: 15,
            },
          })}
        </View>
      )}
      {open && Platform.OS !== "web" && (
        <View style={Platform.OS === "ios" ? s.pickerCard : undefined}>
          <DateTimePicker
            value={value ?? new Date()}
            mode={mode}
            minimumDate={minimumDate}
            display={Platform.OS === "ios" ? "spinner" : "default"}
            accentColor={colors.accent}
            textColor={colors.text}
            onChange={(event, date) => {
              // Android shows a dialog that closes itself; unmount it.
              if (Platform.OS === "android") setOpen(false);
              if (event.type === "dismissed") return;
              if (date) onPick(date);
            }}
          />
          {Platform.OS === "ios" && (
            <Button
              title="Done"
              icon="check"
              style={{ marginBottom: 0 }}
              onPress={() => {
                if (!value) onPick(new Date());
                setOpen(false);
              }}
            />
          )}
        </View>
      )}
    </>
  );
}

/** A wall-clock time kept as "09:30". */
export function ClockField({
  value,
  onChange,
  label,
  disabled,
}: {
  value: string;
  onChange: (clock: string) => void;
  label: string;
  disabled?: boolean;
}) {
  const [h, m] = value.split(":").map(Number);
  return (
    <PickerField
      mode="time"
      label={label}
      disabled={disabled}
      value={new Date(2000, 0, 1, h || 0, m || 0)}
      text={clockDisplay(value)}
      onPick={(d) => onChange(clockText(d.getHours() * 60 + d.getMinutes()))}
    />
  );
}

/** A Date as "09:30", for the browser's own time picker. */
const timeOf = (d: Date) =>
  `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

const dayKeyOf = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** A calendar day kept as "2026-09-18", or null. */
export function DateField({
  value,
  onChange,
  label,
  placeholder = "Pick a date",
  clearable = false,
  minimumDate,
}: {
  value: string | null;
  onChange: (day: string | null) => void;
  label: string;
  placeholder?: string;
  clearable?: boolean;
  minimumDate?: Date;
}) {
  const [y, mo, d] = (value ?? "").split("-").map(Number);
  const date = value ? new Date(y, mo - 1, d) : null;
  return (
    <PickerField
      mode="date"
      label={label}
      value={date}
      minimumDate={minimumDate}
      text={
        date
          ? date.toLocaleDateString([], {
              weekday: "short",
              month: "short",
              day: "numeric",
              year: "numeric",
            })
          : placeholder
      }
      onPick={(picked) => onChange(dayKeyOf(picked))}
      onClear={clearable ? () => onChange(null) : undefined}
    />
  );
}

/** A time of day on a given date, kept as a Date. */
export function TimeField({
  value,
  onChange,
  label,
}: {
  value: Date;
  onChange: (date: Date) => void;
  label: string;
}) {
  return (
    <PickerField
      mode="time"
      label={label}
      value={value}
      text={value.toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit",
      })}
      onPick={(picked) => {
        const next = new Date(value);
        next.setHours(picked.getHours(), picked.getMinutes(), 0, 0);
        onChange(next);
      }}
    />
  );
}

const s = themed(() =>
  StyleSheet.create({
    field: { marginBottom: 18 },
    hint: { marginTop: 8 },
    numberRow: { flexDirection: "row", alignItems: "center", gap: 10 },
    number: { width: 110 },
    suffix: { fontFamily: fonts.medium, fontSize: 14, color: colors.muted },
    pickRow: { flexDirection: "row", alignItems: "center", gap: 8 },
    pick: {
      flex: 1,
      minHeight: 50,
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.input,
      paddingHorizontal: 15,
    },
    pickActive: { borderColor: colors.accent },
    webPicker: { marginTop: 8 },
    pickText: {
      flexShrink: 1,
      fontFamily: fonts.medium,
      fontSize: 15,
      color: colors.text,
    },
    clear: {
      width: 44,
      height: 50,
      borderRadius: radii.input,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      alignItems: "center",
      justifyContent: "center",
    },
    pickerCard: {
      backgroundColor: colors.surface,
      borderRadius: radii.card,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 12,
      marginTop: 10,
    },
  }),
);
