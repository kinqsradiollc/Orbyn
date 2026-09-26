/**
 * Choices that follow the account (NAV-08, NAV-09, SHR-08), and the one that
 * stays on each device (NAV-12).
 *
 * - The sidebar's "Arrange" list: the order of its destinations and which
 *   are hidden. One list, the same on every computer.
 * - Changed shortcuts: a command's own keys, or none. The shortcut sheet and
 *   ⌘K show the keys as changed, and a key can do only one thing.
 * - View choices: how a task list is laid out, grouped and sorted, and the
 *   calendar set shown. They follow the account; theme and text size stay
 *   on each device.
 * - What opens at start: Overview, today's agenda, My tasks or the last
 *   page, chosen on each device (a phone and a desk are used differently).
 */
import { z } from "zod";
import type { CommandDef } from "./commands.js";

// ------------------------------------------------------------ sidebar ---

/** How the sidebar is arranged: its destinations' order, and those hidden. */
export type SidebarArrangement = {
  /** Destinations in the order chosen; any left out keep their place after. */
  order: string[];
  /** Destinations not shown. Settings and Overview can't be hidden. */
  hidden: string[];
};

/** Destinations that always show: there must be a way home and to Settings. */
export const ALWAYS_SHOWN = ["Overview", "Settings"] as const;

export const sidebarArrangement = z
  .object({
    order: z.array(z.string().trim().min(1).max(40)).max(40).default([]),
    hidden: z.array(z.string().trim().min(1).max(40)).max(40).default([]),
  })
  .strict();

/**
 * Arrange a group of destinations: in the chosen order (the rest after, as
 * they were), leaving out the hidden ones unless `showHidden`.
 */
export function arrangeEntries<T>(
  entries: T[],
  labelOf: (entry: T) => string,
  arrangement: Partial<SidebarArrangement> | null | undefined,
  showHidden = false,
): T[] {
  const order = arrangement?.order ?? [];
  const hidden = new Set(
    (arrangement?.hidden ?? []).filter(
      (h) => !(ALWAYS_SHOWN as readonly string[]).includes(h),
    ),
  );
  // The arranged ones take the arranged ones' places, in the chosen order;
  // anything the list doesn't name (one only the phone has, or a new one)
  // stays where it was.
  const ranked = entries
    .filter((e) => order.includes(labelOf(e)))
    .sort((a, b) => order.indexOf(labelOf(a)) - order.indexOf(labelOf(b)));
  let next = 0;
  return entries
    .map((e) => (order.includes(labelOf(e)) ? ranked[next++] : e))
    .filter((e) => showHidden || !hidden.has(labelOf(e)));
}

/** Move one destination up or down within its group's arranged order. */
export function moveEntry(
  labels: string[],
  label: string,
  by: -1 | 1,
): string[] {
  const i = labels.indexOf(label);
  const j = i + by;
  if (i === -1 || j < 0 || j >= labels.length) return labels;
  const next = [...labels];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

/** Drop `label` before `before` (or at the end), for dragging in Arrange. */
export function dropEntry(
  labels: string[],
  label: string,
  before: string | null,
): string[] {
  const rest = labels.filter((l) => l !== label);
  const at = before === null ? rest.length : rest.indexOf(before);
  if (at === -1) return labels;
  return [...rest.slice(0, at), label, ...rest.slice(at)];
}

/** Show or hide one destination. Overview and Settings always show. */
export function toggleSidebarHidden(
  arrangement: SidebarArrangement,
  label: string,
): SidebarArrangement {
  if ((ALWAYS_SHOWN as readonly string[]).includes(label)) return arrangement;
  const hidden = arrangement.hidden.includes(label)
    ? arrangement.hidden.filter((h) => h !== label)
    : [...arrangement.hidden, label];
  return { ...arrangement, hidden };
}

// ---------------------------------------------------------- shortcuts ---

/** One key, as the command list writes keys: "mod", "shift", "alt", or a key. */
const KEY = z
  .string()
  .min(1)
  .max(12)
  .regex(
    /^(?:mod|shift|alt|[!-~]|F\d{1,2}|Enter|Space|Arrow(?:Up|Down|Left|Right))$/,
  );

export const shortcutKeys = z.array(KEY).max(4);

/** Changed shortcuts by command id; an empty list takes a command's key away. */
export const shortcutOverrides = z.record(
  z
    .string()
    .regex(/^[a-z]+[.a-z0-9-]*$/)
    .max(60),
  shortcutKeys,
);
export type ShortcutOverrides = z.infer<typeof shortcutOverrides>;

/** A command's keys, as changed or as they come. */
export const effectiveKeys = (
  command: Pick<CommandDef, "id" | "keys">,
  overrides: ShortcutOverrides | null | undefined,
): string[] =>
  overrides && Object.prototype.hasOwnProperty.call(overrides, command.id)
    ? overrides[command.id]
    : (command.keys ?? []);

/** The same keys, whatever order they were written in. */
export const keysId = (keys: string[]): string => {
  const mods = ["mod", "alt", "shift"].filter((m) => keys.includes(m));
  const key = keys.filter((k) => !["mod", "alt", "shift"].includes(k));
  return [...mods, ...key.map((k) => k.toLowerCase())].join("+");
};

/**
 * Keys from a key press, for recording a new shortcut: the modifiers held
 * and the key. Null for a modifier on its own, or a key that can't be one
 * (Tab and Escape stay for moving around and closing).
 */
export function keysFromPress(e: {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}): string[] | null {
  if (["Meta", "Control", "Alt", "Shift", "Tab", "Escape"].includes(e.key))
    return null;
  let key = e.key === " " ? "Space" : e.key;
  if (key.length === 1) key = key.toUpperCase();
  if (!KEY.safeParse(key).success) return null;
  const keys: string[] = [];
  if (e.metaKey || e.ctrlKey) keys.push("mod");
  if (e.altKey) keys.push("alt");
  // Shift is kept for letters and named keys; for a symbol it's already in
  // the character typed ("?" is Shift+/).
  if (e.shiftKey && (/^[A-Z]$/.test(key) || key.length > 1)) keys.push("shift");
  keys.push(key);
  // A bare letter works only outside fields; that's fine, but a bare named
  // key such as Enter or an arrow would get in the way everywhere.
  if (keys.length === 1 && key.length > 1 && !/^F\d/.test(key)) return null;
  return keys;
}

/**
 * Which command already has these keys, if another one does: a key can do
 * only one thing, so the Shortcuts list says which it would take them from.
 */
export function shortcutClash(
  commands: Pick<CommandDef, "id" | "keys" | "label">[],
  overrides: ShortcutOverrides | null | undefined,
  id: string,
  keys: string[],
): Pick<CommandDef, "id" | "label"> | null {
  if (!keys.length) return null;
  const want = keysId(keys);
  return (
    commands.find(
      (c) => c.id !== id && keysId(effectiveKeys(c, overrides)) === want,
    ) ?? null
  );
}

/** Set a command's keys, taking them from any command that had them. */
export function setShortcut(
  commands: Pick<CommandDef, "id" | "keys" | "label">[],
  overrides: ShortcutOverrides,
  id: string,
  keys: string[] | null,
): ShortcutOverrides {
  const next = { ...overrides };
  const command = commands.find((c) => c.id === id);
  if (!command) return next;
  if (keys === null) {
    // Back to its own keys (and anything they were taken from gets its own back).
    delete next[id];
    return next;
  }
  const clash = shortcutClash(commands, next, id, keys);
  if (clash) next[clash.id] = [];
  const own = command.keys ?? [];
  if (own.length === keys.length && keysId(own) === keysId(keys))
    delete next[id];
  else next[id] = keys;
  return next;
}

/** Whether a key press is these keys (Shift left to the character for symbols). */
export function pressMatches(
  keys: string[],
  e: {
    key: string;
    metaKey: boolean;
    ctrlKey: boolean;
    altKey?: boolean;
    shiftKey?: boolean;
  },
): boolean {
  if (!keys.length) return false;
  const wantsMod = keys.includes("mod");
  const wantsShift = keys.includes("shift");
  const wantsAlt = keys.includes("alt");
  const key = keys[keys.length - 1];
  if (wantsMod !== (e.metaKey || e.ctrlKey)) return false;
  if (wantsAlt !== !!e.altKey) return false;
  if (wantsShift && !e.shiftKey) return false;
  // A letter with Shift is its own shortcut; symbols carry Shift in them.
  if (!wantsShift && e.shiftKey && (/^[A-Za-z]$/.test(key) || wantsMod))
    return false;
  const pressed = e.key === " " ? "Space" : e.key;
  return pressed.toLowerCase() === key.toLowerCase();
}

// -------------------------------------------------------- view choices ---

/** How one list or screen is shown, as it was left. */
export const viewChoice = z
  .object({
    layout: z.string().max(30).optional(),
    group: z.string().max(60).optional(),
    sort: z.string().max(60).optional(),
    /** Sections kept at the top of a grouped list. */
    pins: z.array(z.string().max(80)).max(40).optional(),
    /** The calendar set shown, by id, or "all". */
    set: z.string().max(60).optional(),
    /** A page's mode on a phone: reading or editing. */
    mode: z.enum(["read", "edit"]).optional(),
  })
  .strict();
export type ViewChoice = z.infer<typeof viewChoice>;

/** View choices by place: "tasks", "calendar", "docs" and so on. */
export const viewChoices = z.record(
  z
    .string()
    .regex(/^[a-z][a-z0-9:_-]*$/)
    .max(80),
  viewChoice,
);
export type ViewChoices = z.infer<typeof viewChoices>;

// ------------------------------------------------------------- the lot ---

/** What GET /me/prefs answers. */
export type AccountPrefs = {
  sidebar: SidebarArrangement;
  shortcuts: ShortcutOverrides;
  views: ViewChoices;
  updated_at: string | null;
};

export const EMPTY_PREFS: AccountPrefs = {
  sidebar: { order: [], hidden: [] },
  shortcuts: {},
  views: {},
  updated_at: null,
};

/**
 * PUT /me/prefs: any of the three. The sidebar and shortcuts are replaced
 * whole; view choices are merged by place (null clears one place).
 */
export const accountPrefsInput = z
  .object({
    sidebar: sidebarArrangement.optional(),
    shortcuts: shortcutOverrides.optional(),
    views: z
      .record(
        z
          .string()
          .regex(/^[a-z][a-z0-9:_-]*$/)
          .max(80),
        viewChoice.nullable(),
      )
      .optional(),
  })
  .strict()
  .refine(
    (p) =>
      p.sidebar !== undefined ||
      p.shortcuts !== undefined ||
      p.views !== undefined,
    { message: "Nothing to change." },
  )
  .refine((p) => !p.views || Object.keys(p.views).length <= 60, {
    message: "Too many views at once.",
    path: ["views"],
  });
export type AccountPrefsInput = z.infer<typeof accountPrefsInput>;

/** How many places' view choices an account keeps. */
export const MAX_VIEW_CHOICES = 60;

// ------------------------------------------------------ start (device) ---

/** What opens at start (NAV-12), chosen on each device. */
export const START_SCREENS = [
  "overview",
  "agenda",
  "tasks",
  "last-page",
] as const;
export type StartScreen = (typeof START_SCREENS)[number];

export const START_SCREEN_LABELS: Record<StartScreen, string> = {
  overview: "Overview",
  agenda: "Today's agenda",
  tasks: "My tasks",
  "last-page": "The last page I had open",
};

/** A stored choice, or Overview for anything else. */
export const readStartScreen = (raw: string | null | undefined): StartScreen =>
  (START_SCREENS as readonly string[]).includes(raw ?? "")
    ? (raw as StartScreen)
    : "overview";
