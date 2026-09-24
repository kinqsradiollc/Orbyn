import { useState } from "react";
import {
  ArrowLeft,
  Copy,
  Download,
  KeyRound,
  LogOut,
  Pencil,
  ShieldOff,
} from "lucide-react";
import type { AdminUserDetail as Detail, ApiKey } from "@orbyn/core";
import { client } from "../../lib/api";
import { useRemote } from "../../hooks/useRemote";
import { useConfirm } from "../../components/Confirm";
import { Bars } from "./Bars";
import "./database.css";
import "./insights.css";

/** Every one of the last 30 days, quiet ones as zero, so one busy day is one column. */
const lastThirtyDays = (activity: { day: string; requests: number }[]) => {
  const byDay = new Map(activity.map((a) => [a.day, a.requests]));
  return Array.from({ length: 30 }, (_, n) => {
    const day = new Date(Date.now() - (29 - n) * 86_400_000)
      .toISOString()
      .slice(0, 10);
    return {
      key: day,
      label: new Date(`${day}T12:00:00`).toLocaleDateString([], {
        day: "numeric",
        month: "short",
      }),
      value: byDay.get(day) ?? 0,
    };
  });
};

const when = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString([], {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "—";
const device = (agent: string) =>
  /iPhone|iPad/.test(agent)
    ? "iPhone or iPad"
    : /Android/.test(agent)
      ? "Android"
      : /Electron|Orbyn/.test(agent)
        ? "Orbyn desktop"
        : /Mac/.test(agent)
          ? "Mac browser"
          : /Windows/.test(agent)
            ? "Windows browser"
            : agent
              ? agent.slice(0, 40)
              : "Unknown device";

/** A history entry in words: "signed out", "API key revoked". */
const historyLabel = (action: string) =>
  action.startsWith("api_key.")
    ? `API key ${action.slice("api_key.".length).replaceAll("_", " ")}`
    : action.replace("user.", "").replaceAll("_", " ");

/**
 * One account in full, and what an admin can do for it: correct the name or
 * email, sign it out everywhere or end one session, revoke a personal API
 * key, give a password reset link, clear two-step verification, and export
 * its data. Each asks first and lands in the audit log. The contents of their
 * items stay private.
 */
export function AdminUserDetail({
  userId,
  selfId,
  onBack,
  report,
}: {
  userId: string;
  selfId?: string;
  onBack: () => void;
  report: (e: unknown) => void;
}) {
  const { ask, tell } = useConfirm();
  const [revision, setRevision] = useState(0);
  const data = useRemote(
    () => client.adminUserDetail(userId),
    [userId, revision],
    report,
  );
  const [editing, setEditing] = useState<{
    name: string;
    email: string;
  } | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const self = userId === selfId;

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      setRevision((n) => n + 1);
    } catch (e) {
      report(e);
    } finally {
      setBusy(false);
    }
  };

  if (!data)
    return (
      <section className="card admin-user">
        <p className="db-loading">Loading account…</p>
      </section>
    );
  const d: Detail = data;
  // A server from before key listing sends only the count.
  const keys = d.keys ?? [];

  const saveProfile = async () => {
    if (!editing) return;
    const name = editing.name.trim();
    const email = editing.email.trim().toLowerCase();
    if (name === d.name && email === d.email) return setEditing(null);
    if (
      !(await ask({
        title: `Save changes to ${d.email}?`,
        body: [
          name !== d.name ? `Name: ${d.name} → ${name}` : "",
          email !== d.email
            ? `Email: ${d.email} → ${email}. They sign in with the new address from now on.`
            : "",
        ]
          .filter(Boolean)
          .join(" · "),
        confirmLabel: "Save changes",
      }))
    )
      return;
    await run(async () => {
      const r = await client.adminUpdateUserProfile(d.id, {
        ...(name !== d.name ? { name } : {}),
        ...(email !== d.email ? { email } : {}),
      });
      setEditing(null);
      if (r.verify_again)
        tell({
          title: "Email changed",
          body: "They'll need to confirm the new address before signing in.",
        });
    });
  };

  const signOut = async () => {
    if (
      !(await ask({
        title: `Sign ${d.email} out on every device?`,
        body: "They can sign straight back in with their password.",
        confirmLabel: "Sign out everywhere",
        destructive: true,
      }))
    )
      return;
    await run(() => client.adminSignOutUser(d.id));
  };

  const endSession = async (id: string, agent: string) => {
    if (
      !(await ask({
        title: `End this session (${device(agent)})?`,
        confirmLabel: "End session",
        destructive: true,
      }))
    )
      return;
    await run(() => client.adminEndSession(d.id, id));
  };

  const revokeKey = async (k: ApiKey) => {
    if (
      !(await ask({
        title: `Revoke the key “${k.name}”?`,
        body: "Anything using it stops working at once. They can make a new one in Settings → Connections.",
        confirmLabel: "Revoke key",
        destructive: true,
      }))
    )
      return;
    await run(() => client.adminRevokeApiKey(d.id, k.id));
  };

  const resetLink = async () => {
    if (
      !(await ask({
        title: `Make a password reset link for ${d.email}?`,
        body: "It works once, for an hour. Their password stays as it is until they use it.",
        confirmLabel: "Make link",
      }))
    )
      return;
    await run(async () => {
      const r = await client.adminResetLink(d.id);
      setLink(r.link);
      if (r.emailed)
        tell({ title: "Link made", body: "It was emailed to them as well." });
    });
  };

  const reset2fa = async () => {
    if (
      !(await ask({
        title: `Turn off two-step verification for ${d.email}?`,
        body: "Only do this once you're sure it's really them: their password alone will then sign them in.",
        confirmLabel: "Turn it off",
        destructive: true,
      }))
    )
      return;
    await run(() => client.adminResetTwoFactor(d.id));
  };

  const exportData = async () => {
    if (
      !(await ask({
        title: `Export everything in ${d.email}'s account?`,
        body: "Their tasks, events, lists and pages, as a file. The export is recorded in the audit log.",
        confirmLabel: "Export",
      }))
    )
      return;
    await run(async () => {
      const data = await client.adminExportUser(d.id);
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(data, null, 2)], {
          type: "application/json",
        }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = `orbyn-export-${d.email}.json`;
      a.click();
      URL.revokeObjectURL(url);
    });
  };

  return (
    <section className="admin-user">
      <button className="text-button" onClick={onBack}>
        <ArrowLeft size={14} /> All users
      </button>
      <div className="card admin-user-head">
        {editing ? (
          <div className="admin-user-edit">
            <label>
              Name
              <input
                value={editing.name}
                maxLength={100}
                onChange={(e) =>
                  setEditing({ ...editing, name: e.target.value })
                }
              />
            </label>
            <label>
              Email
              <input
                type="email"
                value={editing.email}
                maxLength={254}
                onChange={(e) =>
                  setEditing({ ...editing, email: e.target.value })
                }
              />
            </label>
            <div className="admin-user-edit-actions">
              <button
                className="secondary"
                disabled={busy}
                onClick={() => setEditing(null)}
              >
                Cancel
              </button>
              <button
                className="primary"
                disabled={busy || !editing.name.trim() || !editing.email.trim()}
                onClick={() => void saveProfile()}
              >
                Save
              </button>
            </div>
          </div>
        ) : (
          <div className="admin-user-title">
            <div>
              <h2>
                {d.name}
                {self && <span className="you-tag">You</span>}
              </h2>
              <p className="muted">
                {d.email} · {d.role === "admin" ? "Admin" : "Member"} ·{" "}
                {d.disabled
                  ? "Disabled"
                  : d.email_verified
                    ? "Active"
                    : "Unverified"}
              </p>
            </div>
            <button
              className="secondary"
              disabled={busy}
              onClick={() => setEditing({ name: d.name, email: d.email })}
            >
              <Pencil size={14} /> Edit
            </button>
          </div>
        )}
        <dl className="admin-user-facts">
          <div>
            <dt>Joined</dt>
            <dd>{when(d.created_at)}</dd>
          </div>
          <div>
            <dt>Last active</dt>
            <dd>{when(d.last_active)}</dd>
          </div>
          <div>
            <dt>Items</dt>
            <dd>
              {d.counts.items} ({d.counts.open_items} open)
            </dd>
          </div>
          <div>
            <dt>Pages · projects</dt>
            <dd>
              {d.counts.docs} · {d.counts.projects}
            </dd>
          </div>
          <div>
            <dt>Sign-in</dt>
            <dd>
              {d.two_factor ? "Two-step on" : "Password only"}
              {d.passkeys
                ? ` · ${d.passkeys} passkey${d.passkeys > 1 ? "s" : ""}`
                : ""}
              {d.api_keys
                ? ` · ${d.api_keys} API key${d.api_keys > 1 ? "s" : ""}`
                : ""}
            </dd>
          </div>
          <div>
            <dt>Teams</dt>
            <dd>
              {d.teams.length
                ? d.teams.map((t) => `${t.name} (${t.role})`).join(", ")
                : "None"}
            </dd>
          </div>
        </dl>
      </div>

      <div className="card admin-user-actions">
        <h3>Account actions</h3>
        <div>
          <button
            className="secondary"
            disabled={busy || self || !d.sessions.length}
            title={self ? "Sign yourself out from Settings" : undefined}
            onClick={() => void signOut()}
          >
            <LogOut size={14} /> Sign out everywhere
          </button>
          <button
            className="secondary"
            disabled={busy || d.disabled}
            onClick={() => void resetLink()}
          >
            <KeyRound size={14} /> Password reset link
          </button>
          <button
            className="secondary"
            disabled={busy || !d.two_factor}
            title={d.two_factor ? undefined : "Two-step verification is off"}
            onClick={() => void reset2fa()}
          >
            <ShieldOff size={14} /> Turn off two-step
          </button>
          <button
            className="secondary"
            disabled={busy}
            onClick={() => void exportData()}
          >
            <Download size={14} /> Export their data
          </button>
        </div>
        {link && (
          <div className="admin-link">
            <code>{link}</code>
            <button
              className="secondary"
              onClick={() =>
                void navigator.clipboard
                  .writeText(link)
                  .then(() => tell({ title: "Link copied" }))
              }
            >
              <Copy size={14} /> Copy
            </button>
            <small className="muted">
              Works once, for an hour. Send it to them privately.
            </small>
          </div>
        )}
      </div>

      <div className="admin-user-grid">
        <div className="card">
          <div className="section-heading">
            <h2>
              Signed in <span>{d.sessions.length}</span>
            </h2>
          </div>
          {d.sessions.length === 0 ? (
            <p className="db-empty">Not signed in anywhere.</p>
          ) : (
            <ul className="admin-sessions">
              {d.sessions.map((s) => (
                <li key={s.id}>
                  <span>
                    <strong>{device(s.user_agent)}</strong>
                    <small className="muted">
                      Last seen {when(s.last_seen_at)}
                    </small>
                  </span>
                  <button
                    className="text-button danger-text"
                    disabled={busy || self}
                    onClick={() => void endSession(s.id, s.user_agent)}
                  >
                    End
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="card">
          <div className="section-heading">
            <h2>Activity, last 30 days</h2>
          </div>
          <div className="admin-user-activity">
            {d.activity.length ? (
              <Bars
                label="Requests"
                height={80}
                data={lastThirtyDays(d.activity)}
              />
            ) : (
              <p className="db-empty">No activity recorded yet.</p>
            )}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="section-heading">
          <h2>
            API keys <span>{keys.length}</span>
          </h2>
        </div>
        {keys.length === 0 ? (
          <p className="db-empty">No personal API keys.</p>
        ) : (
          <ul className="admin-sessions admin-keys">
            {keys.map((k) => (
              <li key={k.id}>
                <span>
                  <strong>{k.name}</strong>
                  <small className="muted">
                    <code>{k.prefix}…</code> · created {when(k.created_at)} ·{" "}
                    {k.last_used_at
                      ? `last used ${when(k.last_used_at)}`
                      : "never used"}
                  </small>
                </span>
                <button
                  className="text-button danger-text"
                  disabled={busy}
                  onClick={() => void revokeKey(k)}
                >
                  Revoke
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card">
        <div className="section-heading">
          <h2>History</h2>
        </div>
        {d.audit.length === 0 ? (
          <p className="db-empty">Nothing recorded about this account yet.</p>
        ) : (
          <ul className="admin-sessions">
            {d.audit.map((a) => (
              <li key={a.id}>
                <span>
                  <strong>{historyLabel(a.action)}</strong>
                  <small className="muted">
                    {a.actor_email ?? "System"} · {when(a.created_at)}
                  </small>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
