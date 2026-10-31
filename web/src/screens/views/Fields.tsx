import {
  FIELD_TYPE_LABELS,
  FIELD_TYPES,
  type CustomField,
  type CustomFieldUpdate,
  type FieldTarget,
  type FieldType,
  type FieldValue,
  type TargetFields,
} from "@orbyn/core";
import { MoreHorizontal, Plus } from "lucide-react";
import { useState } from "react";
import { messageOf, useResource } from "../../lib/resource";
import { client } from "../../lib/session";
import {
  Button,
  Dialog,
  ErrorNotice,
  Field,
  IconButton,
  Input,
  Loading,
  SelectBox,
  useConfirm,
  useToast,
} from "../../ui/kit";
import { FieldInput } from "./FieldInput";

const choicesOf = (text: string) => [
  ...new Set(
    text
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  ),
];

function NewField({
  target,
  teamId,
  onCancel,
  onMade,
}: {
  target: FieldTarget;
  teamId: string | null;
  onCancel: () => void;
  onMade: () => void;
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState<FieldType>("text");
  const [choices, setChoices] = useState("");
  const [onCalendar, setOnCalendar] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const options = type === "select" ? choicesOf(choices) : [];
  const ready =
    !!name.trim() &&
    (type !== "select" || (options.length > 0 && options.length <= 30));
  const save = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setError("");
    try {
      await client.createField({
        name: name.trim(),
        type,
        applies_to: target,
        team_id: teamId,
        options,
        on_calendar: type === "date" && onCalendar,
      });
      onMade();
    } catch (failure) {
      setError(messageOf(failure, "Couldn't add the field."));
      setBusy(false);
    }
  };
  return (
    <Dialog
      title="Add field"
      onClose={() => !busy && onCancel()}
      actions={
        <>
          <Button variant="ghost" disabled={busy} onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant="primary"
            busy={busy}
            disabled={!ready}
            onClick={() => void save()}
          >
            {busy ? "Adding…" : "Add field"}
          </Button>
        </>
      }
    >
      <Field label="Name">
        <Input
          autoFocus
          placeholder="Name, like Essay due"
          value={name}
          maxLength={60}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>
      <Field label="Type">
        <SelectBox
          value={type}
          onChange={(e) => setType(e.target.value as FieldType)}
        >
          {FIELD_TYPES.map((t) => (
            <option key={t} value={t}>
              {FIELD_TYPE_LABELS[t]}
            </option>
          ))}
        </SelectBox>
      </Field>
      {type === "select" && (
        <Field label="Choices">
          <Input
            placeholder="Up to 30 choices, separated by commas"
            value={choices}
            onChange={(e) => setChoices(e.target.value)}
          />
        </Field>
      )}
      {type === "date" && (
        <label className="check">
          <input
            type="checkbox"
            checked={onCalendar}
            onChange={(e) => setOnCalendar(e.target.checked)}
          />
          Show deadlines on Calendar
        </label>
      )}
      <p className="muted small">
        {teamId
          ? `Available on all ${target}s in this team.`
          : `Available on all your personal ${target}s.`}
      </p>
      {error && <ErrorNotice message={error} />}
    </Dialog>
  );
}

function FieldOptions({
  field,
  onClose,
  onSave,
  onRemove,
}: {
  field: CustomField;
  onClose: () => void;
  onSave: (input: CustomFieldUpdate) => Promise<void>;
  onRemove: () => void;
}) {
  const [name, setName] = useState(field.name);
  const [choices, setChoices] = useState(field.options.join(", "));
  const [onCalendar, setOnCalendar] = useState(field.on_calendar);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const options = choicesOf(choices);
  const valid =
    !!name.trim() &&
    (field.type !== "select" || (options.length > 0 && options.length <= 30));
  const save = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setError("");
    try {
      await onSave({
        name: name.trim(),
        ...(field.type === "select" ? { options } : {}),
        ...(field.type === "date" ? { on_calendar: onCalendar } : {}),
      });
    } catch (failure) {
      setError(messageOf(failure, "Couldn't save the field."));
      setBusy(false);
    }
  };
  return (
    <Dialog
      title="Field options"
      onClose={() => !busy && onClose()}
      actions={
        <>
          <Button variant="danger" disabled={busy} onClick={onRemove}>
            Remove field
          </Button>
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            busy={busy}
            disabled={!valid}
            onClick={() => void save()}
          >
            Save
          </Button>
        </>
      }
    >
      <Field label="Name">
        <Input
          autoFocus
          maxLength={60}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>
      {field.type === "select" && (
        <Field label="Choices">
          <Input value={choices} onChange={(e) => setChoices(e.target.value)} />
        </Field>
      )}
      {field.type === "date" && (
        <label className="check">
          <input
            type="checkbox"
            checked={onCalendar}
            onChange={(e) => setOnCalendar(e.target.checked)}
          />
          Show deadlines on Calendar
        </label>
      )}
      {error && <ErrorNotice message={error} />}
    </Dialog>
  );
}

/** Your own fields on a project: each ready to change, with room for more. */
export function FieldsPanel({
  target,
  targetId,
  revision,
}: {
  target: FieldTarget;
  targetId: string;
  revision?: string | number;
}) {
  const confirm = useConfirm();
  const toast = useToast();
  const read = useResource<TargetFields>(
    () => client.targetFields(target, targetId),
    [target, targetId, revision],
  );
  const [adding, setAdding] = useState(false);
  const [menu, setMenu] = useState<CustomField | null>(null);
  const data = read.data;
  if (read.error && !data)
    return (
      <ErrorNotice message={read.error} onRetry={() => void read.reload()} />
    );
  if (!data) return <Loading label="Loading fields" />;
  if (!data.fields.length && !data.can_write) return null;
  const save = async (field: CustomField, value: FieldValue) => {
    try {
      const saved = await client.setFieldValue(
        field.id,
        target,
        targetId,
        value,
      );
      read.set((d) =>
        d ? { ...d, values: { ...d.values, [field.id]: saved.value } } : d,
      );
      return true;
    } catch (failure) {
      toast({ text: messageOf(failure, "Couldn't save that."), error: true });
      return false;
    }
  };
  const remove = async (field: CustomField) => {
    setMenu(null);
    const yes = await confirm({
      title: `Remove ${field.name}?`,
      body: `It comes off every ${target} ${field.team_name ? `in ${field.team_name}` : "of yours"}, with what was filled in.`,
      action: "Remove field",
      danger: true,
    });
    if (!yes) return;
    try {
      await client.deleteField(field.id);
      await read.reload();
    } catch (failure) {
      toast({
        text: messageOf(failure, "Couldn't remove the field."),
        error: true,
      });
    }
  };
  return (
    <section className="pj-side" aria-label="Fields">
      <h3>Fields</h3>
      {data.fields.length > 0 && (
        <dl className="pj-fields">
          {data.fields.map((field) => (
            <div key={field.id}>
              <dt title={FIELD_TYPE_LABELS[field.type]} dir="auto">
                {field.name}
              </dt>
              <dd>
                <FieldInput
                  field={field}
                  value={data.values[field.id]}
                  people={data.people}
                  disabled={!data.can_write}
                  onCommit={(value) => save(field, value)}
                />
                {field.can_manage && (
                  <IconButton
                    label={`${field.name} options`}
                    onClick={() => setMenu(field)}
                  >
                    <MoreHorizontal />
                  </IconButton>
                )}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {data.can_write && (
        <Button variant="ghost" onClick={() => setAdding(true)}>
          <Plus aria-hidden="true" /> Add a field
        </Button>
      )}
      {adding && (
        <NewField
          target={target}
          teamId={data.team_id}
          onCancel={() => setAdding(false)}
          onMade={() => {
            setAdding(false);
            void read.reload();
          }}
        />
      )}
      {menu && (
        <FieldOptions
          field={menu}
          onClose={() => setMenu(null)}
          onSave={async (input) => {
            await client.updateField(menu.id, input);
            setMenu(null);
            await read.reload();
          }}
          onRemove={() => void remove(menu)}
        />
      )}
    </section>
  );
}
