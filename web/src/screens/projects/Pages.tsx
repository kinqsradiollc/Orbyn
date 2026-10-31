import type { DocSummary } from "@orbyn/core";
import { Plus } from "lucide-react";
import { useResource } from "../../lib/resource";
import { navigate } from "../../lib/router";
import { client } from "../../lib/session";
import { Button, ErrorNotice, Loading } from "../../ui/kit";
import { shortDate } from "./shared";

/** Notes are ordinary pages, so these open the same editor as everywhere else. */
export function Pages({
  projectId,
  canWrite,
  busy,
  revision,
  onNew,
}: {
  projectId: string;
  canWrite: boolean;
  busy: boolean;
  revision: unknown;
  onNew: () => void;
}) {
  const notes = useResource<DocSummary[]>(
    () => client.listDocs({ project: projectId }),
    [projectId, revision],
  );
  return (
    <section className="pj-block">
      <header className="pj-block-head">
        <h3>Notes</h3>
        {canWrite && (
          <Button variant="ghost" disabled={busy} onClick={onNew}>
            <Plus aria-hidden="true" /> New note
          </Button>
        )}
      </header>
      {notes.error && (
        <ErrorNotice
          message={notes.error}
          onRetry={() => void notes.reload()}
        />
      )}
      {notes.loading && !notes.data && <Loading label="Loading notes" />}
      {notes.data?.length === 0 && <p className="muted small">No notes yet.</p>}
      <ul className="pj-notes">
        {notes.data?.map((note) => (
          <li key={note.id}>
            <button onClick={() => navigate(`/app/doc/${note.id}`)}>
              <span dir="auto">{note.title || "Untitled"}</span>
              {note.preview && <small dir="auto">{note.preview}</small>}
              <small>{shortDate(note.updated_at)}</small>
            </button>
            {!!note.tags?.length && (
              <span className="pj-row-wrap">
                {note.tags.map((tag) => (
                  <span key={tag.id} className="pill" dir="auto">
                    {tag.name}
                  </span>
                ))}
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
