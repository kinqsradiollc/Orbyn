import { useEffect, useRef, useState } from "react";
import type { CustomField, FieldValue } from "@orbyn/core";
import { DateField } from "../../components/DateField";
import { Select } from "../../components/Select";

/**
 * One of your own fields, ready to change: text and numbers keep what's
 * typed until Enter or leaving the field, while dates, choices, people and
 * ticks save as soon as they're picked. Escape puts text back.
 */
export function FieldInput({
  field,
  value,
  people,
  disabled,
  autoFocus,
  onCommit,
  onDone,
  className,
}: {
  field: CustomField;
  value: FieldValue | undefined;
  people: { id: string; name: string }[];
  disabled?: boolean;
  autoFocus?: boolean;
  onCommit: (value: FieldValue) => void;
  /** Editing ended (saved or put back), for editors inside a table cell. */
  onDone?: () => void;
  className?: string;
}) {
  const shown = value === null || value === undefined ? "" : String(value);
  const [draft, setDraft] = useState(shown);
  useEffect(() => setDraft(shown), [shown]);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (autoFocus) input.current?.focus();
  }, [autoFocus]);
  const label = field.name;

  const cancelled = useRef(false);
  const commitText = () => {
    if (cancelled.current) {
      cancelled.current = false;
      return;
    }
    if (draft.trim() !== shown) onCommit(draft.trim() === "" ? null : draft);
    onDone?.();
  };

  switch (field.type) {
    case "checkbox":
      return (
        <input
          ref={input}
          type="checkbox"
          className={className}
          aria-label={label}
          checked={value === true}
          disabled={disabled}
          onChange={(e) => {
            onCommit(e.target.checked);
            onDone?.();
          }}
        />
      );
    case "date":
      return (
        <DateField
          className={className}
          aria-label={label}
          value={typeof value === "string" ? value : ""}
          disabled={disabled}
          autoFocus={autoFocus}
          placeholder="No date"
          onChange={(e) => {
            onCommit(e.target.value || null);
            onDone?.();
          }}
        />
      );
    case "select":
    case "person": {
      const options =
        field.type === "select"
          ? field.options.map((o) => ({ value: o, label: o }))
          : people.map((p) => ({ value: p.id, label: p.name }));
      return (
        <Select
          className={className}
          aria-label={label}
          value={shown}
          disabled={disabled}
          onChange={(e) => {
            onCommit(e.target.value || null);
            onDone?.();
          }}
        >
          <option value="">
            {field.type === "select" ? "None" : "No one"}
          </option>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      );
    }
    default:
      return (
        <input
          ref={input}
          className={className}
          aria-label={label}
          value={draft}
          disabled={disabled}
          inputMode={field.type === "number" ? "decimal" : undefined}
          maxLength={500}
          placeholder={field.type === "number" ? "0" : "Empty"}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitText}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              e.currentTarget.blur();
            }
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              // Leave without saving: the words go back as they were.
              cancelled.current = true;
              setDraft(shown);
              e.currentTarget.blur();
              cancelled.current = false;
              onDone?.();
            }
          }}
        />
      );
  }
}
