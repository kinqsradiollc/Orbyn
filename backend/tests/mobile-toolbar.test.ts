import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import {
  CREATE_ACTIONS,
  DEFAULT_ARRANGEMENT,
  QUICK_ACTIONS,
  appPath,
  appUrl,
  canRedo,
  canStyleLine,
  canUndo,
  emptyUndo,
  lineWordsStart,
  moveAction,
  parseAppLink,
  readArrangement,
  recordUndo,
  redoStep,
  setFavourite,
  shortAddress,
  shownActions,
  stylesAt,
  toggleHidden,
  toolbarLink,
  toolbarStyle,
  undoStep,
  wordsRange,
} from "@orbyn/core";
import { deepLinkOf } from "../../desktop/src/app/deep-link.ts";

/**
 * The phone's page editor and its + (the mobile app has no test runner of
 * its own, so the pure parts are tested here): the keyboard toolbar's
 * styles, links and ranges (MOB-01), Undo and Redo, the + sheet's
 * arrangement (MOB-02), links into the app and the icon's quick actions
 * (CAP-08), and the links pages, tasks and projects share (SHR-07).
 */

// ----------------------------------------------------- keyboard toolbar ---

test("a line's marker is never part of its words", () => {
  assert.equal(lineWordsStart("## Plan"), 3);
  assert.equal(lineWordsStart("- [ ] buy milk"), 6);
  assert.equal(lineWordsStart("- [x] done"), 6);
  assert.equal(lineWordsStart("- item"), 2);
  assert.equal(lineWordsStart("12. twelfth"), 4);
  assert.equal(lineWordsStart("> quoted"), 2);
  assert.equal(lineWordsStart("plain words"), 0);
  assert.equal(lineWordsStart("#hashtag"), 0, "a tag is not a heading");
  assert.equal(canStyleLine("```js\nx\n```"), false);
  assert.equal(canStyleLine("$$\nx\n$$"), false);
  assert.equal(canStyleLine("---"), false);
  assert.equal(canStyleLine("- [ ] words"), true);
});

test("Bold, Italic and Highlight act on the words, not the marker", () => {
  // The whole line chosen, marker and all: only the words are styled.
  assert.deepEqual(toolbarStyle("- [ ] buy milk", 0, 14, "bold"), {
    text: "- [ ] **buy milk**",
    start: 8,
    end: 16,
  });
  // Pressed again on the styled words, it comes off.
  assert.deepEqual(toolbarStyle("- [ ] **buy milk**", 8, 16, "bold"), {
    text: "- [ ] buy milk",
    start: 6,
    end: 14,
  });
  // With nothing chosen the markers go in at the caret, ready to type into.
  assert.deepEqual(toolbarStyle("## Plan ", 8, 8, "italic"), {
    text: "## Plan **",
    start: 9,
    end: 9,
  });
  // Pressed again before typing, the empty markers come out.
  assert.deepEqual(toolbarStyle("Plan ****", 7, 7, "bold"), {
    text: "Plan ",
    start: 5,
    end: 5,
  });
  assert.deepEqual(toolbarStyle("Plan ====", 7, 7, "highlight"), {
    text: "Plan ",
    start: 5,
    end: 5,
  });
  // A caret on the marker lands at the start of the words.
  assert.deepEqual(toolbarStyle("> quote", 0, 0, "highlight"), {
    text: "> ====quote",
    start: 4,
    end: 4,
  });
  assert.deepEqual(toolbarStyle("one two", 4, 7, "highlight"), {
    text: "one ==two==",
    start: 6,
    end: 9,
  });
  // Code and maths aren't styled; nor are words styled another way.
  assert.equal(toolbarStyle("```\ncode\n```", 4, 8, "bold"), null);
  assert.equal(toolbarStyle("a *b* c", 0, 7, "bold"), null);
});

test("the toolbar knows which styles the caret sits in", () => {
  const line = "- plain **bold** and ==marked== [link](https://x.io)";
  assert.deepEqual(stylesAt(line, 3, 3), []);
  assert.deepEqual(stylesAt(line, 12, 12), ["bold"]);
  // At the edge of the styled words, where styling leaves the caret.
  assert.deepEqual(stylesAt(line, 10, 10), ["bold"]);
  assert.deepEqual(stylesAt(line, 25, 27), ["highlight"]);
  assert.deepEqual(stylesAt(line, 34, 34), ["link"]);
  // A selection shows a style only when all of it has that style.
  assert.deepEqual(stylesAt(line, 3, 12), []);
});

test("Bold pressed with nothing chosen shows as on until it's typed into", () => {
  const pressed = toolbarStyle("- word ", 7, 7, "bold")!;
  assert.equal(pressed.text, "- word ****");
  assert.deepEqual(stylesAt(pressed.text, pressed.start, pressed.end), [
    "bold",
  ]);
  assert.deepEqual(stylesAt("- a == == b", 6, 6), []);
  assert.deepEqual(stylesAt("- ====", 4, 4), ["highlight"]);
  assert.deepEqual(stylesAt("- **", 4, 4), []);
});

test("Link turns chosen words into a link, or puts the address in", () => {
  assert.deepEqual(toolbarLink("- read this", 7, 11, "example.com/a"), {
    text: "- read [this](https://example.com/a)",
    start: 8,
    end: 12,
  });
  // Spaces at the edges stay outside the link.
  assert.deepEqual(toolbarLink("see the docs ", 3, 13, "https://d.io"), {
    text: "see [the docs](https://d.io) ",
    start: 5,
    end: 13,
  });
  // Nothing chosen: the short address becomes the link's words.
  assert.deepEqual(toolbarLink("Notes", 5, 5, "https://www.example.com/x/"), {
    text: "Notes [example.com/x](https://www.example.com/x/)",
    start: 49,
    end: 49,
  });
  // Empty markers left at the caret go, since a style can't hold a link.
  assert.deepEqual(toolbarLink("quiz.****", 7, 7, "https://a.io"), {
    text: "quiz. [a.io](https://a.io)",
    start: 26,
    end: 26,
  });
  // An address chosen becomes a link to itself.
  assert.deepEqual(toolbarLink("https://a.io", 0, 12, "https://a.io"), {
    text: "[a.io](https://a.io)",
    start: 20,
    end: 20,
  });
  // Brackets in the words are taken out, and parentheses in the address kept safe.
  assert.deepEqual(toolbarLink("a [b] c", 0, 7, "https://x.io/(y)"), {
    text: "[a b c](https://x.io/%28y%29)",
    start: 1,
    end: 6,
  });
  assert.equal(toolbarLink("words", 0, 5, "not a link"), null);
  assert.equal(toolbarLink("words", 0, 5, "javascript:alert(1)"), null);
  assert.equal(toolbarLink("**bold**", 2, 6, "https://x.io"), null);
  assert.equal(toolbarLink("```\nx\n```", 0, 0, "https://x.io"), null);
  assert.equal(shortAddress("mailto:me@x.io"), "me@x.io");
  assert.equal(shortAddress(`https://x.io/${"a".repeat(80)}`).length, 60);
});

test("a stretch of the Markdown is the same stretch of the line's words", () => {
  assert.deepEqual(wordsRange("- [ ] buy milk", 10, 14), { start: 4, end: 8 });
  // Over the marker, it starts at the words.
  assert.deepEqual(wordsRange("## Plan it", 0, 7), { start: 0, end: 4 });
  // Nothing chosen is the whole line, without trailing spaces.
  assert.deepEqual(wordsRange("> quote  ", 4, 4), { start: 0, end: 5 });
  assert.deepEqual(wordsRange("plain", 5, 2), { start: 2, end: 5 });
});

// ---------------------------------------------------------- undo, redo ---

test("Undo takes back a burst of typing, and Redo brings it back", () => {
  let stack = emptyUndo<string>();
  assert.equal(canUndo(stack), false);
  // Typing "abc" quickly is one step.
  stack = recordUndo(stack, "", { kind: "type", now: 0 });
  stack = recordUndo(stack, "a", { kind: "type", now: 300 });
  stack = recordUndo(stack, "ab", { kind: "type", now: 600 });
  // A pause starts another.
  stack = recordUndo(stack, "abc", { kind: "type", now: 5000 });
  // Styling is always a step of its own.
  stack = recordUndo(stack, "abcd", { now: 5100 });
  stack = recordUndo(stack, "**abcd**", { kind: "type", now: 5200 });
  const current = "**abcd**!";
  let step = undoStep(stack, current)!;
  assert.equal(step.state, "**abcd**");
  step = undoStep(step.stack, step.state)!;
  assert.equal(step.state, "abcd");
  step = undoStep(step.stack, step.state)!;
  assert.equal(step.state, "abc");
  step = undoStep(step.stack, step.state)!;
  assert.equal(step.state, "");
  assert.equal(undoStep(step.stack, step.state), null);
  assert.equal(canRedo(step.stack), true);
  let again = redoStep(step.stack, step.state)!;
  assert.equal(again.state, "abc");
  again = redoStep(again.stack, again.state)!;
  assert.equal(again.state, "abcd");
  // A new change forgets what was undone.
  const moved = recordUndo(again.stack, again.state, { now: 9000 });
  assert.equal(canRedo(moved), false);
  assert.equal(undoStep(moved, "new")!.state, "abcd");
});

test("Undo keeps a hundred steps at most", () => {
  let stack = emptyUndo<number>();
  for (let n = 0; n < 150; n++) stack = recordUndo(stack, n, { now: n });
  assert.equal(stack.past.length, 100);
  assert.equal(stack.past[0].state, 50);
});

// -------------------------------------------------------- the + button ---

test("the + sheet lists every way to start something", () => {
  assert.deepEqual(
    CREATE_ACTIONS.map((a) => a.label),
    [
      "New task",
      "New page",
      "From template",
      "Scan notes",
      "New project",
      "Plan my day",
      "Start focus",
      "Ask assistant",
    ],
  );
  assert.equal(DEFAULT_ARRANGEMENT.favourite, "task");
  assert.deepEqual(readArrangement(null), DEFAULT_ARRANGEMENT);
  assert.deepEqual(readArrangement("{nope"), DEFAULT_ARRANGEMENT);
});

test("the + sheet can be arranged, and the favourite always shows", () => {
  let a = DEFAULT_ARRANGEMENT;
  a = moveAction(a, "ask", -1);
  assert.deepEqual(a.order.slice(-2), ["ask", "focus"]);
  assert.equal(moveAction(a, "task", -1), a, "the first can't go higher");
  a = toggleHidden(a, "scan");
  assert.equal(shownActions(a).includes("scan"), false);
  assert.equal(toggleHidden(a, "task"), a, "the favourite can't be hidden");
  a = setFavourite(a, "scan");
  assert.equal(a.favourite, "scan");
  assert.equal(shownActions(a).includes("scan"), true, "shown again");
  a = toggleHidden(a, "task");
  // Kept and read back as it was; unknown actions dropped, new ones added.
  assert.deepEqual(readArrangement(JSON.stringify(a)), a);
  const old = readArrangement(
    JSON.stringify({
      order: ["ask", "task", "gone"],
      hidden: ["page", "page", "ask", "gone"],
      favourite: "ask",
    }),
  );
  assert.deepEqual(old.order.slice(0, 2), ["ask", "task"]);
  assert.equal(old.order.length, CREATE_ACTIONS.length);
  assert.deepEqual(old.hidden, ["page"], "the favourite is never hidden");
  assert.equal(readArrangement('{"favourite":"nothing"}').favourite, "task");
});

// ------------------------------------------------ links into the app ---

const ID = "3f0c5d2e-8a4b-4c1d-9e2f-0a1b2c3d4e5f";

test("links into the app open one thing each", () => {
  assert.deepEqual(parseAppLink("orbyn://add"), { kind: "add", text: null });
  assert.deepEqual(parseAppLink("orbyn://add?text=Buy%20milk"), {
    kind: "add",
    text: "Buy milk",
  });
  assert.deepEqual(parseAppLink("orbyn://agenda"), { kind: "agenda" });
  assert.deepEqual(parseAppLink("orbyn://scan"), { kind: "scan" });
  assert.deepEqual(parseAppLink("orbyn://assistant"), { kind: "assistant" });
  assert.deepEqual(parseAppLink("orbyn://overnight"), { kind: "overnight" });
  assert.deepEqual(parseAppLink("https://orbyn.dev/app/overnight"), {
    kind: "overnight",
  });
  assert.deepEqual(parseAppLink("https://orbyn.dev/app/assistant"), {
    kind: "assistant",
  });
  assert.deepEqual(parseAppLink("orbyn://today"), { kind: "today" });
  assert.deepEqual(parseAppLink(`orbyn://doc/${ID.toUpperCase()}`), {
    kind: "doc",
    id: ID,
  });
  assert.deepEqual(parseAppLink(`https://orbyn.dev/app/task/${ID}`), {
    kind: "task",
    id: ID,
  });
  assert.deepEqual(parseAppLink(`https://orbyn.dev/app/project/${ID}/`), {
    kind: "project",
    id: ID,
  });
  assert.deepEqual(parseAppLink("https://orbyn.dev/app/today"), {
    kind: "today",
  });
  assert.deepEqual(
    parseAppLink(
      "orbyn://share?url=https%3A%2F%2Fexample.com%2Fa&text=%20Look%20",
    ),
    { kind: "share", url: "https://example.com/a", text: "Look" },
  );
  assert.deepEqual(
    parseAppLink("https://orbyn.dev/share?text=Hi&url=http%3A%2F%2Fa.io"),
    { kind: "share", url: "http://a.io", text: "Hi" },
  );
  // A share link never carries anything but a web address as its link.
  assert.deepEqual(parseAppLink("orbyn://share?url=javascript:alert(1)"), {
    kind: "share",
    url: null,
    text: null,
  });
});

test("links that aren't ours, or name nothing, open nothing", () => {
  for (const url of [
    null,
    undefined,
    "",
    "not a link",
    "mailto:me@x.io",
    "orbyn://doc/not-an-id",
    `orbyn://doc/${ID}/extra`,
    "orbyn://settings",
    "orbyn://today/now",
    "https://orbyn.dev/app/agenda",
    "https://orbyn.dev/app/scan",
    "https://orbyn.dev/app/doc",
    "orbyn://doc/%E0%A4%A",
  ])
    assert.equal(parseAppLink(url), null, String(url));
});

test("pages, tasks and projects share links the web app opens", () => {
  assert.equal(
    appPath({ kind: "doc", id: ID.toUpperCase() }),
    `/app/doc/${ID}`,
  );
  assert.equal(
    appUrl("https://orbyn.dev/", { kind: "project", id: ID }),
    `https://orbyn.dev/app/project/${ID}`,
  );
  // What the app shares is what the app opens.
  for (const kind of ["doc", "task", "project"] as const)
    assert.deepEqual(
      parseAppLink(appUrl("https://orbyn.dev", { kind, id: ID })),
      {
        kind,
        id: ID,
      },
    );
});

test("the web app opens a shared page, task or project link", () => {
  for (const kind of ["doc", "task", "project"] as const) {
    const path = appPath({ kind, id: ID });
    const want =
      kind === "doc" ? { kind, id: ID, block: null } : { kind, id: ID };
    assert.deepEqual(deepLinkOf(path), want);
    assert.deepEqual(deepLinkOf(`${path}/`), want);
  }
  // A page link can carry the line to bring into view.
  assert.deepEqual(deepLinkOf(appPath({ kind: "doc", id: ID }), "#b12"), {
    kind: "doc",
    id: ID,
    block: "b12",
  });
  for (const path of [
    "/",
    "/app",
    "/app/settings",
    "/app/doc/not-an-id",
    "/terms",
    "/book/x",
    "/application",
    "/app/agenda",
  ])
    assert.equal(deepLinkOf(path), null, path);
  // /app/add opens Quick add to confirm (D2a), with or without words.
  assert.deepEqual(deepLinkOf("/app/add"), { kind: "add", text: "" });
  assert.deepEqual(deepLinkOf("/app/assistant"), { kind: "assistant" });
});

// ------------------------------------------------ app icon quick actions ---

const plugin = createRequire(import.meta.url)(
  "../../mobile/modules/orbyn-quick-actions/app.plugin.js",
) as {
  QUICK_ACTIONS: {
    id: string;
    title: string;
    short: string;
    url: string;
    symbol: string;
  }[];
  iosShortcutItems: (
    existing?: Record<string, unknown>[],
  ) => Record<string, unknown>[];
  androidShortcutsXml: (pkg: string) => string;
  androidStrings: () => { name: string; value: string }[];
};

test("the icon's quick actions are the four, each opening its link", () => {
  assert.deepEqual(
    QUICK_ACTIONS.map((a) => a.title),
    ["New task", "Today’s agenda", "Scan notes", "Ask assistant"],
  );
  assert.deepEqual(
    QUICK_ACTIONS.map((a) => parseAppLink(a.url)?.kind),
    ["add", "agenda", "scan", "assistant"],
  );
  // The config plugin lists exactly the same, in the same order.
  assert.deepEqual(plugin.QUICK_ACTIONS, [...QUICK_ACTIONS]);
});

test("the config plugin writes the iOS and Android quick actions", () => {
  const theirs = { UIApplicationShortcutItemType: "com.other.thing" };
  const items = plugin.iosShortcutItems([
    theirs,
    { UIApplicationShortcutItemType: "orbyn.quick.old" },
  ]);
  assert.deepEqual(items[0], theirs, "another plugin's items are kept");
  assert.equal(items.length, 1 + QUICK_ACTIONS.length, "ours are replaced");
  assert.deepEqual(items[1], {
    UIApplicationShortcutItemType: "orbyn.quick.new-task",
    UIApplicationShortcutItemTitle: "New task",
    UIApplicationShortcutItemIconSymbolName: "square.and.pencil",
    UIApplicationShortcutItemUserInfo: { url: "orbyn://add" },
  });
  const xml = plugin.androidShortcutsXml("com.orbyn.planner");
  for (const a of QUICK_ACTIONS) {
    assert.ok(xml.includes(`android:shortcutId="${a.id}"`), a.id);
    assert.ok(xml.includes(`android:data="${a.url}"`), a.url);
  }
  assert.ok(
    xml.includes('android:targetClass="com.orbyn.planner.MainActivity"'),
  );
  assert.equal((xml.match(/<shortcut\b/g) ?? []).length, 4);
  // Every label the shortcuts point at is written.
  const strings = new Set(plugin.androidStrings().map((s) => s.name));
  for (const ref of xml.match(/@string\/[a-z_]+/g) ?? [])
    assert.ok(strings.has(ref.slice("@string/".length)), ref);
  assert.equal(
    plugin.androidStrings().find((s) => s.name === "orbyn_shortcut_agenda")
      ?.value,
    "Today’s agenda",
  );
});
