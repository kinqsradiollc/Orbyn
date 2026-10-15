import { AssistChips } from "../assist/AssistChips";
import { useCallback, useEffect, useRef, useState } from "react";
import { FileText, FileUp, FolderInput, GraduationCap, X } from "lucide-react";
import {
  IMPORT_ACCEPT,
  IMPORT_ACTIVE,
  IMPORT_LIMITS,
  importHint,
  importRefusal,
  importStatusLine,
  importTypeOf,
  type ImportCapabilities,
  type DocSummary,
  type ImportJob,
} from "@orbyn/core";
import { KeepOriginalsSwitch } from "./OriginalFile";
import { errorText } from "../../lib/errors";
import { client } from "../../lib/api";

/**
 * Importing files into Docs: the imports going on, kept fresh while any is
 * still being read, and a way to start one from a picked or dropped file.
 */
export function useImports(
  report: (e: unknown) => void,
  onReady: () => void,
  projectId?: string,
  projectTeamId?: string | null,
) {
  const alive = useRef(true);
  const request = useRef(0);
  const uploading = useRef(false);
  const removing = useRef(new Set<string>());
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [jobs, setJobs] = useState<ImportJob[]>([]);
  const [starting, setStarting] = useState(0);
  const [caps, setCaps] = useState<ImportCapabilities | null>(null);
  useEffect(() => {
    alive.current = true;
    void client.importCapabilities().then(
      (next) => {
        if (alive.current) setCaps(next);
      },
      () => {},
    );
    return () => {
      alive.current = false;
      request.current++;
    };
  }, []);
  const ready = useRef(new Set<string>());
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  const refresh = useCallback(async () => {
    const epoch = ++request.current;
    try {
      const list = await client.listImports();
      if (!alive.current || epoch !== request.current) return;
      const fresh = list.filter(
        (job) => job.status === "ready" && !ready.current.has(job.id),
      );
      for (const job of list)
        if (job.status === "ready") ready.current.add(job.id);
      if (fresh.length) onReadyRef.current();
      setJobs(list);
      setLoadError("");
    } catch (reason) {
      if (alive.current && epoch === request.current)
        setLoadError(errorText(reason));
    } finally {
      if (alive.current && epoch === request.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const active = jobs.some((j) => IMPORT_ACTIVE.includes(j.status));
  useEffect(() => {
    if (!active && !starting) return;
    const timer = setInterval(() => void refresh(), 4000);
    return () => clearInterval(timer);
  }, [active, starting, refresh]);

  /** Upload files one after another; each becomes a page in Uploads. */
  const importFiles = async (files: File[]) => {
    if (uploading.current || !alive.current) return;
    uploading.current = true;
    try {
      for (const file of files) {
        if (!alive.current) break;
        const refused = importRefusal(file.name, file.type);
        if (refused) {
          report(new Error(refused));
          continue;
        }
        const type = importTypeOf(file.name, file.type);
        if (caps && !caps.enabled) {
          report(new Error("Importing files isn't set up on this server yet."));
          return;
        }
        if ((type === "png" || type === "jpeg") && caps && !caps.photos) {
          report(
            new Error(
              `${file.name}: photos of notes can't be read on this server. Import a PDF or Word file instead.`,
            ),
          );
          continue;
        }
        if (file.size > IMPORT_LIMITS.maxBytes) {
          report(
            new Error(
              `${file.name} is over the ${IMPORT_LIMITS.maxBytes / 1024 / 1024} MB limit.`,
            ),
          );
          continue;
        }
        setStarting((n) => n + 1);
        let startedId: string | null = null;
        try {
          const { upload_path, import: started } = await client.createImport({
            file_name: file.name,
            bytes: file.size,
            mime: file.type || undefined,
            project_id: projectId,
            project_team_id: projectId ? projectTeamId : undefined,
          });
          startedId = started.id;
          await refresh();
          await client.uploadImportFile(upload_path, file, file.type);
        } catch (e) {
          report(e);
          // The upload didn't arrive: don't leave the import waiting for it.
          if (startedId) await client.removeImport(startedId).catch(() => {});
        } finally {
          if (alive.current) {
            setStarting((n) => n - 1);
            void refresh();
          }
        }
      }
    } finally {
      uploading.current = false;
    }
  };

  const remove = async (job: ImportJob) => {
    if (removing.current.has(job.id) || !alive.current) return;
    removing.current.add(job.id);
    try {
      await client.removeImport(job.id);
      if (alive.current) {
        setJobs((all) => all.filter((next) => next.id !== job.id));
        await refresh();
      }
    } catch (reason) {
      if (alive.current) report(reason);
    } finally {
      removing.current.delete(job.id);
    }
  };

  return {
    jobs,
    importFiles,
    remove,
    busy: starting > 0,
    caps,
    loading,
    loadError,
    refresh,
  };
}

/** The "Import file" button: a hidden file input behind a normal button. */
export function ImportButton({
  onFiles,
  busy,
  className = "text-button",
  label = "Import file",
}: {
  onFiles: (files: File[]) => void;
  busy: boolean;
  className?: string;
  label?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <button
        className={className}
        disabled={busy}
        title="Import a PDF, Word file or photo of notes"
        onClick={() => input.current?.click()}
      >
        <FileUp size={15} /> {busy ? "Uploading…" : label}
      </button>
      <input
        ref={input}
        type="file"
        hidden
        multiple
        accept={IMPORT_ACCEPT}
        aria-label="Choose files to import"
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = "";
          if (files.length) onFiles(files);
        }}
      />
    </>
  );
}

const kindLabel = (job: ImportJob) =>
  job.file_type === "docx" ? "DOC" : job.file_type === "pdf" ? "PDF" : "IMG";

/**
 * Uploads: files being imported, and imported pages not filed yet. Moving a
 * page to a folder (or Unfiled) takes it out of here.
 */
export function UploadsPanel({
  jobs,
  docs,
  busy,
  onOpen,
  onMove,
  onRemove,
  onMakeCards,
  onFiles,
  caps,
  report,
  onChanged,
  loading = false,
  loadError = "",
  onRetry,
}: {
  loading?: boolean;
  loadError?: string;
  onRetry?: () => void;
  caps: ImportCapabilities | null;
  /**
   * Shows errors; with it, the assistant's chips on each page (AI-01)
   * show too.
   */
  report?: (e: unknown) => void;
  /** The assistant's suggestion was taken: read the pages again. */
  onChanged?: () => void;
  jobs: ImportJob[];
  docs: DocSummary[];
  busy: boolean;
  onOpen: (id: string) => void;
  onMove: (doc: DocSummary, anchor: DOMRect) => void;
  onRemove: (job: ImportJob) => void;
  onMakeCards: (doc: DocSummary) => void;
  onFiles: (files: File[]) => void;
}) {
  const waiting = docs.filter((d) => d.in_uploads);
  // A finished import is shown as its page (below) while it waits to be
  // filed; once filed or deleted, it's gone from Uploads.
  const shownJobs = jobs.filter((j) => j.status !== "ready");
  return (
    <div className="uploads">
      <p className="uploads-intro muted">
        Import files as pages. Originals are deleted unless you keep them.
      </p>
      {/* "Keep the original" is your account's setting, on every device. */}
      <KeepOriginalsSwitch report={report ?? (() => {})} />
      <details className="uploads-hint">
        <summary>Supported files</summary>
        <p>{importHint(caps)}</p>
      </details>
      {loadError && (
        <div role="alert">
          <p>{loadError}</p>
          {onRetry && (
            <button className="text-button" onClick={onRetry}>
              Retry
            </button>
          )}
        </div>
      )}
      {loading && !loadError && <p role="status">Loading imports…</p>}
      {!loading && !loadError && !waiting.length && !shownJobs.length && (
        <div className="uploads-empty">
          <FileUp size={22} aria-hidden="true" />
          <strong>No imports yet</strong>
          <p className="muted">Choose a file or drop it here.</p>
          <ImportButton onFiles={onFiles} busy={busy} className="primary" />
        </div>
      )}
      <ul className="uploads-list">
        {shownJobs.map((job) => {
          const active = IMPORT_ACTIVE.includes(job.status);
          const progress =
            job.status === "ocr" && job.ocr_pages
              ? job.ocr_done / job.ocr_pages
              : job.status === "reading"
                ? 0.1
                : null;
          return (
            <li
              key={job.id}
              className={"upload-row is-" + job.status}
              aria-busy={active}
            >
              <span className={"upload-kind is-" + job.file_type}>
                {kindLabel(job)}
              </span>
              <span className="upload-main">
                <strong>{job.file_name}</strong>
                <small>{importStatusLine(job)}</small>
                {progress !== null && (
                  <span
                    className="upload-bar"
                    role="progressbar"
                    aria-label={`Importing ${job.file_name}`}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(progress * 100)}
                  >
                    <i
                      style={{ width: `${Math.max(progress, 0.04) * 100}%` }}
                    />
                  </span>
                )}
              </span>
              <span className="upload-actions">
                {job.status === "ready" && job.doc_id && (
                  <button
                    className="secondary"
                    onClick={() => onOpen(job.doc_id!)}
                  >
                    Open
                  </button>
                )}
                {job.status === "failed" && (
                  <ImportButton
                    onFiles={onFiles}
                    busy={busy}
                    className="text-button"
                  />
                )}
                <button
                  className="icon-button"
                  aria-label={
                    active
                      ? `Cancel ${job.file_name}`
                      : `Clear ${job.file_name}`
                  }
                  title={active ? "Cancel" : "Clear"}
                  onClick={() => onRemove(job)}
                >
                  <X size={16} />
                </button>
              </span>
            </li>
          );
        })}
        {waiting.map((doc) => {
          const job = jobs.find((j) => j.doc_id === doc.id);
          return (
            <li key={doc.id} className="upload-row is-ready">
              <span
                className={
                  "upload-kind is-" + (doc.imported_from?.file_type ?? "pdf")
                }
              >
                <FileText size={16} aria-hidden="true" />
              </span>
              <button
                className="upload-main upload-open"
                onClick={() => onOpen(doc.id)}
              >
                <strong>{doc.title || "Untitled"}</strong>
                <small>
                  {job
                    ? importStatusLine(job)
                    : `Ready · from ${doc.imported_from?.file_name ?? "an upload"}`}
                  {doc.original ? " · original kept" : ""}
                </small>
              </button>
              <span className="upload-actions">
                {report ? (
                  <AssistChips
                    docId={doc.id}
                    title={doc.title || "Untitled"}
                    report={report}
                    onChanged={onChanged}
                  />
                ) : (
                  <button
                    className="text-button"
                    title="Suggest study cards from this page"
                    onClick={() => onMakeCards(doc)}
                  >
                    <GraduationCap size={15} /> Make cards
                  </button>
                )}
                <button
                  className="primary"
                  aria-haspopup="dialog"
                  onClick={(e) =>
                    onMove(doc, e.currentTarget.getBoundingClientRect())
                  }
                >
                  <FolderInput size={15} /> Move
                </button>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
