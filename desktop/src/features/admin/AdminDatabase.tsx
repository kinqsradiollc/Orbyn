import { useEffect, useMemo, useRef, useState } from "react";
import {
  Columns3,
  Database,
  Pencil,
  RefreshCw,
  Search,
  Table2,
} from "lucide-react";
import type {
  AdminDatabaseRows,
  AdminDatabaseTable,
  AdminDatabaseTableDetail,
  SystemRole,
} from "@orbyn/core";
import { client } from "../../lib/api";
import { useConfirm } from "../../components/Confirm";
import type { TeamActions } from "../teams/TeamDetail";
import "./database.css";

type Panel = "Rows" | "Columns" | "Indexes";
type RowDraft =
  | {
      table: "users";
      id: string;
      email: string;
      role: SystemRole;
      disabled: boolean;
      email_verified: boolean;
    }
  | { table: "teams"; id: string; name: string };

const display = (value: unknown) => {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
};

/** Bounded database browser. Validated edits use the regular admin APIs. */
export function AdminDatabase({
  report,
  user,
  refresh: refreshPlanner,
}: Pick<TeamActions, "report" | "user" | "refresh">) {
  const { ask } = useConfirm();
  const [tables, setTables] = useState<AdminDatabaseTable[]>([]);
  const [selected, setSelected] = useState("");
  const [detail, setDetail] = useState<AdminDatabaseTableDetail | null>(null);
  const [data, setData] = useState<AdminDatabaseRows | null>(null);
  const [panel, setPanel] = useState<Panel>("Rows");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [editMode, setEditMode] = useState(false);
  const [editing, setEditing] = useState<RowDraft | null>(null);
  const [saving, setSaving] = useState(false);
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
    setEditing(null);
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

  const toggleEditMode = async () => {
    if (editMode) {
      setEditing(null);
      setEditMode(false);
      return;
    }
    if (
      !(await ask({
        title: "Enable database edit mode?",
        body: "You can edit validated user account fields and team names. Each save asks for confirmation and is recorded in the audit log. Private data stays masked.",
        confirmLabel: "Enable editing",
      }))
    )
      return;
    setEditMode(true);
  };

  const startEdit = (row: Record<string, unknown>) => {
    if (!editMode || typeof row.id !== "string") return;
    if (selected === "users") {
      setEditing({
        table: "users",
        id: row.id,
        email: typeof row.email === "string" ? row.email : row.id,
        role: row.role === "admin" ? "admin" : "member",
        disabled: row.disabled === true,
        email_verified: row.email_verified === true,
      });
    } else if (selected === "teams") {
      setEditing({ table: "teams", id: row.id, name: String(row.name ?? "") });
    }
  };

  const saveEdit = async () => {
    if (!editing || !data || saving) return;
    const original = data.rows.find((row) => row.id === editing.id);
    if (!original) {
      setError("This row changed. Refresh and try again.");
      return;
    }
    if (editing.table === "users") {
      const patch: {
        role?: SystemRole;
        disabled?: boolean;
        email_verified?: boolean;
      } = {};
      if (editing.role !== original.role) patch.role = editing.role;
      if (editing.disabled !== original.disabled)
        patch.disabled = editing.disabled;
      if (editing.email_verified !== original.email_verified)
        patch.email_verified = editing.email_verified;
      const changes = Object.entries(patch).map(
        ([key, value]) =>
          `${key.replaceAll("_", " ")}: ${display(original[key])} → ${display(value)}`,
      );
      if (!changes.length) {
        setEditing(null);
        return;
      }
      if (
        !(await ask({
          title: `Save changes to ${editing.email}?`,
          body: `${changes.join(" · ")}${editing.id === user?.id && patch.role === "member" ? " · You will lose admin access." : ""}`,
          confirmLabel: "Save changes",
          destructive: patch.disabled === true || patch.role === "member",
        }))
      )
        return;
      setSaving(true);
      try {
        await client.adminUpdateUser(editing.id, patch);
        setEditing(null);
        setRefresh((n) => n + 1);
        setError("");
        void refreshPlanner().catch(report);
      } catch (e) {
        setError((e as Error).message);
        report(e);
      } finally {
        setSaving(false);
      }
    } else {
      const name = editing.name.trim();
      if (!name) {
        setError("Enter a team name.");
        return;
      }
      if (name === original.name) {
        setEditing(null);
        return;
      }
      if (
        !(await ask({
          title: `Rename team “${original.name}” to “${name}”?`,
          confirmLabel: "Save name",
        }))
      )
        return;
      setSaving(true);
      try {
        await client.updateTeam(editing.id, { name });
        setEditing(null);
        setRefresh((n) => n + 1);
        setError("");
        void refreshPlanner().catch(report);
      } catch (e) {
        setError((e as Error).message);
        report(e);
      } finally {
        setSaving(false);
      }
    }
  };

  const editableTable = selected === "users" || selected === "teams";

  return (
    <section className="admin-database">
      <div className="card db-intro">
        <div>
          <span className="db-eyebrow">
            <Database size={15} /> PUBLIC SCHEMA
          </span>
          <h2>Database explorer</h2>
          <p>
            Inspect tables, columns, indexes and redacted row previews. Edit
            mode supports validated user fields and team names.
          </p>
        </div>
        <div className="db-intro-actions">
          <div className="db-mode" role="group" aria-label="Database mode">
            <button
              className={!editMode ? "active" : ""}
              aria-pressed={!editMode}
              disabled={saving}
              onClick={() => {
                if (editMode) void toggleEditMode();
              }}
            >
              View
            </button>
            <button
              className={editMode ? "active is-edit" : ""}
              aria-pressed={editMode}
              disabled={saving}
              onClick={() => {
                if (!editMode) void toggleEditMode();
              }}
            >
              <Pencil size={13} /> Edit
            </button>
          </div>
          <button
            className="secondary"
            onClick={() => {
              setEditing(null);
              setRefresh((n) => n + 1);
            }}
            disabled={loading || saving}
          >
            <RefreshCw size={14} /> Refresh
          </button>
        </div>
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
                  setEditing(null);
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
                    {editMode
                      ? editableTable
                        ? "Edit mode · Select a row to change validated fields · 25 rows per page"
                        : "Edit mode · This table has no validated fields to edit"
                      : "View mode · 25 rows per page · •••• means a masked value"}
                  </p>
                  {editing && (
                    <div
                      className="db-editor"
                      aria-label={`Edit ${editing.table} row`}
                    >
                      <div className="db-editor-head">
                        <strong>
                          {editing.table === "users"
                            ? `Edit ${editing.email}`
                            : "Edit team"}
                        </strong>
                        <span>Changes are reviewed before saving</span>
                      </div>
                      {editing.table === "users" ? (
                        <div className="db-editor-fields">
                          <label>
                            System role
                            <select
                              value={editing.role}
                              disabled={saving}
                              onChange={(e) =>
                                setEditing({
                                  ...editing,
                                  role: e.target.value as SystemRole,
                                })
                              }
                            >
                              <option value="member">Member</option>
                              <option value="admin">Admin</option>
                            </select>
                          </label>
                          <label className="db-check">
                            <input
                              type="checkbox"
                              checked={editing.disabled}
                              disabled={saving}
                              onChange={(e) =>
                                setEditing({
                                  ...editing,
                                  disabled: e.target.checked,
                                })
                              }
                            />{" "}
                            Account disabled
                          </label>
                          <label className="db-check">
                            <input
                              type="checkbox"
                              checked={editing.email_verified}
                              disabled={saving}
                              onChange={(e) =>
                                setEditing({
                                  ...editing,
                                  email_verified: e.target.checked,
                                })
                              }
                            />{" "}
                            Email verified
                          </label>
                        </div>
                      ) : (
                        <div className="db-editor-fields">
                          <label>
                            Team name
                            <input
                              value={editing.name}
                              maxLength={80}
                              disabled={saving}
                              onChange={(e) =>
                                setEditing({ ...editing, name: e.target.value })
                              }
                            />
                          </label>
                        </div>
                      )}
                      <div className="db-editor-actions">
                        <button
                          className="secondary"
                          disabled={saving}
                          onClick={() => setEditing(null)}
                        >
                          Cancel
                        </button>
                        <button
                          className="primary"
                          disabled={saving}
                          onClick={() => void saveEdit()}
                        >
                          {saving ? "Saving…" : "Review and save"}
                        </button>
                      </div>
                    </div>
                  )}
                  <div className="db-grid-scroll">
                    <table className="data-table db-grid">
                      <thead>
                        <tr>
                          {editMode && editableTable && <th>Action</th>}
                          {detail.columns.map((column) => (
                            <th key={column.name}>{column.name}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {data?.rows.map((row, index) => (
                          <tr key={`${data.offset}-${index}`}>
                            {editMode && editableTable && (
                              <td>
                                <button
                                  className="link-button"
                                  disabled={saving}
                                  onClick={() => startEdit(row)}
                                >
                                  <Pencil size={12} /> Edit
                                </button>
                              </td>
                            )}
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
