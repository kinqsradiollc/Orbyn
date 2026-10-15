import { usePaneLeaveGuard } from "../../app/page-commands";
import { useConfirm } from "../../components/Confirm";
import { session } from "../../lib/session";
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
  onCommit: (value: FieldValue) => void | Promise<boolean | void>;
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
  const writing = useRef(false);
  const mounted = useRef(true);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const { ask } = useConfirm();
  const account = useRef(session.get()).current;
  const deciding = useRef(false);
  const live = useRef({ draft, shown, failed });
  live.current = { draft, shown, failed };
  usePaneLeaveGuard(async () => {
    if (writing.current || deciding.current) return false;
    const target = live.current;
    if (target.draft === target.shown && !target.failed) return true;
    deciding.current = true;
    try {
      if (
        !(await ask({
          title: "Discard field changes?",
          body: `Your unsaved changes to ${field.name} will be lost.`,
          confirmLabel: "Discard changes",
          cancelLabel: "Keep editing",
        }))
      )
        return false;
      if (
        !mounted.current ||
        session.get() !== account ||
        live.current.draft !== target.draft ||
        live.current.shown !== target.shown ||
        writing.current
      )
        return false;
      cancelled.current = true;
      setDraft(target.shown);
      setFailed(false);
      return true;
    } finally {
      deciding.current = false;
    }
  });
  const commit = async (next: FieldValue) => {
    if (writing.current || deciding.current || disabled) return;
    writing.current = true;
    setPending(true);
    setFailed(false);
    setDraft(next == null ? "" : String(next));
    try {
      const saved = await onCommit(next);
      if (!mounted.current) return;
      if (saved === false) setFailed(true);
      else onDone?.();
    } catch {
      if (mounted.current) setFailed(true);
    } finally {
      writing.current = false;
      if (mounted.current) setPending(false);
    }
  };
  const commitText = () => {
    if (cancelled.current) {
      cancelled.current = false;
      return;
    }
    if (writing.current || deciding.current || disabled) return;
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
            className={className}
            aria-label={label}
            checked={draft === "true"}
            disabled={disabled || pending}
            onChange={(e) => {
              void commit(e.target.checked);
            }}
          />
        );
      case "date":
        return (
          <DateField
            className={className}
            aria-label={label}
            value={draft}
            disabled={disabled || pending}
            autoFocus={autoFocus}
            placeholder="No date"
            onChange={(e) => {
              void commit(e.target.value || null);
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
            value={draft}
            disabled={disabled || pending}
            onChange={(e) => {
              void commit(e.target.value || null);
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
            disabled={disabled || pending}
            inputMode={field.type === "number" ? "decimal" : undefined}
            maxLength={500}
            placeholder={field.type === "number" ? "0" : "Empty"}
            onChange={(e) => {
              cancelled.current = false;
              live.current = { ...live.current, draft: e.target.value };
              setDraft(e.target.value);
            }}
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
                live.current = { ...live.current, draft: shown, failed: false };
                setDraft(shown);
                setFailed(false);
                e.currentTarget.blur();
                cancelled.current = false;
                onDone?.();
              }
            }}
          />
        );
    }
  };
  return (
    <div className="field-input-owner" aria-busy={pending}>
      {control()}
      {pending && (
        <small className="muted" role="status">
          Saving…
        </small>
      )}
      {failed && (
        <div className="field-input-recovery">
          <small className="error" role="status">
            Not saved
          </small>
          <button
            type="button"
            className="text-button"
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
          </button>
        </div>
      )}
    </div>
  );
}
