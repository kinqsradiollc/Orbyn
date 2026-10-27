import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useModalFocus } from "../../hooks/useModalFocus";
import type { ReactNode } from "react";
import { BadgeCheck, Link2 } from "lucide-react";
import type { ItemProof } from "@orbyn/core";
import { client } from "../../lib/api";
import { errorText } from "../planner/planning";

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
export function ProofSection(props: Parameters<typeof ProofSectionBody>[0]) {
  return <ProofSectionBody key={props.itemId} {...props} />;
}

function ProofSectionBody({
  itemId,
  canWrite,
}: {
  itemId: string;
  canWrite: boolean;
}) {
  const request = useRef(0);
  const mutation = useRef(false);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [proofs, setProofs] = useState<ItemProof[]>([]);
  const [adding, setAdding] = useState(false);
  const [url, setUrl] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    const version = ++request.current;
    setError("");
    try {
      const next = await client.listProofs(itemId);
      if (version === request.current) {
        setProofs(next);
        setLoaded(true);
      }
    } catch (reason) {
      if (version === request.current) setError(errorText(reason));
    }
  }, [itemId]);
  useEffect(() => {
    void load();
    return () => {
      request.current++;
    };
  }, [load]);
  if (loaded && !proofs.length && !canWrite && !error) return null;
  const add = async () => {
    if (!canWrite || mutation.current || (!url.trim() && !note.trim())) return;
    mutation.current = true;
    setBusy(true);
    setError("");
    try {
      await client.addProof(itemId, {
        url: url.trim() || null,
        note: note.trim(),
      });
      setUrl("");
      setNote("");
      setAdding(false);
      await load();
    } catch (e) {
      setError(errorText(e));
    } finally {
      mutation.current = false;
      setBusy(false);
    }
  };
  const remove = async (proof: ItemProof) => {
    if (!canWrite || mutation.current) return;
    mutation.current = true;
    setBusy(true);
    setError("");
    try {
      await client.deleteProof(itemId, proof.id);
      await load();
    } catch (error) {
      setError(errorText(error));
    } finally {
      mutation.current = false;
      setBusy(false);
    }
  };
  return (
    <section className="drawer-section" aria-labelledby={`proof-${itemId}`}>
      <div className="drawer-section-head">
        <h3 id={`proof-${itemId}`}>
          <BadgeCheck size={16} aria-hidden="true" /> Proof
        </h3>
        {canWrite && !adding && (
          <button
            className="text-button"
            disabled={busy}
            onClick={() => setAdding(true)}
          >
            Add proof
          </button>
        )}
      </div>
      {!loaded && !error && <p role="status">Loading proof…</p>}
      {loaded && proofs.length === 0 && !adding && (
        <p className="drawer-hint">No proof yet.</p>
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
              <details className="proof-options">
                <summary aria-label="Proof options">More</summary>
                <button
                  className="text-button"
                  aria-label="Remove this proof"
                  disabled={busy}
                  onClick={() => void remove(p)}
                >
                  Remove
                </button>
              </details>
            )}
          </li>
        ))}
      </ul>
      {adding && (
        <ProofDialog
          busy={busy}
          onClose={() => {
            if (!mutation.current) setAdding(false);
          }}
        >
          <form
            className="proof-form"
            onSubmit={(e) => {
              e.preventDefault();
              void add();
            }}
          >
            <input
              type="url"
              disabled={busy}
              value={url}
              placeholder="https://… (optional)"
              aria-label="Link"
              onChange={(e) => setUrl(e.target.value)}
              autoFocus
            />
            <input
              disabled={busy}
              value={note}
              maxLength={1000}
              placeholder="What this shows"
              aria-label="Note"
              onChange={(e) => setNote(e.target.value)}
            />
            <div className="proof-actions">
              <button
                className="secondary"
                disabled={busy || (!url.trim() && !note.trim())}
              >
                {busy ? "Saving…" : "Add proof"}
              </button>
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() => setAdding(false)}
              >
                Cancel
              </button>
            </div>
          </form>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </ProofDialog>
      )}
      {error && !adding && (
        <p className="error" role="alert">
          {error}
          <button
            className="text-button"
            disabled={busy}
            onClick={() => void load()}
          >
            Retry
          </button>
        </p>
      )}
    </section>
  );
}

function ProofDialog({
  busy,
  onClose,
  children,
}: {
  busy: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const focus = useModalFocus(onClose, busy);
  useEffect(() => {
    const dialog = focus.ref.current as HTMLDialogElement;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return createPortal(
    <dialog
      ref={(node) => {
        focus.ref.current = node;
      }}
      data-modal-focus={focus.id}
      className="modal modal-small"
      aria-labelledby="proof-dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <h2 id="proof-dialog-title">Add proof</h2>
      {children}
    </dialog>,
    document.body,
  );
}
