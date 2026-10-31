import type { CustomField, FieldValue } from "@orbyn/core";
import { useEffect, useRef, useState } from "react";
import { Button, Input, SelectBox } from "../../ui/kit";

/**
 * One of your own fields, ready to change: text and numbers keep what's typed
 * until Enter or leaving the field, while dates, choices, people and ticks
 * save as soon as they're picked. Escape puts text back.
 */
export function FieldInput({
  field,
  value,
  people,
  disabled,
  autoFocus,
  onCommit,
  onDone,
}: {
  field: CustomField;
  value: FieldValue | undefined;
  people: { id: string; name: string }[];
  disabled?: boolean;
  autoFocus?: boolean;
  onCommit: (value: FieldValue) => void | Promise<boolean | void>;
  /** Editing ended, for editors inside a table cell. */
  onDone?: () => void;
}) {
  const shown = value === null || value === undefined ? "" : String(value);
  const [draft, setDraft] = useState(shown);
  useEffect(() => setDraft(shown), [shown]);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (autoFocus) input.current?.focus();
  }, [autoFocus]);
  const cancelled = useRef(false);
  const writing = useRef(false);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const commit = async (next: FieldValue) => {
    if (writing.current || disabled) return;
    writing.current = true;
    setPending(true);
    setFailed(false);
    setDraft(next == null ? "" : String(next));
    try {
      const saved = await onCommit(next);
      if (saved === false) setFailed(true);
      else onDone?.();
    } catch {
      setFailed(true);
    } finally {
      writing.current = false;
      setPending(false);
    }
  };
  const commitText = () => {
    if (cancelled.current) {
      cancelled.current = false;
      return;
    }
    if (writing.current || disabled) return;
    if (draft.trim() !== shown) void commit(draft.trim() === "" ? null : draft);
    else onDone?.();
  };
  const control = () => {
    switch (field.type) {
      case "checkbox":
        return (
          <input
            ref={input}
            type="checkbox"
            aria-label={field.name}
            checked={draft === "true"}
            disabled={disabled || pending}
            onChange={(event) => void commit(event.target.checked)}
          />
        );
      case "date":
        return (
          <Input
            ref={input}
            type="date"
            aria-label={field.name}
            value={draft}
            disabled={disabled || pending}
            onChange={(event) => void commit(event.target.value || null)}
          />
        );
      case "select":
      case "person": {
        const options =
          field.type === "select"
            ? field.options.map((o) => ({ value: o, label: o }))
            : people.map((p) => ({ value: p.id, label: p.name }));
        return (
          <SelectBox
            aria-label={field.name}
            value={draft}
            disabled={disabled || pending}
            onChange={(event) => void commit(event.target.value || null)}
          >
            <option value="">
              {field.type === "select" ? "None" : "No one"}
            </option>
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </SelectBox>
        );
      }
      default:
        return (
          <Input
            ref={input}
            aria-label={field.name}
            value={draft}
            disabled={disabled || pending}
            inputMode={field.type === "number" ? "decimal" : undefined}
            maxLength={500}
            placeholder={field.type === "number" ? "0" : "Empty"}
            onChange={(event) => {
              cancelled.current = false;
              setDraft(event.target.value);
            }}
            onBlur={commitText}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                event.currentTarget.blur();
              }
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                cancelled.current = true;
                setDraft(shown);
                setFailed(false);
                event.currentTarget.blur();
                cancelled.current = false;
                onDone?.();
              }
            }}
          />
        );
    }
  };
  return (
    <div className="vw-field-input" aria-busy={pending}>
      {control()}
      {pending && (
        <small className="muted" role="status">
          Saving…
        </small>
      )}
      {failed && (
        <span className="vw-field-failed">
          <small role="alert">Not saved</small>
          <Button
            variant="ghost"
            disabled={pending || disabled}
            onClick={() =>
              void commit(
                field.type === "checkbox"
                  ? draft === "true"
                  : draft.trim() || null,
              )
            }
          >
            Retry
          </Button>
        </span>
      )}
    </div>
  );
}
