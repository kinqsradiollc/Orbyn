import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CONCEPT_ICONS,
  TYPE_SCALE,
  initialsOf,
  snapToTypeScale,
  typeScale,
} from "@orbyn/core";

/**
 * The neatness pass ("Tidy only"): one type scale for both apps, one icon
 * per idea, calm empty states, one-sentence intros, quiet editor handles and
 * a readable page column. The apps have no test runner of their own, so
 * their sources are checked here, as ratchets: new code that drifts off the
 * scale or grows a second paragraph fails.
 */

const root = fileURLToPath(new URL("../../", import.meta.url));
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

function walk(dir: string, ext: RegExp): string[] {
  const out: string[] = [];
  for (const name of readdirSync(join(root, dir))) {
    const rel = `${dir}/${name}`;
    if (statSync(join(root, rel)).isDirectory()) out.push(...walk(rel, ext));
    else if (ext.test(name)) out.push(rel);
  }
  return out;
}

const lineOf = (text: string, index: number) =>
  text.slice(0, index).split("\n").length;

// ---------------------------------------------------------- type scale ---

test("the type scale is six sizes, nothing under 11, ties round up", () => {
  assert.deepEqual([...TYPE_SCALE], [11, 13, 15, 18, 24, 36]);
  assert.deepEqual(Object.values(typeScale), [...TYPE_SCALE]);
  assert.equal(snapToTypeScale(8), 11);
  assert.equal(snapToTypeScale(12), 13);
  assert.equal(snapToTypeScale(14), 15);
  assert.equal(snapToTypeScale(16), 15);
  assert.equal(snapToTypeScale(17), 18);
  assert.equal(snapToTypeScale(21), 24);
  assert.equal(snapToTypeScale(30), 36);
  assert.equal(snapToTypeScale(76), 36);
});

const ON_SCALE = new Set(TYPE_SCALE.map((n) => `${n}px`));
/** Sizes that aren't a number: the shared field sizes and inheritance. */
const FIELD_SIZES = new Set([
  "var(--control-fs)",
  "var(--control-fs-sm)",
  "max(15px, var(--control-fs))",
  "inherit",
  "0",
]);

test("every font size in the web's styles is on the scale", () => {
  const off: string[] = [];
  for (const file of walk("desktop/src", /\.css$/)) {
    const css = read(file);
    for (const m of css.matchAll(/font-size:\s*([^;]+);/g)) {
      const value = m[1].replace(/\s*!important$/, "").trim();
      if (!ON_SCALE.has(value) && !FIELD_SIZES.has(value))
        off.push(`${file}:${lineOf(css, m.index!)} ${value}`);
    }
    // The shorthand: `font: 600 11px "DM Sans", sans-serif`.
    for (const m of css.matchAll(
      /\bfont:\s*(?:\d{3}\s+)?([\d.]+(?:px|rem|em))\s/g,
    ))
      if (!ON_SCALE.has(m[1]))
        off.push(`${file}:${lineOf(css, m.index!)} font ${m[1]}`);
    for (const m of css.matchAll(/--control-fs(?:-sm)?:\s*([^;]+);/g))
      if (!ON_SCALE.has(m[1].trim()))
        off.push(`${file}:${lineOf(css, m.index!)} ${m[0]}`);
  }
  assert.deepEqual(off, []);
});

test("every fontSize in the phone app is on the scale", () => {
  // Maths is typeset relative to the line it sits in, and the logo is a
  // drawing; everything else takes a size from the scale.
  const exempt = new Set([
    "mobile/src/screens/docs/MathView.tsx",
    "mobile/src/components/Brand.tsx",
  ]);
  const off: string[] = [];
  for (const file of walk("mobile/src", /\.tsx?$/)) {
    if (exempt.has(file)) continue;
    const src = read(file);
    for (const m of src.matchAll(/fontSize(?::\s*|=\{)([^,}\n]+)/g)) {
      const value = m[1].trim();
      if (!(TYPE_SCALE as readonly number[]).includes(Number(value)))
        off.push(`${file}:${lineOf(src, m.index!)} ${value}`);
    }
  }
  assert.deepEqual(off, []);
});

// ------------------------------------------------------ one icon each ---

const pascal = (id: string) =>
  id.replace(/(^|-)([a-z])/g, (_m, _d, c: string) => c.toUpperCase());

test("each idea has one icon, the same on web and phone", () => {
  assert.deepEqual(Object.keys(CONCEPT_ICONS).sort(), [
    "agenda",
    "event",
    "page",
    "project",
    "study",
    "task",
  ]);
  const web = read("desktop/src/app/concept-icons.ts");
  const phone = read("mobile/src/components/Icon.tsx");
  // The phone's copy of lucide keeps calendar-days under "calendar".
  const phoneName = (id: string) =>
    id === "calendar-days"
      ? "calendar"
      : pascal(id).replace(/^./, (c) => c.toLowerCase());
  for (const [concept, id] of Object.entries(CONCEPT_ICONS)) {
    assert.match(web, new RegExp(`\\b${concept}: ${pascal(id)},`), concept);
    assert.match(
      phone,
      new RegExp(`\\b${concept}: "${phoneName(id)}",`),
      `phone ${concept}`,
    );
    assert.match(phone, new RegExp(`\\n  ${phoneName(id)}: \\[`), id);
  }
  // The nav on both apps draws the ideas from the one map.
  const nav = read("desktop/src/app/views.ts");
  for (const [label, concept] of [
    ["Agenda", "agenda"],
    ["My tasks", "task"],
    ["Calendar", "event"],
    ["Projects", "project"],
    ["Docs", "page"],
    ["Study", "study"],
  ])
    assert.match(
      nav,
      new RegExp(`label: "${label}", icon: CONCEPT_ICON\\.${concept}`),
    );
  const browse = read("mobile/src/screens/BrowseScreen.tsx");
  for (const [title, concept] of [
    ["Projects", "project"],
    ["Docs", "page"],
    ["Study", "study"],
    ["Agenda", "agenda"],
  ])
    assert.match(
      browse,
      new RegExp(`icon: CONCEPT_ICON\\.${concept},\\s+title: "${title}"`),
    );
  // Link pills, ⌘K and Search & do name a page, task, event and project
  // through the map too.
  for (const file of [
    "desktop/src/features/docs/DocLinks.tsx",
    "desktop/src/components/CommandBar.tsx",
    "mobile/src/screens/docs/links.tsx",
    "mobile/src/screens/SearchSheet.tsx",
  ])
    for (const concept of ["page", "task", "event", "project"])
      assert.match(read(file), new RegExp(`CONCEPT_ICON\\.${concept}`), file);
});

test("initials for a member list", () => {
  assert.equal(initialsOf("Ada Lovelace"), "AL");
  assert.equal(initialsOf("  grace  brewster murray "), "GB");
  assert.equal(initialsOf("cher"), "C");
  assert.equal(initialsOf(""), "?");
  assert.equal(initialsOf(null), "?");
});

// ------------------------------------------- one sentence, calm empties ---

const sentences = (text: string) => (text.match(/[.!?](\s|$)/g) ?? []).length;

const plain = (jsx: string) =>
  jsx
    .replace(/<[^>]+>|\{[^}]*\}/g, "")
    .replace(/&apos;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

test("empty states say one sentence", () => {
  const long: string[] = [];
  for (const file of walk("desktop/src", /\.tsx$/)) {
    const src = read(file);
    for (const m of src.matchAll(/<EmptyState[\s\S]*?body="([^"]+)"/g))
      if (sentences(m[1]) > 1)
        long.push(`${file}:${lineOf(src, m.index!)} ${m[1]}`);
  }
  for (const file of walk("mobile/src", /\.tsx$/)) {
    const src = read(file);
    for (const m of src.matchAll(/<EmptyState[\s\S]*?body="([^"]+)"/g))
      if (sentences(m[1]) > 1)
        long.push(`${file}:${lineOf(src, m.index!)} ${m[1]}`);
  }
  assert.deepEqual(long, []);
  // The phone's empty state takes at most two buttons, by its type.
  assert.match(
    read("mobile/src/components/EmptyState.tsx"),
    /actions\?: \[\] \| \[Action\] \| \[Action, Action\];/,
  );
});

test("each settings card opens with a bold lead-in and one sentence", () => {
  const long: string[] = [];
  for (const file of walk("desktop/src/features/settings", /\.tsx$/)) {
    const src = read(file);
    if (!src.includes("SettingsSection")) continue;
    for (const m of src.matchAll(/<\/h2>\s*<p[^>]*>([\s\S]*?)<\/p>/g))
      if (sentences(plain(m[1])) > 1)
        long.push(`${file}:${lineOf(src, m.index!)} ${plain(m[1])}`);
  }
  assert.deepEqual(long, []);
});

// ------------------------------------------------------------- editor ---

test("the page editor keeps handles out of sight and lines readable", () => {
  const css = read("desktop/src/features/docs/docs.css");
  const rule = (selector: string) => {
    const at = css.indexOf(`\n${selector} {`);
    assert.ok(at >= 0, selector);
    return css.slice(at, css.indexOf("}", at));
  };
  // Handles show only on the line you're on or pointing at.
  assert.match(rule(".doc-handle"), /opacity: 0;/);
  assert.match(
    css,
    /\.doc-block-row:hover \.doc-handle,\n\.doc-handle:focus-visible,\n\.doc-block-row:focus-within \.doc-handle \{\n {2}opacity: 1;/,
  );
  // Text is capped at about 680px.
  assert.match(rule(".doc-body"), /max-width: 680px;/);
});

// -------------------------------------------------------------- toast ---

test("Undo lives in the one toast, not in bars of its own", () => {
  const calendar = read("desktop/src/features/calendar/CalendarView.tsx");
  assert.doesNotMatch(calendar, /undo\?: \(\) => void/);
  assert.match(calendar, /label: "Undo",/);
  // One toast region on the web, one toast host on the phone.
  const regions = walk("desktop/src", /\.tsx$/).filter((f) =>
    read(f).includes('className="toast-region"'),
  );
  assert.deepEqual(regions, ["desktop/src/components/Toast.tsx"]);
});
