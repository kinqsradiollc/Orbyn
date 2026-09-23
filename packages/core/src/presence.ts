import { z } from "zod";

/**
 * Presence: which of your devices are online and in sync, who on a shared
 * page has it open, and — only for people who turn it on — which teammates
 * are active now. Teammates never see a last-seen time, or what you are on
 * outside a page you both have open.
 */
export const PLATFORMS = ["web", "desktop", "ios", "android"] as const;
export type Platform = (typeof PLATFORMS)[number];

/** A device checking in, about once a minute while the app is open. */
export const presenceHeartbeat = z
  .object({
    /** Made once on the device and kept. */
    device_id: z.string().trim().min(8).max(64),
    platform: z.enum(PLATFORMS),
    /** "MacBook", "iPhone": what the person would call it. */
    label: z.string().trim().max(60).optional(),
    /** The app is in front and being used. */
    active: z.boolean().default(true),
    /** The page open on it, if any. */
    doc_id: z.uuid().nullable().default(null),
    /** Changes made offline and not sent yet. */
    pending_changes: z.number().int().min(0).max(100_000).default(0),
    /** Changes the server refused, waiting for the person to decide. */
    failed_changes: z.number().int().min(0).max(100_000).default(0),
    /** When it last caught up with the server. */
    synced_at: z.iso.datetime({ offset: true }).nullable().optional(),
  })
  .strict();
export type PresenceHeartbeat = z.input<typeof presenceHeartbeat>;

export const presenceSettingsInput = z
  .object({ share_presence: z.boolean() })
  .strict();

/** One of your own devices. */
export type DevicePresence = {
  device_id: string;
  platform: Platform;
  label: string | null;
  /** Checked in within the last few minutes. */
  online: boolean;
  /** Online, in front and being used. */
  active: boolean;
  pending_changes: number;
  failed_changes: number;
  synced_at: string | null;
  seen_at: string;
};

/**
 * A teammate, as the team sees them. "hidden" when they haven't chosen to
 * share it; there is never a time.
 */
export type MemberPresence = {
  user_id: string;
  status: "active" | "away" | "offline" | "hidden";
};

/** Someone with a page open now. */
export type DocViewer = { user_id: string; name: string };

export type PresenceSettings = { share_presence: boolean };

/** Minutes after its last check-in a device still counts as online. */
export const ONLINE_MINUTES = 3;
/** And as away, rather than offline. */
export const AWAY_MINUTES = 15;

/** "Up to date", "2 changes waiting", "1 change needs you". */
export function syncLabel(
  d: Pick<DevicePresence, "pending_changes" | "failed_changes" | "online">,
) {
  if (d.failed_changes)
    return `${d.failed_changes} ${d.failed_changes === 1 ? "change needs" : "changes need"} you`;
  if (d.pending_changes)
    return `${d.pending_changes} ${d.pending_changes === 1 ? "change" : "changes"} waiting`;
  return d.online ? "Up to date" : "Offline";
}

/** "Anna", "Anna and Jonah", "Anna, Jonah and 2 others". */
export function viewersLabel(names: string[]) {
  if (names.length === 0) return "";
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  const rest = names.length - 2;
  return `${names[0]}, ${names[1]} and ${rest} ${rest === 1 ? "other" : "others"}`;
}
