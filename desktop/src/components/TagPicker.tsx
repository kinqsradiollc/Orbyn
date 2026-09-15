import { useState } from "react";
import { Check, Plus } from "lucide-react";
import type { Tag } from "@orbyn/core";

type Props = {
  /** Tags that fit this item (personal tags, or the team's). */
  tags: Tag[];
  selected: string[];
  onChange: (ids: string[]) => void;
  /** Creates a tag here and resolves with it; omit to hide "New tag". */
  onCreate?: (name: string) => Promise<Tag | null>;
};

/** Toggle tags on an item, or make a new one without leaving the form. */
export function TagPicker({ tags, selected, onChange, onCreate }: Props) {
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const full = selected.length >= 20;

  const create = async () => {
    const trimmed = name.trim();
    if (!trimmed || !onCreate) return;
    const existing = tags.find(
      (t) => t.name.toLowerCase() === trimmed.toLowerCase(),
    );
    if (existing) {
      if (!selected.includes(existing.id)) onChange([...selected, existing.id]);
      setName("");
      return;
    }
    setPending(true);
    try {
      const tag = await onCreate(trimmed);
      if (tag) {
        onChange([...selected, tag.id]);
        setName("");
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <fieldset className="tag-picker">
      <legend>Tags</legend>
      {tags.length > 0 ? (
        <div className="tag-options" role="group" aria-label="Tags">
          {tags.map((t) => {
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
      {onCreate && (
        <div className="tag-create">
          <input
            aria-label="New tag name"
            placeholder="New tag"
            maxLength={40}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
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
