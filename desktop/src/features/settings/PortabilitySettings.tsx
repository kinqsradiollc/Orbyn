import { useState } from "react";
import { Download, Upload } from "lucide-react";
import type { ImportSummary } from "@orbyn/core";
import { client } from "../../lib/api";
import { OutcomeNote, useAction } from "../../components/Outcome";

/** Export a JSON archive, and import items from an Orbyn export or a CSV. */
export function PortabilitySettings({
  report,
}: {
  report: (e: unknown) => void;
}) {
  const [format, setFormat] = useState<"orbyn" | "csv">("csv");
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

  const onFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      setData(String(reader.result ?? ""));
      setFormat(file.name.endsWith(".csv") ? "csv" : "orbyn");
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
    <section className="card settings-card" aria-labelledby="portability-title">
      <h2 id="portability-title">Import &amp; export</h2>
      <p className="muted">
        Take your planner data with you, or bring it in from another app.
      </p>

      <button
        className="secondary"
        disabled={action.pending}
        onClick={download}
      >
        <Download size={14} /> Export my data (JSON)
      </button>

      <h3 className="settings-subtitle">Import</h3>
      <p className="muted">
        An Orbyn export, or a CSV with a <code>title</code> column (plus
        optional <code>notes</code>, <code>due</code>, <code>priority</code>,{" "}
        <code>list</code>, <code>tags</code>). Nothing is written until you
        confirm.
      </p>
      <div className="settings-grid">
        <label className="settings-field">
          <span className="settings-label">Format</span>
          <select
            value={format}
            onChange={(e) => {
              setFormat(e.target.value as "orbyn" | "csv");
              setPreview(null);
            }}
          >
            <option value="csv">CSV</option>
            <option value="orbyn">Orbyn export (JSON)</option>
          </select>
        </label>
        <label className="settings-field">
          <span className="settings-label">Choose a file</span>
          <input
            type="file"
            accept=".csv,.json,text/csv,application/json"
            onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
          />
        </label>
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
    </section>
  );
}
