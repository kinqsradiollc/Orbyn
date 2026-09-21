import { useState } from "react";
import { FileText, Plus } from "lucide-react";
import { docPreview, type DraftNote } from "@orbyn/core";
import { client } from "../lib/api";

/**
 * Notes the assistant has drafted, waiting for someone to keep them.
 *
 * A draft is shown as itself — its title, how long it is, and the first of
 * what it says — because the decision is whether this is worth keeping,
 * which you cannot make from a summary of a summary. Nothing is written
 * until Keep is pressed.
 */
export function DraftNotes({
  notes,
  onKept,
  report,
}: {
  notes: DraftNote[];
  /** Called with the page once it exists, to open it. */
  onKept?: (docId: string) => void;
  report: (e: unknown) => void;
}) {
  const [kept, setKept] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  if (!notes.length) return null;

  const keep = (draft: DraftNote, at: number) => {
    setBusy(true);
    client
      .createDoc({
        title: draft.title,
        kind: "note",
        content: draft.content,
        project_id: draft.project_id,
        item_id: draft.item_id,
        team_id: draft.team_id,
      })
      .then((doc) => {
        setKept((all) => ({ ...all, [at]: doc.id }));
        onKept?.(doc.id);
      })
      .catch(report)
      .finally(() => setBusy(false));
  };

  return (
    <div className="ai-drafts">
      {notes.map((draft, at) => (
        <article key={at} className="ai-draft">
          <header>
            <FileText size={14} aria-hidden="true" />
            <strong>{draft.title || "Untitled"}</strong>
            {!!draft.project_name && (
              <span className="chip">{draft.project_name}</span>
            )}
          </header>
          <p className="ai-draft-preview">{docPreview(draft.content, 200)}</p>
          {!!draft.note && <p className="ai-draft-why">{draft.note}</p>}
          <div className="ai-draft-actions">
            <span className="muted small">
              {draft.content.length} line
              {draft.content.length === 1 ? "" : "s"}
            </span>
            {kept[at] ? (
              <button
                className="text-button"
                onClick={() => onKept?.(kept[at])}
              >
                Kept — open it
              </button>
            ) : (
              <button
                className="primary"
                disabled={busy}
                onClick={() => keep(draft, at)}
              >
                <Plus size={14} aria-hidden="true" /> Keep this note
              </button>
            )}
          </div>
        </article>
      ))}
    </div>
  );
}
