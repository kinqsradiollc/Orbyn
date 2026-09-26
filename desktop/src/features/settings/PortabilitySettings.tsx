import { SettingsSection } from "./SettingsSection";
import { FilePicker } from "../../components/FilePicker";
import { Select } from "../../components/Select";
import { useState } from "react";
import { Archive, Download, Upload } from "lucide-react";
import type { ImportSummary, PagesImportSummary } from "@orbyn/core";
import { client } from "../../lib/api";
import { OutcomeNote, useAction } from "../../components/Outcome";

type TaskFormat = "orbyn" | "csv" | "todoist" | "ticktick";

/** Which app a CSV came from, by its header (DATA-08). */
export function csvFormat(text: string): TaskFormat {
  const head = text.slice(0, 2000).toLowerCase();
  if (/^\ufeff?"?type"?,"?content"?/.test(head)) return "todoist";
  if (head.includes('"list name"') || head.includes("list name,"))
    return "ticktick";
  return "csv";
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
  const [format, setFormat] = useState<"markdown" | "notion">("markdown");
  const [file, setFile] = useState<{ name: string; data: string } | null>(null);
  const [preview, setPreview] = useState<PagesImportSummary | null>(null);
  const [made, setMade] = useState<string | null>(null);
  const action = useAction(report);
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
      <h3 className="settings-subtitle">Pages from Markdown or Notion</h3>
      <p className="muted">
        A folder of Markdown notes as a .zip (or one .md file), or a Notion
        export (Markdown &amp; CSV). Pages keep their folders, [[links]] between
        them work, and Notion databases become projects with their rows as
        tasks.
      </p>
      <div className="settings-grid">
        <label className="settings-field">
          <span className="settings-label">From</span>
          <Select
            value={format}
            onChange={(e) => {
              setFormat(e.target.value as "markdown" | "notion");
              setPreview(null);
            }}
          >
            <option value="markdown">Markdown (.zip or .md)</option>
            <option value="notion">Notion export (.zip)</option>
          </Select>
        </label>
        <div className="settings-field">
          <span className="settings-label">Choose a file</span>
          <FilePicker
            accept=".zip,.md,.markdown,.txt,application/zip,text/markdown"
            hint="or drop a .zip or .md here"
            onFile={(f) =>
              void action.run(async () => {
                setPreview(null);
                setMade(null);
                if (f.size > 20 * 1024 * 1024)
                  throw new Error(
                    "That file is over 20 MB. Split the export and try again.",
                  );
                setFile({ name: f.name, data: await base64Of(f) });
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
              setPreview(
                await client.importPages({
                  format,
                  file_name: file!.name,
                  data: file!.data,
                  dry_run: true,
                }),
              );
            })
          }
        >
          Preview
        </button>
        {preview && !preview.errors.length && (
          <button
            className="primary"
            disabled={action.pending || (!preview.pages && !preview.projects)}
            onClick={() =>
              void action.run(async () => {
                const done = await client.importPages({
                  format,
                  file_name: file!.name,
                  data: file!.data,
                  dry_run: false,
                });
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
          <button className="secondary" onClick={() => onOpenFolder(made)}>
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
            <p className="muted">Left out: {preview.left_out.join(", ")}.</p>
          )}
          {preview.errors.map((e, i) => (
            <p key={i} className="muted">
              ⚠ {e}
            </p>
          ))}
        </div>
      )}
      <OutcomeNote outcome={action.outcome} />
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
  const [format, setFormat] = useState<TaskFormat>("csv");
  const [data, setData] = useState("");
  const [preview, setPreview] = useState<ImportSummary | null>(null);
  const action = useAction(report);

  const download = () =>
    void action.run(async () => {
      const archive = await client.exportData();
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
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
      return "Everything was downloaded.";
    });

  const onFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? "");
      setData(text);
      setFormat(file.name.endsWith(".csv") ? csvFormat(text) : "orbyn");
      setPreview(null);
    };
    reader.readAsText(file);
  };

  const dryRun = () =>
    void action.run(async () => {
      setPreview(await client.importData({ format, data, dry_run: true }));
    });
  const doImport = () =>
    void action.run(async () => {
      const summary = await client.importData({ format, data, dry_run: false });
      setPreview(null);
      setData("");
      return `Imported ${summary.created} item${summary.created === 1 ? "" : "s"}.`;
    });

  return (
    <SettingsSection
      className="card settings-card"
      aria-labelledby="portability-title"
    >
      <h2 id="portability-title">Import &amp; export</h2>
      <p className="muted">
        Take everything with you — every page as Markdown in its folders — or
        bring tasks and pages in from another app.
      </p>

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

      <h3 className="settings-subtitle">Tasks</h3>
      <p className="muted">
        An Orbyn export, a Todoist or TickTick CSV, or any CSV with a{" "}
        <code>title</code> column (plus optional <code>notes</code>,{" "}
        <code>due</code>, <code>priority</code>, <code>list</code>,{" "}
        <code>tags</code>). Nothing is written until you confirm.
      </p>
      <div className="settings-grid">
        <label className="settings-field">
          <span className="settings-label">Format</span>
          <Select
            value={format}
            onChange={(e) => {
              setFormat(e.target.value as TaskFormat);
              setPreview(null);
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
            accept=".csv,.json,text/csv,application/json"
            hint="or drop a CSV or JSON here"
            onFile={onFile}
          />
        </div>
      </div>
      <textarea
        className="portability-paste"
        rows={5}
        value={data}
        placeholder="…or paste your CSV or JSON here"
        onChange={(e) => {
          setData(e.target.value);
          setPreview(null);
        }}
      />
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
            {preview.lists_added === 1 ? "" : "s"}, {preview.tags_added} new tag
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
      <OutcomeNote outcome={action.outcome} />
      <PageImport report={report} onOpenFolder={onOpenFolder} />
    </SettingsSection>
  );
}
