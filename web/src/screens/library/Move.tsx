import { nestTargets, type DocSummary, type Project } from "@orbyn/core";
import { FileText, Folder as FolderIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { messageOf } from "../../lib/resource";
import { client } from "../../lib/session";
import { Button, Dialog, ErrorNotice, Input, Loading } from "../../ui/kit";
import { teamName, useLibraryState } from "./store";

export type MoveTarget = {
  parent_id?: string | null;
  folder_id?: string | null;
};

/** Move one page, or several: into a folder, inside a page, or to a project. */
export function MoveDialog({
  doc,
  many,
  onClose,
  onMove,
  onProject,
}: {
  doc: DocSummary;
  many?: DocSummary[];
  onClose: () => void;
  onMove: (doc: DocSummary, to: MoveTarget) => Promise<void>;
  onProject?: (doc: DocSummary, projectId: string) => Promise<void>;
}) {
  const { folders, docs, memory, agents, teams } = useLibraryState();
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [projectsFailed, setProjectsFailed] = useState("");
  const [attempt, setAttempt] = useState(0);
  const showProjects = !!doc.in_uploads && !doc.team_id && !many && !!onProject;
  useEffect(() => {
    if (!showProjects) return;
    let live = true;
    setProjects(null);
    setProjectsFailed("");
    client.listProjects().then(
      (list) => live && setProjects(list.filter((project) => !project.team_id)),
      (failure) =>
        live &&
        setProjectsFailed(messageOf(failure, "Couldn't load projects.")),
    );
    return () => {
      live = false;
    };
  }, [showProjects, attempt]);

  const movable = many ?? [doc];
  const words = query.trim().toLocaleLowerCase();
  const hits = (name: string) => name.toLocaleLowerCase().includes(words);
  const shownFolders = [
    { id: "", name: "Unfiled", team_id: null as string | null },
    ...folders.filter((folder) => !folder.archived_at),
  ]
    .filter((folder) =>
      movable.every(
        (page) =>
          !folder.id || (folder.team_id ?? null) === (page.team_id ?? null),
      ),
    )
    .filter((folder) => hits(folder.name));
  const everyPage = [...(docs ?? []), ...memory, ...agents];
  const shownPages = many
    ? []
    : nestTargets(everyPage, doc)
        .filter((page) => hits(page.title || "Untitled"))
        .slice(0, 30);
  const run = (work: Promise<void>) => {
    setBusy(true);
    work.finally(onClose);
  };
  const library = doc.kind === "memory" || doc.kind === "agent";

  return (
    <Dialog
      title={many ? `Move ${many.length} pages` : "Move page"}
      onClose={onClose}
    >
      <Input
        autoFocus
        aria-label="Find a folder or page"
        placeholder="Find a folder or page"
        value={query}
        onChange={(event) => setQuery(event.currentTarget.value)}
      />
      <div className="lib-picklist">
        {!library &&
          shownFolders.map((folder) => (
            <button
              key={folder.id || "unfiled"}
              type="button"
              className="row"
              disabled={
                busy ||
                (!folder.id
                  ? !doc.folder_id && !doc.parent_id && !many && !doc.in_uploads
                  : doc.folder_id === folder.id && !doc.parent_id && !many)
              }
              onClick={() =>
                run(
                  onMove(doc, {
                    parent_id: null,
                    folder_id: folder.id || null,
                  }),
                )
              }
            >
              <FolderIcon aria-hidden="true" className="lib-icon" />
              <span className="row-main">
                <span className="row-title" dir="auto">
                  {folder.name}
                </span>
              </span>
              <span className="small muted">
                {folder.id ? teamName(teams, { team_id: folder.team_id }) : ""}
              </span>
            </button>
          ))}
        {library && doc.parent_id && (
          <button
            type="button"
            className="row"
            disabled={busy}
            onClick={() => run(onMove(doc, { parent_id: null }))}
          >
            <FolderIcon aria-hidden="true" className="lib-icon" />
            <span className="row-main">Top level</span>
          </button>
        )}
        {!many &&
          shownPages.map((page) => (
            <button
              key={page.id}
              type="button"
              className="row"
              disabled={busy}
              onClick={() => run(onMove(doc, { parent_id: page.id }))}
            >
              <FileText aria-hidden="true" className="lib-icon" />
              <span className="row-main">
                <span className="row-title" dir="auto">
                  {page.title || "Untitled"}
                </span>
              </span>
              <span className="small muted">Inside</span>
            </button>
          ))}
        {!shownFolders.length && !shownPages.length && !library && (
          <p className="small muted">No folder is called that.</p>
        )}
      </div>
      {showProjects && (
        <div>
          <h3>Move to personal project</h3>
          {projects === null && !projectsFailed && (
            <Loading label="Loading projects" />
          )}
          {projectsFailed && (
            <ErrorNotice
              message={projectsFailed}
              onRetry={() => setAttempt((n) => n + 1)}
            />
          )}
          <div className="lib-picklist">
            {projects?.map((project) => (
              <button
                key={project.id}
                type="button"
                className="row"
                disabled={busy}
                onClick={() => run(onProject!(doc, project.id))}
              >
                <span className="row-main">
                  <span className="row-title" dir="auto">
                    {project.name}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="dialog-actions">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </Dialog>
  );
}
