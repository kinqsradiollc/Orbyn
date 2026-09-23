import { useCallback, useEffect, useRef, useState } from "react";
import { FileText, FileUp, FolderInput, GraduationCap, X } from "lucide-react";
import {
  IMPORT_ACCEPT,
  IMPORT_ACTIVE,
  IMPORT_LIMITS,
  importRefusal,
  importStatusLine,
  type DocSummary,
  type ImportJob,
} from "@orbyn/core";
import { client } from "../../lib/api";

/**
 * Importing files into Docs: the imports going on, kept fresh while any is
 * still being read, and a way to start one from a picked or dropped file.
 */
export function useImports(report: (e: unknown) => void, onReady: () => void) {
  const [jobs, setJobs] = useState<ImportJob[]>([]);
  const [starting, setStarting] = useState(0);
  const ready = useRef(new Set<string>());
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  const refresh = useCallback(
    () =>
      client.listImports().then(
        (list) => {
          // A page that just became ready joins the library.
          const fresh = list.filter(
            (j) => j.status === "ready" && !ready.current.has(j.id),
          );
          for (const j of list)
            if (j.status === "ready") ready.current.add(j.id);
          if (fresh.length) onReadyRef.current();
          setJobs(list);
        },
        () => {},
      ),
    [],
  );

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
    for (const file of files) {
      const refused = importRefusal(file.name, file.type);
      if (refused) {
        report(new Error(refused));
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
        });
        startedId = started.id;
        await refresh();
        await client.uploadImportFile(upload_path, file, file.type);
      } catch (e) {
        report(e);
        // The upload didn't arrive: don't leave the import waiting for it.
        if (startedId) await client.removeImport(startedId).catch(() => {});
      } finally {
        setStarting((n) => n - 1);
        void refresh();
      }
    }
  };

  const remove = async (job: ImportJob) => {
    setJobs((all) => all.filter((j) => j.id !== job.id));
    try {
      await client.removeImport(job.id);
    } catch (e) {
      report(e);
    }
    void refresh();
  };

  return { jobs, importFiles, remove, busy: starting > 0 };
}

/** The "Import file" button: a hidden file input behind a normal button. */
export function ImportButton({
  onFiles,
  busy,
  className = "text-button",
}: {
  onFiles: (files: File[]) => void;
  busy: boolean;
  className?: string;
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
        <FileUp size={15} /> {busy ? "Uploading…" : "Import file"}
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
}: {
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
  const shownJobs = jobs.filter(
    (j) =>
      j.status !== "ready" ||
      !j.doc_id ||
      !waiting.some((d) => d.id === j.doc_id),
  );
  return (
    <div className="uploads">
      <p className="uploads-intro muted">
        PDFs, Word files and photos of notes become pages here. Orbyn reads the
        file, then deletes it; only the page stays. Move a page to a folder when
        you&apos;re ready.
      </p>
      {!waiting.length && !shownJobs.length && (
        <div className="uploads-empty">
          <FileUp size={22} aria-hidden="true" />
          <strong>Drop a lecture PDF or Word file here</strong>
          <p className="muted">
            Or choose one. Scanned pages take a few minutes each to read.
          </p>
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
                </small>
              </button>
              <span className="upload-actions">
                <button
                  className="text-button"
                  title="Suggest study cards from this page"
                  onClick={() => onMakeCards(doc)}
                >
                  <GraduationCap size={15} /> Make cards
                </button>
                <button
                  className="primary"
                  aria-haspopup="dialog"
                  onClick={(e) =>
                    onMove(doc, e.currentTarget.getBoundingClientRect())
                  }
                >
                  <FolderInput size={15} /> Move to…
                </button>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
