import { useCallback, useEffect, useRef, useState } from "react";
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
export function ProjectNotes(props: Parameters<typeof ProjectNotesBody>[0]) {
  return <ProjectNotesBody key={props.projectId} {...props} />;
}

function ProjectNotesBody({
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
  const request = useRef(0);
  const mutation = useRef(false);
  const [failed, setFailed] = useState(false);
  const [notes, setNotes] = useState<DocSummary[] | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    const epoch = ++request.current;
    setFailed(false);
    void client.listDocs({ project: projectId }).then(
      (next) => {
        if (epoch === request.current) setNotes(next);
      },
      () => {
        if (epoch === request.current) setFailed(true);
      },
    );
  }, [projectId]);

  useEffect(() => {
    load();
    return () => {
      request.current++;
    };
  }, [load]);

  const create = () => {
    if (!canWrite || mutation.current) return;
    mutation.current = true;
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
      .finally(() => {
        mutation.current = false;
        setBusy(false);
      });
  };

  return (
    <section className="project-notes">
      <div className="project-notes-head">
        <h3>
          <FileText size={14} aria-hidden="true" /> Notes
        </h3>
        {canWrite && (
          <button className="text-button" onClick={create} disabled={busy}>
            <Plus size={14} aria-hidden="true" /> New note
          </button>
        )}
      </div>
      {failed && (
        <p role="alert">
          Couldn't load notes.{" "}
          <button className="text-button" onClick={load}>
            Retry
          </button>
        </p>
      )}
      {notes === null ? (
        !failed && (
          <p className="muted small" role="status">
            Loading…
          </p>
        )
      ) : notes.length === 0 ? (
        <p className="muted small">No notes yet.</p>
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
