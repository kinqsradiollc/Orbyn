import {
  docStats,
  fileSize,
  pageFreshness,
  sourceReadLabel,
  type Doc,
  type DocInfo,
  type PageFile,
  type PageFilesUsage,
  type PageSource,
} from "@orbyn/core";
import { Trash2, X } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { messageOf } from "../../../lib/resource";
import { useNavigate } from "../../../lib/router";
import { client, getSessionVersion, onToken } from "../../../lib/session";
import {
  Button,
  ErrorNotice,
  IconButton,
  Input,
  Loading,
  useConfirm,
  useToast,
} from "../../../ui/kit";
import { FieldsPanel } from "../../views/Fields";
import { when } from "../model";
import { loadLibrary } from "../store";
import type { Page } from "./usePage";
import { useLibraryOwner } from "../lifetime";

type Props = { page: Page; doc: Doc; canWrite: boolean; onClose: () => void };

export function InfoPanel(props: Props) {
  const owner = useSyncExternalStore(onToken, getSessionVersion);
  return <InfoPanelBody key={`${owner}:${props.doc.id}`} {...props} />;
}

function InfoPanelBody({ page, doc, canWrite, onClose }: Props) {
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const [info, setInfo] = useState<DocInfo | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [files, setFiles] = useState<PageFile[] | null>(null);
  const [filesError, setFilesError] = useState("");
  const [usage, setUsage] = useState<PageFilesUsage | null>(null);
  const [usageError, setUsageError] = useState("");
  const [actionError, setActionError] = useState("");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const current = useLibraryOwner();
  const [aliases, setAliases] = useState(doc.aliases ?? []);
  const [alias, setAlias] = useState("");
  const version = page.session?.saved.version;
  useEffect(() => {
    let live = true;
    if (!current()) return;
    setError("");
    setInfo(null);
    setFiles(null);
    setFilesError("");
    setUsage(null);
    setUsageError("");
    client.docInfo(doc.id).then(
      (next) => live && current() && setInfo(next),
      (failure) =>
        live &&
        current() &&
        setError(messageOf(failure, "Page info couldn't be loaded.")),
    );
    client.pageFiles(doc.id).then(
      (list) => live && current() && setFiles(list),
      (failure) =>
        live &&
        current() &&
        setFilesError(messageOf(failure, "Files couldn't be loaded.")),
    );
    client.filesUsage().then(
      (next) => live && current() && setUsage(next),
      (failure) =>
        live &&
        current() &&
        setUsageError(messageOf(failure, "File storage couldn't be loaded.")),
    );
    return () => {
      live = false;
    };
  }, [doc.id, version, attempt]);
  const stats = docStats(page.leaves);
  const [needsUpdate, setNeedsUpdate] = useState(false);
  const [note, setNote] = useState("");
  const run = async (work: () => Promise<void>) => {
    if (lock.current || !current()) return false;
    lock.current = true;
    setBusy(true);
    setActionError("");
    try {
      await work();
      return current();
    } catch (failure) {
      if (current())
        setActionError(
          messageOf(failure, "Couldn't save this change. Try again."),
        );
      return false;
    } finally {
      lock.current = false;
      if (current()) setBusy(false);
    }
  };
  const review = (
    input:
      { verdict: "still_true" } | { verdict: "needs_update"; note: string },
  ) =>
    run(async () => {
      await client.reviewDoc(doc.id, input);
      if (!current()) return;
      setNeedsUpdate(false);
      setNote("");
      setAttempt((n) => n + 1);
      void loadLibrary();
      toast({
        text:
          input.verdict === "still_true"
            ? "Confirmed up to date."
            : "A task was added to update this page.",
      });
    });
  const saveAliases = (next: string[], added?: string) =>
    run(async () => {
      const result = await client.setDocAliases(doc.id, next);
      if (!current()) return;
      setAliases(result.aliases);
      if (added) setAlias("");
    });
  const removeSource = (source: PageSource) =>
    run(async () => {
      if (
        !(await confirm({
          title: "Remove this source?",
          body: `“${source.title || source.url}” will be removed from this page. Its words and other pages' citations stay.`,
          action: "Remove",
          danger: true,
        })) ||
        !current()
      )
        return;
      await client.removePageSource(doc.id, source.id);
      if (current()) setAttempt((n) => n + 1);
    });
  const removeFile = (file: PageFile) =>
    run(async () => {
      if (!canWrite || file.doc_id !== doc.id) return;
      if (
        !(await confirm({
          title: "Delete this file for good?",
          body: `“${file.name}” will no longer be available to pages that use it.`,
          action: "Delete",
          danger: true,
        })) ||
        !current()
      )
        return;
      await client.deletePageFile(file.id);
      if (current()) setAttempt((n) => n + 1);
    });
  const download = (file: PageFile) =>
    run(async () => {
      // Read fresh authorization; never reuse another account's signed-link cache.
      const link = await client.pageFile(file.id);
      if (!current()) return;
      const response = await fetch(client.urlFor(link.url_path));
      if (!current()) return;
      if (!response.ok)
        throw new Error("This file couldn't be downloaded. Try again.");
      const blob = await response.blob();
      if (!current()) return;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = link.file.name;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  const fresh = info ? pageFreshness(info.updated_at, info.reviewed_at) : null;
  return (
    <div className="page-panel-body">
      <div className="page-panel-head">
        <h2>Info</h2>
        <Button variant="ghost" disabled={busy} onClick={onClose}>
          Close
        </Button>
      </div>
      <p className="small muted">
        {stats.words} words · {stats.minutes} min read
      </p>
      {actionError && <ErrorNotice message={actionError} />}
      {error && (
        <ErrorNotice message={error} onRetry={() => setAttempt((n) => n + 1)} />
      )}
      {!info && !error && <Loading label="Loading page info" />}
      {info && (
        <dl className="page-facts small">
          <dt>Space</dt>
          <dd dir="auto">{info.team ? info.team.name : "Only you"}</dd>
          {info.folder && (
            <>
              <dt>Folder</dt>
              <dd dir="auto">{info.folder.name}</dd>
            </>
          )}
          {info.project && (
            <>
              <dt>Project</dt>
              <dd>
                <button
                  type="button"
                  className="doc-textlink"
                  dir="auto"
                  onClick={() => navigate(`/app/project/${info.project!.id}`)}
                >
                  {info.project.name}
                </button>
              </dd>
            </>
          )}
          {info.event && (
            <>
              <dt>Event</dt>
              <dd dir="auto">{info.event.title}</dd>
            </>
          )}
          <dt>Changed</dt>
          <dd>{when(info.updated_at)}</dd>
          {fresh && fresh.state !== "fresh" && (
            <>
              <dt>Status</dt>
              <dd>Not confirmed for {fresh.days} days</dd>
            </>
          )}
          <dt>Linked here</dt>
          <dd>{info.linked_here}</dd>
          <dt>Versions</dt>
          <dd>{info.versions.count}</dd>
        </dl>
      )}
      {canWrite && info?.can_write && (
        <section className="page-fresh">
          <h3>Is this page still true?</h3>
          <div className="page-look-row">
            <Button
              disabled={busy}
              onClick={() => void review({ verdict: "still_true" })}
            >
              Still true
            </Button>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => setNeedsUpdate(!needsUpdate)}
            >
              Needs updating
            </Button>
          </div>
          {needsUpdate && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void review({ verdict: "needs_update", note: note.trim() });
              }}
            >
              <Input
                aria-label="What's changed"
                placeholder="What's changed"
                value={note}
                disabled={busy}
                onChange={(event) => setNote(event.currentTarget.value)}
              />
            </form>
          )}
        </section>
      )}
      <FieldsPanel
        target="page"
        targetId={doc.id}
        revision={page.fieldsStamp}
      />
      <section>
        <h3>Other names</h3>
        <div className="doc-tags">
          {aliases.map((one) => (
            <span key={one} className="lib-tag" dir="auto">
              {one}
              {canWrite && (
                <button
                  type="button"
                  aria-label={`Remove ${one}`}
                  disabled={busy}
                  onClick={() =>
                    void saveAliases(aliases.filter((other) => other !== one))
                  }
                >
                  <X aria-hidden="true" />
                </button>
              )}
            </span>
          ))}
        </div>
        {canWrite && (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const name = alias.trim();
              if (!name || aliases.includes(name)) return;
              void saveAliases([...aliases, name], name);
            }}
          >
            <Input
              aria-label="Add another name"
              placeholder="Add another name"
              value={alias}
              disabled={busy}
              onChange={(event) => setAlias(event.currentTarget.value)}
            />
          </form>
        )}
      </section>
      {!!info?.sources.length && (
        <section>
          <h3>Sources</h3>
          <ul className="page-files">
            {info.sources.map((source) => (
              <li key={source.id}>
                <div className="row-main small">
                  <a
                    href={source.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    dir="auto"
                  >
                    {source.title || source.url}
                  </a>
                  <p className="muted">
                    {[
                      source.site,
                      source.author,
                      sourceReadLabel(source.accessed_on),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  {source.quote && (
                    <blockquote dir="auto">{source.quote}</blockquote>
                  )}
                </div>
                {canWrite && (
                  <IconButton
                    label={`Remove ${source.title || "source"}`}
                    disabled={busy}
                    onClick={() => void removeSource(source)}
                  >
                    <X />
                  </IconButton>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      <section>
        <h3>Files on this page</h3>
        {filesError && (
          <ErrorNotice
            message={filesError}
            onRetry={() => setAttempt((n) => n + 1)}
          />
        )}
        {files === null && !filesError && (
          <Loading label="Loading page files" />
        )}
        {files?.length === 0 && (
          <p className="small muted">No files on this page.</p>
        )}
        {!!files?.length && (
          <ul className="page-files">
            {files.map((file) => (
              <li key={file.id}>
                <Button
                  variant="ghost"
                  className="row-main"
                  disabled={busy}
                  onClick={() => void download(file)}
                  aria-label={`Download ${file.name}`}
                >
                  <span dir="auto">{file.name}</span>
                </Button>
                <span className="small muted">{fileSize(file.bytes)}</span>
                {canWrite && file.doc_id === doc.id && (
                  <IconButton
                    label={`Delete ${file.name}`}
                    disabled={busy}
                    onClick={() => void removeFile(file)}
                  >
                    <Trash2 />
                  </IconButton>
                )}
              </li>
            ))}
          </ul>
        )}
        {usageError && (
          <ErrorNotice
            message={usageError}
            onRetry={() => setAttempt((n) => n + 1)}
          />
        )}
        {!usage && !usageError && <Loading label="Loading file storage" />}
        {usage && (
          <div className="small">
            {usage.quota_bytes > 0 && (
              <meter
                aria-label="File storage across your pages"
                min={0}
                max={usage.quota_bytes}
                value={usage.used_bytes}
              />
            )}
            <p>
              {fileSize(usage.used_bytes)} of {fileSize(usage.quota_bytes)} used
              across your pages.
            </p>
            <details>
              <summary>Storage details</summary>
              <p>
                Files removed from every page free space after 30 days. Trash
                keeps files until emptied. Deleting a file here frees its space
                immediately.
              </p>
            </details>
          </div>
        )}
      </section>
    </div>
  );
}
