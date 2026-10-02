import { SettingsSection } from "./SettingsSection";
import { useEffect, useState } from "react";
import { LogOut, Monitor } from "lucide-react";
import type { Session } from "@orbyn/core";
import { client } from "../../lib/api";
import { OutcomeNote, useAction } from "../../components/Outcome";

/** A friendly device name from a User-Agent string. */
function deviceName(ua: string): string {
  if (!ua) return "Unknown device";
  const os = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua)
      ? "iPad"
      : /Android/.test(ua)
        ? "Android"
        : /Mac OS X|Macintosh/.test(ua)
          ? "Mac"
          : /Windows/.test(ua)
            ? "Windows"
            : /Linux/.test(ua)
              ? "Linux"
              : "";
  const app = /Orbyn/.test(ua)
    ? "Orbyn app"
    : /Edg\//.test(ua)
      ? "Edge"
      : /Chrome\//.test(ua)
        ? "Chrome"
        : /Firefox\//.test(ua)
          ? "Firefox"
          : /Safari\//.test(ua)
            ? "Safari"
            : "";
  return [app, os].filter(Boolean).join(" · ") || ua.slice(0, 40);
}

const ago = (iso: string) => {
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h} h ago`;
  return new Date(iso).toLocaleDateString();
};

/** Where the account is signed in, with per-device and bulk sign-out. */
export function SessionsSettings({ report }: { report: (e: unknown) => void }) {
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const action = useAction(report);

  const load = () =>
    client.listSessions().then(setSessions, (e) => {
      setSessions([]);
      report(e);
    });
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const revoke = (s: Session) =>
    void action.run(async () => {
      await client.revokeSession(s.id);
      await load();
      return "Signed that device out.";
    });
  const revokeOthers = () =>
    void action.run(async () => {
      const { signed_out } = await client.revokeOtherSessions();
      await load();
      return signed_out
        ? `Signed out ${signed_out} other device${signed_out === 1 ? "" : "s"}.`
        : "No other devices were signed in.";
    });

  const others = (sessions ?? []).filter((s) => !s.current).length;

  return (
    <SettingsSection className="card settings-card">
      <h2>Signed-in devices</h2>
      {sessions === null ? (
        <p className="muted">Loading…</p>
      ) : (
        <ul className="settings-list">
          {sessions.map((s) => (
            <li key={s.id}>
              <Monitor size={16} aria-hidden="true" />
              <span className="settings-list-main">
                <strong>
                  {deviceName(s.user_agent)}
                  {s.current && <small className="muted"> · this device</small>}
                </strong>
                <small>Last active {ago(s.last_seen_at)}</small>
              </span>
              {!s.current && (
                <button
                  className="link-button"
                  disabled={action.pending}
                  onClick={() => revoke(s)}
                >
                  Sign out
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {others > 0 && (
        <button
          className="secondary"
          disabled={action.pending}
          onClick={revokeOthers}
        >
          <LogOut size={14} /> Sign out everywhere else
        </button>
      )}
      <OutcomeNote outcome={action.outcome} />
    </SettingsSection>
  );
}
