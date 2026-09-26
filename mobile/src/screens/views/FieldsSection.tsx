import React, { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
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
import { client } from "../../lib/api";
import { confirmAction } from "../../lib/confirm";
import { shared } from "../../styles";
import { colors, fonts, themed } from "../../theme";

const choicesOf = (text: string) =>
  [
    ...new Set(
      text
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ].slice(0, 30);

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
  frame = (content) => content,
}: {
  target: FieldTarget;
  targetId: string;
  /** Changes when the page or project is saved, to read afresh. */
  revision?: string | number;
  report: (e: unknown) => void;
  onChanged?: () => void;
  /** Its heading and box, drawn only when there is something to show. */
  frame?: (content: React.ReactNode) => React.ReactNode;
}) {
  const [data, setData] = useState<TargetFields | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<CustomField | null>(null);
  const reportRef = useRef(report);
  reportRef.current = report;
  const load = () =>
    client.targetFields(target, targetId).then(setData, (e) => {
      reportRef.current(e);
    });
  useEffect(() => {
    void load();
  }, [target, targetId, revision]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!data || (!data.fields.length && !data.can_write)) return null;

  const save = (field: CustomField, value: FieldValue) => {
    setData((d) =>
      d ? { ...d, values: { ...d.values, [field.id]: value } } : d,
    );
    client.setFieldValue(field.id, target, targetId, value).then(
      (saved) => {
        setData((d) =>
          d ? { ...d, values: { ...d.values, [field.id]: saved.value } } : d,
        );
        onChanged?.();
      },
      (e) => {
        report(e);
        void load();
      },
    );
  };
  const change = (
    field: CustomField,
    input: Parameters<typeof client.updateField>[1],
  ) =>
    client.updateField(field.id, input).then(() => {
      setEditing(null);
      void load();
      onChanged?.();
    }, report);

  return frame(
    <View style={s.wrap}>
      {data.fields.map((field) =>
        editing?.id === field.id ? (
          <FieldSettings
            key={field.id}
            field={field}
            onCancel={() => setEditing(null)}
            onSave={(input) => void change(field, input)}
          />
        ) : (
          <View key={field.id} style={s.row}>
            <View style={s.head}>
              <Text style={s.name} numberOfLines={1}>
                {field.name}
              </Text>
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
                      onPress: () =>
                        confirmAction(
                          `Remove ${field.name}?`,
                          `It comes off every ${target} ${
                            field.team_name
                              ? `in ${field.team_name}`
                              : "of yours"
                          }, with what was filled in.`,
                          "Remove field",
                          () =>
                            void client.deleteField(field.id).then(() => {
                              void load();
                              onChanged?.();
                            }, report),
                        ),
                    },
                  ]}
                />
              )}
            </View>
            <FieldValueInput
              field={field}
              value={data.values[field.id]}
              people={data.people}
              editable={data.can_write}
              onCommit={(value) => save(field, value)}
            />
          </View>
        ),
      )}
      {data.can_write &&
        (adding ? (
          <NewField
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
}: {
  field: CustomField;
  value: FieldValue | undefined;
  people: { id: string; name: string }[];
  editable: boolean;
  onCommit: (value: FieldValue) => void;
}) {
  const shown = value === null || value === undefined ? "" : String(value);
  const [draft, setDraft] = useState(shown);
  useEffect(() => setDraft(shown), [shown]);
  switch (field.type) {
    case "checkbox":
      return (
        <Switch
          accessibilityLabel={field.name}
          value={value === true}
          disabled={!editable}
          onValueChange={(on) => onCommit(on)}
        />
      );
    case "date":
      return editable ? (
        <DateField
          label={field.name}
          value={typeof value === "string" ? value : null}
          placeholder="No date"
          clearable
          onChange={(day) => onCommit(day)}
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
              selected={value === o.id}
              disabled={!editable}
              onPress={() => onCommit(value === o.id ? null : o.id)}
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
          editable={editable}
          placeholder={field.type === "number" ? "0" : "Empty"}
          placeholderTextColor={colors.faint}
          keyboardType={field.type === "number" ? "decimal-pad" : "default"}
          maxLength={500}
          onChangeText={setDraft}
          onEndEditing={() => {
            if (draft.trim() !== shown)
              onCommit(draft.trim() === "" ? null : draft);
          }}
          returnKeyType="done"
        />
      );
  }
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
  const options = type === "select" ? choicesOf(choices) : [];
  const ready = !!name.trim() && (type !== "select" || options.length > 0);
  return (
    <View style={s.form}>
      <TextInput
        style={shared.input}
        accessibilityLabel="Field name"
        placeholder="Name, like Essay due"
        placeholderTextColor={colors.faint}
        value={name}
        maxLength={60}
        onChangeText={setName}
        autoFocus
      />
      <ChipRow label="Field type">
        {FIELD_TYPES.map((t) => (
          <Chip
            key={t}
            compact
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
          placeholder="Choices, separated by commas"
          placeholderTextColor={colors.faint}
          value={choices}
          onChangeText={setChoices}
        />
      )}
      {type === "date" && (
        <View style={s.switchRow}>
          <Text style={s.value}>Show on the calendar as a deadline</Text>
          <Switch
            accessibilityLabel="Show on the calendar as a deadline"
            value={onCalendar}
            onValueChange={setOnCalendar}
          />
        </View>
      )}
      <Text style={shared.small}>
        {teamId
          ? `Every ${target} in this team gets it.`
          : `Every one of your own ${target}s gets it.`}
      </Text>
      <View style={s.actions}>
        <SmallAction label="Cancel" disabled={busy} onPress={onCancel} />
        <SmallAction
          label="Add field"
          disabled={!ready || busy}
          onPress={() => {
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
              .then(onMade, (e) => {
                setBusy(false);
                report(e);
              });
          }}
        />
      </View>
    </View>
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
  }) => void;
}) {
  const [name, setName] = useState(field.name);
  const [choices, setChoices] = useState(field.options.join(", "));
  const [onCalendar, setOnCalendar] = useState(field.on_calendar);
  const options = choicesOf(choices);
  return (
    <View style={s.form}>
      <TextInput
        style={shared.input}
        accessibilityLabel="Field name"
        value={name}
        maxLength={60}
        onChangeText={setName}
      />
      {field.type === "select" && (
        <>
          <TextInput
            style={shared.input}
            accessibilityLabel="Choices"
            value={choices}
            onChangeText={setChoices}
          />
          <Text style={shared.small}>
            A choice taken away is cleared where it was picked.
          </Text>
        </>
      )}
      {field.type === "date" && (
        <View style={s.switchRow}>
          <Text style={s.value}>Show on the calendar as a deadline</Text>
          <Switch
            accessibilityLabel="Show on the calendar as a deadline"
            value={onCalendar}
            onValueChange={setOnCalendar}
          />
        </View>
      )}
      <View style={s.actions}>
        <SmallAction label="Cancel" disabled={false} onPress={onCancel} />
        <SmallAction
          label="Save"
          disabled={
            !name.trim() || (field.type === "select" && !options.length)
          }
          onPress={() =>
            onSave({
              ...(name.trim() !== field.name ? { name: name.trim() } : {}),
              ...(field.type === "select" &&
              options.join(",") !== field.options.join(",")
                ? { options }
                : {}),
              ...(field.type === "date" && onCalendar !== field.on_calendar
                ? { on_calendar: onCalendar }
                : {}),
            })
          }
        />
      </View>
    </View>
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
      fontFamily: fonts.medium,
      fontSize: 13,
      color: colors.textSoft,
    },
    value: { fontFamily: fonts.regular, fontSize: 15, color: colors.text },
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
