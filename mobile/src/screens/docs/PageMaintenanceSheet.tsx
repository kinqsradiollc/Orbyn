import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { PageMaintenanceStore } from "@orbyn/api-client";
import {
  blockText,
  serializeDoc,
  type Doc,
  type MaintainedPageBinding,
} from "@orbyn/core";
import { BottomSheet } from "../../components/BottomSheet";
import { Button } from "../../components/Button";
import { MoreMenu } from "../../components/MoreMenu";
import { Pressable } from "../../motion";
import { client } from "../../lib/api";
import { session } from "../../lib/session";
import { colors, fonts, radii, themed } from "../../theme";

/** The same scoped schedule and nonce-bound review flow as desktop. */
export function PageMaintenanceSheet({
  id,
  onChanged,
  onClose,
}: {
  id: string;
  onChanged: (doc: Doc) => void;
  onClose: () => void;
}) {
  const changed = useRef(onChanged);
  changed.current = onChanged;
  const store = useMemo(
    () =>
      new PageMaintenanceStore(
        client,
        id,
        () => session.token,
        (doc) => changed.current(doc),
      ),
    [id],
  );
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [showForm, setShowForm] = useState(true);
  useEffect(() => {
    if (state.bindings.length) setShowForm(false);
  }, [state.bindings.length]);
  const [selected, setSelected] = useState<string[]>([]);
  const [instruction, setInstruction] = useState("");
  const [frequency, setFrequency] = useState("FREQ=DAILY");
  const [editing, setEditing] = useState<MaintainedPageBinding>();
  useEffect(() => {
    void store.prepare();
    return store.dispose;
  }, [store]);
  const edit = (binding: MaintainedPageBinding) => {
    setShowForm(true);
    setEditing(binding);
    setSelected(binding.snapshot.blocks.map((block) => block.block_id));
    setInstruction(binding.instruction);
    setFrequency(binding.rrule);
  };
  return (
    <BottomSheet
      visible
      title="Page updates"
      onClose={() => {
        if (!state.busy) onClose();
      }}
    >
      <View style={s.content}>
        <Button
          title="Close"
          secondary
          disabled={state.busy}
          onPress={onClose}
          style={{ alignSelf: "flex-end" }}
        />
        {!!state.error && (
          <Text accessibilityRole="alert" style={s.error}>
            {state.error}
          </Text>
        )}
        {!state.doc && <Text style={s.muted}>Loading…</Text>}
        {!showForm && (
          <Button
            title="Add schedule"
            secondary
            disabled={state.busy}
            onPress={() => {
              setEditing(undefined);
              setSelected([]);
              setInstruction("");
              setShowForm(true);
            }}
          />
        )}
        {showForm && (
          <>
            <Text style={s.heading}>
              {editing ? "Edit schedule" : "New schedule"}
            </Text>
            <Text style={s.muted}>
              Choose the blocks your assistant may update using your configured
              model.
            </Text>
            {state.doc?.content.map(
              (block, index) =>
                block.id && (
                  <Pressable
                    key={block.id}
                    disabled={state.busy}
                    accessibilityRole="checkbox"
                    accessibilityState={{
                      checked: selected.includes(block.id),
                    }}
                    onPress={() =>
                      setSelected((ids) =>
                        ids.includes(block.id!)
                          ? ids.filter((id) => id !== block.id)
                          : [...ids, block.id!],
                      )
                    }
                    style={s.block}
                  >
                    <Text style={s.text}>
                      {selected.includes(block.id) ? "✓" : "○"} {index + 1}.{" "}
                      {blockText(block).slice(0, 140) || block.type}
                    </Text>
                  </Pressable>
                ),
            )}
            <Text style={s.heading}>Instructions</Text>
            <TextInput
              accessibilityLabel="Page update instructions"
              editable={!state.busy}
              multiline
              maxLength={4000}
              value={instruction}
              onChangeText={setInstruction}
              style={s.input}
              placeholder="What should these blocks contain?"
              placeholderTextColor={colors.muted}
            />
            <View style={s.actions}>
              {["FREQ=DAILY", "FREQ=WEEKLY"].map((value) => (
                <Button
                  key={value}
                  title={`${frequency === value ? "✓ " : ""}${value === "FREQ=DAILY" ? "Daily" : "Weekly"}`}
                  secondary
                  disabled={state.busy}
                  onPress={() => setFrequency(value)}
                />
              ))}
            </View>
            <Text style={s.muted}>
              Starts when enabled. Overnight handles updates when follow-through
              is enabled.
            </Text>
            <Button
              title={editing ? "Save and enable" : "Enable updates"}
              disabled={
                state.busy ||
                !state.doc ||
                !selected.length ||
                selected.length > 100 ||
                !instruction.trim()
              }
              onPress={() =>
                void store.save(
                  {
                    instruction,
                    rrule: frequency,
                    timezone:
                      editing?.timezone ??
                      Intl.DateTimeFormat().resolvedOptions().timeZone,
                    next_run_at: new Date().toISOString(),
                    block_ids: selected,
                    expected_doc_version: state.doc!.version,
                    paused: false,
                  },
                  editing,
                )
              }
            />
            {editing && (
              <Button
                title="New schedule"
                secondary
                disabled={state.busy}
                onPress={() => {
                  setEditing(undefined);
                  setSelected([]);
                  setInstruction("");
                }}
              />
            )}
          </>
        )}
        {!showForm && (
          <>
            <Text style={s.heading}>Schedules</Text>
            {!state.bindings.length && (
              <Text style={s.muted}>No schedules yet.</Text>
            )}
            {state.bindings.map((binding) => (
              <View key={binding.id} style={s.row}>
                <View style={s.grow}>
                  <Text style={s.text}>{binding.instruction}</Text>
                  <Text style={s.muted}>
                    {binding.paused
                      ? "Paused"
                      : binding.schedule_exhausted
                        ? "Ended"
                        : binding.rrule}{" "}
                    · {binding.snapshot.blocks.length}{" "}
                    {binding.snapshot.blocks.length === 1 ? "block" : "blocks"}
                  </Text>
                </View>
                <MoreMenu
                  label="Schedule options"
                  disabled={state.busy}
                  actions={[
                    { label: "Edit", onPress: () => edit(binding) },
                    {
                      label: binding.paused ? "Resume" : "Pause",
                      onPress: () => void store.pause(binding),
                    },
                    {
                      label: "Remove schedule",
                      destructive: true,
                      onPress: () => void store.remove(binding),
                    },
                  ]}
                />
              </View>
            ))}
            <View style={s.row}>
              <Text style={s.heading}>Recent runs</Text>
              <Button
                title="Refresh"
                secondary
                disabled={state.busy}
                onPress={() => void store.refresh()}
              />
            </View>
            {state.runs.map((run) => (
              <View key={run.id} style={s.card}>
                <Text style={s.heading}>
                  {run.lane === "overnight" ? "Overnight" : "Background"} ·{" "}
                  {run.state}
                </Text>
                <Text style={s.muted}>
                  {new Date(run.scheduled_for).toLocaleString()} ·{" "}
                  {run.estimated_tokens} estimated tokens
                </Text>
                {!!run.error && <Text style={s.text}>{run.error}</Text>}
                {run.can_review && run.replacements && (
                  <>
                    <Text style={s.heading}>Proposed replacement blocks</Text>
                    <Text selectable style={s.source}>
                      {serializeDoc(run.replacements)}
                    </Text>
                    <View style={s.actions}>
                      <Button
                        title="Apply update"
                        disabled={state.busy}
                        onPress={() => void store.decide(run, true)}
                      />
                      <Button
                        title="Decline"
                        secondary
                        disabled={state.busy}
                        onPress={() => void store.decide(run, false)}
                      />
                    </View>
                  </>
                )}
              </View>
            ))}
          </>
        )}
      </View>
    </BottomSheet>
  );
}
const s = themed(() =>
  StyleSheet.create({
    content: { padding: 16, gap: 12 },
    heading: { fontFamily: fonts.semibold, fontSize: 18, color: colors.text },
    text: { fontFamily: fonts.regular, fontSize: 15, color: colors.text },
    muted: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted },
    error: { color: colors.danger },
    block: {
      padding: 12,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.input,
    },
    input: {
      padding: 12,
      minHeight: 88,
      textAlignVertical: "top",
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.input,
      color: colors.text,
      fontFamily: fonts.regular,
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 8,
    },
    grow: { flex: 1 },
    actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    card: {
      padding: 12,
      gap: 8,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radii.card,
    },
    source: {
      padding: 12,
      backgroundColor: colors.surfaceMuted,
      color: colors.text,
      fontFamily: fonts.regular,
      fontSize: 13,
    },
  }),
);
