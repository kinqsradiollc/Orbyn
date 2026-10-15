import React, { useEffect, useRef, useState } from "react";
import { ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import {
  FIELD_TYPE_LABELS,
  FIELD_TYPES,
  type CustomField,
  type FieldTarget,
  type FieldType,
  type FieldValue,
  type TargetFields,
} from "@orbyn/core";
import { Chip, ChipRow } from "../../components/Chip";
import { DateField } from "../../components/Field";
import { MoreMenu } from "../../components/MoreMenu";
import { SmallAction } from "../../components/SmallAction";
import { Switch } from "../../components/Switch";
import { Sheet, sheetStyles } from "../../components/Sheet";
import { ErrorBanner } from "../../components/ErrorBanner";
import { client } from "../../lib/api";
import { confirmAction } from "../../lib/confirm";
import { shared } from "../../styles";
import { colors, fonts, themed } from "../../theme";

const choicesOf = (text: string) => [
  ...new Set(
    text
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  ),
];

/**
 * Your own fields on a page or project (ORG-02), for its Info: each field
 * its space has, ready to change, and "Add a field" for anyone who can
 * change the page or project. A field's ⋯ (for whoever made it, or the
 * team's owners and admins) renames it, changes its choices, puts it on
 * the calendar or removes it.
 */
export function FieldsSection({
  target,
  targetId,
  revision,
  report,
  onChanged,
  onDraftState,
  frame = (content) => content,
}: {
  target: FieldTarget;
  targetId: string;
  /** Changes when the page or project is saved, to read afresh. */
  revision?: string | number;
  report: (e: unknown) => void;
  onChanged?: () => void;
  onDraftState?: (state: { dirty: boolean; pending: boolean }) => void;
  /** Its heading and box, drawn only when there is something to show. */
  frame?: (content: React.ReactNode) => React.ReactNode;
}) {
  const [data, setData] = useState<TargetFields | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<CustomField | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const dirtyValues = useRef(new Map<string, boolean>());
  const pendingValues = useRef(new Set<string>());
  const draftReporter = useRef(onDraftState);
  draftReporter.current = onDraftState;
  const editorActive = useRef(false);
  editorActive.current = !!editing || (adding && !!data?.can_write);
  const notifyDraft = () =>
    draftReporter.current?.({
      dirty: [...dirtyValues.current.values()].some(Boolean),
      pending: editorActive.current || pendingValues.current.size > 0,
    });
  useEffect(() => {
    const ids = new Set(data?.fields.map((field) => field.id) ?? []);
    if (data)
      for (const id of dirtyValues.current.keys())
        if (!ids.has(id)) dirtyValues.current.delete(id);
    notifyDraft();
  }, [data, adding, editing]);
  useEffect(
    () => () => draftReporter.current?.({ dirty: false, pending: false }),
    [],
  );

  const read = useRef(0);
  const mounted = useRef(true);
  const owner = useRef({ target, targetId });
  owner.current = { target, targetId };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      read.current += 1;
    };
  }, []);
  const reportRef = useRef(report);
  reportRef.current = report;
  const load = async () => {
    const request = ++read.current;
    setLoadFailed(false);
    try {
      const next = await client.targetFields(target, targetId);
      if (mounted.current && request === read.current) setData(next);
    } catch (e) {
      if (mounted.current && request === read.current) {
        setLoadFailed(true);
        reportRef.current(e);
      }
    }
  };
  useEffect(() => {
    setData(null);
    setAdding(false);
    setEditing(null);
    void load();
    return () => {
      read.current += 1;
    };
  }, [target, targetId, revision, retry]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!data)
    return frame(
      loadFailed ? (
        <SmallAction
          label="Retry fields"
          disabled={false}
          onPress={() => setRetry((n) => n + 1)}
        />
      ) : (
        <Text style={shared.small}>Loading fields…</Text>
      ),
    );
  if (!data.fields.length && !data.can_write) return null;

  const save = async (field: CustomField, value: FieldValue) => {
    if (!data.can_write) return false;
    const current = owner.current;
    const owns = () =>
      mounted.current &&
      current.target === owner.current.target &&
      current.targetId === owner.current.targetId;
    try {
      const saved = await client.setFieldValue(
        field.id,
        target,
        targetId,
        value,
      );
      if (owns()) {
        setData((d) =>
          d ? { ...d, values: { ...d.values, [field.id]: saved.value } } : d,
        );
        onChanged?.();
      }
      return true;
    } catch (e) {
      if (owns()) report(e);
      return false;
    }
  };
  const change = async (
    field: CustomField,
    input: Parameters<typeof client.updateField>[1],
  ) => {
    if (!field.can_manage) return false;
    const current = owner.current;
    const owns = () =>
      mounted.current &&
      current.target === owner.current.target &&
      current.targetId === owner.current.targetId;
    try {
      await client.updateField(field.id, input);
      if (owns()) {
        setEditing(null);
        void load();
        onChanged?.();
      }
      return true;
    } catch (e) {
      if (owns()) report(e);
      return false;
    }
  };

  const remove = (field: CustomField) => {
    if (!field.can_manage) return;
    const current = owner.current;
    const owns = () =>
      mounted.current &&
      current.target === owner.current.target &&
      current.targetId === owner.current.targetId;
    confirmAction(
      `Remove ${field.name}?`,
      `Removes this field and its values from all ${target}s ${field.team_name ? `in ${field.team_name}` : "of yours"}.`,
      "Remove field",
      async () => {
        if (!owns()) return;
        try {
          await client.deleteField(field.id);
          if (owns()) {
            void load();
            onChanged?.();
          }
        } catch (e) {
          if (owns()) report(e);
        }
      },
    );
  };

  return frame(
    <View style={s.wrap}>
      {data.fields.map((field) => (
        <View key={field.id} style={s.row}>
          <View style={s.head}>
            <Text style={s.name}>{field.name}</Text>
            {field.can_manage && (
              <MoreMenu
                label={`${field.name} options`}
                title={field.name}
                actions={[
                  {
                    label: "Rename or change",
                    onPress: () => setEditing(field),
                  },
                  {
                    label: "Remove field",
                    destructive: true,
                    onPress: () => remove(field),
                  },
                ]}
              />
            )}
          </View>
          <FieldValueInput
            key={`${target}:${targetId}:${field.id}`}
            field={field}
            value={data.values[field.id]}
            people={data.people}
            editable={data.can_write}
            onDraftChange={(dirty) => {
              dirtyValues.current.set(field.id, dirty);
              notifyDraft();
            }}
            onPendingChange={(pending) => {
              if (pending) pendingValues.current.add(field.id);
              else pendingValues.current.delete(field.id);
              notifyDraft();
            }}
            onCommit={(value) => save(field, value)}
          />
        </View>
      ))}
      {data.can_write &&
        (adding ? (
          <NewField
            key={`${target}:${targetId}`}
            target={target}
            teamId={data.team_id}
            report={report}
            onCancel={() => setAdding(false)}
            onMade={() => {
              setAdding(false);
              void load();
              onChanged?.();
            }}
          />
        ) : (
          <View style={s.actions}>
            <SmallAction
              label="Add a field"
              disabled={false}
              onPress={() => setAdding(true)}
            />
          </View>
        ))}
      {editing && (
        <FieldSettings
          key={`${target}:${targetId}:${editing.id}`}
          field={editing}
          onCancel={() => setEditing(null)}
          onSave={(input) => change(editing, input)}
        />
      )}
    </View>,
  );
}

/** One field's value, ready to change. */
export function FieldValueInput({
  field,
  value,
  people,
  editable,
  onCommit,
  manualSave = false,
  onDraftChange,
  onPendingChange,
}: {
  field: CustomField;
  value: FieldValue | undefined;
  people: { id: string; name: string }[];
  editable: boolean;
  manualSave?: boolean;
  onDraftChange?: (dirty: boolean) => void;
  onPendingChange?: (pending: boolean) => void;
  onCommit: (value: FieldValue) => void | Promise<boolean | void>;
}) {
  const shown = value === null || value === undefined ? "" : String(value);
  const [draft, setDraft] = useState(shown);
  useEffect(() => setDraft(shown), [shown]);
  const writing = useRef(false);
  const mounted = useRef(true);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    onDraftChange?.(draft !== shown || failed);
  }, [draft, shown, failed, onDraftChange]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const commit = async (next: FieldValue) => {
    if (!editable || writing.current) return;
    writing.current = true;
    onPendingChange?.(true);
    setPending(true);
    setFailed(false);
    setDraft(next == null ? "" : String(next));
    try {
      const saved = await onCommit(next);
      if (mounted.current && saved === false) setFailed(true);
    } catch {
      if (mounted.current) setFailed(true);
    } finally {
      writing.current = false;
      onPendingChange?.(false);
      if (mounted.current) setPending(false);
    }
  };
  const control = () => {
    switch (field.type) {
      case "checkbox":
        return (
          <Switch
            accessibilityLabel={field.name}
            value={draft === "true"}
            disabled={!editable || pending}
            onValueChange={(on) => void commit(on)}
          />
        );
      case "date":
        return editable ? (
          <DateField
            label={field.name}
            value={draft || null}
            placeholder="No date"
            clearable
            disabled={pending}
            onChange={(day) => void commit(day)}
          />
        ) : (
          <Text style={s.value}>{shown || "No date"}</Text>
        );
      case "select":
      case "person": {
        const options =
          field.type === "select"
            ? field.options.map((o) => ({ id: o, label: o }))
            : people.map((p) => ({ id: p.id, label: p.name }));
        return (
          <ChipRow label={field.name}>
            {options.map((o) => (
              <Chip
                key={o.id}
                compact
                label={o.label}
                selected={draft === o.id}
                disabled={!editable || pending}
                onPress={() => void commit(draft === o.id ? null : o.id)}
              />
            ))}
          </ChipRow>
        );
      }
      default:
        return (
          <TextInput
            style={[shared.input, s.input]}
            accessibilityLabel={field.name}
            value={draft}
            editable={editable && !pending}
            placeholder={field.type === "number" ? "0" : "Empty"}
            placeholderTextColor={colors.faint}
            keyboardType={field.type === "number" ? "decimal-pad" : "default"}
            maxLength={500}
            onChangeText={(next) => {
              onDraftChange?.(next !== shown || failed);
              setDraft(next);
            }}
            onEndEditing={() => {
              if (!manualSave && draft.trim() !== shown)
                void commit(draft.trim() === "" ? null : draft);
            }}
            returnKeyType="done"
          />
        );
    }
  };
  return (
    <View style={s.row}>
      {control()}
      {(failed || (manualSave && ["text", "number"].includes(field.type))) && (
        <View style={s.actions}>
          {failed && (
            <Text style={shared.small} accessibilityLiveRegion="polite">
              Not saved
            </Text>
          )}
          <SmallAction
            label={pending ? "Saving…" : failed ? "Retry save" : "Save"}
            disabled={pending || !editable}
            onPress={() =>
              void commit(
                field.type === "checkbox"
                  ? draft === "true"
                  : draft.trim() || null,
              )
            }
          />
        </View>
      )}
    </View>
  );
}

/** Making a field: its name, its type, choices for a choice field. */
function NewField({
  target,
  teamId,
  report,
  onCancel,
  onMade,
}: {
  target: FieldTarget;
  teamId: string | null;
  report: (e: unknown) => void;
  onCancel: () => void;
  onMade: () => void;
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState<FieldType>("text");
  const [choices, setChoices] = useState("");
  const [onCalendar, setOnCalendar] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const writing = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const options = type === "select" ? choicesOf(choices) : [];
  const ready =
    !!name.trim() &&
    (type !== "select" || (options.length > 0 && options.length <= 30));
  return (
    <Sheet
      visible
      title="Add field"
      closeDisabled={busy}
      onClose={() => {
        if (!writing.current) onCancel();
      }}
    >
      <ScrollView
        contentContainerStyle={sheetStyles.body}
        keyboardShouldPersistTaps="handled"
      >
        <View style={sheetStyles.column}>
          <ErrorBanner error={error} onDismiss={() => setError("")} />
          <View style={s.form}>
            <Text style={shared.label}>Name</Text>
            <TextInput
              style={shared.input}
              accessibilityLabel="Field name"
              placeholder="Name, like Essay due"
              placeholderTextColor={colors.faint}
              editable={!busy}
              value={name}
              maxLength={60}
              onChangeText={setName}
              autoFocus
            />
            <Text style={shared.label}>Type</Text>
            <ChipRow label="Field type">
              {FIELD_TYPES.map((t) => (
                <Chip
                  key={t}
                  compact
                  disabled={busy}
                  label={FIELD_TYPE_LABELS[t]}
                  selected={type === t}
                  onPress={() => setType(t)}
                />
              ))}
            </ChipRow>
            {type === "select" && (
              <TextInput
                style={shared.input}
                accessibilityLabel="Choices"
                placeholder="Up to 30 choices, separated by commas"
                placeholderTextColor={colors.faint}
                editable={!busy}
                value={choices}
                onChangeText={setChoices}
              />
            )}
            {type === "date" && (
              <View style={s.switchRow}>
                <Text style={[s.value, s.switchLabel]}>Calendar deadline</Text>
                <Switch
                  accessibilityLabel="Show on the calendar as a deadline"
                  disabled={busy}
                  value={onCalendar}
                  onValueChange={setOnCalendar}
                />
              </View>
            )}
            <Text style={shared.small}>
              {teamId
                ? `Available on all ${target}s in this team.`
                : `Available on all your personal ${target}s.`}
            </Text>
            <View style={s.actions}>
              <SmallAction label="Cancel" disabled={busy} onPress={onCancel} />
              <SmallAction
                label={busy ? "Adding…" : "Add field"}
                disabled={!ready || busy}
                onPress={() => {
                  if (!ready || writing.current) return;
                  writing.current = true;
                  setError("");
                  setBusy(true);
                  client
                    .createField({
                      name: name.trim(),
                      type,
                      applies_to: target,
                      team_id: teamId,
                      options,
                      on_calendar: type === "date" && onCalendar,
                    })
                    .then(
                      () => {
                        if (mounted.current) onMade();
                      },
                      (e) => {
                        if (mounted.current) {
                          setError(
                            e instanceof Error
                              ? e.message
                              : "Couldn’t add field. Try again.",
                          );
                          report(e);
                        }
                      },
                    )
                    .finally(() => {
                      writing.current = false;
                      if (mounted.current) setBusy(false);
                    });
                }}
              />
            </View>
          </View>
        </View>
      </ScrollView>
    </Sheet>
  );
}

/** Renaming a field, its choices and the calendar switch. */
function FieldSettings({
  field,
  onCancel,
  onSave,
}: {
  field: CustomField;
  onCancel: () => void;
  onSave: (input: {
    name?: string;
    options?: string[];
    on_calendar?: boolean;
  }) => Promise<boolean>;
}) {
  const [name, setName] = useState(field.name);
  const [choices, setChoices] = useState(field.options.join(", "));
  const [onCalendar, setOnCalendar] = useState(field.on_calendar);
  const options = choicesOf(choices);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const writing = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const valid =
    !!name.trim() &&
    (field.type !== "select" || (options.length > 0 && options.length <= 30));
  const changed =
    name.trim() !== field.name ||
    (field.type === "select" &&
      options.join(",") !== field.options.join(",")) ||
    (field.type === "date" && onCalendar !== field.on_calendar);
  return (
    <Sheet
      visible
      title="Edit field"
      closeDisabled={busy}
      onClose={() => {
        if (!writing.current) onCancel();
      }}
    >
      <ScrollView
        contentContainerStyle={sheetStyles.body}
        keyboardShouldPersistTaps="handled"
      >
        <View style={sheetStyles.column}>
          {failed && (
            <Text style={shared.small} accessibilityLiveRegion="polite">
              Couldn’t save field. Try again.
            </Text>
          )}
          <View style={s.form}>
            <Text style={shared.label}>Name</Text>
            <TextInput
              style={shared.input}
              accessibilityLabel="Field name"
              editable={!busy}
              value={name}
              maxLength={60}
              onChangeText={setName}
            />
            {field.type === "select" && (
              <>
                <TextInput
                  style={shared.input}
                  accessibilityLabel="Choices"
                  editable={!busy}
                  value={choices}
                  onChangeText={setChoices}
                />
                <Text style={shared.small}>
                  Up to 30, separated by commas. Removed choices clear their
                  saved values.
                </Text>
              </>
            )}
            {field.type === "date" && (
              <View style={s.switchRow}>
                <Text style={[s.value, s.switchLabel]}>Calendar deadline</Text>
                <Switch
                  accessibilityLabel="Show on the calendar as a deadline"
                  disabled={busy}
                  value={onCalendar}
                  onValueChange={setOnCalendar}
                />
              </View>
            )}
            <View style={s.actions}>
              <SmallAction label="Cancel" disabled={busy} onPress={onCancel} />
              <SmallAction
                label={busy ? "Saving…" : "Save field"}
                disabled={busy || !valid || !changed}
                onPress={async () => {
                  if (writing.current || !valid || !changed) return;
                  writing.current = true;
                  setBusy(true);
                  setFailed(false);
                  try {
                    const saved = await onSave({
                      ...(name.trim() !== field.name
                        ? { name: name.trim() }
                        : {}),
                      ...(field.type === "select" &&
                      options.join(",") !== field.options.join(",")
                        ? { options }
                        : {}),
                      ...(field.type === "date" &&
                      onCalendar !== field.on_calendar
                        ? { on_calendar: onCalendar }
                        : {}),
                    });
                    if (mounted.current && !saved) setFailed(true);
                  } catch {
                    if (mounted.current) setFailed(true);
                  } finally {
                    writing.current = false;
                    if (mounted.current) setBusy(false);
                  }
                }}
              />
            </View>
          </View>
        </View>
      </ScrollView>
    </Sheet>
  );
}

const s = themed(() =>
  StyleSheet.create({
    wrap: { gap: 14 },
    row: { gap: 6 },
    head: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 8,
    },
    name: {
      flex: 1,
      minWidth: 0,
      fontFamily: fonts.medium,
      fontSize: 13,
      color: colors.textSoft,
    },
    value: { fontFamily: fonts.regular, fontSize: 15, color: colors.text },
    switchLabel: { flex: 1, minWidth: 0 },
    input: { minHeight: 44, paddingVertical: 10 },
    form: { gap: 10 },
    actions: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
    switchRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 12,
    },
  }),
);
