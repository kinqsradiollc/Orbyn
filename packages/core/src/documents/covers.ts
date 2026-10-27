import { z } from "zod";

/**
 * Covers and icons (W6): a project, a page or a Home hub can show a cover
 * picture (one of the pictures kept in Orbyn's own file store, as pages
 * hold them) and an icon — an emoji, or one of the app's own icons by
 * name, stored as "icon:<name>". Both are optional; null clears one.
 */

/** The app's own icons a project, page or hub can wear, by name. */
export const LOOK_ICON_NAMES = [
  "fileText",
  "boxes",
  "sun",
  "calendar",
  "graduationCap",
  "sparkles",
  "star",
  "folder",
  "coffee",
  "target",
  "flag",
  "lightbulb",
  "bell",
  "users",
  "clock",
  "mapPin",
  "video",
  "image",
  "mic",
  "hash",
  "inbox",
  "archive",
  "presentation",
  "network",
  "clipboardList",
  "tag",
  "link",
  "key",
  "listTodo",
  "newspaper",
] as const;
export type LookIconName = (typeof LOOK_ICON_NAMES)[number];

/** Plain words for each icon, for pickers and screen readers. */
export const LOOK_ICON_LABELS: Record<LookIconName, string> = {
  fileText: "Page",
  boxes: "Boxes",
  sun: "Sun",
  calendar: "Calendar",
  graduationCap: "Graduation cap",
  sparkles: "Sparkles",
  star: "Star",
  folder: "Folder",
  coffee: "Coffee",
  target: "Target",
  flag: "Flag",
  lightbulb: "Light bulb",
  bell: "Bell",
  users: "People",
  clock: "Clock",
  mapPin: "Map pin",
  video: "Video",
  image: "Picture",
  mic: "Microphone",
  hash: "Hash",
  inbox: "Inbox",
  archive: "Archive",
  presentation: "Presentation",
  network: "Network",
  clipboardList: "Clipboard",
  tag: "Tag",
  link: "Link",
  key: "Key",
  listTodo: "Checklist",
  newspaper: "Newspaper",
};

/** A few emoji offered first; any other emoji can be typed. */
export const LOOK_EMOJI = [
  "📚",
  "🎯",
  "🚀",
  "🌱",
  "💡",
  "🧪",
  "🎨",
  "🎵",
  "🏃",
  "✈️",
  "🏠",
  "💼",
  "🧠",
  "📝",
  "⭐",
  "🔥",
] as const;

const PICTOGRAPH = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u;
const WORDY = /[\p{L}\p{N}\s]/u;

/** Whether `text` is an emoji (one, perhaps with modifiers or joiners). */
export const isEmoji = (text: string) =>
  text.length > 0 &&
  text.length <= 16 &&
  PICTOGRAPH.test(text) &&
  // Keycaps (1️⃣) carry a digit; anything else wordy isn't an emoji.
  !WORDY.test(text.replace(/[0-9#*]\uFE0F?\u20E3/gu, ""));

/** What an icon value draws: an emoji, or one of the app's icons. */
export type LookIcon =
  { kind: "emoji"; text: string } | { kind: "icon"; name: LookIconName };

/** Read a stored icon; null for none or anything not understood. */
export function parseLookIcon(
  value: string | null | undefined,
): LookIcon | null {
  if (!value) return null;
  if (value.startsWith("icon:")) {
    const name = value.slice(5);
    return (LOOK_ICON_NAMES as readonly string[]).includes(name)
      ? { kind: "icon", name: name as LookIconName }
      : null;
  }
  return isEmoji(value) ? { kind: "emoji", text: value } : null;
}

/** An icon as stored: an emoji, or "icon:<name>" for one of the app's. */
export const lookIconInput = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .refine((v) => parseLookIcon(v) !== null, {
    message: `An icon is one emoji, or icon:<name> with one of: ${LOOK_ICON_NAMES.join(", ")}.`,
  });

/** A cover and icon change: either or both; null clears one. */
export const lookInput = z
  .object({
    cover_file_id: z.uuid().nullable().optional(),
    icon: lookIconInput.nullable().optional(),
  })
  .strict()
  .refine((l) => l.cover_file_id !== undefined || l.icon !== undefined, {
    message: "Give a cover, an icon, or both.",
  });
export type LookInput = z.infer<typeof lookInput>;

/** A project's or page's cover and icon, as read. */
export type Look = { cover_file_id: string | null; icon: string | null };

/** A picture you can use as a cover (GET /me/pictures). */
export type CoverPicture = {
  id: string;
  name: string;
  doc_id: string | null;
  doc_title: string | null;
  width: number | null;
  height: number | null;
  created_at: string;
};
