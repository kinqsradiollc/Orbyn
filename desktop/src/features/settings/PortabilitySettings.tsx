import { SettingsSection } from "./SettingsSection";
import { FilePicker } from "../../components/FilePicker";
import { Select } from "../../components/Select";
import { useEffect, useRef, useState } from "react";
import { SettingsEditor } from "./SettingsEditor";
import { Archive, Download, Upload } from "lucide-react";
import {
  csvFormat,
  type ImportSummary,
  type PagesImportSummary,
  type TaskImportFormat,
} from "@orbyn/core";
import { client } from "../../lib/api";
import { session } from "../../lib/session";
import { OutcomeNote, useAction } from "../../components/Outcome";

type TaskFormat = TaskImportFormat;

/** Late reads/downloads belong to the mounted login that started them. */
function useMounted() {
  const alive = useRef(true);
  const account = useRef(session.get()).current;
  const mounted = useRef({
    get current() {
      return alive.current && session.get() === account;
    },
  });
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  return mounted.current;
}

/** Keep retry identity without retaining a second copy of private import data. */
function useImportAttempts() {
  const keys = useRef(new Map<string, { key: string; started: number }>());
  return {
    async keyFor(input: unknown) {
      const bytes = new TextEncoder().encode(JSON.stringify(input));
      const digest = await crypto.subtle.digest("SHA-256", bytes);
      const fingerprint = Array.from(new Uint8Array(digest), (value) =>
        value.toString(16).padStart(2, "0"),
      ).join("");
      let attempt = keys.current.get(fingerprint);
      if (attempt && Date.now() - attempt.started >= 23 * 60 * 60 * 1000)
        throw new Error(
          "This import attempt expired. Check imported content before starting another import.",
        );
      if (!attempt) {
        attempt = { key: crypto.randomUUID(), started: Date.now() };
        keys.current.set(fingerprint, attempt);
      }
      return attempt.key;
    },
    complete(key: string) {
      for (const [fingerprint, value] of keys.current)
        if (value.key === key) keys.current.delete(fingerprint);
    },
  };
}

/** A file as base64, for sending in one request. */
const base64Of = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      resolve(String(reader.result ?? "").replace(/^data:[^,]*,/, ""));
    reader.onerror = () => reject(new Error("The file couldn't be read."));
    reader.readAsDataURL(file);
  });

/**
 * Pages from another app (DATA-08): a zip of Markdown notes, or a Notion
 * export. A preview (the dry run) says what would come in first.
 */
function PageImport({
  report,
  onOpenFolder,
}: {
  report: (e: unknown) => void;
  onOpenFolder?: (folderId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const mounted = useMounted();
  const [format, setFormat] = useState<"markdown" | "notion">("markdown");
  const [file, setFile] = useState<{ name: string; data: string } | null>(null);
  const [preview, setPreview] = useState<PagesImportSummary | null>(null);
  const [made, setMade] = useState<string | null>(null);
  const action = useAction(report);
  const attempts = useImportAttempts();
  const input = useRef({ file, format });
  input.current = { file, format };
  const previewInput = useRef<{
    file: typeof file;
    format: typeof format;
  } | null>(null);
  const plural = (n: number, word: string) =>
    `${n} ${word}${n === 1 ? "" : "s"}`;
  const describe = (s: PagesImportSummary) =>
    [
      plural(s.pages, "page"),
      s.folders ? plural(s.folders, "folder") : "",
      s.projects
        ? `${plural(s.projects, "project")} with ${plural(s.tasks, "task")}`
        : "",
      s.links ? `${plural(s.links, "link")} between them` : "",
    ]
      .filter(Boolean)
      .join(", ");
  return (
    <>
      <button className="secondary" onClick={() => setOpen(true)}>
        <Upload size={14} /> Import pages
      </button>
      {open && (
        <SettingsEditor
          title="Import pages"
          pending={action.pending}
          onClose={() => setOpen(false)}
        >
          <p className="muted">
            Preview first. Nothing is added until you confirm.
          </p>
          <details>
            <summary>Supported page formats</summary>
            <p>
              Markdown and Notion exports retain folders and links. Notion
              databases become projects with tasks.
            </p>
          </details>
          <fieldset disabled={action.pending}>
            <div className="settings-grid">
              <label className="settings-field">
                <span className="settings-label">From</span>
                <Select
                  disabled={action.pending}
                  value={format}
                  onChange={(e) => {
                    if (action.pending) return;
                    setFormat(e.target.value as "markdown" | "notion");
                    setPreview(null);
                    previewInput.current = null;
                    setMade(null);
                  }}
                >
                  <option value="markdown">Markdown (.zip or .md)</option>
                  <option value="notion">Notion export (.zip)</option>
                </Select>
              </label>
              <div className="settings-field">
                <span className="settings-label">Choose a file</span>
                <FilePicker
                  disabled={action.pending}
                  value={file?.name ?? ""}
                  onClear={() => {
                    setFile(null);
                    setPreview(null);
                    previewInput.current = null;
                    setMade(null);
                  }}
                  accept=".zip,.md,.markdown,.txt,application/zip,text/markdown"
                  hint="or drop a .zip or .md here"
                  onFile={(f) =>
                    void action.run(async () => {
                      if (f.size > 20 * 1024 * 1024)
                        throw new Error(
                          "That file is over 20 MB. Split the export and try again.",
                        );
                      const data = await base64Of(f);
                      if (!mounted.current) return;
                      setFile({ name: f.name, data });
                      setPreview(null);
                      previewInput.current = null;
                      setMade(null);
                    })
                  }
                />
              </div>
            </div>
            <div className="portability-actions">
              <button
                className="secondary"
                disabled={action.pending || !file}
                onClick={() =>
                  void action.run(async () => {
                    const target = { ...input.current };
                    if (!target.file) return;
                    const result = await client.importPages({
                      format: target.format,
                      file_name: target.file.name,
                      data: target.file.data,
                      dry_run: true,
                    });
                    if (
                      mounted.current &&
                      input.current.file === target.file &&
                      input.current.format === target.format
                    ) {
                      previewInput.current = target;
                      setPreview(result);
                    }
                  })
                }
              >
                Preview
              </button>
              {preview && !preview.errors.length && (
                <button
                  className="primary"
                  disabled={
                    action.pending || (!preview.pages && !preview.projects)
                  }
                  onClick={() =>
                    void action.run(async () => {
                      const target = previewInput.current;
                      if (
                        !target?.file ||
                        input.current.file !== target.file ||
                        input.current.format !== target.format
                      )
                        throw new Error("Preview this file before importing.");
                      const payload = {
                        format: target.format,
                        file_name: target.file.name,
                        data: target.file.data,
                        dry_run: false,
                      };
                      const key = await attempts.keyFor(payload);
                      if (!mounted.current) return;
                      const done = await client.once(key, () =>
                        client.importPages(payload),
                      );
                      if (!mounted.current) return;
                      attempts.complete(key);
                      if (done.errors.length) {
                        setPreview(done);
                        previewInput.current = null;
                        throw new Error(
                          "Pages weren’t imported. Review the import issues.",
                        );
                      }
                      previewInput.current = null;
                      setPreview(null);
                      setFile(null);
                      setMade(done.folder_id ?? null);
                      return `Imported ${describe(done)}.`;
                    })
                  }
                >
                  <Upload size={14} /> Import {plural(preview.pages, "page")}
                </button>
              )}
              {made && onOpenFolder && (
                <button
                  className="secondary"
                  onClick={() => onOpenFolder(made)}
                >
                  Open in Documents
                </button>
              )}
            </div>
            {preview && (
              <div className="portability-preview">
                {!preview.errors.length && (
                  <p className="muted">{describe(preview)}.</p>
                )}
                {preview.sample.length > 0 && (
                  <p className="muted">e.g. {preview.sample.join(", ")}</p>
                )}
                {preview.left_out.length > 0 && (
                  <p className="muted">
                    Left out: {preview.left_out.join(", ")}.
                  </p>
                )}
                {preview.errors.map((e, i) => (
                  <p key={i} className="muted">
                    ⚠ {e}
                  </p>
                ))}
              </div>
            )}
          </fieldset>
          {action.pending && (
            <p className="muted small" role="status">
              Processing import…
            </p>
          )}
          <OutcomeNote outcome={action.outcome} />
        </SettingsEditor>
      )}
    </>
  );
}

/**
 * Export everything, and bring things in: tasks from an Orbyn export, a
 * CSV, Todoist or TickTick, and pages from Markdown or Notion (DATA-08).
 */
export function PortabilitySettings({
  report,
  onOpenFolder,
}: {
  report: (e: unknown) => void;
  /** Open Documents at a folder the import made. */
  onOpenFolder?: (folderId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const mounted = useMounted();
  const [fileName, setFileName] = useState("");
  const [format, setFormat] = useState<TaskFormat>("csv");
  const [data, setData] = useState("");
  const [preview, setPreview] = useState<ImportSummary | null>(null);
  const action = useAction(report);
  const attempts = useImportAttempts();
  const input = useRef({ data, format });
  input.current = { data, format };
  const previewInput = useRef<{ data: string; format: TaskFormat } | null>(
    null,
  );

  const download = () =>
    void action.run(async () => {
      const archive = await client.exportData();
      if (!mounted.current) return;
      const blob = new Blob([JSON.stringify(archive, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `orbyn-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      return "Your archive was downloaded.";
    });

  /** Everything, pages included, as a .zip of Markdown and JSON. */
  const downloadAll = () =>
    void action.run(async () => {
      const { blob, name } = await client.exportArchive();
      if (!mounted.current) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
      return "Everything was downloaded.";
    });

  const onFile = (file: File) => {
    void action.run(async () => {
      const text = await file.text();
      if (!mounted.current) return;
      setData(text);
      setFileName(file.name);
      setPreview(null);
      previewInput.current = null;
      setFormat(
        file.name.toLowerCase().endsWith(".csv") ? csvFormat(text) : "orbyn",
      );
    });
  };

  const dryRun = () =>
    void action.run(async () => {
      const target = { ...input.current };
      const result = await client.importData({ ...target, dry_run: true });
      if (
        mounted.current &&
        input.current.data === target.data &&
        input.current.format === target.format
      ) {
        previewInput.current = target;
        setPreview(result);
      }
    });
  const doImport = () =>
    void action.run(async () => {
      const target = previewInput.current;
      if (
        !target ||
        input.current.data !== target.data ||
        input.current.format !== target.format
      )
        throw new Error("Preview this data before importing.");
      const payload = { ...target, dry_run: false };
      const key = await attempts.keyFor(payload);
      if (!mounted.current) return;
      const summary = await client.once(key, () => client.importData(payload));
      if (!mounted.current) return;
      attempts.complete(key);
      previewInput.current = null;
      setPreview(null);
      setData("");
      setFileName("");
      return `Imported ${summary.created} item${summary.created === 1 ? "" : "s"}${summary.skipped ? ` · ${summary.skipped} skipped` : ""}.`;
    });

  return (
    <SettingsSection
      className="card settings-card"
      aria-labelledby="portability-title"
    >
      <h2 id="portability-title">Import &amp; export</h2>

      <div className="portability-actions">
        <button
          type="button"
          className="secondary"
          disabled={action.pending}
          onClick={() => {
            action.setOutcome(null);
            setExportOpen(true);
          }}
        >
          Export
        </button>
      </div>
      {exportOpen && (
        <SettingsEditor
          title="Export your data"
          pending={action.pending}
          onClose={() => setExportOpen(false)}
        >
          <div className="portability-actions">
            <button
              className="secondary"
              disabled={action.pending}
              onClick={downloadAll}
            >
              <Archive size={14} /> Export everything (.zip)
            </button>
            <button
              className="secondary"
              disabled={action.pending}
              onClick={download}
            >
              <Download size={14} /> Export my data (JSON)
            </button>
          </div>
          {action.pending && (
            <p className="muted small" role="status">
              Preparing export…
            </p>
          )}
          <OutcomeNote outcome={action.outcome} />
        </SettingsEditor>
      )}

      <div className="portability-actions">
        <button
          className="secondary"
          disabled={action.pending}
          onClick={() => setOpen(true)}
        >
          <Upload size={14} /> Import tasks
        </button>
        <PageImport report={report} onOpenFolder={onOpenFolder} />
      </div>
      {!open && !exportOpen && <OutcomeNote outcome={action.outcome} />}
      {open && (
        <SettingsEditor
          title="Import tasks"
          pending={action.pending}
          onClose={() => setOpen(false)}
        >
          <p className="muted">
            Preview first. Nothing is added until you confirm.
          </p>
          <details>
            <summary>Supported task formats</summary>
            <p>
              An Orbyn JSON export, Todoist or TickTick CSV, or CSV with a{" "}
              <code>title</code> column. Optional columns: <code>notes</code>,{" "}
              <code>due</code>, <code>priority</code>, <code>list</code>,{" "}
              <code>tags</code>.
            </p>
          </details>
          <fieldset disabled={action.pending}>
            <div className="settings-grid">
              <label className="settings-field">
                <span className="settings-label">Format</span>
                <Select
                  disabled={action.pending}
                  value={format}
                  onChange={(e) => {
                    if (action.pending) return;
                    setFormat(e.target.value as TaskFormat);
                    setPreview(null);
                    previewInput.current = null;
                  }}
                >
                  <option value="csv">CSV</option>
                  <option value="todoist">Todoist (CSV)</option>
                  <option value="ticktick">TickTick backup (CSV)</option>
                  <option value="orbyn">Orbyn export (JSON)</option>
                </Select>
              </label>
              <div className="settings-field">
                <span className="settings-label">Choose a file</span>
                <FilePicker
                  disabled={action.pending}
                  onClear={() => {
                    setData("");
                    setFileName("");
                    setPreview(null);
                    previewInput.current = null;
                  }}
                  accept=".csv,.json,text/csv,application/json"
                  hint="or drop a CSV or JSON here"
                  onFile={onFile}
                />
              </div>
            </div>
            {fileName && <p className="muted">Preview source: {fileName}</p>}
            <label className="settings-field">
              <span className="settings-label">CSV or JSON</span>
              <textarea
                className="portability-paste"
                rows={5}
                value={data}
                placeholder="…or paste your CSV or JSON here"
                onChange={(e) => {
                  setData(e.target.value);
                  setFileName("");
                  setPreview(null);
                  previewInput.current = null;
                }}
              />
            </label>
            <div className="portability-actions">
              <button
                className="secondary"
                disabled={action.pending || !data.trim()}
                onClick={dryRun}
              >
                Preview
              </button>
              {preview && (
                <button
                  className="primary"
                  disabled={action.pending || !preview.created}
                  onClick={doImport}
                >
                  <Upload size={14} /> Import {preview.created} item
                  {preview.created === 1 ? "" : "s"}
                </button>
              )}
            </div>
            {preview && (
              <div className="portability-preview">
                <p className="muted">
                  {preview.created} item{preview.created === 1 ? "" : "s"},{" "}
                  {preview.lists_added} new list
                  {preview.lists_added === 1 ? "" : "s"}, {preview.tags_added}{" "}
                  new tag
                  {preview.tags_added === 1 ? "" : "s"}
                  {preview.skipped ? `, ${preview.skipped} skipped` : ""}.
                </p>
                {preview.sample.length > 0 && (
                  <p className="muted">e.g. {preview.sample.join(", ")}</p>
                )}
                {preview.errors.map((e, i) => (
                  <p key={i} className="muted">
                    ⚠ {e}
                  </p>
                ))}
              </div>
            )}
          </fieldset>
          {action.pending && (
            <p className="muted small" role="status">
              Processing import…
            </p>
          )}
          <OutcomeNote outcome={action.outcome} />
        </SettingsEditor>
      )}
    </SettingsSection>
  );
}
