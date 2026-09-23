import { useCallback, useEffect, useState } from "react";
import { BadgeCheck, Link2, X } from "lucide-react";
import type { ItemProof } from "@orbyn/core";
import { client } from "../../lib/api";
import { errorText } from "../../lib/planning";

const hostOf = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

/**
 * Proof of progress on a task: the link that shows it moved — the pull
 * request, the sent file — or a short note. Anyone who can edit it can add.
 */
export function ProofSection({
  itemId,
  canWrite,
}: {
  itemId: string;
  canWrite: boolean;
}) {
  const [proofs, setProofs] = useState<ItemProof[]>([]);
  const [adding, setAdding] = useState(false);
  const [url, setUrl] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const load = useCallback(() => {
    client.listProofs(itemId).then(setProofs, () => setProofs([]));
  }, [itemId]);
  useEffect(load, [load]);
  if (!proofs.length && !canWrite) return null;
  const add = async () => {
    setError("");
    try {
      await client.addProof(itemId, {
        url: url.trim() || null,
        note: note.trim(),
      });
      setUrl("");
      setNote("");
      setAdding(false);
      load();
    } catch (e) {
      setError(errorText(e));
    }
  };
  return (
    <section className="drawer-section" aria-labelledby={`proof-${itemId}`}>
      <div className="drawer-section-head">
        <h3 id={`proof-${itemId}`}>
          <BadgeCheck size={16} aria-hidden="true" /> Proof
        </h3>
        {canWrite && !adding && (
          <button className="text-button" onClick={() => setAdding(true)}>
            Add proof
          </button>
        )}
      </div>
      {proofs.length === 0 && !adding && (
        <p className="drawer-hint">
          A link or a note that shows this moved — a pull request, a sent file.
        </p>
      )}
      <ul className="proof-list">
        {proofs.map((p) => (
          <li key={p.id}>
            {p.url ? (
              <Link2 size={14} aria-hidden="true" />
            ) : (
              <BadgeCheck size={14} aria-hidden="true" />
            )}
            <span>
              {p.url ? (
                <a href={p.url} target="_blank" rel="noopener noreferrer">
                  {p.note || hostOf(p.url)}
                </a>
              ) : (
                p.note
              )}
              <small>
                {p.user_name}
                {p.url && p.note ? ` · ${hostOf(p.url)}` : ""}
              </small>
            </span>
            {canWrite && (
              <button
                className="icon-button"
                aria-label="Remove this proof"
                onClick={() =>
                  void client
                    .deleteProof(itemId, p.id)
                    .then(load, (e) => setError(errorText(e)))
                }
              >
                <X size={14} />
              </button>
            )}
          </li>
        ))}
      </ul>
      {adding && (
        <form
          className="proof-form"
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <input
            type="url"
            value={url}
            placeholder="https://… (optional)"
            aria-label="Link"
            onChange={(e) => setUrl(e.target.value)}
            autoFocus
          />
          <input
            value={note}
            maxLength={1000}
            placeholder="What it shows, e.g. “PR #42 merged”"
            aria-label="Note"
            onChange={(e) => setNote(e.target.value)}
          />
          <div className="proof-actions">
            <button
              className="secondary"
              disabled={!url.trim() && !note.trim()}
            >
              Add
            </button>
            <button
              type="button"
              className="text-button"
              onClick={() => setAdding(false)}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
