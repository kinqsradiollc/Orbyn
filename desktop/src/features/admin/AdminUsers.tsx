import { useCallback, useEffect, useRef, useState } from "react";
import { Search, Trash2 } from "lucide-react";
import type { AdminUser, SystemRole } from "@orbyn/core";
import { client } from "../../lib/api";
import type { TeamActions } from "../teams/TeamDetail";
import { stagger } from "../../lib/motion";

const PAGE = 50;

type Props = Pick<TeamActions, "user" | "busy" | "act" | "refresh" | "report">;

/** Searchable account table: system role, enable/disable, delete. */
export function AdminUsers({ user, busy, act, refresh, report }: Props) {
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<AdminUser[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);
  const reportRef = useRef(report);
  reportRef.current = report;

  const fetchPage = useCallback(async (offset: number, term: string) => {
    const mine = ++seq.current;
    setLoading(true);
    try {
      const page = await client.adminListUsers({
        search: term.trim() || undefined,
        limit: PAGE,
        offset,
      });
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
    const t = setTimeout(() => void fetchPage(0, search), search ? 250 : 0);
    return () => clearTimeout(t);
  }, [search, fetchPage]);

  const update = (
    target: AdminUser,
    input: { role?: SystemRole; disabled?: boolean; email_verified?: boolean },
  ) =>
    void act(async () => {
      const next = await client.adminUpdateUser(target.id, input);
      setRows((rs) => rs.map((r) => (r.id === next.id ? next : r)));
      await refresh();
    });

  const changeRole = (target: AdminUser, role: SystemRole) => {
    if (
      target.id === user?.id &&
      role !== "admin" &&
      !window.confirm(
        "Remove your own admin access? You'll lose access to this console.",
      )
    )
      return;
    update(target, { role });
  };

  const toggleDisabled = (target: AdminUser) => {
    if (
      !target.disabled &&
      !window.confirm(
        `Disable ${target.email}? They won't be able to sign in until you enable them again.`,
      )
    )
      return;
    update(target, { disabled: !target.disabled });
  };

  const remove = (target: AdminUser) => {
    if (
      !window.confirm(
        `Permanently delete ${target.email}'s account? This can't be undone.`,
      )
    )
      return;
    void act(async () => {
      await client.adminDeleteUser(target.id);
      setRows((rs) => rs.filter((r) => r.id !== target.id));
      setTotal((n) => Math.max(0, n - 1));
      await refresh();
    });
  };

  return (
    <section className="card">
      <div className="section-heading">
        <h2>
          Users <span>{total}</span>
        </h2>
        <div className="search">
          <Search size={16} />
          <input
            aria-label="Search users"
            placeholder="Name or email…"
            maxLength={100}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Status</th>
              <th>Teams</th>
              <th>Items</th>
              <th>Joined</th>
              <th>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((u, n) => {
              const self = u.id === user?.id;
              return (
                <tr
                  key={u.id}
                  className={
                    "fade-up stagger " + (u.disabled ? "is-disabled" : "")
                  }
                  style={stagger(n % PAGE)}
                >
                  <td>
                    <strong>{u.name}</strong>
                    {self && <span className="you-tag">You</span>}
                  </td>
                  <td>
                    {u.email}
                    {!u.email_verified && (
                      <span className="admin-unverified">
                        <span className="status-pill disabled">Unverified</span>
                        <button
                          className="link-button"
                          disabled={busy}
                          onClick={() => update(u, { email_verified: true })}
                        >
                          Verify
                        </button>
                      </span>
                    )}
                  </td>
                  <td>
                    <select
                      className="role-select"
                      aria-label={`System role for ${u.name}`}
                      value={u.role}
                      disabled={busy}
                      onChange={(e) =>
                        changeRole(u, e.target.value as SystemRole)
                      }
                    >
                      <option value="admin">Admin</option>
                      <option value="member">Member</option>
                    </select>
                  </td>
                  <td>
                    <span
                      className={
                        "status-pill " + (u.disabled ? "disabled" : "active")
                      }
                    >
                      {u.disabled ? "Disabled" : "Active"}
                    </span>
                    {!self && (
                      <button
                        className="link-button"
                        disabled={busy}
                        onClick={() => toggleDisabled(u)}
                      >
                        {u.disabled ? "Enable" : "Disable"}
                      </button>
                    )}
                  </td>
                  <td>{u.team_count}</td>
                  <td>{u.item_count}</td>
                  <td>{new Date(u.created_at).toLocaleDateString()}</td>
                  <td className="row-actions">
                    {!self && (
                      <button
                        className="danger-text"
                        aria-label={`Delete ${u.email}`}
                        disabled={busy}
                        onClick={() => remove(u)}
                      >
                        <Trash2 size={13} /> Delete
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
            {!rows.length && !loading && (
              <tr>
                <td colSpan={8} className="muted table-empty">
                  {search ? "No one matches that search." : "No users yet."}
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
            onClick={() => void fetchPage(rows.length, search)}
          >
            {loading ? "Loading…" : "Load more"}
          </button>
        )}
      </div>
    </section>
  );
}
