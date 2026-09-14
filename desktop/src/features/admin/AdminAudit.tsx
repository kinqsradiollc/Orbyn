import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import type { AuditEntry } from "@orbyn/core";
import { client } from "../../lib/api";
import type { TeamActions } from "../teams/TeamDetail";
import { stagger } from "../../lib/motion";

const PAGE = 50;

const formatValue = (v: unknown) =>
  v !== null && typeof v === "object" ? JSON.stringify(v) : String(v);

const formatDetails = (details: Record<string, unknown>) =>
  Object.entries(details ?? {})
    .map(([k, v]) => `${k}: ${formatValue(v)}`)
    .join(" · ");

/** Newest-first audit log with "Load more" pagination. */
export function AdminAudit({ report }: Pick<TeamActions, "report">) {
  const [rows, setRows] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);
  const reportRef = useRef(report);
  reportRef.current = report;

  const fetchPage = useCallback(async (offset: number) => {
    const mine = ++seq.current;
    setLoading(true);
    try {
      const page = await client.adminListAudit({ limit: PAGE, offset });
      if (mine !== seq.current) return;
      setRows((prev) => (offset ? [...prev, ...page.rows] : page.rows));
      setTotal(page.total);
    } catch (e) {
      if (mine === seq.current) reportRef.current(e);
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchPage(0);
  }, [fetchPage]);

  return (
    <section className="card">
      <div className="section-heading">
        <h2>
          Audit log <span>{total}</span>
        </h2>
        <button
          className="icon-button"
          aria-label="Refresh audit log"
          disabled={loading}
          onClick={() => void fetchPage(0)}
        >
          <RefreshCw size={16} />
        </button>
      </div>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Time</th>
              <th>Actor</th>
              <th>Action</th>
              <th>Target</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((a, n) => (
              <tr
                key={a.id}
                className="fade-up stagger"
                style={stagger(n % PAGE)}
              >
                <td className="nowrap">
                  {new Date(a.created_at).toLocaleString()}
                </td>
                <td>
                  {a.actor_email ?? (
                    <span className="muted">
                      {a.actor_id ? "Deleted user" : "System"}
                    </span>
                  )}
                </td>
                <td>
                  <code className="audit-action">{a.action}</code>
                </td>
                <td className="nowrap">
                  {a.target_type}
                  {a.target_id && (
                    <small className="muted" title={a.target_id}>
                      {" "}
                      {a.target_id.slice(0, 8)}
                    </small>
                  )}
                </td>
                <td className="audit-details" title={formatDetails(a.details)}>
                  {formatDetails(a.details) || <span className="muted">—</span>}
                </td>
              </tr>
            ))}
            {!rows.length && !loading && (
              <tr>
                <td colSpan={5} className="muted table-empty">
                  Nothing has been recorded yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="table-footer">
        <small className="muted">
          Showing {rows.length} of {total}
        </small>
        {rows.length < total && (
          <button
            className="secondary"
            disabled={loading}
            onClick={() => void fetchPage(rows.length)}
          >
            {loading ? "Loading…" : "Load more"}
          </button>
        )}
      </div>
    </section>
  );
}
