import React, { useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import DateTimePicker from "@react-native-community/datetimepicker";
import { dateLabel, type Item, type ItemInput } from "@orbyn/core";
import { Button } from "./Button";
import { Icon } from "./Icon";
import { colors, fonts, radii, spacing } from "../theme";
import { shared } from "../styles";

/** A saved item being edited, or the draft of a new one. */
export type Editing = Item | ItemInput;

type DateField = "due_at" | "end_at";
type Picker = { field: DateField; mode: "date" | "time" };

type Props = {
  editing: Editing | null;
  busy: boolean;
  error: string;
  onChange: (editing: Editing) => void;
  onSave: () => void;
  onDelete: () => void;
  onClose: () => void;
};

/** Native sheet on iOS, full-screen modal on Android; both respect safe areas. */
export function ItemEditor({ editing, onClose, ...form }: Props) {
  return (
    <Modal
      visible={!!editing}
      animationType="slide"
      presentationStyle={Platform.OS === "ios" ? "pageSheet" : "fullScreen"}
      onRequestClose={onClose}
    >
      <SafeAreaProvider>
        <SafeAreaView
          edges={["top", "bottom", "left", "right"]}
          style={s.sheet}
        >
          {editing && <Form editing={editing} onClose={onClose} {...form} />}
        </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
}

/** Mounted only while something is being edited, so picker state resets on close. */
function Form({
  editing,
  busy,
  error,
  onChange,
  onSave,
  onDelete,
  onClose,
}: Omit<Props, "editing"> & { editing: Editing }) {
  const [picker, setPicker] = useState<Picker | null>(null);
  const exists = "id" in editing;
  return (
    <>
      <View style={s.header}>
        <Text style={s.headerTitle}>
          {exists ? "Edit your plan" : "Make a little plan"}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close editor"
          hitSlop={10}
          onPress={onClose}
          style={s.close}
        >
          <Icon name="x" size={18} color={colors.textSoft} />
        </Pressable>
      </View>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={s.body}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
        >
          <View style={s.column}>
            <Section label="What’s the plan?">
              <TextInput
                style={[shared.input, s.titleInput]}
                value={editing.title}
                onChangeText={(title) => onChange({ ...editing, title })}
                maxLength={200}
                placeholder="Something worth making time for"
                placeholderTextColor={colors.faint}
                autoFocus={!exists}
              />
            </Section>
            <Section label="Type">
              <Segmented
                options={["task", "event"] as const}
                value={editing.kind}
                onChange={(kind) => onChange({ ...editing, kind })}
              />
            </Section>
            <Section label="Priority">
              <Segmented
                options={["low", "medium", "high"] as const}
                value={editing.priority}
                onChange={(priority) => onChange({ ...editing, priority })}
              />
            </Section>
            {(["due_at", "end_at"] as const).map((field) => (
              <Section
                key={field}
                label={field === "due_at" ? "Due / start" : "End (optional)"}
              >
                <View style={s.dateRow}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={
                      (field === "due_at" ? "Due date: " : "End date: ") +
                      dateLabel(editing[field])
                    }
                    onPress={() => setPicker({ field, mode: "date" })}
                    style={({ pressed }) => [
                      s.dateButton,
                      picker?.field === field && s.dateActive,
                      pressed && { backgroundColor: colors.surfaceMuted },
                    ]}
                  >
                    <Icon
                      name={field === "due_at" ? "clock" : "calendar"}
                      size={16}
                      color={colors.accent}
                    />
                    <Text
                      style={[
                        s.dateText,
                        !editing[field] && { color: colors.faint },
                      ]}
                    >
                      {dateLabel(editing[field])}
                    </Text>
                  </Pressable>
                  {editing[field] && (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Clear time"
                      hitSlop={8}
                      onPress={() => {
                        if (picker?.field === field) setPicker(null);
                        onChange({ ...editing, [field]: null });
                      }}
                      style={s.clear}
                    >
                      <Icon name="x" size={16} color={colors.muted} />
                    </Pressable>
                  )}
                </View>
              </Section>
            ))}
            {picker && (
              <View style={s.pickerCard}>
                <DateTimePicker
                  value={new Date(editing[picker.field] || Date.now())}
                  mode={picker.mode}
                  display={Platform.OS === "ios" ? "spinner" : "default"}
                  accentColor={colors.accent}
                  textColor={colors.text}
                  onChange={(event, date) => {
                    if (event.type === "dismissed") {
                      setPicker(null);
                      return;
                    }
                    if (date) {
                      const current = new Date(
                        editing[picker.field] || Date.now(),
                      );
                      if (picker.mode === "date")
                        current.setFullYear(
                          date.getFullYear(),
                          date.getMonth(),
                          date.getDate(),
                        );
                      else
                        current.setHours(
                          date.getHours(),
                          date.getMinutes(),
                          0,
                          0,
                        );
                      onChange({
                        ...editing,
                        [picker.field]: current.toISOString(),
                      });
                      if (Platform.OS === "android")
                        setPicker(
                          picker.mode === "date"
                            ? { ...picker, mode: "time" }
                            : null,
                        );
                    }
                  }}
                />
                {Platform.OS === "ios" && (
                  <Button
                    title={picker.mode === "date" ? "Choose time" : "Done"}
                    icon={picker.mode === "date" ? "arrowRight" : "check"}
                    style={{ marginBottom: 0 }}
                    onPress={() => {
                      if (!editing[picker.field])
                        onChange({
                          ...editing,
                          [picker.field]: new Date().toISOString(),
                        });
                      setPicker(
                        picker.mode === "date"
                          ? { ...picker, mode: "time" }
                          : null,
                      );
                    }}
                  />
                )}
              </View>
            )}
            <Section label="Notes">
              <TextInput
                style={[shared.input, s.notes]}
                multiline
                textAlignVertical="top"
                value={editing.notes}
                maxLength={10000}
                placeholder="Anything worth remembering"
                placeholderTextColor={colors.faint}
                onChangeText={(notes) => onChange({ ...editing, notes })}
              />
            </Section>
            <Section label="Remind me before (minutes)">
              <TextInput
                style={shared.input}
                keyboardType="number-pad"
                value={String(editing.reminder_minutes)}
                onChangeText={(value) =>
                  onChange({ ...editing, reminder_minutes: Number(value) || 0 })
                }
              />
            </Section>
            {!!error && (
              <Text accessibilityRole="alert" style={s.error}>
                {error}
              </Text>
            )}
            <Button
              title={busy ? "Saving…" : "Save item"}
              icon={busy ? undefined : "check"}
              disabled={busy}
              onPress={onSave}
            />
            {exists && (
              <Button
                destructive
                title="Delete item"
                disabled={busy}
                onPress={() =>
                  Alert.alert(
                    "Delete this item?",
                    "This removes it from your planner.",
                    [
                      { text: "Cancel", style: "cancel" },
                      {
                        text: "Delete",
                        style: "destructive",
                        onPress: onDelete,
                      },
                    ],
                  )
                }
              />
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}

function Section({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <View style={s.section}>
      <Text style={shared.label}>{label}</Text>
      {children}
    </View>
  );
}

function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly T[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <View style={s.segmented} accessibilityRole="radiogroup">
      {options.map((option) => {
        const active = option === value;
        return (
          <Pressable
            key={option}
            accessibilityRole="radio"
            accessibilityState={{ checked: active }}
            onPress={() => onChange(option)}
            style={[s.segment, active && s.segmentActive]}
          >
            <Text style={[s.segmentText, active && s.segmentTextActive]}>
              {option}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  sheet: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.page,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  headerTitle: {
    fontFamily: fonts.display,
    fontSize: 18,
    letterSpacing: -0.4,
    color: colors.text,
  },
  close: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.surfaceMuted,
    alignItems: "center",
    justifyContent: "center",
  },
  body: { padding: spacing.page, paddingBottom: 40 },
  column: { width: "100%", maxWidth: 600, alignSelf: "center" },
  section: { marginBottom: 18 },
  titleInput: { fontFamily: fonts.medium, fontSize: 17 },
  segmented: {
    flexDirection: "row",
    backgroundColor: colors.surfaceMuted,
    borderRadius: radii.input,
    padding: 3,
  },
  segment: {
    flex: 1,
    minHeight: 40,
    borderRadius: radii.input - 3,
    alignItems: "center",
    justifyContent: "center",
  },
  segmentActive: {
    backgroundColor: colors.surface,
    shadowColor: "#1d2b23",
    shadowOpacity: 0.08,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  segmentText: {
    fontFamily: fonts.medium,
    fontSize: 14,
    color: colors.muted,
    textTransform: "capitalize",
  },
  segmentTextActive: { fontFamily: fonts.semibold, color: colors.accent },
  dateRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  dateButton: {
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
  dateActive: { borderColor: colors.accent },
  dateText: { fontFamily: fonts.medium, fontSize: 15, color: colors.text },
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
    marginBottom: 18,
  },
  notes: { minHeight: 100 },
  error: {
    fontFamily: fonts.medium,
    fontSize: 13,
    color: colors.danger,
    backgroundColor: colors.dangerSoft,
    borderRadius: radii.input,
    padding: 12,
    marginBottom: 14,
  },
});
