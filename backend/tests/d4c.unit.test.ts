import { test } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import {
  cachedPage,
  changeDayLabel,
  changeEdits,
  changeVerb,
  CHANGELOG,
  commandById,
  commandForKey,
  commandsOn,
  COMMANDS,
  decodePageCache,
  encodePageCache,
  groupChangesByDay,
  hasUnseenRelease,
  keepPage,
  KEYED_COMMANDS,
  layoutMath,
  linkImportedPage,
  mathReadable,
  mathSpoken,
  orderCommands,
  EMPTY_MEMORY,
  PAGE_CACHE_SIZE,
  planPagesImport,
  publishSlug,
  queueChange,
  resolvePageSave,
  searchSettings,
  sectionKey,
  SETTINGS_INDEX,
  startersFor,
  starterBrief,
  starterById,
  tickTickTasks,
  todoistTasks,
  waitingPageSave,
  withPendingSave,
  withSummary,
  slashQueryAt,
  slashMatches,
  csvFormat,
  BLOCK_KINDS,
  describeOp,
  parseObjectHref,
  cardDescription,
  type Doc,
  type DocBlock,
  type OutboxEntry,
  type PageSave,
  type TeamChange,
} from "@orbyn/core";

/**
 * D4c, the pure parts: maths laid out for phones (EDT-12), pages kept and
 * edited offline (SHR-03), the shared command list and settings search
 * (MOB-10, NAV-10), recent changes by day (SHR-02), the first run's
 * starters (DSN-02), What's new (DSN-03), publishing (SHR-05), imports
 * from other apps (DATA-08) and the assistant's summary (AI-01).
 */

// ------------------------------------------------------------ EDT-12 maths

test("maths lays out fractions, scripts, roots, big operators and matrices", () => {
  const frac = layoutMath("\\frac{a+b}{2}");
  assert.equal(frac.k, "frac");
  const sum = layoutMath("\\sum_{i=1}^{n} i^2");
  assert.equal(sum.k, "row");
  const first = (sum as { items: { k: string; limits?: boolean }[] }).items[0];
  assert.equal(first.k, "scripts");
  assert.equal(first.limits, true, "∑'s limits go above and below");
  // An integral's limits sit beside it.
  const int = layoutMath("\\int_0^1 x\\,dx") as {
    items: { limits?: boolean }[];
  };
  assert.equal(int.items[0].limits, false);
  assert.equal(layoutMath("\\sqrt[3]{x}").k, "sqrt");
  const matrix = layoutMath("\\begin{pmatrix}1&2\\\\3&4\\end{pmatrix}");
  assert.equal(matrix.k, "table");
  assert.deepEqual(
    (matrix as { rows: unknown[][]; open: string }).rows.map((r) => r.length),
    [2, 2],
  );
  assert.equal((matrix as { open: string }).open, "(");
  const cases = layoutMath(
    "f(x)=\\begin{cases}1 & x>0\\\\0 & \\text{otherwise}\\end{cases}",
  );
  assert.ok(
    mathReadable(
      "f(x)=\\begin{cases}1 & x>0\\\\0 & \\text{otherwise}\\end{cases}",
    ),
  );
  assert.match(mathSpoken(cases), /otherwise/);
  // A number reads as one piece, a minus as a real minus sign.
  assert.equal(mathSpoken(layoutMath("3.14 - x")), "3.14 − x");
  // \text keeps its spaces.
  assert.equal(mathSpoken(layoutMath("\\text{if } x")), "if x");
});

test("maths it cannot read comes back as its plain reading, never an error", () => {
  assert.equal(mathReadable("\\unknowncommand{x}"), false);
  const node = layoutMath("\\unknowncommand{x} + \\alpha");
  assert.equal(node.k, "sym");
  assert.match((node as { s: string }).s, /α/);
  assert.equal(mathReadable("\\frac{a}{"), false);
  assert.equal(layoutMath("\\frac{a}{").k, "sym");
  // Greek, blackboard letters and \left…\right read fine.
  assert.ok(mathReadable("\\mathbb{R}^n \\ni \\left(\\alpha, \\beta\\right)"));
  assert.equal(mathSpoken(layoutMath("\\mathbb{R}")), "ℝ");
});

// -------------------------------------------------------- SHR-03 offline

const doc = (id: string, over: Partial<Doc> = {}): Doc =>
  ({
    id,
    user_id: "u",
    team_id: null,
    title: `Page ${id}`,
    kind: "doc",
    content: [{ type: "paragraph", text: "one" }],
    item_id: null,
    project_id: null,
    folder_id: null,
    version: 1,
    created_at: "2026-09-01T00:00:00Z",
    updated_at: "2026-09-01T00:00:00Z",
    ...over,
  }) as Doc;

test("a phone keeps the last 20 pages opened, newest first, and drops old or broken ones", () => {
  let pages = keepPage([], doc("a"), 1000);
  for (let n = 0; n < PAGE_CACHE_SIZE + 5; n++)
    pages = keepPage(pages, doc(`p${n}`), 2000 + n);
  assert.equal(pages.length, PAGE_CACHE_SIZE);
  assert.equal(cachedPage(pages, "a"), null, "the oldest is let go");
  // Opening one again brings it to the front.
  pages = keepPage(pages, doc("p10"), 9999);
  assert.equal(pages[0].doc.id, "p10");
  const raw = encodePageCache(pages);
  assert.equal(decodePageCache(raw, 10_000).length, PAGE_CACHE_SIZE);
  // Too old, another version, or not JSON: nothing, rather than a crash.
  assert.deepEqual(decodePageCache(raw, 10_000 + 31 * 86_400_000), []);
  assert.deepEqual(decodePageCache(raw.replace('"v":1', '"v":9')), []);
  assert.deepEqual(decodePageCache("{nope"), []);
  // A page in Trash isn't kept.
  const trashed = keepPage(pages, { ...doc("p10"), deleted_at: "x" } as Doc);
  assert.equal(cachedPage(trashed, "p10"), null);
});

const para = (text: string): DocBlock => ({ type: "paragraph", text });

test("an edit made offline is sent as it stands when the page didn't move on", () => {
  const save: PageSave = {
    id: "d",
    title: "Notes",
    content: [para("one"), para("two, offline")],
    base: { version: 3, title: "Notes", content: [para("one"), para("two")] },
  };
  const sent = resolvePageSave(save, {
    version: 3,
    title: "Notes",
    content: save.base.content,
  });
  assert.equal(sent.version, 3);
  assert.deepEqual(sent.content, save.content);
  assert.equal(sent.conflicts, 0);
});

test("an edit made offline is merged line by line into a page that moved on", () => {
  const save: PageSave = {
    id: "d",
    title: "Notes",
    content: [para("one, mine"), para("two")],
    base: { version: 3, title: "Notes", content: [para("one"), para("two")] },
  };
  const merged = resolvePageSave(save, {
    version: 5,
    title: "Notes (renamed)",
    content: [para("one"), para("two, theirs")],
  });
  assert.equal(merged.version, 5, "sent against the page as it is now");
  assert.deepEqual(
    merged.content.map((b) => (b as { text: string }).text),
    ["one, mine", "two, theirs"],
  );
  assert.equal(merged.title, "Notes (renamed)", "their rename is kept");
  // Both changed the same line: theirs, then this one below it.
  const clash = resolvePageSave(save, {
    version: 5,
    title: "Notes",
    content: [para("one, theirs"), para("two")],
  });
  assert.equal(clash.conflicts, 1);
  const texts = clash.content.map((b) => (b as { text: string }).text);
  assert.ok(texts.includes("one, theirs") && texts.includes("one, mine"));
});

test("page edits waiting offline join into one, measured from where they began", () => {
  const first: OutboxEntry = {
    key: "k1",
    op: {
      type: "doc.save",
      save: {
        id: "d",
        title: "A",
        content: [para("x")],
        base: { version: 1, title: "A", content: [] },
      },
    },
    queued_at: "2026-09-27T00:00:00Z",
    attempts: 0,
    state: "pending",
  };
  const later: OutboxEntry = {
    ...first,
    key: "k2",
    op: {
      type: "doc.save",
      save: {
        id: "d",
        title: "A",
        content: [para("x"), para("y")],
        base: { version: 2, title: "A", content: [para("x")] },
      },
    },
  };
  const queue = queueChange(queueChange([], first), later);
  assert.equal(queue.length, 1);
  const waiting = waitingPageSave(queue, "d")!;
  assert.equal(waiting.base.version, 1, "the start is kept");
  assert.equal(waiting.content.length, 2, "the newer words are taken");
  assert.equal(describeOp(queue[0].op), "Edited page · A");
  // Shown with its waiting edit laid on.
  assert.equal(withPendingSave(doc("d"), waiting).content.length, 2);
  assert.equal(withPendingSave(doc("e"), waiting).content.length, 1);
});

// --------------------------------------------------- MOB-10, NAV-10 commands

test("one command list: the phone leaves out keyboard-only commands", () => {
  const phone = commandsOn("phone");
  assert.ok(
    !phone.some((c) => c.id === "app.shortcuts" || c.id === "app.sidebar"),
  );
  assert.ok(phone.some((c) => c.id === "new.task"));
  assert.ok(phone.some((c) => c.id === "app.whats-new"));
  assert.equal(commandsOn("web").length, COMMANDS.length);
  // Every command with keys has a handler on the web (KEYED_COMMANDS).
  for (const c of COMMANDS.filter((x) => x.keys?.length))
    assert.ok((KEYED_COMMANDS as readonly string[]).includes(c.id), c.id);
});

test("⌘⇧R toggles reading; ⌘K still needs no Shift, and ? still works", () => {
  const key = (k: string, mod: boolean, shift: boolean) =>
    commandForKey({ key: k, metaKey: mod, ctrlKey: false, shiftKey: shift })
      ?.id;
  assert.equal(key("R", true, true), "page.read");
  assert.equal(key("r", true, false), undefined, "⌘R is the browser's reload");
  assert.equal(key("k", true, false), "app.search");
  assert.equal(key("k", true, true), undefined);
  assert.equal(key("?", false, true), "app.shortcuts");
});

test("settings are found by name, by what they do, and from ⌘K once words are typed", () => {
  assert.equal(searchSettings("two")[0].id, "two-step");
  assert.equal(searchSettings("dark mode")[0].id, "theme");
  assert.ok(searchSettings("notion").some((s) => s.id === "import"));
  assert.deepEqual(searchSettings("  "), []);
  // The phone lists only settings it has.
  assert.ok(
    !searchSettings("your account", "phone").some((s) => s.id === "account"),
  );
  // ⌘K: not with nothing typed, "Settings: …" once words are.
  const none = orderCommands("", EMPTY_MEMORY, () => true);
  assert.ok(!none.some((c) => c.group === "Settings"));
  const found = orderCommands("two-step", EMPTY_MEMORY, () => true);
  assert.equal(found[0].label, "Settings: Two-step verification");
  assert.equal(commandById("settings.two-step")?.setting, "two-step");
  // Every entry names a section, compared without case or marks.
  for (const e of SETTINGS_INDEX) assert.ok(sectionKey(e.section).length > 0);
  assert.equal(sectionKey(" Import & export "), "import export");
});

test("every setting the phone lists names a section or sheet its Settings has", () => {
  const read = (rel: string) =>
    readFileSync(
      fileURLToPath(
        new URL(`../../mobile/src/screens/${rel}`, import.meta.url),
      ),
      "utf8",
    );
  const source =
    read("SettingsScreen.tsx") + read("settings/PrivacySection.tsx");
  const places = new Set(
    [...source.matchAll(/(?:title|name)="([^"]+)"/g)].map((m) =>
      sectionKey(m[1]),
    ),
  );
  for (const e of SETTINGS_INDEX) {
    if (!e.phone || !("section" in e.phone)) continue;
    assert.ok(
      places.has(sectionKey(e.phone.section)),
      `${e.id}: no "${e.phone.section}" in the phone's Settings`,
    );
  }
});

// ------------------------------------------------------ MOB-13 "/" on phones

test('"/" at the start of a line or after a space offers kinds; "and/or" and addresses don\'t', () => {
  assert.deepEqual(slashQueryAt("/", 1), { start: 0, query: "" });
  assert.deepEqual(slashQueryAt("Notes /head", 11), {
    start: 6,
    query: "head",
  });
  assert.deepEqual(slashQueryAt("/to do", 6), { start: 0, query: "to do" });
  assert.equal(slashQueryAt("and/or", 6), null);
  assert.equal(slashQueryAt("see https://x.org/a", 19), null);
  assert.equal(slashQueryAt("/ list", 6), null);
  assert.equal(slashQueryAt("/a  b", 5), null);
  assert.equal(slashQueryAt("/" + "a".repeat(30), 31), null);
  // Only up to the caret.
  assert.deepEqual(slashQueryAt("/quote more", 6), {
    start: 0,
    query: "quote",
  });
  // Matching: the start of a word in the label or its other words.
  const h1 = BLOCK_KINDS.find((k) => k.label === "Heading 1")!;
  assert.ok(slashMatches("head", h1));
  assert.ok(slashMatches("", h1));
  assert.ok(slashMatches("h 1", h1));
  assert.ok(!slashMatches("ead", h1));
  assert.ok(slashMatches("tab", { label: "Table", keywords: "" }));
  assert.ok(slashMatches("query", { label: "Live list", keywords: "query" }));
});

// ------------------------------------------------------ SHR-02 recent changes

test("recent changes read as sentences and group by day in the reader's zone", () => {
  const change = (at: string, over: Partial<TeamChange> = {}): TeamChange => ({
    id: at,
    team_id: "t",
    team_name: "Physics",
    user_id: "u",
    user_name: "Anna",
    kind: "page",
    object_id: "o",
    title: "Lab notes",
    action: "edited",
    edits: 1,
    first_at: at,
    at,
    open: true,
    ...over,
  });
  assert.equal(changeVerb(change("x")), "Anna edited the page");
  assert.equal(
    changeVerb(change("x", { action: "done", kind: "task" })),
    "Anna finished the task",
  );
  assert.equal(
    changeVerb(change("x", { user_name: null })),
    "Someone who left edited the page",
  );
  assert.equal(changeEdits(change("x", { edits: 5 })), "5 edits");
  assert.equal(changeEdits(change("x", { edits: 5, action: "created" })), "");
  const now = new Date("2026-09-27T10:00:00Z");
  const days = groupChangesByDay(
    [
      change("2026-09-25T09:00:00Z"),
      change("2026-09-27T08:00:00Z"),
      change("2026-09-26T23:30:00Z"),
      change("2026-09-27T09:00:00Z"),
    ],
    "UTC",
    now,
  );
  assert.deepEqual(
    days.map((d) => [d.label, d.changes.length]),
    [
      ["Today", 2],
      ["Yesterday", 1],
      ["Fri 25 Sep", 1],
    ],
  );
  // 23:30 UTC is already Sunday in Melbourne.
  assert.equal(
    changeDayLabel("2026-09-26T23:30:00Z", "Australia/Melbourne", now),
    "Today",
  );
});

// ------------------------------------------------ DSN-02, DSN-03 first run

test("the first run offers the starter made for each purpose first", () => {
  assert.equal(startersFor("study")[0].id, "term");
  assert.equal(startersFor("team")[0].id, "sprint");
  assert.equal(startersFor("personal")[0].id, "weekly");
  assert.equal(startersFor("study").at(-1)!.id, "none");
  const brief = starterBrief(
    starterById("term"),
    [{ id: "11111111-1111-4111-8111-111111111111", title: "Lecture notes" }],
    "22222222-2222-4222-8222-222222222222",
  );
  const links = [...brief.matchAll(/\]\((orbyn:\/\/[^)]+)\)/g)].map((m) =>
    parseObjectHref(m[1]),
  );
  assert.deepEqual(
    links.map((l) => l?.kind),
    ["doc", "project"],
    "the brief links its pages and its project",
  );
});

test("What's new opens by itself only for a release newer than the one seen", () => {
  const newest = CHANGELOG[0].date;
  assert.equal(hasUnseenRelease(null), false, "a new account isn't shown it");
  assert.equal(hasUnseenRelease(newest), false);
  assert.equal(hasUnseenRelease("2000-01-01"), true);
  // Newest first, each with at least one line.
  for (let n = 1; n < CHANGELOG.length; n++)
    assert.ok(CHANGELOG[n - 1].date > CHANGELOG[n].date);
  for (const r of CHANGELOG)
    assert.ok(r.new.length + r.better.length + r.fixed.length > 0);
  // Plain words: none of the words the product never uses.
  const all = JSON.stringify(CHANGELOG).toLowerCase();
  assert.ok(!/self-hosted|bring your own|time block/.test(all));
});

// ------------------------------------------------------------ SHR-05 publish

test("a published page's address comes from its title", () => {
  assert.equal(
    publishSlug(
      "Physics 101: Lab notes!",
      "3f2a1c9e-0000-4000-8000-000000000000",
    ),
    "physics-101-lab-notes-3f2a1c",
  );
  assert.equal(publishSlug("Café résumé", "abcdef12-x"), "cafe-resume-abcdef");
  assert.equal(publishSlug("!!!", "abcdef12"), "page-abcdef");
  assert.equal(cardDescription("a  b\n c"), "a b c");
  assert.equal(cardDescription("x".repeat(200)).length, 160);
});

// ------------------------------------------------------------ DATA-08 imports

test("a CSV's app is told by its header: Todoist, TickTick or a plain CSV", () => {
  assert.equal(
    csvFormat("TYPE,CONTENT,DESCRIPTION,PRIORITY\ntask,Buy milk,,1"),
    "todoist",
  );
  assert.equal(csvFormat('\ufeff"TYPE","CONTENT"\n'), "todoist");
  assert.equal(
    csvFormat(
      'Date: 2026-09-01\n"Folder Name","List Name","Title"\n"","Inbox","Call"',
    ),
    "ticktick",
  );
  assert.equal(csvFormat("title,notes,due\nCall,,2026-10-01"), "csv");
});

test("Todoist's CSV: sections become lists, notes join their task, priority 1 is high", () => {
  const csv = [
    "TYPE,CONTENT,DESCRIPTION,PRIORITY,INDENT,AUTHOR,RESPONSIBLE,DATE,DATE_LANG,TIMEZONE",
    "section,Week 1,,,,,,,,",
    "task,Read chapter 2 @reading,Pages 10-40,1,1,Me,,2026-10-01,en,UTC",
    "note,Bring the book,,,,,,,,",
    "task,Tidy desk,,4,1,Me,,,en,UTC",
    ",,,,,,,,,",
  ].join("\n");
  const tasks = todoistTasks(csv);
  assert.equal(tasks.length, 2);
  assert.deepEqual(
    { ...tasks[0], due_at: tasks[0].due_at?.slice(0, 10) },
    {
      title: "Read chapter 2",
      notes: "Pages 10-40\n\nBring the book",
      status: "todo",
      priority: "high",
      due_at: tasks[0].due_at?.slice(0, 10),
      list: "Week 1",
      tags: ["reading"],
    },
  );
  assert.ok(tasks[0].due_at);
  assert.equal(tasks[1].priority, "low");
});

test("TickTick's backup: the table after its preamble, with done and priority read", () => {
  const csv = [
    '"Date: 2026-09-27+0000"',
    '"Version: 7.1"',
    '"Status: \n0 Normal\n1 Completed\n2 Archived"',
    '"Folder Name","List Name","Title","Kind","Tags","Content","Is Check list","Start Date","Due Date","Reminder","Repeat","Priority","Status"',
    '"","Inbox","Essay draft","TEXT","uni, writing","First 500 words","N","","2026-10-03T13:00:00+0000","","","5","0"',
    '"","Home","Water plants","TEXT","","","N","","","","","0","2"',
  ].join("\n");
  const tasks = tickTickTasks(csv);
  assert.equal(tasks.length, 2);
  assert.equal(tasks[0].title, "Essay draft");
  assert.equal(tasks[0].priority, "high");
  assert.deepEqual(tasks[0].tags, ["uni", "writing"]);
  assert.equal(tasks[0].due_at, "2026-10-03T13:00:00.000Z");
  assert.equal(tasks[0].list, "Inbox");
  assert.equal(tasks[1].status, "done");
  assert.deepEqual(tickTickTasks("no,table,here"), []);
});

test("a Markdown export becomes pages in one level of folders, with [[links]] made into links", () => {
  const plan = planPagesImport(
    [
      {
        path: "vault/Physics/Lab 1.md",
        text: "# Lab 1\n\nSee [[Formulas]] and [[Missing page]].\n\n![](img/a.png)",
      },
      {
        path: "vault/Physics/deep/Formulas.md",
        text: "---\ntags: x\n---\nF = ma, see [lab](../Lab%201.md)",
      },
      { path: "vault/Inbox.md", text: "Top-level note" },
      { path: "vault/img/a.png", text: "" },
      { path: "__MACOSX/vault/._Inbox.md", text: "" },
    ],
    "markdown",
    "vault.zip",
  );
  assert.deepEqual(plan.folders.sort(), ["Physics", "vault"].sort());
  assert.deepEqual(plan.pages.map((p) => [p.title, p.folder]).sort(), [
    ["Formulas", "Physics"],
    ["Inbox", "vault"],
    ["Lab 1", "Physics"],
  ]);
  assert.ok(plan.left_out.some((l) => /1 picture/.test(l)));
  const ids = new Map(
    plan.pages.map((p, n) => [
      p.path,
      `0000000${n}-0000-4000-8000-000000000000`,
    ]),
  );
  const byPath = new Map(
    plan.pages.map((p) => [p.path.toLowerCase(), ids.get(p.path)!]),
  );
  const byTitle = new Map(
    plan.pages.map((p) => [p.title.toLowerCase(), ids.get(p.path)!]),
  );
  const lab = plan.pages.find((p) => p.title === "Lab 1")!;
  const linked = linkImportedPage(lab, byPath, byTitle);
  assert.equal(linked.links, 1);
  assert.match(linked.markdown, /\[Formulas\]\(orbyn:\/\/doc\//);
  assert.match(
    linked.markdown,
    /and Missing page\./,
    "a link to nothing keeps its words",
  );
  assert.ok(!linked.markdown.includes("img/a.png"));
  const formulas = plan.pages.find((p) => p.title === "Formulas")!;
  assert.ok(!formulas.markdown.includes("tags: x"), "front matter is dropped");
  const back = linkImportedPage(formulas, byPath, byTitle);
  assert.equal(back.links, 1, "a relative .md link resolves");
});

test("a Notion export: names lose their ids, databases become projects with their rows as tasks", () => {
  const id = "0123456789abcdef0123456789abcdef";
  const plan = planPagesImport(
    [
      {
        path: `Export/Course ${id}.md`,
        text: `# Course\n\n[Tasks](Course%20${id}/Tasks%20${id}.csv)`,
      },
      {
        path: `Export/Course ${id}/Reading ${id}.md`,
        text: "# Reading\n\nChapter one.",
      },
      {
        path: `Export/Course ${id}/Tasks ${id}.csv`,
        text: "Name,Status,Due,Tags\nEssay,Done,2026-10-01,uni\nQuiz,Not started,,",
      },
      {
        path: `Export/Course ${id}/Tasks ${id}_all.csv`,
        text: "Name\nEssay\nQuiz",
      },
      {
        path: `Export/Course ${id}/Tasks ${id}/Essay ${id}.md`,
        text: "# Essay\n\nStatus: Done\n\nThe essay's notes.",
      },
    ],
    "notion",
    "Export.zip",
  );
  assert.deepEqual(plan.pages.map((p) => p.title).sort(), [
    "Course",
    "Reading",
  ]);
  assert.equal(plan.projects.length, 1);
  assert.equal(plan.projects[0].name, "Tasks");
  assert.deepEqual(
    plan.projects[0].tasks.map((t) => [t.title, t.status]),
    [
      ["Essay", "done"],
      ["Quiz", "todo"],
    ],
  );
  assert.equal(plan.projects[0].tasks[0].notes, "The essay's notes.");
});

// ------------------------------------------------------------ AI-01 summary

test("a summary taken onto a page is a Summary callout and a list at the top", () => {
  const out = withSummary([para("page")], "- One\n- Two\n\n3) Three");
  assert.deepEqual(
    out.map((b) => b.type),
    ["callout", "bullet", "bullet", "bullet", "divider", "paragraph"],
  );
  assert.equal((out[0] as { kind: string }).kind, "summary");
  assert.equal((out[3] as { text: string }).text, "Three");
  assert.equal(withSummary([para("page")], "  ").length, 1);
});
