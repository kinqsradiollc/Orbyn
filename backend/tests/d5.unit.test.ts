import { test } from "node:test";
import assert from "node:assert/strict";
import {
  arrangeEntries,
  articleBlocks,
  BUILT_IN_CLIP_RULES,
  cellText,
  clipTypeFor,
  clozeLine,
  COMMANDS,
  commandForKey,
  commandShortcuts,
  dropEntry,
  dueWords,
  effectiveKeys,
  htmlTitle,
  isAudio,
  keysFor,
  keysFromPress,
  lastTouchedText,
  layoutConnections,
  lineDirection,
  moveEntry,
  nodeLabel,
  pageFileType,
  pageSlides,
  paperMeta,
  pressMatches,
  readStartScreen,
  setShortcut,
  shortcutClash,
  slideStep,
  sniffPageFile,
  subtasksDoneText,
  summaryLines,
  toggleSidebarHidden,
  VIEW_COLUMNS,
  type ConnectionMap,
  type DocBlock,
  type ViewRow,
} from "@orbyn/core";

/**
 * D5, the pure parts: Arrange and changed shortcuts (NAV-08, NAV-09), what
 * opens at start (NAV-12), the Connections map's layout (CNV-02), slides
 * (CNV-03), right-to-left lines (DSN-04), the Clipper's cleaning and
 * shapes (CAP-02..04), recordings (CAP-10) and the new computed columns
 * (DATA-06).
 */

// -------------------------------------------------------------- NAV-08

test("Arrange orders a group's destinations, hides some, and never hides the way home", () => {
  const nav = ["Overview", "Agenda", "My tasks", "Calendar"];
  const same = (x: string) => x;
  assert.deepEqual(
    arrangeEntries(nav, same, { order: ["Calendar", "Overview"], hidden: [] }),
    ["Calendar", "Overview", "Agenda", "My tasks"],
  );
  assert.deepEqual(
    arrangeEntries(nav, same, {
      order: [],
      hidden: ["Agenda", "Overview"],
    }),
    ["Overview", "My tasks", "Calendar"],
  );
  // Settings shows the hidden ones so they can come back.
  assert.equal(
    arrangeEntries(nav, same, { order: [], hidden: ["Agenda"] }, true).length,
    4,
  );
  assert.deepEqual(arrangeEntries(nav, same, null), nav);
  assert.deepEqual(moveEntry(["a", "b", "c"], "b", -1), ["b", "a", "c"]);
  assert.deepEqual(moveEntry(["a", "b", "c"], "a", -1), ["a", "b", "c"]);
  assert.deepEqual(dropEntry(["a", "b", "c"], "c", "a"), ["c", "a", "b"]);
  assert.deepEqual(dropEntry(["a", "b", "c"], "a", null), ["b", "c", "a"]);
  const a = { order: [], hidden: [] };
  assert.deepEqual(toggleSidebarHidden(a, "Study").hidden, ["Study"]);
  assert.deepEqual(
    toggleSidebarHidden({ order: [], hidden: ["Study"] }, "Study").hidden,
    [],
  );
  assert.deepEqual(toggleSidebarHidden(a, "Settings").hidden, []);
});

// -------------------------------------------------------------- NAV-09

test("a changed shortcut runs its command, and a key does only one thing", () => {
  const press = (key: string, mod = false, shift = false) => ({
    key,
    metaKey: mod,
    ctrlKey: false,
    shiftKey: shift,
  });
  const overrides = { "page.present": ["mod", "shift", "P"], "new.task": [] };
  assert.equal(
    commandForKey(press("P", true, true), overrides)?.id,
    "page.present",
  );
  assert.equal(commandForKey(press("n"), overrides), null, "N was taken away");
  assert.equal(commandForKey(press("n"))?.id, "new.task");
  assert.equal(commandForKey(press("?", false, true))?.id, "app.shortcuts");
  // A command's keys as the sheet and ⌘K show them.
  const present = COMMANDS.find((c) => c.id === "page.present");
  assert.deepEqual(keysFor(present, true, overrides), ["⌘", "⇧", "P"]);
  assert.deepEqual(keysFor(present, false, overrides), ["Ctrl", "Shift", "P"]);
  assert.ok(
    commandShortcuts(true, overrides).some(
      (s) => s.label === "Present this page",
    ),
  );
  assert.ok(
    !commandShortcuts(true, overrides).some((s) => s.label === "New task"),
  );
  // Recording a key press.
  assert.deepEqual(
    keysFromPress({ key: "p", metaKey: true, ctrlKey: false, shiftKey: true }),
    ["mod", "shift", "P"],
  );
  assert.deepEqual(
    keysFromPress({ key: "j", metaKey: false, ctrlKey: true, altKey: true }),
    ["mod", "alt", "J"],
  );
  assert.equal(
    keysFromPress({ key: "Shift", metaKey: false, ctrlKey: false }),
    null,
  );
  assert.equal(
    keysFromPress({ key: "Tab", metaKey: false, ctrlKey: false }),
    null,
  );
  assert.equal(
    keysFromPress({ key: "Enter", metaKey: false, ctrlKey: false }),
    null,
  );
  // Giving a key to a command takes it from the one that had it.
  const taken = setShortcut(COMMANDS, {}, "page.present", ["mod", "K"]);
  assert.deepEqual(taken["page.present"], ["mod", "K"]);
  assert.deepEqual(taken["app.search"], []);
  assert.equal(
    shortcutClash(COMMANDS, {}, "page.present", ["mod", "K"])?.id,
    "app.search",
  );
  // Back to its own keys.
  assert.deepEqual(setShortcut(COMMANDS, taken, "page.present", null), {
    "app.search": [],
  });
  assert.deepEqual(effectiveKeys({ id: "x", keys: ["N"] }, {}), ["N"]);
  assert.ok(pressMatches(["mod", "\\"], press("\\", true)));
  assert.ok(!pressMatches(["N"], press("N", false, true)));
});

test("what opens at start is one of four, Overview otherwise", () => {
  assert.equal(readStartScreen("agenda"), "agenda");
  assert.equal(readStartScreen("last-page"), "last-page");
  assert.equal(readStartScreen("admin"), "overview");
  assert.equal(readStartScreen(null), "overview");
});

// -------------------------------------------------------------- CNV-02

test("the map puts the page in the middle, its links around it, and the next ring by what led there", () => {
  const map: ConnectionMap = {
    nodes: [
      { key: "doc:c", kind: "doc", id: "c", title: "Centre", depth: 0 },
      { key: "doc:a", kind: "doc", id: "a", title: "A", depth: 1 },
      { key: "task:b", kind: "task", id: "b", title: "B", depth: 1 },
      { key: "doc:d", kind: "doc", id: "d", title: "D", depth: 2 },
    ],
    edges: [
      { from: "doc:c", to: "doc:a", label: "Links to" },
      { from: "doc:c", to: "task:b", label: "Links to" },
      { from: "doc:a", to: "doc:d", label: "Links to" },
    ],
    truncated: false,
  };
  const placed = layoutConnections(map, 400);
  const at = (k: string) => placed.find((n) => n.key === k)!;
  assert.deepEqual([at("doc:c").x, at("doc:c").y], [200, 200]);
  const dist = (k: string) => Math.hypot(at(k).x - 200, at(k).y - 200);
  assert.ok(Math.abs(dist("doc:a") - dist("task:b")) < 0.001);
  assert.ok(dist("doc:d") > dist("doc:a"));
  // D sits out beyond A, the node that led to it.
  const angle = (k: string) => Math.atan2(at(k).y - 200, at(k).x - 200);
  assert.ok(Math.abs(angle("doc:d") - angle("doc:a")) < 0.01);
  // Every node is inside the square.
  for (const n of placed) {
    assert.ok(n.x >= 0 && n.x <= 400 && n.y >= 0 && n.y <= 400);
  }
  assert.equal(
    nodeLabel("A very long page title about waves and light", 12),
    "A very long…",
  );
  assert.equal(nodeLabel("  "), "Untitled");
});

// -------------------------------------------------------------- CNV-03

test("a page splits into slides at dividers and top headings", () => {
  const content: DocBlock[] = [
    { type: "paragraph", text: "Welcome" },
    { type: "heading", level: 1, text: "Agenda" },
    { type: "bullet", text: "Updates" },
    { type: "divider" },
    { type: "heading", level: 2, text: "Numbers" },
    { type: "paragraph", text: "" },
    { type: "divider" },
    { type: "divider" },
    { type: "footnote", label: "1", text: "note" },
  ];
  const slides = pageSlides("Stand-up", content);
  assert.equal(slides.length, 3);
  assert.equal(slides[0].title, "Stand-up");
  assert.equal(slides[1].title, "Agenda");
  assert.equal(slides[1].blocks.length, 1);
  assert.equal(slides[2].title, null);
  assert.equal(slides[2].blocks[0].type, "heading");
  assert.deepEqual(pageSlides("Empty", []), [{ title: "Empty", blocks: [] }]);
  // A page that starts with a top heading opens on a title slide.
  const titled = pageSlides("Lab talk", [
    { type: "heading", level: 1, text: "Aim" },
    { type: "paragraph", text: "Measure g" },
  ]);
  assert.deepEqual(
    titled.map((s) => s.title),
    ["Lab talk", "Aim"],
  );
  assert.equal(slideStep("ArrowRight", 0, 3), 1);
  assert.equal(slideStep("ArrowRight", 2, 3), 2);
  assert.equal(slideStep("ArrowLeft", 0, 3), 0);
  assert.equal(slideStep("End", 0, 3), 2);
  assert.equal(slideStep("x", 0, 3), null);
});

// -------------------------------------------------------------- DSN-04

test("a line reads right to left when its first letter is Arabic or Hebrew", () => {
  assert.equal(lineDirection("שלום עולם"), "rtl");
  assert.equal(lineDirection("مرحبا بالعالم and more"), "rtl");
  assert.equal(lineDirection("Hello مرحبا"), "ltr");
  assert.equal(lineDirection("123 — שלום"), "rtl");
  assert.equal(lineDirection("$x^2$ שלום"), "rtl");
  assert.equal(lineDirection("[שלום](https://example.com/abc)"), "rtl");
  assert.equal(lineDirection(""), "ltr");
});

// ------------------------------------------------------ CAP-02..04

test("a clipped page keeps the article and drops the page's furniture", () => {
  const html = `<html><head><title>T | Site</title>
    <meta property="og:title" content="Real &amp; title"></head><body>
    <nav>Menu</nav><div class="newsletter-signup"><p>Subscribe!</p></div>
    <article><h2>Part one</h2><p>Hello <em>there</em>, see <a href="/x">this</a>.</p>
    <pre><code>let a = 1;
let b = 2;</code></pre><blockquote>Quoted</blockquote>
    <p>${"filler ".repeat(40)}</p></article><aside>Ads</aside></body></html>`;
  const blocks = articleBlocks(html, "https://site.example/post");
  const text = JSON.stringify(blocks);
  assert.ok(!text.includes("Menu"));
  assert.ok(!text.includes("Subscribe"));
  assert.ok(!text.includes("Ads"));
  assert.ok(blocks.some((b) => b.type === "heading"));
  assert.ok(text.includes("[this](https://site.example/x)"));
  const code = blocks.find((b) => b.type === "code");
  assert.ok(code && "text" in code && code.text.includes("\n"));
  assert.ok(blocks.some((b) => b.type === "quote"));
  assert.equal(htmlTitle(html), "Real & title");
});

test("clip shapes follow the site, papers carry their details, cards hide a telling word", () => {
  assert.equal(clipTypeFor("https://arxiv.org/abs/1"), "paper");
  assert.equal(clipTypeFor("https://www.nature.com/articles/x"), "paper");
  assert.equal(clipTypeFor("https://www.nature.com/news/x"), "article");
  assert.equal(
    clipTypeFor("https://uni.instructure.com/courses/4/assignments/1"),
    "assignment",
  );
  assert.equal(clipTypeFor("https://moodle.uni.edu/mod/assign"), "assignment");
  assert.equal(clipTypeFor("https://blog.example.com"), "article");
  assert.equal(
    clipTypeFor("https://blog.example.com/x", [
      { host: "example.com", type: "read_later" },
    ]),
    "read_later",
  );
  assert.equal(clipTypeFor("not a url"), "article");
  const meta = paperMeta(
    `<meta name="citation_author" content="A. One"><meta name="citation_author" content="B. Two">
     <meta name="citation_date" content="2019-05-01"><meta name="citation_journal_title" content="J">
     <p>doi: 10.5555/abc.1</p>`,
  );
  assert.deepEqual(meta.authors, ["A. One", "B. Two"]);
  assert.equal(meta.year, "2019");
  assert.equal(meta.doi, "10.5555/abc.1");
  assert.equal(meta.journal, "J");
  assert.equal(
    clozeLine({ text: "Rayleigh described it in 1871.", hide: "1871" }),
    "Rayleigh described it in {{1871}}.",
  );
  assert.equal(
    clozeLine({ text: "The mitochondria is the powerhouse" }),
    "The {{mitochondria}} is the powerhouse",
  );
  assert.equal(clozeLine({ text: "it is so" }), null);
  assert.equal(
    dueWords("Lab 2. Due: Oct 3 2026 5pm. Late work"),
    "Oct 3 2026 5pm",
  );
  assert.equal(dueWords("Deadline - Friday"), "Friday");
  assert.equal(dueWords("Nothing here"), null);
});

// ------------------------------------------------------------- CAP-10

test("recordings are kept as page files and summaries become a checklist", () => {
  assert.equal(pageFileType("Lecture.m4a"), "audio/mp4");
  assert.equal(pageFileType("rec.weba"), "audio/webm");
  assert.equal(pageFileType("x", "audio/webm;codecs=opus"), "audio/webm");
  assert.ok(isAudio("audio/mpeg"));
  assert.ok(!isAudio("application/pdf"));
  const bytes = (...b: number[]) =>
    new Uint8Array([...b, ...Array(16).fill(0)]);
  assert.ok(sniffPageFile(bytes(0x1a, 0x45, 0xdf, 0xa3), "audio/webm"));
  assert.ok(!sniffPageFile(bytes(0x25, 0x50, 0x44, 0x46), "audio/webm"));
  assert.ok(
    sniffPageFile(bytes(0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70), "audio/mp4"),
  );
  assert.ok(sniffPageFile(bytes(0x49, 0x44, 0x33), "audio/mpeg"));
  const lines = summaryLines({
    summary: "One.\n\nTwo.",
    actions: [{ title: "Do it", due: null }],
  });
  assert.deepEqual(
    lines.map((b) => b.type),
    ["heading", "paragraph", "paragraph", "heading", "todo"],
  );
  assert.equal(summaryLines({ summary: "Only", actions: [] }).length, 2);
});

// ------------------------------------------------------------ DATA-06

test("ready-made columns: subtasks done and last touched", () => {
  assert.ok(VIEW_COLUMNS.tasks.includes("subtasks_done"));
  assert.ok(VIEW_COLUMNS.pages.includes("last_touched"));
  const now = new Date("2026-09-27T12:00:00Z");
  assert.equal(lastTouchedText("2026-09-27T08:00:00Z", now), "Today");
  assert.equal(lastTouchedText("2026-09-26T08:00:00Z", now), "Yesterday");
  assert.equal(lastTouchedText("2026-09-20T12:00:00Z", now), "7 days ago");
  assert.equal(lastTouchedText("2026-08-20T12:00:00Z", now), "5 weeks ago");
  assert.equal(lastTouchedText("2026-01-01T12:00:00Z", now), "8 months ago");
  const row = {
    item: { child_count: 2, children_done: 1, steps_total: 2, steps_done: 2 },
  } as unknown as ViewRow;
  assert.equal(subtasksDoneText(row), "3 of 4 · 75%");
  assert.equal(subtasksDoneText({ item: {} } as unknown as ViewRow), "");
  assert.equal(
    cellText(
      { ...row, updated_at: "2026-09-26T08:00:00Z" } as ViewRow,
      "last_touched",
      { userId: "u", now, timeZone: "UTC" },
    ),
    "Yesterday",
  );
});

// ---------------------------------------------------- the Clipper app

test("the Clipper extension is Manifest V3, asks for little, and shapes clips as Orbyn does", async () => {
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const at = (rel: string) =>
    fileURLToPath(new URL(`../../clipper/${rel}`, import.meta.url));
  const manifest = JSON.parse(readFileSync(at("manifest.json"), "utf8"));
  assert.equal(manifest.manifest_version, 3);
  // Everywhere-access is optional (only for bringing highlights back).
  assert.ok(!manifest.host_permissions.includes("<all_urls>"));
  assert.ok(manifest.optional_host_permissions.includes("<all_urls>"));
  assert.deepEqual([...manifest.permissions].sort(), [
    "activeTab",
    "contextMenus",
    "scripting",
    "storage",
  ]);
  for (const file of [
    manifest.background.service_worker,
    manifest.action.default_popup,
    manifest.options_page,
    ...Object.values(manifest.icons as Record<string, string>),
  ])
    assert.ok(readFileSync(at(file)).length > 0, file);
  const shared = (await import(at("shared.js"))) as {
    BUILT_IN_RULES: unknown;
    clipTypeFor: (url: string, rules?: unknown[]) => string;
  };
  assert.deepEqual(shared.BUILT_IN_RULES, BUILT_IN_CLIP_RULES);
  for (const url of [
    "https://arxiv.org/abs/2401.1",
    "https://uni.instructure.com/courses/1/assignments/2",
    "https://blog.example.com/post",
  ])
    assert.equal(shared.clipTypeFor(url), clipTypeFor(url), url);
});
