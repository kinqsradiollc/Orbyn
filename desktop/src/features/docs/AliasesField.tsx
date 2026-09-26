import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { MAX_ALIASES } from "@orbyn/core";

/**
 * "Also called" (LNK-03): other names a page or project goes by, such as a
 * course code. The link picker, the quick switcher, search and "Mentioned
 * without a link" find it by them too. Enter adds one; × takes one off.
 */
export function AliasesField({
  aliases,
  canWrite,
  onSave,
  placeholder = "Add another name, like CS101",
}: {
  aliases: string[];
  canWrite: boolean;
  /** Saves the whole list; resolves with what was kept. */
  onSave: (next: string[]) => Promise<string[]>;
  placeholder?: string;
}) {
  const [list, setList] = useState(aliases);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => setList(aliases), [aliases]);
  const save = (next: string[]) => {
    setBusy(true);
    void onSave(next)
      .then((kept) => setList(kept))
      .finally(() => setBusy(false));
  };
  if (!canWrite && !list.length) return null;
  return (
    <div className="aliases-field">
      {list.map((a) => (
        <span key={a} className="aliases-chip">
          {a}
          {canWrite && (
            <button
              type="button"
              aria-label={`Remove ${a}`}
              disabled={busy}
              onClick={() => save(list.filter((x) => x !== a))}
            >
              <X size={12} aria-hidden="true" />
            </button>
          )}
        </span>
      ))}
      {canWrite && list.length < MAX_ALIASES && (
        <input
          value={typed}
          placeholder={list.length ? "Add another" : placeholder}
          aria-label="Add another name"
          maxLength={80}
          disabled={busy}
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter" && e.key !== ",") return;
            e.preventDefault();
            const name = typed.trim();
            if (!name) return;
            setTyped("");
            if (list.some((x) => x.toLowerCase() === name.toLowerCase()))
              return;
            save([...list, name]);
          }}
        />
      )}
    </div>
  );
}
