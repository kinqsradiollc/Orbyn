import {
  blankDate,
  fillTemplate,
  newBlockId,
  type Doc,
  type DocBlock,
  type LinkOption,
  type PageTemplate,
} from "@orbyn/core";
import { useEffect, useMemo, useRef, useState } from "react";
import { messageOf } from "../../../lib/resource";
import { client } from "../../../lib/session";
import { Button, Dialog, ErrorNotice, Input, Loading } from "../../../ui/kit";
import { deviceTimeZone } from "../../shared-task";

/** "Merge into…": the page's lines join another; links and tasks go with them. */
export function MergeDialog({
  doc,
  version,
  onClose,
  onMerged,
}: {
  doc: Pick<Doc, "id" | "title" | "team_id">;
  version: () => Promise<number>;
  onClose: () => void;
  onMerged: (into: Doc, relinked: number) => void;
}) {
  const busyRef = useRef(false);
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<LinkOption[] | null>(null);
  const [searchFailed, setSearchFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [picked, setPicked] = useState<LinkOption | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    setFound(null);
    setSearchFailed(false);
    const timer = window.setTimeout(() => {
      client.pickLinks(query, 20).then(
        (hits) =>
          live &&
          setFound(
            hits.filter((hit) => hit.kind === "doc" && hit.id !== doc.id),
          ),
        () => live && setSearchFailed(true),
      );
    }, 150);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query, doc.id, attempt]);
  const merge = async () => {
    if (!picked || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      const done = await client.mergeDoc(doc.id, picked.id, await version());
      onMerged(done.doc, done.relinked);
    } catch (failure) {
      setError(messageOf(failure, "Couldn't merge these pages."));
      busyRef.current = false;
      setBusy(false);
    }
  };
  return (
    <Dialog
      title="Merge into…"
      onClose={() => !busy && onClose()}
      actions={
        <>
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            busy={busy}
            disabled={!picked || searchFailed}
            onClick={() => void merge()}
          >
            Merge pages
          </Button>
        </>
      }
    >
      <p className="small muted" dir="auto">
        “{doc.title || "Untitled"}” joins the target with comments and tasks.
        Links redirect; this page moves to Trash and can be restored.
      </p>
      {error && <ErrorNotice message={error} />}
      <Input
        autoFocus
        aria-label="Find the page to merge into"
        placeholder="Find a page"
        disabled={busy}
        value={query}
        onChange={(event) => {
          setQuery(event.currentTarget.value);
          setPicked(null);
        }}
      />
      {searchFailed && (
        <ErrorNotice
          message="Couldn't load pages."
          onRetry={() => setAttempt((n) => n + 1)}
        />
      )}
      {found === null && !searchFailed && <Loading label="Searching" />}
      <div className="lib-picklist" role="listbox" aria-label="Pages">
        {found?.map((hit) => (
          <button
            key={hit.id}
            type="button"
            role="option"
            aria-selected={picked?.id === hit.id}
            className="row"
            disabled={busy}
            onClick={() => setPicked(hit)}
          >
            <span className="row-main">
              <span className="row-title" dir="auto">
                {hit.title}
              </span>
              {hit.hint && (
                <span className="small muted" dir="auto">
                  {hit.hint}
                </span>
              )}
            </span>
          </button>
        ))}
        {found && !found.length && (
          <p className="small muted">
            {query ? "No matching pages." : "No pages available."}
          </p>
        )}
      </div>
    </Dialog>
  );
}

/** "Template" in the / menu: a template's lines go where the line is. */
export function TemplateInsert({
  doc,
  onPick,
  onClose,
}: {
  doc: Pick<Doc, "title" | "project_name">;
  onPick: (lines: DocBlock[]) => void;
  onClose: () => void;
}) {
  const [templates, setTemplates] = useState<PageTemplate[] | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    setError("");
    setTemplates(null);
    client.listPageTemplates().then(
      (next) => live && setTemplates(next),
      (failure) =>
        live && setError(messageOf(failure, "Couldn't load templates.")),
    );
    return () => {
      live = false;
    };
  }, [attempt]);
  const values = useMemo(
    () => ({
      date: blankDate(new Date(), deviceTimeZone()),
      title: doc.title,
      project: doc.project_name ?? "",
    }),
    [doc.title, doc.project_name],
  );
  return (
    <Dialog title="Insert a template" onClose={onClose}>
      {error && (
        <ErrorNotice message={error} onRetry={() => setAttempt((n) => n + 1)} />
      )}
      {!templates && !error && <Loading label="Loading templates" />}
      {templates?.length === 0 && (
        <p className="small muted">No templates yet.</p>
      )}
      <div className="lib-picklist" role="listbox" aria-label="Templates">
        {templates?.map((template) => (
          <button
            key={template.id}
            type="button"
            className="row"
            onClick={() => {
              const { content } = fillTemplate(template, values, doc.title);
              onPick(
                content.map(
                  (block) => ({ ...block, id: newBlockId() }) as DocBlock,
                ),
              );
              onClose();
            }}
          >
            <span className="row-main">
              <span className="row-title" dir="auto">
                {template.name}
              </span>
              {template.description && (
                <span className="small muted" dir="auto">
                  {template.description}
                </span>
              )}
            </span>
          </button>
        ))}
      </div>
    </Dialog>
  );
}
