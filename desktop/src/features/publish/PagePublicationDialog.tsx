import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { PagePublicationStore } from "@orbyn/api-client";
import { blockText, type Doc } from "@orbyn/core";
import { client } from "../../lib/api";
import { session } from "../../lib/session";
import { webOrigin } from "../../lib/links";
import { copyText } from "../../lib/planning";
import { Select } from "../../components/Select";
import "../docs/page-maintenance.css";

export function PagePublicationDialog({
  id,
  onClose,
  onChanged,
}: {
  id: string;
  onClose: () => void;
  onChanged?: (doc: Doc) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    changed = useRef(onChanged);
  changed.current = onChanged;
  const store = useMemo(
    () =>
      new PagePublicationStore(
        client,
        id,
        () => session.get(),
        (doc) => changed.current?.(doc),
      ),
    [id],
  );
  const s = useSyncExternalStore(store.subscribe, store.getSnapshot);
  useEffect(() => {
    dialog.current?.showModal();
    void store.prepare();
    return () => {
      dialog.current?.close();
      store.dispose();
    };
  }, [store]);
  const url = s.publication ? `${webOrigin() ?? ""}${s.publication.path}` : "";
  return (
    <dialog
      ref={dialog}
      className="page-maintenance modal"
      aria-labelledby="publication-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!s.busy) onClose();
      }}
    >
      <header className="section-heading">
        <h2 id="publication-title">Share page</h2>
        <button disabled={s.busy} aria-label="Close sharing" onClick={onClose}>
          ×
        </button>
      </header>
      <div className="page-maintenance-body">
        {s.error && (
          <p role="alert">
            {s.error}{" "}
            <button disabled={s.busy} onClick={() => void store.prepare()}>
              Reload
            </button>
          </p>
        )}
        {!s.doc && !s.error && <p className="muted">Loading…</p>}
        {s.legacyPath && (
          <section>
            <p className="muted">An older link still shares this whole page.</p>
            <button disabled={s.busy} onClick={() => void store.revokeLegacy()}>
              Revoke older link
            </button>
          </section>
        )}
        {s.folderPath && (
          <p className="muted">
            This page is also public through its folder. Manage that link in
            folder sharing.
          </p>
        )}
        {s.publication && (
          <section aria-label="Current link">
            <a href={url} target="_blank" rel="noopener noreferrer">
              Open shared page
            </a>
            <p className="muted">
              {s.publication.mode === "snapshot"
                ? "Saved snapshot"
                : "Live selected blocks"}
              {s.publication.expires_at
                ? ` · Expires ${new Date(s.publication.expires_at).toLocaleDateString()}`
                : " · No expiry"}
            </p>
            <div className="page-maintenance-actions">
              <button onClick={() => void copyText(url)}>Copy link</button>
              <button disabled={s.busy} onClick={() => void store.revoke()}>
                Revoke link
              </button>
            </div>
          </section>
        )}
        {s.doc && (
          <fieldset disabled={s.busy}>
            <legend>Shared blocks</legend>
            <div className="page-maintenance-blocks">
              {s.doc.content.map(
                (block, index) =>
                  block.id && (
                    <label key={block.id}>
                      <input
                        type="checkbox"
                        checked={s.selected.includes(block.id)}
                        onChange={() =>
                          store.configure({
                            selected: s.selected.includes(block.id!)
                              ? s.selected.filter((id) => id !== block.id)
                              : [...s.selected, block.id!],
                          })
                        }
                      />
                      <span>
                        {index + 1}.{" "}
                        {blockText(block).slice(0, 100) || block.type}
                      </span>
                    </label>
                  ),
              )}
            </div>
            <label>
              Updates
              <Select
                value={s.mode}
                onChange={(e) =>
                  store.configure({
                    mode: e.target.value as "snapshot" | "live",
                  })
                }
              >
                <option value="snapshot">Saved snapshot</option>
                <option value="live">Live selected blocks</option>
              </Select>
            </label>
            <p className="muted">
              {s.mode === "snapshot"
                ? "Later edits stay private until you update this link."
                : "Edits to selected blocks are public. New blocks stay private."}
            </p>
            <label>
              Expires
              <Select
                value={s.expiryDays}
                onChange={(e) =>
                  store.configure({
                    expiryDays: Number(e.target.value) as 0 | 7 | 30,
                  })
                }
              >
                <option value={7}>In 7 days</option>
                <option value={30}>In 30 days</option>
                <option value={0}>Never</option>
              </Select>
            </label>
            <label className="switch-line">
              <input
                type="checkbox"
                checked={s.consent}
                onChange={(e) => store.configure({ consent: e.target.checked })}
              />
              <span>
                Anyone with the link can read the title and selected blocks.
              </span>
            </label>
            <button
              className="primary"
              disabled={!s.consent || !s.selected.length}
              onClick={() => void store.save()}
            >
              {s.busy
                ? "Saving…"
                : s.publication
                  ? "Update shared page"
                  : "Create public link"}
            </button>
          </fieldset>
        )}
      </div>
    </dialog>
  );
}
