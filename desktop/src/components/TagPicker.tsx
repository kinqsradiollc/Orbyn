import { useEffect, useRef, useState } from "react";
import { Check, Plus } from "lucide-react";
import { session } from "../lib/session";
import type { Tag } from "@orbyn/core";

type Props = {
  /** Tags that fit this item (personal tags, or the team's). */
  tags: Tag[];
  selected: string[];
  onChange: (ids: string[]) => void;
  /** Creates a tag here and resolves with it; omit to hide "New tag". */
  onCreate?: (name: string) => Promise<Tag | null>;
  disabled?: boolean;
  onDraftChange?: (pending: boolean) => void;
};

/** Toggle tags on an item, or make a new one without leaving the form. */
export function TagPicker({
  tags,
  selected,
  onChange,
  onCreate,
  disabled = false,
  onDraftChange,
}: Props) {
  const owner = useRef(session.get()).current;
  const mounted = useRef(true);
  const latest = useRef({ selected, disabled });
  latest.current = { selected, disabled };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const owns = () => mounted.current && session.get() === owner;
  const [query, setQuery] = useState("");
  const creating = useRef(false);
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  useEffect(() => {
    onDraftChange?.(!!name.trim());
  }, [name, onDraftChange]);
  const full = selected.length >= 20;

  const create = async () => {
    const trimmed = name.trim();
    if (
      !owns() ||
      !trimmed ||
      !onCreate ||
      disabled ||
      creating.current ||
      full
    )
      return;
    const existing = tags.find(
      (t) => t.name.toLowerCase() === trimmed.toLowerCase(),
    );
    if (existing) {
      if (!selected.includes(existing.id)) onChange([...selected, existing.id]);
      onDraftChange?.(false);
      setName("");
      return;
    }
    creating.current = true;
    setPending(true);
    try {
      const tag = await onCreate(trimmed);
      if (tag && owns()) {
        const ids = latest.current.selected;
        if (ids.length < 20 && !ids.includes(tag.id))
          onChange([...ids, tag.id]);
        onDraftChange?.(false);
        setName("");
      }
    } finally {
      creating.current = false;
      if (owns()) setPending(false);
    }
  };

  return (
    <fieldset className="tag-picker" disabled={disabled || pending}>
      <legend>Tags</legend>
      {tags.length > 8 && (
        <input
          aria-label="Find a tag"
          placeholder="Find a tag"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      )}
      {tags.length > 0 ? (
        <div className="tag-options" role="group" aria-label="Tags">
          {tags
            .filter((t) =>
              t.name.toLowerCase().includes(query.trim().toLowerCase()),
            )
            .map((t) => {
              const on = selected.includes(t.id);
              return (
                <button
                  key={t.id}
                  type="button"
                  aria-pressed={on}
                  disabled={!on && full}
                  className={"tag-chip toggle " + (on ? "active" : "")}
                  style={{ "--tag": t.color } as never}
                  onClick={() =>
                    onChange(
                      on
                        ? selected.filter((x) => x !== t.id)
                        : [...selected, t.id],
                    )
                  }
                >
                  {on ? <Check size={11} aria-hidden="true" /> : <i />}
                  {t.name}
                </button>
              );
            })}
        </div>
      ) : (
        <small className="field-hint">No tags here yet.</small>
      )}
      {tags.length > 0 &&
        !tags.some((t) =>
          t.name.toLowerCase().includes(query.trim().toLowerCase()),
        ) && <small className="field-hint">No matching tags.</small>}
      {onCreate && (
        <div className="tag-create">
          <input
            aria-label="New tag name"
            placeholder="New tag"
            maxLength={40}
            value={name}
            onChange={(e) => {
              onDraftChange?.(!!e.target.value.trim());
              setName(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void create();
              }
            }}
          />
          <button
            type="button"
            className="secondary"
            disabled={pending || !name.trim() || full}
            onClick={() => void create()}
          >
            <Plus size={13} /> Create tag
          </button>
        </div>
      )}
    </fieldset>
  );
}
