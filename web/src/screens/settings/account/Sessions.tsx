import { HttpError } from "@orbyn/core";
import { useRef, useState } from "react";
import { client } from "../../../lib/session";
import { messageOf } from "../../../lib/resource";
import { Button, ErrorNotice, useConfirm } from "../../../ui/kit";
import {
  SettingsSection,
  useSettingsExit,
  useSettingsOwner,
  useSettingsRead,
} from "../shared";
const device = (ua: string) =>
  [
    /Orbyn/.test(ua)
      ? "Orbyn"
      : /Edg\//.test(ua)
        ? "Edge"
        : /Chrome\//.test(ua)
          ? "Chrome"
          : /Firefox\//.test(ua)
            ? "Firefox"
            : /Safari\//.test(ua)
              ? "Safari"
              : "Browser",
    /iPhone/.test(ua)
      ? "iPhone"
      : /iPad/.test(ua)
        ? "iPad"
        : /Android/.test(ua)
          ? "Android"
          : /Windows/.test(ua)
            ? "Windows"
            : /Mac/.test(ua)
              ? "Mac"
              : /Linux/.test(ua)
                ? "Linux"
                : "Unknown device",
  ].join(" · ");
export function Sessions() {
  const owner = useSettingsOwner(),
    confirm = useConfirm(),
    read = useSettingsRead(() => client.listSessions());
  const lock = useRef(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [unknown, setUnknown] = useState<string | null>(null);
  useSettingsExit({
    pending: busy || !!unknown,
    dirty: !!unknown,
    message: "Check the saved sign-out request before leaving.",
  });
  const revoke = async (id?: string) => {
    if (!owner() || lock.current || !read.fresh || unknown) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      if (id && !read.data?.some((row) => row.id === id && !row.current))
        return;
      if (
        !(await confirm({
          title: id ? "Sign out this device?" : "Sign out everywhere else?",
          body: "This browser stays signed in. Other selected sessions will end.",
          action: "Sign out",
          danger: true,
        }))
      )
        return;
      if (!owner()) return;
      read.invalidate();
      const receipt = id
        ? await client.revokeSession(id)
        : await client.revokeOtherSessions();
      if (!owner()) return;
      setNotice(
        id
          ? "That session was signed out."
          : receipt && "signed_out" in receipt
            ? `${receipt.signed_out} other sessions signed out.`
            : "Other sessions signed out.",
      );
      await read.reload();
    } catch (failure) {
      if (owner()) {
        if (
          !(failure instanceof HttpError) ||
          failure.statusCode >= 500 ||
          [408, 429].includes(failure.statusCode)
        )
          setUnknown(id ?? "others");
        setError(
          messageOf(
            failure,
            "Couldn't confirm sign-out. Check the saved sessions.",
          ),
        );
      }
    } finally {
      lock.current = false;
      if (owner()) setBusy(false);
    }
  };
  const check = async () => {
    if (!owner() || lock.current || !unknown) return;
    const target = unknown;
    lock.current = true;
    setBusy(true);
    try {
      const rows = await client.listSessions();
      if (!owner()) return;
      read.commit(rows);
      if (
        target === "others"
          ? !rows.some((row) => !row.current)
          : !rows.some((row) => row.id === target)
      ) {
        setUnknown(null);
        setError("");
        setNotice("The saved sessions confirm the requested sign-out.");
      } else
        setError(
          "The current list doesn't confirm that sign-out. The request has not been resent.",
        );
    } catch (failure) {
      if (owner())
        setError(messageOf(failure, "Couldn't check the saved sessions."));
    } finally {
      lock.current = false;
      if (owner()) setBusy(false);
    }
  };
  return (
    <SettingsSection title="Signed-in devices">
      <p className="muted">
        These are sign-in sessions, separate from device presence.
      </p>
      {read.error && (
        <ErrorNotice message={read.error} onRetry={() => void read.reload()} />
      )}
      {error && <ErrorNotice message={error} />}
      {notice && <p role="status">{notice}</p>}
      {!read.data && read.loading && <p role="status">Loading sessions…</p>}
      {read.data?.length === 0 && <p>No signed-in sessions were returned.</p>}
      <ul className="settings-account-list">
        {read.data?.map((row) => (
          <li key={row.id}>
            <div>
              <strong>
                {device(row.user_agent)}
                {row.current ? " · this session" : ""}
              </strong>
              <p className="small muted">
                Last active {new Date(row.last_seen_at).toLocaleString()}
              </p>
              <details>
                <summary>Session detail</summary>
                <p className="small" dir="auto">
                  {row.user_agent || "No device details"}
                </p>
                <p className="small">
                  Signed in {new Date(row.created_at).toLocaleString()}
                </p>
              </details>
            </div>
            {!row.current && (
              <Button
                variant="ghost"
                disabled={busy || !read.fresh || !!unknown}
                onClick={() => void revoke(row.id)}
              >
                Sign out device
              </Button>
            )}
          </li>
        ))}
      </ul>
      <div className="settings-account-actions">
        <Button
          variant="ghost"
          disabled={busy}
          onClick={() => void read.reload()}
        >
          Refresh sessions
        </Button>
        {read.data?.some((row) => !row.current) && (
          <Button
            disabled={busy || !read.fresh || !!unknown}
            onClick={() => void revoke()}
          >
            Sign out everywhere else
          </Button>
        )}
        {unknown && (
          <Button disabled={busy} onClick={() => void check()}>
            Check saved sessions
          </Button>
        )}
      </div>
    </SettingsSection>
  );
}
