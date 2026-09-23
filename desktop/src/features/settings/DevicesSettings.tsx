import { useCallback, useEffect, useState } from "react";
import { Laptop, Monitor, Smartphone } from "lucide-react";
import {
  syncLabel,
  type DevicePresence,
  type PresenceSettings,
} from "@orbyn/core";
import { client } from "../../lib/api";
import { deviceId } from "../../lib/device";
import { onLive } from "../../lib/live";
import { OutcomeNote, useAction } from "../../components/Outcome";

const ago = (iso: string) => {
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h} h ago`;
  return new Date(iso).toLocaleDateString();
};

/** Offline devices shown before "Show all". */
const SHOWN_DEVICES = 4;

const ICONS = {
  ios: Smartphone,
  android: Smartphone,
  desktop: Laptop,
  web: Monitor,
} as const;

/**
 * Your devices as Orbyn sees them: which are online, and whether each is up
 * to date or still holding changes made offline. And whether your teams may
 * see when you're active — off until you turn it on.
 */
export function DevicesSettings({ report }: { report: (e: unknown) => void }) {
  const [devices, setDevices] = useState<DevicePresence[] | null>(null);
  const [settings, setSettings] = useState<PresenceSettings | null>(null);
  const [showAll, setShowAll] = useState(false);
  const action = useAction(report);

  const load = useCallback(() => {
    client.listDevices().then(setDevices, () => setDevices([]));
  }, []);
  useEffect(() => {
    load();
    client.presenceSettings().then(setSettings, report);
    const stop = onLive((news) => news.kind === "presence" && load());
    // "Online" fades with time as well as with news.
    const id = setInterval(load, 60_000);
    return () => {
      stop();
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  const share = (on: boolean) =>
    void action.run(async () => {
      setSettings(await client.updatePresenceSettings({ share_presence: on }));
      return on
        ? "Your teams can see when you're active."
        : "Your teams no longer see when you're active.";
    });

  const forget = (d: DevicePresence) =>
    void action.run(async () => {
      await client.forgetDevice(d.device_id);
      load();
      return "Forgotten. It shows again if it's used.";
    });

  const self = deviceId();
  // Every browser that ever signed in is a device; past a few, the old
  // offline ones wait behind "Show all".
  const recent = (devices ?? []).filter(
    (d, n) => d.online || d.active || d.device_id === self || n < SHOWN_DEVICES,
  );
  const shown = showAll ? (devices ?? []) : recent;
  const hidden = (devices?.length ?? 0) - recent.length;
  return (
    <>
      <hr />
      <h2>Your devices</h2>
      <p className="muted">
        Where Orbyn is open, and whether each device is in sync.
      </p>
      {devices === null ? (
        <p className="muted">Loading…</p>
      ) : devices.length === 0 ? (
        <p className="muted">No devices yet.</p>
      ) : (
        <ul className="settings-list devices-list">
          {shown.map((d) => {
            const Icon = ICONS[d.platform] ?? Monitor;
            const behind = d.failed_changes > 0;
            return (
              <li key={d.device_id}>
                <span
                  className={
                    "device-dot" +
                    (d.active ? " is-active" : d.online ? " is-online" : "")
                  }
                  aria-hidden="true"
                />
                <Icon size={16} aria-hidden="true" />
                <span className="settings-list-main">
                  <strong>
                    {d.label ?? d.platform}
                    {d.device_id === self && (
                      <small className="muted"> · this device</small>
                    )}
                  </strong>
                  <small>
                    {d.active
                      ? "Active now"
                      : d.online
                        ? "Online"
                        : `Seen ${ago(d.seen_at)}`}
                    {" · "}
                    <span className={behind ? "device-behind" : undefined}>
                      {syncLabel(d)}
                    </span>
                  </small>
                </span>
                {d.device_id !== self && !d.online && (
                  <button
                    className="link-button"
                    disabled={action.pending}
                    onClick={() => forget(d)}
                  >
                    Forget
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {hidden > 0 && (
        <button
          type="button"
          className="text-button devices-more"
          onClick={() => setShowAll(!showAll)}
        >
          {showAll
            ? "Show fewer devices"
            : `Show ${hidden} older ${hidden === 1 ? "device" : "devices"}`}
        </button>
      )}
      {settings && (
        <label className="switch-line settings-field devices-share">
          <input
            type="checkbox"
            role="switch"
            className="ai-switch"
            checked={settings.share_presence}
            disabled={action.pending}
            onChange={(e) => share(e.target.checked)}
          />
          <span>
            Let my teams see when I&apos;m active
            <small>
              They see “active” or “away” — never when you were last on, or what
              you&apos;re working on. Anyone on a shared page you have open sees
              you there either way.
            </small>
          </span>
        </label>
      )}
      <OutcomeNote outcome={action.outcome} />
    </>
  );
}
