import React, { useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import DateTimePicker from "@react-native-community/datetimepicker";
import { dateLabel, type Item, type ItemInput } from "@orbyn/core";
import { Button } from "./Button";
import { colors } from "../theme";
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

export function ItemEditor({ editing, onClose, ...form }: Props) {
  return (
    <Modal visible={!!editing} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView
        style={{ flex: 1, backgroundColor: colors.modalBackground }}
      >
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <ScrollView
            contentContainerStyle={shared.content}
            keyboardShouldPersistTaps="handled"
          >
            {editing && <Form editing={editing} onClose={onClose} {...form} />}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
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
      <Text style={shared.title}>
        {exists ? "Edit your plan" : "Make a little plan"}
      </Text>
      <Text style={s.label}>What’s the plan?</Text>
      <TextInput
        style={shared.input}
        value={editing.title}
        onChangeText={(title) => onChange({ ...editing, title })}
        maxLength={200}
        placeholder="Something worth making time for"
      />
      <Text style={s.label}>Type</Text>
      <View style={s.choices}>
        {(["task", "event"] as const).map((kind) => (
          <Button
            key={kind}
            secondary={editing.kind !== kind}
            title={kind}
            onPress={() => onChange({ ...editing, kind })}
          />
        ))}
      </View>
      <Text style={s.label}>Priority</Text>
      <View style={s.choices}>
        {(["low", "medium", "high"] as const).map((priority) => (
          <Button
            key={priority}
            secondary={editing.priority !== priority}
            title={priority}
            onPress={() => onChange({ ...editing, priority })}
          />
        ))}
      </View>
      {(["due_at", "end_at"] as const).map((field) => (
        <View key={field}>
          <Text style={s.label}>
            {field === "due_at" ? "Due / start" : "End (optional)"}
          </Text>
          <Button
            secondary
            title={dateLabel(editing[field])}
            onPress={() => setPicker({ field, mode: "date" })}
          />
          {editing[field] && (
            <Button
              secondary
              title="Clear time"
              onPress={() => onChange({ ...editing, [field]: null })}
            />
          )}
        </View>
      ))}
      {picker && (
        <DateTimePicker
          value={new Date(editing[picker.field] || Date.now())}
          mode={picker.mode}
          display={Platform.OS === "ios" ? "spinner" : "default"}
          onChange={(event, date) => {
            if (event.type === "dismissed") {
              setPicker(null);
              return;
            }
            if (date) {
              const current = new Date(editing[picker.field] || Date.now());
              if (picker.mode === "date")
                current.setFullYear(
                  date.getFullYear(),
                  date.getMonth(),
                  date.getDate(),
                );
              else current.setHours(date.getHours(), date.getMinutes(), 0, 0);
              onChange({
                ...editing,
                [picker.field]: current.toISOString(),
              });
              if (Platform.OS === "android")
                setPicker(
                  picker.mode === "date" ? { ...picker, mode: "time" } : null,
                );
            }
          }}
        />
      )}
      {picker && Platform.OS === "ios" && (
        <Button
          title={picker.mode === "date" ? "Choose time" : "Done"}
          onPress={() => {
            if (!editing[picker.field])
              onChange({
                ...editing,
                [picker.field]: new Date().toISOString(),
              });
            setPicker(
              picker.mode === "date" ? { ...picker, mode: "time" } : null,
            );
          }}
        />
      )}
      <Text style={s.label}>Notes</Text>
      <TextInput
        style={[shared.input, { minHeight: 90 }]}
        multiline
        value={editing.notes}
        maxLength={10000}
        onChangeText={(notes) => onChange({ ...editing, notes })}
      />
      <Text style={s.label}>Remind me before (minutes)</Text>
      <TextInput
        style={shared.input}
        keyboardType="number-pad"
        value={String(editing.reminder_minutes)}
        onChangeText={(value) =>
          onChange({ ...editing, reminder_minutes: Number(value) || 0 })
        }
      />
      {!!error && <Text style={shared.error}>{error}</Text>}
      <Button
        title={busy ? "Saving…" : "Save item"}
        disabled={busy}
        onPress={onSave}
      />
      {exists && (
        <Button
          secondary
          title="Delete item"
          disabled={busy}
          onPress={() =>
            Alert.alert(
              "Delete this item?",
              "This removes it from your planner.",
              [
                { text: "Cancel", style: "cancel" },
                { text: "Delete", style: "destructive", onPress: onDelete },
              ],
            )
          }
        />
      )}
      <Button secondary title="Cancel" onPress={onClose} />
    </>
  );
}

const s = StyleSheet.create({
  label: { fontSize: 11, color: "#708362", marginBottom: 10, marginTop: 5 },
  choices: { flexDirection: "row", gap: 10, marginBottom: 10 },
});
