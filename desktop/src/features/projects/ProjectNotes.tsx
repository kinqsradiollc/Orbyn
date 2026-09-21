import { useCallback, useEffect, useState } from "react";
import { FileText, Plus } from "lucide-react";
import type { DocSummary } from "@orbyn/core";
import { client } from "../../lib/api";

const when = (iso: string) =>
  new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });

/**
 * The notes kept about a project, newest first.
 *
 * A note is an ordinary page, so opening one from here opens the same
 * editor as everywhere else — with its comments, its history and everyone
 * else's proposals already on it.
 */
export function ProjectNotes({
  projectId,
  teamId,
  canWrite,
  report,
  onOpen,
}: {
  projectId: string;
  teamId: string | null;
  canWrite: boolean;
  report: (e: unknown) => void;
  onOpen: (docId: string) => void;
}) {
  const [notes, setNotes] = useState<DocSummary[] | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    client.listDocs({ project: projectId }).then(setNotes, () => setNotes([]));
  }, [projectId]);

  useEffect(() => load(), [load]);

  const create = () => {
    setBusy(true);
    client
      .createDoc({
        title: "",
        kind: "note",
        project_id: projectId,
        team_id: teamId,
        content: [{ type: "paragraph", text: "" }],
      })
      .then((doc) => {
        load();
        onOpen(doc.id);
      })
      .catch(report)
      .finally(() => setBusy(false));
  };

  return (
    <section className="project-notes">
      <div className="project-notes-head">
        <h3>
          <FileText size={14} aria-hidden="true" /> Notes
        </h3>
        {canWrite && (
          <button className="text-button" onClick={create} disabled={busy}>
            <Plus size={14} aria-hidden="true" /> New note here
          </button>
        )}
      </div>
      {notes === null ? (
        <p className="muted small">Loading…</p>
      ) : notes.length === 0 ? (
        <p className="muted small">
          Nothing written down yet. A note here keeps the thinking beside the
          work.
        </p>
      ) : (
        <ul className="project-note-list">
          {notes.map((n) => (
            <li key={n.id}>
              <button className="project-note" onClick={() => onOpen(n.id)}>
                <strong>{n.title || "Untitled"}</strong>
                <span className="muted small">{n.preview}</span>
                <small className="muted">{when(n.updated_at)}</small>
              </button>
              {!!n.tags?.length && (
                <span className="project-note-tags">
                  {n.tags.map((t) => (
                    <span key={t.id} className="chip">
                      {t.name}
                    </span>
                  ))}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
