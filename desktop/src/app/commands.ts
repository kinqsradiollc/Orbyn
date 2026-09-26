import type { View } from "./views";

/**
 * One list of everything Orbyn can do from the keyboard (NAV-01). ⌘K, the
 * shortcut sheet and the sidebar's hints all read it, so a command and its
 * shortcut are written down once.
 *
 * This file is only the list and its ordering (recent commands first, pinned
 * ones on top); what each command does is wired in the command bar, which
 * has the app's handlers.
 */

export type CommandGroup = "Go to" | "Create" | "Page" | "Planner" | "Help";

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
  | "shield";

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
  view?: View;
  /** Shown only with a page open, or only to admins. */
  needs?: "page" | "admin";
};

const go = (
  view: View,
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
  go("Overview", "home today start"),
  go("Agenda", "day page notes today"),
  go("My tasks", "todo list"),
  go("Calendar", "events week month"),
  go("Projects", "stages work"),
  go("Docs", "documents pages notes library", "Go to Documents"),
  go("Views", "saved views filters table board gallery exam week"),
  go("Study", "flashcards cards exams revise"),
  go("Lists", "groups"),
  go("AI assistant", "ask chat ai"),
  go("Teams", "people members"),
  go("Booking", "booking pages meetings"),
  go("Notifications", "inbox notices alerts"),
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
  },
  {
    id: "app.shortcuts",
    label: "Keyboard shortcuts",
    group: "Help",
    keywords: "keys help",
    icon: "keyboard",
    keys: ["?"],
  },
  {
    id: "app.sidebar",
    label: "Show or hide the sidebar",
    group: "Help",
    keywords: "rail collapse menu",
    icon: "panel",
    keys: ["mod", "\\"],
  },
  {
    id: "app.security",
    label: "Security and data",
    group: "Help",
    keywords: "privacy safety encryption passkeys export",
    icon: "shield",
  },
];

export const commandById = (id: string) => COMMANDS.find((c) => c.id === id);

/** A command's keys for this computer: ⌘ on a Mac, Ctrl elsewhere. */
export function keysFor(command: CommandDef | undefined, mac: boolean) {
  return (command?.keys ?? []).map((k) =>
    k === "mod" ? (mac ? "⌘" : "Ctrl") : k,
  );
}

/** The keys of the command for a screen, for a sidebar hint. */
export const viewCommand = (view: View) =>
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
  const shown = COMMANDS.filter(
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
export const commandShortcuts = (mac: boolean) =>
  COMMANDS.filter((c) => c.keys?.length).map((c) => ({
    keys: keysFor(c, mac),
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
export function commandForKey(e: KeyPress): CommandDef | null {
  const mod = e.metaKey || e.ctrlKey;
  for (const c of COMMANDS) {
    const keys = c.keys;
    if (!keys?.length) continue;
    const wantsMod = keys[0] === "mod";
    const key = keys[keys.length - 1];
    if (keys.length !== (wantsMod ? 2 : 1)) continue;
    if (wantsMod !== mod || e.altKey) continue;
    if (e.key.toLowerCase() === key.toLowerCase()) return c;
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
