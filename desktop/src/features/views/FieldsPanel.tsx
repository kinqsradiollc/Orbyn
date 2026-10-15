import { session } from "../../lib/session";
import { usePaneLeaveGuard } from "../../app/page-commands";
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
import { Select } from "../../components/Select";
import { useConfirm } from "../../components/Confirm";
import { FieldInput } from "./FieldInput";
import { SettingsEditor } from "../settings/SettingsEditor";
import "./views.css";

/**
 * Your own fields on a page or project (ORG-02), in its Info panel: every
 * field its space has, each ready to change, and "Add a field" for anyone
 * who can change it. Whoever made a field (or a team's owners and admins)
 * renames it, changes its choices, shows it on the calendar or removes it
 * from the ⋯ beside it.
 */
export function FieldsPanel(props: Parameters<typeof FieldsPanelBody>[0]) {
  return (
    <FieldsPanelBody
      key={`${session.get()}:${props.target}:${props.targetId}`}
      {...props}
    />
  );
}
function FieldsPanelBody({
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
  const [loadFailed, setLoadFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const owner = useRef({ target, targetId });
  owner.current = { target, targetId };
  const read = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      read.current += 1;
    };
  }, []);

  const [menu, setMenu] = useState<CustomField | null>(null);
  const reportRef = useRef(report);
  reportRef.current = report;
  const { ask } = useConfirm();

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
    void load();
    return () => {
      read.current += 1;
    };
  }, [target, targetId, revision, retry]); // eslint-disable-line react-hooks/exhaustive-deps

  usePaneLeaveGuard(async () => !adding && !menu);

  if (!data)
    return loadFailed ? (
      <button className="secondary" onClick={() => setRetry((n) => n + 1)}>
        Retry fields
      </button>
    ) : (
      <p className="muted" role="status">
        Loading fields…
      </p>
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

  const remove = async (field: CustomField) => {
    if (!field.can_manage) return;
    const current = owner.current;
    const owns = () =>
      mounted.current &&
      current.target === owner.current.target &&
      current.targetId === owner.current.targetId;
    setMenu(null);
    const ok = await ask({
      title: `Remove ${field.name}?`,
      body: `It comes off every ${target === "page" ? "page" : "project"} ${
        field.team_name ? `in ${field.team_name}` : "of yours"
      }, with what was filled in.`,
      confirmLabel: "Remove field",
      destructive: true,
    });
    if (!ok || !owns()) return;
    client.deleteField(field.id).then(
      () => {
        if (!owns()) return;
        void load();
        onChanged?.();
      },
      (e) => {
        if (owns()) report(e);
      },
    );
  };

  const change = async (
    field: CustomField,
    input: Parameters<typeof client.updateField>[1],
  ) => {
    if (!field.can_manage) return false;
    const current = owner.current;
    try {
      await client.updateField(field.id, input);
      if (
        mounted.current &&
        current.target === owner.current.target &&
        current.targetId === owner.current.targetId
      ) {
        setMenu(null);
        void load();
        onChanged?.();
      }
      return true;
    } catch (e) {
      if (
        mounted.current &&
        current.target === owner.current.target &&
        current.targetId === owner.current.targetId
      )
        report(e);
      return false;
    }
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
                  key={`${target}:${targetId}:${field.id}`}
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
                    onClick={() => setMenu(field)}
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
            key={`${target}:${targetId}`}
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
        <FieldOptions
          field={menu}
          onClose={() => setMenu(null)}
          onSave={(input) => change(menu, input)}
          onRemove={() => void remove(menu)}
        />
      )}
    </section>
  );
}

const choicesOf = (text: string) => [
  ...new Set(
    text
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  ),
];

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
    name.trim() &&
    (type !== "select" || (options.length > 0 && options.length <= 30));
  return (
    <SettingsEditor
      title="Add field"
      pending={busy}
      onClose={() => {
        if (!writing.current) onCancel();
      }}
    >
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <form
        className="new-field"
        onSubmit={(e) => {
          e.preventDefault();
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
              (err) => {
                if (mounted.current) {
                  setError(
                    err instanceof Error
                      ? err.message
                      : "Couldn’t add field. Try again.",
                  );
                  report(err);
                }
              },
            )
            .finally(() => {
              writing.current = false;
              if (mounted.current) setBusy(false);
            });
        }}
      >
        <fieldset disabled={busy} className="new-view-fields">
          <label>
            Name
            <input
              autoFocus
              aria-label="Field name"
              placeholder="Name, like Essay due"
              value={name}
              maxLength={60}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label>
            Type
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
          </label>
          {type === "select" && (
            <label>
              Choices
              <input
                aria-label="Choices"
                placeholder="Up to 30 choices, separated by commas"
                value={choices}
                onChange={(e) => setChoices(e.target.value)}
              />
            </label>
          )}
          {type === "date" && (
            <label className="field-check">
              <input
                type="checkbox"
                checked={onCalendar}
                onChange={(e) => setOnCalendar(e.target.checked)}
              />
              Show deadlines on Calendar
            </label>
          )}
          <small className="muted">
            {teamId
              ? `Available on all ${target}s in this team.`
              : `Available on all your personal ${target}s.`}
          </small>
        </fieldset>
        <div className="new-field-actions">
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={onCancel}
          >
            Cancel
          </button>
          <button type="submit" className="primary" disabled={!ready || busy}>
            {busy ? "Adding…" : "Add field"}
          </button>
        </div>
      </form>
    </SettingsEditor>
  );
}

/** A focused field editor retains the submitted values when a write fails. */
function FieldOptions({
  field,
  onClose,
  onSave,
  onRemove,
}: {
  field: CustomField;
  onClose: () => void;
  onSave: (input: Parameters<typeof client.updateField>[1]) => Promise<boolean>;
  onRemove: () => void;
}) {
  const [name, setName] = useState(field.name);
  const [choices, setChoices] = useState(field.options.join(", "));
  const [onCalendar, setOnCalendar] = useState(field.on_calendar);
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
  const options = choicesOf(choices);
  const valid =
    !!name.trim() &&
    (field.type !== "select" || (options.length > 0 && options.length <= 30));
  const changed =
    name.trim() !== field.name ||
    (field.type === "select" &&
      options.join(", ") !== field.options.join(", ")) ||
    (field.type === "date" && onCalendar !== field.on_calendar);
  return (
    <SettingsEditor
      title="Edit field"
      pending={busy}
      onClose={() => {
        if (!writing.current) onClose();
      }}
    >
      <form
        className="new-view-body"
        onSubmit={async (event) => {
          event.preventDefault();
          if (!valid || !changed || writing.current) return;
          writing.current = true;
          setBusy(true);
          setFailed(false);
          try {
            const saved = await onSave({
              name: name.trim(),
              ...(field.type === "select" ? { options } : {}),
              ...(field.type === "date" ? { on_calendar: onCalendar } : {}),
            });
            if (mounted.current && !saved) setFailed(true);
          } catch {
            if (mounted.current) setFailed(true);
          } finally {
            writing.current = false;
            if (mounted.current) setBusy(false);
          }
        }}
      >
        {failed && (
          <p className="error" role="status">
            Couldn’t save field. Try again.
          </p>
        )}
        <fieldset disabled={busy} className="new-view-fields">
          <label>
            Name
            <input
              autoFocus
              value={name}
              maxLength={60}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          {field.type === "select" && (
            <label>
              Choices
              <input
                value={choices}
                onChange={(event) => setChoices(event.target.value)}
              />
              <small className="muted">
                Up to 30, separated by commas. Removed choices clear their saved
                values.
              </small>
            </label>
          )}
          {field.type === "date" && (
            <label className="field-check">
              <input
                type="checkbox"
                checked={onCalendar}
                onChange={(event) => setOnCalendar(event.target.checked)}
              />
              Show deadlines on Calendar
            </label>
          )}
        </fieldset>
        <div className="new-field-actions">
          <button
            type="button"
            className="danger-text"
            disabled={busy}
            onClick={onRemove}
          >
            Remove field
          </button>
          <button className="primary" disabled={busy || !valid || !changed}>
            {busy ? "Saving…" : "Save field"}
          </button>
        </div>
      </form>
    </SettingsEditor>
  );
}
