import { HttpError, syncLabel } from "@orbyn/core";
import { useEffect, useRef, useState } from "react";
import { client } from "../../../lib/session";
import { messageOf } from "../../../lib/resource";
import { Button, ErrorNotice, useConfirm } from "../../../ui/kit";
import {
  SettingsSection,
  useSettingsExit,
  useSettingsOwner,
  useSettingsRead,
} from "../shared";
import { onForeground, onLive } from "../../agents-shared/hooks";
const self = () => {
  try {
    return localStorage.getItem("orbyn-device-id");
  } catch {
    return null;
  }
};
export function Devices() {
  const owner = useSettingsOwner(),
    confirm = useConfirm(),
    read = useSettingsRead(() => client.listDevices()),
    sharing = useSettingsRead(() => client.presenceSettings());
  const lock = useRef(false),
    [busy, setBusy] = useState(false),
    [all, setAll] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [unknown, setUnknown] = useState<
      { kind: "forget"; id: string } | { kind: "share"; value: boolean } | null
    >(null);
  useSettingsExit({
    pending: busy || !!unknown,
    dirty: !!unknown,
    message: "Check the saved device change before leaving.",
  });
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      if (!owner() || document.hidden || lock.current || timer) return;
      timer = setTimeout(() => {
        timer = undefined;
        if (owner() && !lock.current) void read.reload();
      }, 250);
    };
    const live = onLive((news) => {
      if (news.kind === "presence") refresh();
    });
    const foreground = onForeground(refresh);
    const poll = setInterval(refresh, 60000);
    return () => {
      clearTimeout(timer);
      clearInterval(poll);
      live();
      foreground();
    };
  }, [owner, read.reload]);
  const change = async (pending: NonNullable<typeof unknown>) => {
    if (!owner() || lock.current || unknown) return;
    if (pending.kind === "share" ? !sharing.fresh : !read.fresh) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      if (pending.kind === "forget") {
        const row = read.data?.find((one) => one.device_id === pending.id);
        if (!row || row.online || row.device_id === self()) return;
        if (
          !(await confirm({
            title: "Forget this offline device?",
            body: "This removes its presence record, not its signed-in session. It appears again when used.",
            action: "Forget device",
            danger: true,
          }))
        )
          return;
        if (!owner()) return;
        const latest = await client.listDevices();
        if (!owner()) return;
        read.commit(latest);
        const target = latest.find((one) => one.device_id === pending.id);
        if (!target || target.online || target.device_id === self()) {
          setError(
            "This device is no longer eligible to forget. Review the refreshed list.",
          );
          return;
        }
        read.invalidate();
        await client.forgetDevice(pending.id);
        if (!owner()) return;
        await read.reload();
        if (owner()) setNotice("Device forgotten. It appears again if used.");
      } else {
        sharing.invalidate();
        const receipt = await client.updatePresenceSettings({
          share_presence: pending.value,
        });
        if (!owner()) return;
        if (receipt.share_presence !== pending.value)
          throw Error("The saved sharing setting doesn't match your choice.");
        sharing.commit(receipt);
        setNotice(
          pending.value
            ? "Your teams can see active or away."
            : "Activity sharing with teams is off.",
        );
      }
    } catch (failure) {
      if (owner()) {
        if (
          !(failure instanceof HttpError) ||
          failure.statusCode >= 500 ||
          [408, 429].includes(failure.statusCode)
        )
          setUnknown(pending);
        setError(messageOf(failure, "Couldn't confirm this device setting."));
      }
    } finally {
      lock.current = false;
      if (owner()) setBusy(false);
    }
  };
  const check = async () => {
    if (!owner() || lock.current || !unknown) return;
    const pending = unknown;
    lock.current = true;
    setBusy(true);
    try {
      let match = false;
      if (pending.kind === "share") {
        const next = await client.presenceSettings();
        if (!owner()) return;
        sharing.commit(next);
        match = next.share_presence === pending.value;
      } else {
        const rows = await client.listDevices();
        if (!owner()) return;
        read.commit(rows);
        match = !rows.some((row) => row.device_id === pending.id);
      }
      if (match) {
        setUnknown(null);
        setError("");
        setNotice("The saved device state confirms your change.");
      } else
        setError(
          "The saved state doesn't confirm the earlier request. It has not been resent.",
        );
    } catch (failure) {
      if (owner())
        setError(messageOf(failure, "Couldn't check the saved device state."));
    } finally {
      lock.current = false;
      if (owner()) setBusy(false);
    }
  };
  const recent =
      read.data?.filter(
        (d, index) =>
          d.online || d.active || d.device_id === self() || index < 4,
      ) ?? [],
    shown = all ? (read.data ?? []) : recent,
    hidden = (read.data?.length ?? 0) - recent.length;
  return (
    <SettingsSection
      title="Your devices"
      description="Online status and changes waiting to sync."
    >
      {read.error && (
        <ErrorNotice message={read.error} onRetry={() => void read.reload()} />
      )}
      {error && <ErrorNotice message={error} />}
      {notice && <p role="status">{notice}</p>}
      {!read.data && read.loading && <p role="status">Loading devices…</p>}
      {read.data?.length === 0 && <p>No registered devices yet.</p>}
      <ul className="settings-account-list">
        {shown.map((row) => (
          <li key={row.device_id}>
            <div>
              <strong dir="auto">
                {row.label || row.platform}
                {row.device_id === self() ? " · this device" : ""}
              </strong>
              <p className="small muted">
                {row.active
                  ? "Active now"
                  : row.online
                    ? "Online"
                    : `Seen ${new Date(row.seen_at).toLocaleString()}`}{" "}
                · {syncLabel(row)}
              </p>
              {row.synced_at && (
                <p className="small muted">
                  Last synced {new Date(row.synced_at).toLocaleString()}
                </p>
              )}
            </div>
            {!row.online && row.device_id !== self() && (
              <Button
                variant="ghost"
                disabled={busy || !read.fresh || !!unknown}
                onClick={() =>
                  void change({ kind: "forget", id: row.device_id })
                }
              >
                Forget device
              </Button>
            )}
          </li>
        ))}
      </ul>
      {hidden > 0 && (
        <Button variant="ghost" onClick={() => setAll((v) => !v)}>
          {all ? "Show fewer devices" : `Show ${hidden} older devices`}
        </Button>
      )}
      <Button
        variant="ghost"
        disabled={busy}
        onClick={() => void read.reload()}
      >
        Refresh devices
      </Button>
      {sharing.error && (
        <ErrorNotice
          message={sharing.error}
          onRetry={() => void sharing.reload()}
        />
      )}
      {sharing.data && (
        <label className="check">
          <input
            type="checkbox"
            checked={sharing.data.share_presence}
            disabled={busy || !sharing.fresh || !!unknown}
            onChange={(event) =>
              void change({ kind: "share", value: event.target.checked })
            }
          />
          Share activity with teams
        </label>
      )}
      <p className="small muted">
        Teams see active or away, never your work or last visit. People viewing
        the same shared page still see you there.
      </p>
      {unknown && (
        <Button disabled={busy} onClick={() => void check()}>
          Check saved device setting
        </Button>
      )}
    </SettingsSection>
  );
}
