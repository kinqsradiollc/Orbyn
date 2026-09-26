import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EMPTY_SEARCH,
  SECURITY_PAGE,
  SECURITY_PAGE_UPDATED,
  editedSince,
  findNamed,
  formatSearch,
  hasSearchFilters,
  parseAppLink,
  parseSearch,
  searchSummary,
  securityPageDate,
} from "@orbyn/core";
import {
  deepLinkOf,
  deepLinkPath,
  fromAppLink,
  safeNext,
} from "../../desktop/src/app/deep-link.ts";
import {
  COMMANDS,
  EMPTY_MEMORY,
  RECENT_COMMANDS,
  commandMatches,
  commandShortcuts,
  keysFor,
  orderCommands,
  readMemory,
  recordCommand,
  togglePinned,
} from "../../desktop/src/app/commands.ts";
import { NAV } from "../../desktop/src/app/views.ts";

/**
 * Getting anywhere fast (D2a), the parts with no server: search operators
 * and their summary (SRCH-01), the one command list (NAV-01), and the links
 * the apps open (NAV-11, OTH-02).
 */

// ------------------------------------------------------------ SRCH-01 ---

test("operators set filters and leave the words", () => {
  assert.deepEqual(parseSearch('forces tag:physics project:"Big launch"'), {
    ...EMPTY_SEARCH,
    words: "forces",
    tag: "physics",
    project: "Big launch",
  });
  assert.deepEqual(parseSearch("is:task team:lab edited:week notes"), {
    ...EMPTY_SEARCH,
    words: "notes",
    type: "task",
    team: "lab",
    date: "week",
  });
  assert.equal(parseSearch("in:pages x").type, "doc");
  assert.equal(parseSearch("is:projects").type, "project");
  assert.equal(parseSearch("tag:#urgent").tag, "urgent");
});

test("anything that isn't an operator stays in the words", () => {
  for (const text of [
    "meet at 10:30",
    "see https://example.com/a",
    "is:nothing here",
    "edited:yesterday",
    "tag:",
    'project:""',
  ])
    assert.equal(parseSearch(text).words, text.replace(/\s+/g, " "), text);
  assert.equal(hasSearchFilters(parseSearch("plain words")), false);
  assert.equal(hasSearchFilters(parseSearch("is:page")), true);
});

test("filters written back read the same", () => {
  const typed = 'forces is:page project:"Big launch" tag:physics edited:today';
  const filters = parseSearch(typed);
  assert.equal(
    formatSearch(filters),
    'is:page project:"Big launch" tag:physics edited:today forces',
  );
  assert.deepEqual(parseSearch(formatSearch(filters)), filters);
  assert.equal(formatSearch(EMPTY_SEARCH), "");
});

test("the summary is one plain sentence", () => {
  assert.equal(
    searchSummary(parseSearch("forces tag:physics edited:week")),
    "Pages tagged physics, changed in the past week, matching “forces”",
  );
  assert.equal(
    searchSummary(parseSearch("is:task project:Thesis team:Lab")),
    "Tasks in the project Thesis in the team Lab",
  );
  assert.equal(
    searchSummary(parseSearch("budget")),
    "Pages, tasks and projects matching “budget”",
  );
  assert.equal(searchSummary(parseSearch("is:project")), "Projects");
  assert.equal(
    searchSummary(parseSearch("team:personal")),
    "Pages, tasks and projects in your personal space",
  );
});

test("dates count back from now", () => {
  const now = new Date("2026-09-26T15:30:00");
  const today = new Date(editedSince("today", now));
  assert.equal(today.getHours(), 0);
  assert.equal(today.getDate(), 26);
  assert.equal(
    Date.parse(editedSince("week", now)),
    now.getTime() - 7 * 86_400_000,
  );
  assert.equal(
    Date.parse(editedSince("month", now)),
    now.getTime() - 30 * 86_400_000,
  );
});

test("a typed name finds its project, tag or team", () => {
  const list = [
    { id: "1", name: "Physics" },
    { id: "2", name: "Philosophy" },
    { id: "3", name: "Big launch" },
  ];
  assert.equal(findNamed(list, "physics")?.id, "1");
  assert.equal(findNamed(list, "big")?.id, "3", "the only one it starts");
  assert.equal(findNamed(list, "ph"), null, "two start with it");
  assert.equal(findNamed(list, "chemistry"), null);
  assert.equal(findNamed(list, null), null);
  assert.equal(findNamed(list, "  "), null);
});

// ------------------------------------------------------------- NAV-01 ---

test("the command list covers every screen, once each", () => {
  const ids = COMMANDS.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length, "ids are unique");
  for (const entry of NAV)
    assert.ok(
      COMMANDS.some((c) => c.view === entry.label),
      `Go to ${entry.label}`,
    );
  assert.ok(COMMANDS.some((c) => c.view === "Settings"));
  for (const id of [
    "new.task",
    "new.page",
    "new.project",
    "new.from-template",
    "page.link",
    "page.history",
    "plan.day",
    "plan.focus",
  ])
    assert.ok(ids.includes(id), id);
  assert.ok(
    COMMANDS.filter((c) => c.group === "Page").every((c) => c.needs === "page"),
  );
});

test("shortcuts come from the list, for this computer", () => {
  const search = COMMANDS.find((c) => c.id === "app.search");
  assert.deepEqual(keysFor(search, true), ["⌘", "K"]);
  assert.deepEqual(keysFor(search, false), ["Ctrl", "K"]);
  const sheet = commandShortcuts(true);
  assert.ok(sheet.some((s) => s.label === "New task" && s.keys[0] === "N"));
  assert.ok(sheet.every((s) => s.keys.length > 0));
});

test("recent commands come first and pinned ones stay on top", () => {
  const all = () => true;
  let memory = EMPTY_MEMORY;
  memory = recordCommand(memory, "go.calendar");
  memory = recordCommand(memory, "new.page");
  memory = recordCommand(memory, "go.calendar");
  assert.deepEqual(memory.recent, ["go.calendar", "new.page"]);
  memory = togglePinned(memory, "plan.day");
  const shown = orderCommands("", memory, all);
  assert.deepEqual(
    shown.slice(0, 3).map((c) => [c.id, c.section]),
    [
      ["plan.day", "Pinned"],
      ["go.calendar", "Recent commands"],
      ["new.page", "Recent commands"],
    ],
  );
  assert.equal(shown.length, COMMANDS.length, "each once");
  // Unpinning takes it back to its group.
  memory = togglePinned(memory, "plan.day");
  assert.equal(orderCommands("", memory, all)[0].id, "go.calendar");
  // Only so many recent ones are kept.
  for (const c of COMMANDS) memory = recordCommand(memory, c.id);
  assert.equal(memory.recent.length, RECENT_COMMANDS);
});

test("typing narrows the list; unavailable commands never show", () => {
  const found = orderCommands("go cal", EMPTY_MEMORY, () => true);
  assert.deepEqual(
    found.map((c) => c.id),
    ["go.calendar"],
  );
  assert.ok(
    commandMatches(
      COMMANDS.find((c) => c.id === "new.page")!,
      "doc",
    ),
  );
  const noPage = orderCommands("", EMPTY_MEMORY, (c) => c.needs !== "page");
  assert.ok(noPage.every((c) => c.needs !== "page"));
});

test("stored memory is read back safely", () => {
  assert.deepEqual(readMemory(null), EMPTY_MEMORY);
  assert.deepEqual(readMemory("not json"), EMPTY_MEMORY);
  assert.deepEqual(
    readMemory(
      JSON.stringify({
        recent: ["go.calendar", "gone.command", "go.calendar", 3],
        pinned: "plan.day",
      }),
    ),
    { recent: ["go.calendar"], pinned: [] },
  );
});

// ------------------------------------------------------ NAV-11, OTH-02 ---

test("the phone and desktop links: review and search", () => {
  const id = "0f5b1d9e-2a44-4c1e-9d55-6a8b0c3e7f21";
  assert.deepEqual(parseAppLink(`orbyn://review/${id}`), {
    kind: "review",
    id,
  });
  assert.deepEqual(parseAppLink("orbyn://review"), {
    kind: "review",
    id: null,
  });
  assert.deepEqual(parseAppLink(`https://orbyn.dev/app/review/${id}`), {
    kind: "review",
    id,
  });
  assert.equal(parseAppLink("orbyn://review/not-an-id"), null);
  assert.deepEqual(parseAppLink("orbyn://search?q=physics%20notes"), {
    kind: "search",
    q: "physics notes",
  });
  assert.deepEqual(parseAppLink("orbyn://search"), { kind: "search", q: "" });
});

test("web links to add or search open a filled-in bar, and survive sign-in", () => {
  assert.deepEqual(deepLinkOf("/app/add", "", "?text=Buy%20milk%20fri"), {
    kind: "add",
    text: "Buy milk fri",
  });
  assert.deepEqual(deepLinkOf("/app/search", "", "?q=tag:physics"), {
    kind: "search",
    q: "tag:physics",
  });
  const add = { kind: "add" as const, text: "Call Anna 3pm" };
  const kept = deepLinkPath(add);
  assert.equal(kept, "/app/add?text=Call+Anna+3pm");
  assert.deepEqual(safeNext(`?next=${encodeURIComponent(kept)}`), add);
  // Long words are cut down, never refused.
  const long = deepLinkOf("/app/add", "", `?text=${"a".repeat(900)}`);
  assert.equal(long?.kind === "add" && long.text.length, 500);
});

test("the desktop app opens orbyn:// links as the web app does", () => {
  const id = "0f5b1d9e-2a44-4c1e-9d55-6a8b0c3e7f21";
  const open = (url: string) => {
    const app = parseAppLink(url);
    return app && fromAppLink(app);
  };
  assert.deepEqual(open(`orbyn://task/${id}`), { kind: "task", id });
  assert.deepEqual(open(`orbyn://doc/${id}`), { kind: "doc", id, block: null });
  assert.deepEqual(open(`orbyn://project/${id}`), { kind: "project", id });
  assert.deepEqual(open("orbyn://today"), { kind: "today" });
  assert.deepEqual(open(`orbyn://review/${id}`), { kind: "review", id });
  // Words to add fill Quick add; nothing is added by the link itself.
  assert.deepEqual(open("orbyn://add?text=Lunch%20fri%201pm"), {
    kind: "add",
    text: "Lunch fri 1pm",
  });
  assert.deepEqual(open("orbyn://add"), { kind: "add", text: "" });
  assert.equal(open("orbyn://scan"), null, "the phone's camera stays there");
  assert.equal(open("javascript:alert(1)"), null);
  assert.equal(open("orbyn://task/../../etc"), null);
});

test("the Security and data page is dated and plain", () => {
  assert.match(SECURITY_PAGE_UPDATED, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(securityPageDate("en-GB"), "26 September 2026");
  assert.ok(SECURITY_PAGE.length >= 4);
  const text = JSON.stringify(SECURITY_PAGE).toLowerCase();
  for (const word of ["passkeys", "export", "https", "confirm"])
    assert.ok(text.includes(word), word);
  assert.ok(!text.includes("self-host"), "Orbyn is hosted");
  assert.ok(!text.includes("bring your own"));
});
