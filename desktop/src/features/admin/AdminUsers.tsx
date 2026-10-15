import { Select } from "../../components/Select";
import { useConfirm } from "../../components/Confirm";
import { useCallback, useEffect, useRef, useState } from "react";
import { Search, Trash2, MoreHorizontal } from "lucide-react";
import type { AdminUser, SystemRole } from "@orbyn/core";
import { client } from "../../lib/api";
import type { TeamActions } from "../teams/TeamDetail";
import { Popover } from "../../components/Popover";

const PAGE = 50;

type Props = Pick<
  TeamActions,
  "user" | "busy" | "act" | "refresh" | "report"
> & {
  /** Open one account in full, with everything an admin can do for it. */
  onOpen?: (id: string) => void;
};

/** Searchable account table: system role, enable/disable, delete. */
export function AdminUsers({
  user,
  busy,
  act,
  refresh,
  report,
  onOpen,
}: Props) {
  const { ask } = useConfirm();
  const [search, setSearch] = useState("");
  const [menu, setMenu] = useState<{ id: string; anchor: DOMRect } | null>(
    null,
  );

  const [rows, setRows] = useState<AdminUser[]>([]);
  const selected = rows.find((row) => row.id === menu?.id);
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

  const update = async (
    target: AdminUser,
    input: { role?: SystemRole; disabled?: boolean; email_verified?: boolean },
  ) => {
    const title = input.role
      ? `Change ${target.email}'s system role from ${target.role} to ${input.role}?${target.id === user?.id && input.role !== "admin" ? " You'll lose access to this console." : ""}`
      : input.disabled !== undefined
        ? `${input.disabled ? "Disable" : "Enable"} ${target.email}? ${input.disabled ? "They will be signed out and unable to sign in." : "They will be able to sign in again."}`
        : `Mark ${target.email} as verified? This bypasses email confirmation.`;
    if (
      !(await ask({
        title,
        confirmLabel: "Apply change",
        destructive: input.disabled === true,
      }))
    )
      return;
    void act(async () => {
      const next = await client.adminUpdateUser(target.id, input);
      setRows((rs) => rs.map((r) => (r.id === next.id ? next : r)));
      await refresh();
    });
  };

  const changeRole = (target: AdminUser, role: SystemRole) =>
    void update(target, { role });

  const toggleDisabled = (target: AdminUser) =>
    void update(target, { disabled: !target.disabled });

  const remove = async (target: AdminUser) => {
    if (
      !(await ask({
        title: `Permanently delete ${target.email}'s account? This can't be undone.`,
        confirmLabel: "Delete",
        destructive: true,
      }))
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
        <table className="data-table stack-table">
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
            {rows.map((u) => {
              const self = u.id === user?.id;
              return (
                <tr key={u.id} className={u.disabled ? "is-disabled" : ""}>
                  <td>
                    {onOpen ? (
                      <button
                        className="link-button admin-user-link"
                        title="Open account"
                        onClick={() => onOpen(u.id)}
                      >
                        <strong>{u.name}</strong>
                      </button>
                    ) : (
                      <strong>{u.name}</strong>
                    )}
                    {self && <span className="you-tag">You</span>}
                  </td>
                  <td data-label="Email">
                    {u.email}
                    {!u.email_verified && (
                      <span className="admin-unverified">
                        <span className="status-pill disabled">Unverified</span>
                      </span>
                    )}
                  </td>
                  <td data-label="Role">
                    <span>{u.role === "admin" ? "Admin" : "Member"}</span>
                  </td>
                  <td data-label="Status">
                    <span
                      className={
                        "status-pill " + (u.disabled ? "disabled" : "active")
                      }
                    >
                      {u.disabled ? "Disabled" : "Active"}
                    </span>
                  </td>
                  <td data-label="Teams">{u.team_count}</td>
                  <td data-label="Items">{u.item_count}</td>
                  <td data-label="Joined">
                    {new Date(u.created_at).toLocaleDateString()}
                  </td>
                  <td className="row-actions">
                    <button
                      className="icon-button"
                      aria-label={`${u.name} options`}
                      aria-haspopup="dialog"
                      aria-expanded={menu?.id === u.id}
                      disabled={busy}
                      onClick={(event) =>
                        setMenu({
                          id: u.id,
                          anchor: event.currentTarget.getBoundingClientRect(),
                        })
                      }
                    >
                      <MoreHorizontal size={16} />
                    </button>
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
      {menu && selected && (
        <Popover
          anchor={menu.anchor}
          label={`${selected.name} options`}
          onClose={() => setMenu(null)}
        >
          <div className="admin-user-options">
            <label>
              System role
              <Select
                aria-label={`System role for ${selected.name}`}
                value={selected.role}
                disabled={busy}
                onChange={(event) => {
                  setMenu(null);
                  changeRole(selected, event.target.value as SystemRole);
                }}
              >
                <option value="admin">Admin</option>
                <option value="member">Member</option>
              </Select>
            </label>
            {!selected.email_verified && (
              <button
                className="secondary"
                disabled={busy}
                onClick={() => {
                  setMenu(null);
                  void update(selected, { email_verified: true });
                }}
              >
                Verify email
              </button>
            )}
            {selected.id !== user?.id && (
              <>
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() => {
                    setMenu(null);
                    toggleDisabled(selected);
                  }}
                >
                  {selected.disabled ? "Enable account" : "Disable account"}
                </button>
                <button
                  className="danger"
                  disabled={busy}
                  onClick={() => {
                    setMenu(null);
                    void remove(selected);
                  }}
                >
                  <Trash2 size={14} /> Delete account
                </button>
              </>
            )}
          </div>
        </Popover>
      )}
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
