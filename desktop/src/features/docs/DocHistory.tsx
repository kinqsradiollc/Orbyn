import { useEffect, useState } from "react";
import { History, RotateCcw, X } from "lucide-react";
import type { Doc, DocVersion } from "@orbyn/core";
import { client } from "../../lib/api";
import { BlockView } from "./DocBlocks";

const when = (iso: string) => {
  const date = new Date(iso);
  const today = date.toDateString() === new Date().toDateString();
  return today
    ? `Today, ${date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
    : date.toLocaleString([], {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
};

/**
 * The page as it was. Each entry is a sitting — the state a run of saves
 * replaced — so the list reads as "before Tuesday's edits", not as a
 * keystroke log. Choosing one shows it read-only beside the list; Restore
 * puts it back as a new version on top, so nothing is ever thrown away.
 */
export function DocHistory({
  doc,
  onRestored,
  onClose,
  report,
}: {
  doc: Doc;
  onRestored: (doc: Doc) => void;
  onClose: () => void;
  report: (e: unknown) => void;
}) {
  const [versions, setVersions] = useState<DocVersion[] | null>(null);
  const [chosen, setChosen] = useState<Required<DocVersion> | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    client.listDocVersions(doc.id).then(setVersions, (e) => {
      setVersions([]);
      report(e);
    });
  }, [doc.id, doc.version, report]);

  const open = (v: DocVersion) => {
    setBusy(true);
    client
      .getDocVersion(doc.id, v.version)
      .then(setChosen)
      .catch(report)
      .finally(() => setBusy(false));
  };

  const restore = () => {
    if (!chosen) return;
    if (
      !confirm(
        `Put the page back as it was at ${when(chosen.created_at)}? What is there now is kept in history.`,
      )
    )
      return;
    setBusy(true);
    client
      .restoreDocVersion(doc.id, chosen.version)
      .then((restored) => {
        onRestored(restored);
        setChosen(null);
      })
      .catch(report)
      .finally(() => setBusy(false));
  };

  return (
    <aside className="doc-history" aria-label="Page history">
      <div className="doc-history-head">
        <h3>
          <History size={15} aria-hidden="true" /> History
        </h3>
        <button
          className="icon-button"
          aria-label="Close history"
          onClick={onClose}
        >
          <X size={15} />
        </button>
      </div>

      {versions === null ? (
        <p className="muted small">Loading…</p>
      ) : versions.length === 0 ? (
        <p className="muted small">
          Nothing to go back to yet. Each time you sit down and change the page,
          the version you started from is kept here.
        </p>
      ) : (
        <ol className="doc-history-list">
          {versions.map((v) => (
            <li key={v.version}>
              <button
                className={
                  "doc-history-item" +
                  (chosen?.version === v.version ? " is-chosen" : "")
                }
                disabled={busy}
                onClick={() => open(v)}
              >
                <strong>{when(v.created_at)}</strong>
                <small>
                  {v.author ?? "Someone"} · {v.blocks}{" "}
                  {v.blocks === 1 ? "block" : "blocks"}
                  {v.title !== doc.title && v.title ? ` · “${v.title}”` : ""}
                </small>
              </button>
            </li>
          ))}
        </ol>
      )}

      {chosen && (
        <div className="doc-history-preview">
          <div className="doc-history-preview-head">
            <span className="muted small">
              As it was at {when(chosen.created_at)}
            </span>
            <button className="text-button" disabled={busy} onClick={restore}>
              <RotateCcw size={14} aria-hidden="true" /> Restore this version
            </button>
          </div>
          <h4 className="doc-history-title">{chosen.title || "Untitled"}</h4>
          <div className="doc-body doc-history-body">
            {chosen.content.map((block, i) => (
              <div key={i} className="doc-block is-static">
                <BlockView block={block} />
              </div>
            ))}
          </div>
        </div>
      )}
    </aside>
  );
}
