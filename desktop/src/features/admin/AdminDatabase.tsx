import { useEffect, useMemo, useRef, useState } from "react";
import { Columns3, Database, RefreshCw, Search, Table2 } from "lucide-react";
import type {
  AdminDatabaseRows,
  AdminDatabaseTable,
  AdminDatabaseTableDetail,
} from "@orbyn/core";
import { client } from "../../lib/api";
import type { TeamActions } from "../teams/TeamDetail";
import "./database.css";

type Panel = "Rows" | "Columns" | "Indexes";

const display = (value: unknown) => {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
};

/** Bounded, read-only database browser. Private values are masked by the API. */
export function AdminDatabase({ report }: Pick<TeamActions, "report">) {
  const [tables, setTables] = useState<AdminDatabaseTable[]>([]);
  const [selected, setSelected] = useState("");
  const [detail, setDetail] = useState<AdminDatabaseTableDetail | null>(null);
  const [data, setData] = useState<AdminDatabaseRows | null>(null);
  const [panel, setPanel] = useState<Panel>("Rows");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const rowRequest = useRef(0);

  useEffect(() => {
    let active = true;
    client.adminDatabaseTables().then(
      (list) => {
        if (!active) return;
        setTables(list);
        setSelected((current) =>
          list.some((table) => table.name === current)
            ? current
            : (list[0]?.name ?? ""),
        );
        setError("");
      },
      (e: Error) => {
        if (active) setError(e.message);
        report(e);
      },
    );
    return () => {
      active = false;
    };
  }, [refresh, report]);

  useEffect(() => {
    if (!selected) return;
    let active = true;
    const request = ++rowRequest.current;
    setDetail(null);
    setData(null);
    setLoading(true);
    Promise.all([
      client.adminDatabaseTable(selected),
      client.adminDatabaseRows(selected),
    ]).then(
      ([nextDetail, nextData]) => {
        if (!active || request !== rowRequest.current) return;
        setDetail(nextDetail);
        setData(nextData);
        setLoading(false);
        setError("");
      },
      (e: Error) => {
        if (!active || request !== rowRequest.current) return;
        setError(e.message);
        setLoading(false);
        report(e);
      },
    );
    return () => {
      active = false;
    };
  }, [selected, refresh, report]);

  const loadRows = (offset: number) => {
    if (!selected) return;
    const request = ++rowRequest.current;
    setLoading(true);
    client.adminDatabaseRows(selected, offset).then(
      (next) => {
        if (request !== rowRequest.current) return;
        setData(next);
        setLoading(false);
        setError("");
      },
      (e: Error) => {
        if (request !== rowRequest.current) return;
        setError(e.message);
        setLoading(false);
        report(e);
      },
    );
  };

  const filtered = useMemo(
    () =>
      tables.filter((table) =>
        table.name.includes(search.toLowerCase().trim()),
      ),
    [tables, search],
  );

  return (
    <section className="admin-database">
      <div className="card db-intro">
        <div>
          <span className="db-eyebrow">
            <Database size={15} /> PUBLIC SCHEMA
          </span>
          <h2>Database explorer</h2>
          <p>
            Inspect tables, columns, indexes and small row previews. Private
            content and secrets are masked.
          </p>
        </div>
        <button
          className="secondary"
          onClick={() => setRefresh((n) => n + 1)}
          disabled={loading}
        >
          <RefreshCw size={14} /> Refresh
        </button>
      </div>
      {error && (
        <p className="db-error" role="alert">
          {error}
        </p>
      )}
      <div className="db-layout">
        <aside className="card db-sidebar" aria-label="Database tables">
          <label className="db-search">
            <Search size={15} />
            <input
              aria-label="Find a database table"
              placeholder="Find a table…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <div className="db-table-count">
            TABLES <span>{filtered.length}</span>
          </div>
          <div className="db-table-list">
            {filtered.map((table) => (
              <button
                key={table.name}
                className={selected === table.name ? "selected" : ""}
                onClick={() => {
                  setSelected(table.name);
                  setPanel("Rows");
                }}
                aria-current={selected === table.name ? "true" : undefined}
              >
                <Table2 size={14} /> <span>{table.name}</span>
              </button>
            ))}
            {!filtered.length && <p className="muted">No matching tables.</p>}
          </div>
        </aside>
        <div className="card db-main">
          {detail ? (
            <>
              <div className="db-main-head">
                <div>
                  <span className="db-eyebrow">public / table</span>
                  <h2>
                    <Table2 size={20} /> {detail.table.name}
                  </h2>
                  <p>
                    {detail.table.description || "Database table"} · About{" "}
                    {detail.table.estimated_rows.toLocaleString()} rows ·{" "}
                    {detail.table.size}
                  </p>
                </div>
              </div>
              <div
                className="db-tabs"
                role="tablist"
                aria-label="Table details"
              >
                {(["Rows", "Columns", "Indexes"] as const).map((name) => (
                  <button
                    key={name}
                    role="tab"
                    aria-selected={panel === name}
                    className={panel === name ? "active" : ""}
                    onClick={() => setPanel(name)}
                  >
                    {name}
                    {name === "Columns"
                      ? ` ${detail.columns.length}`
                      : name === "Indexes"
                        ? ` ${detail.indexes.length}`
                        : ""}
                  </button>
                ))}
              </div>
              {panel === "Rows" && (
                <>
                  <p className="db-hint">
                    Read-only preview · 25 rows per page · •••• means a masked
                    value
                  </p>
                  <div className="db-grid-scroll">
                    <table className="data-table db-grid">
                      <thead>
                        <tr>
                          {detail.columns.map((column) => (
                            <th key={column.name}>{column.name}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {data?.rows.map((row, index) => (
                          <tr key={`${data.offset}-${index}`}>
                            {detail.columns.map((column) => (
                              <td
                                key={column.name}
                                className={
                                  row[column.name] === "••••" ? "db-masked" : ""
                                }
                                title={display(row[column.name])}
                              >
                                {display(row[column.name])}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {data && !data.rows.length && (
                      <p className="db-empty">
                        This table has no rows on this page.
                      </p>
                    )}
                  </div>
                  <div className="db-pager">
                    <span>
                      {data
                        ? `${data.offset + (data.rows.length ? 1 : 0)}–${data.offset + data.rows.length}`
                        : "—"}{" "}
                      rows
                    </span>
                    <div>
                      <button
                        className="secondary"
                        disabled={loading || !data?.offset}
                        onClick={() =>
                          loadRows(Math.max(0, (data?.offset ?? 0) - 25))
                        }
                      >
                        Previous
                      </button>
                      <button
                        className="secondary"
                        disabled={
                          loading ||
                          !data?.has_more ||
                          data.offset + data.limit > 10000
                        }
                        onClick={() => loadRows((data?.offset ?? 0) + 25)}
                      >
                        Next
                      </button>
                    </div>
                  </div>
                </>
              )}
              {panel === "Columns" && (
                <div className="db-grid-scroll">
                  <table className="data-table db-grid">
                    <thead>
                      <tr>
                        <th>Column</th>
                        <th>Type</th>
                        <th>Nullable</th>
                        <th>Default</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.columns.map((column) => (
                        <tr key={column.name}>
                          <td>
                            <Columns3 size={13} />{" "}
                            <strong>{column.name}</strong>
                            {column.primary_key && (
                              <span className="db-pk">PK</span>
                            )}
                          </td>
                          <td>
                            <code>{column.type}</code>
                          </td>
                          <td>{column.nullable ? "Yes" : "No"}</td>
                          <td>
                            <code>{column.default_value ?? "—"}</code>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {panel === "Indexes" && (
                <div className="db-indexes">
                  {detail.indexes.map((index) => (
                    <div key={index.name}>
                      <strong>{index.name}</strong>
                      <code>{index.definition}</code>
                    </div>
                  ))}
                  {!detail.indexes.length && (
                    <p className="muted">No indexes.</p>
                  )}
                </div>
              )}
            </>
          ) : (
            <div className="db-loading">
              {loading ? "Loading table…" : "Choose a table to inspect."}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
