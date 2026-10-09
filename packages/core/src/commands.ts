/**
 * One list of everything Orbyn can do (NAV-01). The web's ⌘K, its shortcut
 * sheet and sidebar hints, and the phone's "Search & do" (MOB-10) all read
 * it, so a command and its shortcut are written down once.
 *
 * This file is only the list and its ordering (recent commands first, pinned
 * ones on top); what each command does is wired by each app, which has the
 * handlers. A command an app has no handler for is simply not shown there.
 */

import type { ScreenName } from "./presentation.js";
import {
  effectiveKeys,
  pressMatches,
  type ShortcutOverrides,
} from "./prefs.js";

/** A screen a Go to command opens: the shared screens and the web's own. */
export type CommandView =
  | ScreenName
  | "Lists"
  | "Agenda"
  | "Docs"
  | "Memory"
  | "Agent"
  | "Study"
  | "Projects"
  | "Booking"
  | "Review"
  | "Overnight"
  | "Views";

export type CommandGroup =
  "Go to" | "Create" | "Page" | "Planner" | "Settings" | "Help";

/** Icons by name, drawn by the command bar. */
export type CommandIcon =
  | "view"
  | "plus"
  | "calendarPlus"
  | "filePlus"
  | "template"
  | "boxes"
  | "wand"
  | "focus"
  | "calendar"
  | "keyboard"
  | "panel"
  | "search"
  | "link"
  | "copy"
  | "download"
  | "history"
  | "sparkles"
  | "shield"
  | "eye"
  | "news"
  | "upload"
  | "activity"
  | "settings"
  | "present"
  | "window"
  | "archive"
  | "folder"
  | "star"
  | "mic";

export type CommandDef = {
  id: string;
  label: string;
  group: CommandGroup;
  /** Other words it answers to. */
  keywords: string;
  icon: CommandIcon;
  /** The keys, as the shortcut sheet shows them; "mod" is ⌘ or Ctrl. */
  keys?: string[];
  /** A screen to go to (Go to commands). */
  view?: CommandView;
  /** Shown only with a page open, or only to admins. */
  needs?: "page" | "admin";
  /** Where it makes sense; both when left out. */
  on?: "web" | "phone";
  /** A setting it opens (Settings commands, NAV-10). */
  setting?: string;
};

const go = (
  view: CommandView,
  keywords = "",
  label = `Go to ${view}`,
): CommandDef => ({
  id: `go.${view.toLowerCase().replace(/\s+/g, "-")}`,
  label,
  group: "Go to",
  keywords: `go open screen ${view.toLowerCase()} ${keywords}`,
  icon: "view",
  view,
});

export const COMMANDS: CommandDef[] = [
  // Every screen.
  // Home (W1): keyed "Overview" still, so changed shortcuts keep working.
  go("Overview", "home overview today start dashboard hubs", "Go to Home"),
  go("Agenda", "day page notes today"),
  go("My tasks", "todo list"),
  go("Calendar", "events week month"),
  go("Projects", "stages work"),
  go("Docs", "documents pages notes library", "Go to Documents"),
  go("Memory", "private memory remembered facts sources"),
  go("Agent", "agent notes briefs pages", "Go to Agent notes"),
  go("Views", "saved views filters table board gallery exam week"),
  go("Study", "flashcards cards exams revise"),
  go("Lists", "groups"),
  go("AI assistant", "ask chat ai"),
  go("Teams", "people members"),
  go("Booking", "booking pages meetings"),
  go("Notifications", "inbox notices alerts"),
  go("Review", "proposals approve agents suggestions changes"),
  go("Overnight", "night shift morning keep undo review"),
  { ...go("Admin", "console users"), needs: "admin" },
  go("Settings", "preferences account"),
  // Making things.
  {
    id: "new.task",
    label: "New task",
    group: "Create",
    keywords: "add create item todo",
    icon: "plus",
    keys: ["N"],
  },
  {
    id: "new.event",
    label: "New event",
    group: "Create",
    keywords: "add create meeting calendar",
    icon: "calendarPlus",
  },
  {
    id: "new.page",
    label: "New page",
    group: "Create",
    keywords: "add create doc document note",
    icon: "filePlus",
  },
  {
    id: "new.from-template",
    label: "New page from template",
    group: "Create",
    keywords: "add create doc template lecture meeting",
    icon: "template",
  },
  {
    id: "new.project",
    label: "New project",
    group: "Create",
    keywords: "add create stages",
    icon: "boxes",
  },
  {
    id: "new.import",
    label: "Import pages or tasks",
    group: "Create",
    keywords: "markdown notion todoist ticktick csv zip bring in move",
    icon: "upload",
  },
  // The page that is open.
  {
    id: "page.link",
    label: "Copy link to this page",
    group: "Page",
    keywords: "share url address",
    icon: "link",
    needs: "page",
  },
  {
    id: "page.markdown",
    label: "Copy page as Markdown",
    group: "Page",
    keywords: "copy text export",
    icon: "copy",
    needs: "page",
  },
  {
    id: "page.download-md",
    label: "Download page as Markdown",
    group: "Page",
    keywords: "export save file md",
    icon: "download",
    needs: "page",
  },
  {
    id: "page.download-pdf",
    label: "Download page as PDF",
    group: "Page",
    keywords: "export save file print",
    icon: "download",
    needs: "page",
  },
  {
    id: "page.read",
    label: "Read or edit this page",
    group: "Page",
    keywords: "reading mode view only focus distraction",
    icon: "eye",
    keys: ["mod", "shift", "R"],
    needs: "page",
    on: "web",
  },
  {
    id: "page.history",
    label: "Page history",
    group: "Page",
    keywords: "versions changes restore",
    icon: "history",
    needs: "page",
  },
  {
    id: "page.template",
    label: "Save page as template",
    group: "Page",
    keywords: "template reuse",
    icon: "template",
    needs: "page",
  },
  {
    id: "page.ask",
    label: "Talk about this page",
    group: "Page",
    keywords: "ask assistant ai question",
    icon: "sparkles",
    needs: "page",
  },
  {
    id: "page.present",
    label: "Present this page",
    group: "Page",
    keywords: "slides slideshow presentation full screen standup class",
    icon: "present",
    needs: "page",
  },
  {
    id: "page.window",
    label: "Open this page in a new window",
    group: "Page",
    keywords: "pop out window tab second screen monitor",
    icon: "window",
    needs: "page",
    on: "web",
  },
  {
    id: "page.star",
    label: "Star or unstar this page",
    group: "Page",
    keywords: "favourite favorite bookmark pin starred",
    icon: "star",
    needs: "page",
  },
  {
    id: "page.show-in-library",
    label: "Show this page in the library",
    group: "Page",
    keywords: "reveal folder find locate documents",
    icon: "folder",
    needs: "page",
  },
  {
    id: "page.archive",
    label: "Archive or bring back this page",
    group: "Page",
    keywords: "archive hide old unarchive restore search",
    icon: "archive",
    needs: "page",
  },
  {
    id: "page.record",
    label: "Record audio into this page",
    group: "Page",
    keywords: "record audio voice lecture meeting microphone summary",
    icon: "mic",
    needs: "page",
  },
  // The planner.
  {
    id: "plan.day",
    label: "Plan my day",
    group: "Planner",
    keywords: "planner schedule preview today",
    icon: "wand",
  },
  {
    id: "plan.focus",
    label: "Start focus on what's next",
    group: "Planner",
    keywords: "focus timer pomodoro work",
    icon: "focus",
  },
  {
    id: "plan.today",
    label: "Show today on the calendar",
    group: "Planner",
    keywords: "calendar day today",
    icon: "calendar",
  },
  // Help and the app itself.
  {
    id: "app.search",
    label: "Search, jump or ask",
    group: "Help",
    keywords: "command bar find quick switcher",
    icon: "search",
    keys: ["mod", "K"],
    on: "web",
  },
  {
    id: "app.shortcuts",
    label: "Keyboard shortcuts",
    group: "Help",
    keywords: "keys help",
    icon: "keyboard",
    keys: ["?"],
    on: "web",
  },
  {
    id: "app.sidebar",
    label: "Show or hide the sidebar",
    group: "Help",
    keywords: "rail collapse menu",
    icon: "panel",
    keys: ["mod", "\\"],
    on: "web",
  },
  {
    id: "app.changes",
    label: "Recent changes in your teams",
    group: "Help",
    keywords: "activity feed edits catch up who changed team",
    icon: "activity",
  },
  {
    id: "app.whats-new",
    label: "What's new in Orbyn",
    group: "Help",
    keywords: "changelog release updates news",
    icon: "news",
  },
  {
    id: "app.security",
    label: "Security and data",
    group: "Help",
    keywords: "privacy safety encryption passkeys export",
    icon: "shield",
  },
];

export const commandById = (id: string): CommandDef | undefined =>
  COMMANDS.find((c) => c.id === id) ??
  SETTING_COMMANDS.find((c) => c.id === id);

/** A command's keys for this computer: ⌘ on a Mac, Ctrl elsewhere. */
export function keysFor(
  command: CommandDef | undefined,
  mac: boolean,
  overrides?: ShortcutOverrides | null,
) {
  return (command ? effectiveKeys(command, overrides) : []).map((k) =>
    k === "mod"
      ? mac
        ? "⌘"
        : "Ctrl"
      : k === "shift"
        ? mac
          ? "⇧"
          : "Shift"
        : k === "alt"
          ? mac
            ? "⌥"
            : "Alt"
          : k,
  );
}

/** The keys of the command for a screen, for a sidebar hint. */
export const viewCommand = (view: CommandView) =>
  COMMANDS.find((c) => c.view === view);

// ---------------------------------------------------------- recent and pinned

/** What a person used lately and chose to keep on top, newest first. */
export type CommandMemory = { recent: string[]; pinned: string[] };

export const EMPTY_MEMORY: CommandMemory = { recent: [], pinned: [] };

/** How many recent commands are remembered. */
export const RECENT_COMMANDS = 5;

/** A command was run: it leads the recent list. */
export function recordCommand(
  memory: CommandMemory,
  id: string,
): CommandMemory {
  return {
    ...memory,
    recent: [id, ...memory.recent.filter((r) => r !== id)].slice(
      0,
      RECENT_COMMANDS,
    ),
  };
}

/** Pin a command to the top, or unpin it. */
export function togglePinned(memory: CommandMemory, id: string): CommandMemory {
  return {
    ...memory,
    pinned: memory.pinned.includes(id)
      ? memory.pinned.filter((p) => p !== id)
      : [...memory.pinned, id],
  };
}

/** Read back what was stored, dropping anything that isn't a command now. */
export function readMemory(raw: string | null): CommandMemory {
  try {
    const parsed = JSON.parse(raw ?? "") as Partial<CommandMemory>;
    const known = (ids: unknown) =>
      Array.isArray(ids)
        ? [
            ...new Set(
              ids.filter((id): id is string => !!commandById(String(id))),
            ),
          ]
        : [];
    return {
      recent: known(parsed.recent).slice(0, RECENT_COMMANDS),
      pinned: known(parsed.pinned),
    };
  } catch {
    return EMPTY_MEMORY;
  }
}

/** Whether every word typed is in the command's label or its other words. */
export function commandMatches(command: CommandDef, query: string) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const text = `${command.label} ${command.keywords}`.toLowerCase();
  return words.every((w) => text.includes(w));
}

export type ShownCommand = CommandDef & {
  /** Why it is where it is: pinned, used lately, or its own group. */
  section: "Pinned" | "Recent commands" | CommandGroup;
};

/**
 * The commands to show for what was typed: pinned first, then the ones used
 * lately, then the rest in their groups. `available` says which may show
 * (page commands need a page; Admin needs an admin).
 */
export function orderCommands(
  query: string,
  memory: CommandMemory,
  available: (command: CommandDef) => boolean,
): ShownCommand[] {
  // Settings are many and wanted by name, so they show once words are typed.
  const pool = query.trim() ? [...COMMANDS, ...SETTING_COMMANDS] : COMMANDS;
  const shown = pool.filter(
    (c) => available(c) && (!query.trim() || commandMatches(c, query)),
  );
  const byId = new Map(shown.map((c) => [c.id, c]));
  const out: ShownCommand[] = [];
  const taken = new Set<string>();
  for (const id of memory.pinned) {
    const c = byId.get(id);
    if (c && !taken.has(id)) {
      out.push({ ...c, section: "Pinned" });
      taken.add(id);
    }
  }
  for (const id of memory.recent) {
    const c = byId.get(id);
    if (c && !taken.has(id)) {
      out.push({ ...c, section: "Recent commands" });
      taken.add(id);
    }
  }
  for (const c of shown)
    if (!taken.has(c.id)) out.push({ ...c, section: c.group });
  return out;
}

/** The shortcut sheet's "Anywhere" list: every command that has keys. */
export const commandShortcuts = (
  mac: boolean,
  overrides?: ShortcutOverrides | null,
) =>
  COMMANDS.filter((c) => effectiveKeys(c, overrides).length).map((c) => ({
    keys: keysFor(c, mac, overrides),
    label: c.label,
  }));

// -------------------------------------------------------------- keyboard

/**
 * The commands that have keys, which the app's key handler runs. Every
 * command with `keys` must be here (a test checks), so a key in the list
 * always does something.
 */
export const KEYED_COMMANDS = [
  "app.search",
  "app.sidebar",
  "app.shortcuts",
  "new.task",
  "page.read",
] as const;
export type KeyedCommand = (typeof KEYED_COMMANDS)[number];

/** A key press, as the handler sees it. */
export type KeyPress = {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
};

/**
 * The command a key press runs anywhere in the app, from the keys written
 * in the list above (so changing a command's keys changes what the key
 * does). "mod" is ⌘ or Ctrl; a single key needs no modifier held.
 */
export function commandForKey(
  e: KeyPress,
  overrides?: ShortcutOverrides | null,
): CommandDef | null {
  for (const c of COMMANDS) {
    const keys = effectiveKeys(c, overrides);
    if (keys.length && pressMatches(keys, e)) return c;
  }
  return null;
}

// ------------------------------------------------------------- ⌘K rows

/**
 * Whether ⌘K's first row makes what was typed: only when an add link (or a
 * share) opened the bar with these words, never a search link, so Enter on
 * a search link opens what was found rather than creating something.
 */
export const linkAddsFirst = (
  opening: { words: string; add: boolean },
  typed: string,
) => opening.add && !!opening.words.trim() && typed === opening.words.trim();

/**
 * ⌘K's rows in order: a question asks the assistant first; text quick add
 * understood (or words an add link brought) makes the item first; otherwise
 * what was found leads and making or asking waits at the end.
 */
export function arrangeBarRows<T>(
  rows: {
    ask: T | null;
    quick: T | null;
    leading: T[];
    found: T[];
    events: T[];
    trailing: T[];
  },
  how: { question: boolean; quickFirst: boolean; addFirst: boolean },
): T[] {
  const { ask, quick } = rows;
  const quickLeads = !!quick && (how.quickFirst || how.addFirst);
  const askLeads = !!ask && how.question && !how.addFirst;
  return [
    ...(ask && askLeads ? [ask] : []),
    ...(quick && quickLeads ? [quick] : []),
    ...rows.leading,
    ...rows.found,
    ...rows.events,
    ...rows.trailing,
    ...(quick && !quickLeads ? [quick] : []),
    ...(ask && !askLeads ? [ask] : []),
  ];
}

// ------------------------------------------------------------- settings

/** The web's Settings tabs. */
export type SettingsTabId =
  "account" | "planning" | "assistants" | "tags" | "connections" | "privacy";

/** Where a setting lives on the phone: a section of Settings, or its own sheet. */
export type PhoneSettingPlace =
  | { section: string }
  | {
      sheet: "planning" | "tags" | "habits" | "connections" | "sync" | "status";
    };

/**
 * One setting people look for by name (NAV-10). Settings' search box, ⌘K
 * ("Settings: Two-step verification") and the phone's Search & do read this
 * list; `section` is the heading of the section it is in, which the search
 * opens and scrolls to.
 */
export type SettingEntry = {
  id: string;
  /** What it is called. */
  label: string;
  /** What it does, in a few words, also searched. */
  hint: string;
  /** Other words it answers to. */
  keywords: string;
  tab: SettingsTabId;
  /** The web section's heading. */
  section: string;
  /** Where it is on the phone; null when the phone has no such setting. */
  phone: PhoneSettingPlace | null;
};

const setting = (
  id: string,
  label: string,
  hint: string,
  tab: SettingsTabId,
  section: string,
  phone: PhoneSettingPlace | null,
  keywords = "",
): SettingEntry => ({ id, label, hint, keywords, tab, section, phone });

export const SETTINGS_INDEX: SettingEntry[] = [
  setting(
    "account",
    "Your account",
    "Your name and email",
    "account",
    "Your account",
    null,
    "profile name email",
  ),
  setting(
    "theme",
    "Theme",
    "Light, dark or your device's",
    "account",
    "Appearance",
    { section: "Appearance" },
    "dark mode light appearance colours",
  ),
  setting(
    "reading",
    "Open pages for reading",
    "Pages open to read; double-tap or press Edit to change them",
    "account",
    "Reading",
    { section: "Reading" },
    "read mode reading view edit double tap default hide header full screen",
  ),
  setting(
    "start",
    "Open to",
    "What opens when Orbyn starts on this device",
    "account",
    "Start",
    { section: "Start" },
    "start screen launch home default open first",
  ),
  setting(
    "sidebar",
    "Arrange",
    "Show, hide and reorder what the sidebar lists",
    "account",
    "Arrange",
    { section: "Arrange" },
    "sidebar navigation menu hide reorder customise customize tabs",
  ),
  setting(
    "shortcuts",
    "Keyboard shortcuts",
    "Change the keys a command uses",
    "account",
    "Keyboard shortcuts",
    null,
    "hotkeys keys keyboard bindings rebind",
  ),
  setting(
    "clipper",
    "Orbyn Clipper",
    "Save articles, papers and highlights from your browser",
    "connections",
    "Orbyn Clipper",
    null,
    "browser extension web clipper chrome firefox save article highlight",
  ),
  setting(
    "email-reminders",
    "Email reminders",
    "A reminder before tasks and events are due",
    "account",
    "Stay in the loop",
    { section: "Stay in the loop" },
    "notifications email push alerts",
  ),
  setting(
    "two-step",
    "Two-step verification",
    "A code from an app as well as your password",
    "account",
    "Signing in",
    { section: "Two-step verification" },
    "2fa totp security authenticator mfa",
  ),
  setting(
    "passkeys",
    "Passkeys",
    "Sign in with your fingerprint or face",
    "account",
    "Signing in",
    { section: "Passkeys" },
    "security webauthn fingerprint face id",
  ),
  setting(
    "signed-in",
    "Signed-in devices",
    "Where you are signed in, and signing out elsewhere",
    "account",
    "Signing in",
    { section: "Signed-in devices" },
    "sessions sign out logout security",
  ),
  setting(
    "status",
    "Service status",
    "Whether Orbyn is running smoothly",
    "account",
    "Service status",
    { sheet: "status" },
    "uptime incidents outage down",
  ),
  setting(
    "whats-new",
    "What's new",
    "What changed in Orbyn lately",
    "account",
    "What's new",
    { section: "What's new" },
    "changelog release updates",
  ),
  setting(
    "how-you-work",
    "Working hours",
    "When you work and how the planner fills your day",
    "planning",
    "How you work",
    { sheet: "planning" },
    "hours day start end breaks planner focus",
  ),
  setting(
    "frames",
    "Frames",
    "Times of the week kept for one kind of work",
    "planning",
    "Frames",
    { sheet: "planning" },
    "time blocks routine week",
  ),
  setting(
    "places",
    "Places",
    "Where you work, and travel between them",
    "planning",
    "Places",
    { sheet: "planning" },
    "location travel home office campus",
  ),
  setting(
    "habits",
    "Habits",
    "Routines the planner fits into free time",
    "planning",
    "Habits",
    { sheet: "habits" },
    "routine repeat exercise",
  ),
  setting(
    "time",
    "Where your time goes",
    "Hours in sessions and tasks finished",
    "planning",
    "Where your time goes",
    { section: "Where your time goes" },
    "analytics report hours",
  ),
  setting(
    "tags",
    "Tags",
    "Yours and your teams'",
    "tags",
    "Tags",
    { sheet: "tags" },
    "labels",
  ),
  setting(
    "agents",
    "Connected agents",
    "Assistants outside Orbyn that can use your account",
    "connections",
    "Connected agents",
    { sheet: "connections" },
    "mcp claude chatgpt ai agent",
  ),
  setting(
    "assistant-rules",
    "Assistant rules",
    "Limits for Orbyn's own agents",
    "assistants",
    "Assistant rules",
    { section: "Assistant rules" },
    "background overnight chat read write handoff",
  ),
  setting(
    "agent-channels",
    "Agent channels",
    "Background and Overnight updates in Slack or Teams",
    "connections",
    "Agent channels",
    { sheet: "connections" },
    "slack background overnight dm messages",
  ),
  setting(
    "api-keys",
    "Personal API keys",
    "Keys for your own scripts",
    "connections",
    "Personal API keys",
    { sheet: "connections" },
    "token developer",
  ),
  setting(
    "webhooks",
    "Webhooks",
    "Tell another service when something changes",
    "connections",
    "Webhooks",
    { sheet: "connections" },
    "integration developer",
  ),
  setting(
    "calendar-feed",
    "Calendar feed",
    "Your tasks and events in another calendar app",
    "connections",
    "Calendar feed",
    { sheet: "connections" },
    "ics ical google outlook apple subscribe",
  ),
  setting(
    "calendars",
    "Subscribed calendars",
    "Another calendar's events shown in Orbyn",
    "connections",
    "Subscribed calendars",
    { sheet: "connections" },
    "ics ical google outlook connect calendar",
  ),
  setting(
    "email-to-task",
    "Email to task",
    "Forward an email to make a task",
    "connections",
    "Email to task",
    { section: "Email to task" },
    "inbox forward mail",
  ),
  setting(
    "chat",
    "Chat delivery",
    "Reminders in Slack or Discord",
    "connections",
    "Chat delivery",
    { section: "Chat delivery" },
    "slack discord",
  ),
  setting(
    "import",
    "Import & export",
    "Bring in Markdown, Notion, Todoist or TickTick; take everything with you",
    "connections",
    "Import & export",
    { section: "Import & export" },
    "import export markdown notion todoist ticktick csv zip backup download",
  ),
  setting(
    "chatgpt-models",
    "ChatGPT connections and models",
    "ChatGPT account status and default model",
    "account",
    "AI connections & models",
    { section: "AI connections & models" },
    "openai plan provider default model executor device",
  ),
  setting(
    "agreed",
    "What you agreed to",
    "The Terms and Privacy Policy",
    "privacy",
    "What you agreed to",
    { section: "Privacy" },
    "terms privacy policy legal",
  ),
  setting(
    "analytics",
    "Usage analytics",
    "Whether Orbyn counts how you use it",
    "privacy",
    "Usage analytics",
    { section: "Privacy" },
    "tracking opt out",
  ),
  setting(
    "your-data",
    "Your data",
    "Download everything that's yours",
    "privacy",
    "Your data",
    { section: "Import & export" },
    "export download zip backup",
  ),
  setting(
    "delete-account",
    "Delete my account",
    "Remove your account and everything in it",
    "privacy",
    "Delete my account",
    { section: "Delete my account" },
    "close remove erase",
  ),
];

/** The settings as commands: "Settings: Two-step verification". */
export const SETTING_COMMANDS: CommandDef[] = SETTINGS_INDEX.map((e) => ({
  id: `settings.${e.id}`,
  label: `Settings: ${e.label}`,
  group: "Settings",
  keywords: `settings preferences ${e.hint} ${e.keywords}`.toLowerCase(),
  icon: "settings",
  setting: e.id,
  on: e.phone ? undefined : "web",
}));

export const settingById = (id: string) =>
  SETTINGS_INDEX.find((e) => e.id === id);

/**
 * The settings that answer what was typed in Settings' search, best first:
 * a name that starts with the words, then a name that holds them, then the
 * rest. Every word must be found somewhere.
 */
export function searchSettings(
  query: string,
  where: "web" | "phone" = "web",
): SettingEntry[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const list = SETTINGS_INDEX.filter((e) => where === "web" || e.phone);
  const score = (e: SettingEntry) => {
    const label = e.label.toLowerCase();
    const text = `${label} ${e.hint} ${e.section} ${e.keywords}`.toLowerCase();
    if (!words.every((w) => text.includes(w))) return -1;
    const phrase = words.join(" ");
    return label.startsWith(phrase) ? 3 : label.includes(phrase) ? 2 : 1;
  };
  return list
    .map((e) => ({ e, s: score(e) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .map((x) => x.e);
}

/** A section heading as settings compare it: its words, without case or marks. */
export const sectionKey = (heading: string) =>
  heading
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** The commands an app shows: the phone leaves out keyboard-only ones. */
export const commandsOn = (where: "web" | "phone", list = COMMANDS) =>
  list.filter((c) => !c.on || c.on === where);
