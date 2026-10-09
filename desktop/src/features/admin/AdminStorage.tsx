import { useCallback, useEffect, useState } from "react";
import { Brush, HardDrive, RefreshCw, Trash2 } from "lucide-react";
import type { AdminStorage as Storage } from "@orbyn/core";
import { client } from "../../lib/api";
import { useConfirm } from "../../components/Confirm";
import "./storage.css";

export const bytes = (n: number | null | undefined) => {
  if (n === null || n === undefined) return "—";
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 10 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
};

const ago = (iso: string | null) => {
  if (!iso) return "—";
  const m = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
};

const within = (iso: string) => {
  const m = Math.max(0, Math.round((Date.parse(iso) - Date.now()) / 60_000));
  return m < 60 ? `${m} min` : `${Math.round(m / 60)} h`;
};

const SCANS: Record<Storage["reading"]["scans"], string> = {
  tesseract: "Tesseract (built in)",
  full: "Heavy OCR model",
  none: "Not available",
  unknown: "Converter not reporting",
};

const ENGINE: Record<string, string> = {
  text: "own text",
  docx: "Word",
  tesseract: "Tesseract",
  full: "OCR model",
};

/**
 * Admin → Storage: what the server holds. Information about files only —
 * admins can delete an upload but never open it.
 */
export function AdminStorage({ report }: { report: (e: unknown) => void }) {
  const { ask } = useConfirm();
  const [data, setData] = useState<Storage | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  const load = useCallback(
    () => client.adminStorage().then(setData, report),
    [report],
  );
  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 15_000);
    return () => clearInterval(timer);
  }, [load]);

  const remove = async (f: Storage["stored"][number]) => {
    if (
      !(await ask({
        title: `Delete ${f.file_name} now?`,
        body: `The upload from ${f.owner_name} is deleted from the server and its import is cancelled. This is recorded in the audit log.`,
        confirmLabel: "Delete now",
        destructive: true,
      }))
    )
      return;
    setBusy(true);
    try {
      await client.adminDeleteStoredFile(f.import_id);
      setNote(`Deleted ${f.file_name}.`);
      await load();
    } catch (e) {
      report(e);
    } finally {
      setBusy(false);
    }
  };

  const sweep = async () => {
    setBusy(true);
    try {
      const { removed } = await client.adminSweepStorage();
      setNote(
        removed
          ? `Swept ${removed} file${removed === 1 ? "" : "s"}.`
          : "Nothing to sweep.",
      );
      await load();
    } catch (e) {
      report(e);
    } finally {
      setBusy(false);
    }
  };

  if (!data) return <p className="muted">Loading storage…</p>;
  const used =
    data.files.disk_total && data.files.disk_free !== null
      ? 1 - data.files.disk_free / data.files.disk_total
      : null;

  return (
    <div className="admin-storage">
      <div className="storage-stats">
        <div className="card storage-stat">
          <small>Database</small>
          <strong>{bytes(data.database.bytes)}</strong>
        </div>
        <div className="card storage-stat">
          <small>
            File store · {data.files.count} file
            {data.files.count === 1 ? "" : "s"}
          </small>
          <strong>
            {data.files.reachable ? bytes(data.files.bytes) : "Not reachable"}
          </strong>
          {used !== null && (
            <>
              <span
                className="storage-meter"
                role="meter"
                aria-label="Disk used"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(used * 100)}
              >
                <i style={{ width: `${Math.round(used * 100)}%` }} />
              </span>
              <small>
                {Math.round(used * 100)}% of the disk used ·{" "}
                {bytes(data.files.disk_free)} free
              </small>
            </>
          )}
          {data.files.oldest_at && (
            <small>Oldest {ago(data.files.oldest_at)}</small>
          )}
        </div>
        {data.originals && (
          <div className="card storage-stat">
            <small>Kept originals</small>
            <strong>{bytes(data.originals.bytes)}</strong>
            <small>
              {data.originals.count} file
              {data.originals.count === 1 ? "" : "s"} for{" "}
              {data.originals.people}{" "}
              {data.originals.people === 1 ? "person" : "people"} · in kept/,
              back it up
            </small>
          </div>
        )}
        <div className="card storage-stat">
          <small>Reading scans</small>
          <strong>{SCANS[data.reading.scans]}</strong>
          <small>
            {data.reading.formulas
              ? "Equations on scans read too"
              : "Equations on scans not read"}
            {" · "}
            {data.reading.workers} at a time
          </small>
          <small className={data.reading.converter_ok ? "" : "storage-bad"}>
            Converter{" "}
            {data.reading.converter_ok
              ? `reported ${ago(data.reading.converter_seen_at)}`
              : "is not running"}
          </small>
        </div>
        <div className="card storage-stat">
          <small>Import queue</small>
          <strong>
            {data.queue.pages_waiting} page
            {data.queue.pages_waiting === 1 ? "" : "s"} waiting
          </strong>
          <small>
            {data.queue.queued + data.queue.waiting} waiting ·{" "}
            {data.queue.reading + data.queue.ocr} reading
            {data.queue.seconds_per_page !== null &&
              ` · ${data.queue.seconds_per_page} s a page`}
          </small>
          {data.queue.failed_today > 0 && (
            <small className="storage-bad">
              {data.queue.failed_today} failed today
            </small>
          )}
        </div>
      </div>

      <section className="card storage-section">
        <div className="storage-head">
          <div>
            <h3>
              <HardDrive size={16} /> Files on the server
            </h3>
            <p className="muted">
              Pending uploads are deleted after import or within a day. Admins
              can delete them, but cannot open them.
            </p>
          </div>
          <div className="storage-actions">
            <button
              className="text-button"
              disabled={busy}
              onClick={() => void load()}
            >
              <RefreshCw size={14} /> Refresh
            </button>
            <button
              className="secondary"
              disabled={busy}
              onClick={() => void sweep()}
            >
              <Brush size={14} /> Run sweep now
            </button>
          </div>
        </div>
        {note && (
          <p className="storage-note" role="status">
            {note}
          </p>
        )}
        {data.stored.length === 0 ? (
          <p className="muted storage-empty">No files are stored right now.</p>
        ) : (
          <ul className="storage-files">
            {data.stored.map((f) => (
              <li key={f.import_id}>
                <span className={"storage-kind is-" + f.file_type}>
                  {f.file_type === "docx"
                    ? "DOC"
                    : f.file_type === "pdf"
                      ? "PDF"
                      : "IMG"}
                </span>
                <span className="storage-main">
                  <strong>{f.file_name}</strong>
                  <small>
                    {f.owner_name} ({f.owner_email}) · {bytes(f.bytes)} ·{" "}
                    {f.status} · uploaded {ago(f.uploaded_at)} · deleted within{" "}
                    {within(f.deletes_at)}
                  </small>
                </span>
                <button
                  className="secondary storage-delete"
                  disabled={busy}
                  onClick={() => void remove(f)}
                >
                  <Trash2 size={14} /> Delete now
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {data.queue.reasons.length > 0 && (
        <section className="card storage-section">
          <h3>Why imports failed today</h3>
          <ul className="storage-reasons">
            {data.queue.reasons.map((r) => (
              <li key={r.error}>
                <span>{r.error}</span>
                <b>{r.count}</b>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card storage-section">
        <h3>Imports in the last 30 days</h3>
        {data.history.length === 0 ? (
          <p className="muted storage-empty">No imports yet.</p>
        ) : (
          <div className="storage-table">
            <table>
              <thead>
                <tr>
                  <th>File</th>
                  <th>By</th>
                  <th>Pages</th>
                  <th>Read with</th>
                  <th>Outcome</th>
                  <th>Took</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {data.history.map((h) => (
                  <tr key={h.id}>
                    <td>{h.file_name}</td>
                    <td>{h.owner_name}</td>
                    <td>{h.pages ?? "—"}</td>
                    <td>
                      {h.engines.map((e) => ENGINE[e] ?? e).join(", ") || "—"}
                    </td>
                    <td
                      className={h.status === "failed" ? "storage-bad" : ""}
                      title={h.error ?? undefined}
                    >
                      {h.status}
                    </td>
                    <td>{h.seconds === null ? "—" : `${h.seconds} s`}</td>
                    <td>{ago(h.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
