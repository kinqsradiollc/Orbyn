import { useEffect, useRef, useState } from "react";
import { MoreHorizontal, Plus } from "lucide-react";
import {
  FIELD_TYPE_LABELS,
  FIELD_TYPES,
  type CustomField,
  type FieldTarget,
  type FieldType,
  type FieldValue,
  type TargetFields,
} from "@orbyn/core";
import { client } from "../../lib/api";
import { Popover } from "../../components/Popover";
import { Select } from "../../components/Select";
import { useConfirm } from "../../components/Confirm";
import { FieldInput } from "./FieldInput";
import "./views.css";

/**
 * Your own fields on a page or project (ORG-02), in its Info panel: every
 * field its space has, each ready to change, and "Add a field" for anyone
 * who can change it. Whoever made a field (or a team's owners and admins)
 * renames it, changes its choices, shows it on the calendar or removes it
 * from the ⋯ beside it.
 */
export function FieldsPanel({
  target,
  targetId,
  revision,
  report,
  onChanged,
  heading = "Fields",
  className = "page-info-section",
}: {
  target: FieldTarget;
  targetId: string;
  /** Changes when the page or project is saved, to read afresh. */
  revision?: string | number;
  report: (e: unknown) => void;
  /** A value or field changed (so views and the calendar can refresh). */
  onChanged?: () => void;
  heading?: string;
  /** The section's look: the Info rail's, or a project Home card's. */
  className?: string;
}) {
  const [data, setData] = useState<TargetFields | null>(null);
  const [adding, setAdding] = useState(false);
  const [menu, setMenu] = useState<{
    field: CustomField;
    anchor: DOMRect;
  } | null>(null);
  const reportRef = useRef(report);
  reportRef.current = report;
  const { ask } = useConfirm();

  const load = () =>
    client.targetFields(target, targetId).then(setData, (e) => {
      reportRef.current(e);
    });
  useEffect(() => {
    setData(null);
    void load();
  }, [target, targetId, revision]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!data) return null;
  if (!data.fields.length && !data.can_write) return null;

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

  const remove = async (field: CustomField) => {
    setMenu(null);
    const ok = await ask({
      title: `Remove ${field.name}?`,
      body: `It comes off every ${target === "page" ? "page" : "project"} ${
        field.team_name ? `in ${field.team_name}` : "of yours"
      }, with what was filled in.`,
      confirmLabel: "Remove field",
      destructive: true,
    });
    if (!ok) return;
    client.deleteField(field.id).then(() => {
      void load();
      onChanged?.();
    }, report);
  };

  const change = (
    field: CustomField,
    input: Parameters<typeof client.updateField>[1],
  ) => {
    setMenu(null);
    client.updateField(field.id, input).then(() => {
      void load();
      onChanged?.();
    }, report);
  };

  return (
    <section className={`${className} fields-panel`} aria-label={heading}>
      <h3>{heading}</h3>
      {data.fields.length > 0 && (
        <dl className="field-list">
          {data.fields.map((field) => (
            <div className="field-row" key={field.id}>
              <dt title={FIELD_TYPE_LABELS[field.type]}>{field.name}</dt>
              <dd>
                <FieldInput
                  field={field}
                  value={data.values[field.id]}
                  people={data.people}
                  disabled={!data.can_write}
                  onCommit={(value) => save(field, value)}
                />
                {field.can_manage && (
                  <button
                    className="icon-button field-more"
                    aria-label={`${field.name} options`}
                    title="Field options"
                    onClick={(e) =>
                      setMenu({
                        field,
                        anchor: e.currentTarget.getBoundingClientRect(),
                      })
                    }
                  >
                    <MoreHorizontal size={14} />
                  </button>
                )}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {data.can_write &&
        (adding ? (
          <NewField
            target={target}
            teamId={data.team_id}
            onCancel={() => setAdding(false)}
            onMade={() => {
              setAdding(false);
              void load();
              onChanged?.();
            }}
            report={report}
          />
        ) : (
          <button className="page-info-link" onClick={() => setAdding(true)}>
            <Plus size={13} aria-hidden="true" /> Add a field
          </button>
        ))}
      {menu && (
        <Popover
          anchor={menu.anchor}
          label={`${menu.field.name} options`}
          onClose={() => setMenu(null)}
        >
          <FieldOptions
            field={menu.field}
            onRename={(name) => change(menu.field, { name })}
            onChoices={(options) => change(menu.field, { options })}
            onCalendar={(on_calendar) => change(menu.field, { on_calendar })}
            onRemove={() => void remove(menu.field)}
          />
        </Popover>
      )}
    </section>
  );
}

const choicesOf = (text: string) =>
  [
    ...new Set(
      text
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ].slice(0, 30);

/** Making a field: its name, its type, choices for a choice field. */
function NewField({
  target,
  teamId,
  onCancel,
  onMade,
  report,
}: {
  target: FieldTarget;
  teamId: string | null;
  onCancel: () => void;
  onMade: () => void;
  report: (e: unknown) => void;
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState<FieldType>("text");
  const [choices, setChoices] = useState("");
  const [onCalendar, setOnCalendar] = useState(false);
  const [busy, setBusy] = useState(false);
  const options = type === "select" ? choicesOf(choices) : [];
  const ready = name.trim() && (type !== "select" || options.length > 0);
  return (
    <form
      className="new-field"
      onSubmit={(e) => {
        e.preventDefault();
        if (!ready || busy) return;
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
          .then(onMade, (err) => {
            setBusy(false);
            report(err);
          });
      }}
    >
      <input
        autoFocus
        aria-label="Field name"
        placeholder="Name, like Essay due"
        value={name}
        maxLength={60}
        onChange={(e) => setName(e.target.value)}
      />
      <Select
        aria-label="Field type"
        value={type}
        onChange={(e) => setType(e.target.value as FieldType)}
      >
        {FIELD_TYPES.map((t) => (
          <option key={t} value={t}>
            {FIELD_TYPE_LABELS[t]}
          </option>
        ))}
      </Select>
      {type === "select" && (
        <input
          aria-label="Choices"
          placeholder="Choices, separated by commas"
          value={choices}
          onChange={(e) => setChoices(e.target.value)}
        />
      )}
      {type === "date" && (
        <label className="field-check">
          <input
            type="checkbox"
            checked={onCalendar}
            onChange={(e) => setOnCalendar(e.target.checked)}
          />
          Show on the calendar as a deadline
        </label>
      )}
      <small className="muted">
        {teamId
          ? `Every ${target} in this team gets it.`
          : `Every one of your own ${target}s gets it.`}
      </small>
      <div className="new-field-actions">
        <button type="button" className="secondary" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="primary" disabled={!ready || busy}>
          Add field
        </button>
      </div>
    </form>
  );
}

/** A field's ⋯: rename, its choices, the calendar switch, remove. */
function FieldOptions({
  field,
  onRename,
  onChoices,
  onCalendar,
  onRemove,
}: {
  field: CustomField;
  onRename: (name: string) => void;
  onChoices: (options: string[]) => void;
  onCalendar: (on: boolean) => void;
  onRemove: () => void;
}) {
  const [name, setName] = useState(field.name);
  const [choices, setChoices] = useState(field.options.join(", "));
  return (
    <div className="field-options">
      <label>
        <span>Name</span>
        <input
          value={name}
          maxLength={60}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            if (name.trim() && name.trim() !== field.name)
              onRename(name.trim());
          }}
        />
      </label>
      {name.trim() && name.trim() !== field.name && (
        <button className="secondary" onClick={() => onRename(name.trim())}>
          Rename
        </button>
      )}
      {field.type === "select" && (
        <>
          <label>
            <span>Choices</span>
            <input
              value={choices}
              onChange={(e) => setChoices(e.target.value)}
            />
          </label>
          <small className="muted">
            A choice taken away is cleared where it was picked.
          </small>
          {choicesOf(choices).join(", ") !== field.options.join(", ") &&
            choicesOf(choices).length > 0 && (
              <button
                className="secondary"
                onClick={() => onChoices(choicesOf(choices))}
              >
                Save choices
              </button>
            )}
        </>
      )}
      {field.type === "date" && (
        <label className="field-check">
          <input
            type="checkbox"
            role="switch"
            className="ai-switch"
            checked={field.on_calendar}
            onChange={(e) => onCalendar(e.target.checked)}
          />
          Show on the calendar as a deadline
        </label>
      )}
      <button className="danger-text" onClick={onRemove}>
        Remove field
      </button>
    </div>
  );
}
