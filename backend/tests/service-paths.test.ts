import { test } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * One code path per job (A1-late): the logic the routes, the assistant and
 * agents share lives in services, never in a route handler another module
 * reaches into. These checks read the code, so a new copy fails CI.
 */

const root = new URL("../src/", import.meta.url).pathname;

async function sources(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await sources(path)));
    else if (e.name.endsWith(".ts")) out.push(path);
  }
  return out;
}
const files = await Promise.all(
  (await sources(root)).map(async (file) => ({
    rel: file.slice(root.length),
    text: await readFile(file, "utf8"),
  })),
);

test("nothing imports from another module's routes: shared logic is a service", () => {
  const reaching = files.flatMap(({ rel, text }) =>
    [...text.matchAll(/from "(\.\.?\/[^"]*routes\.js)"/g)]
      .map((m) => m[1])
      // A module's own routes may be split over files that import each other.
      .filter((path) => !path.startsWith("./"))
      .map((path) => `${rel} imports ${path}`),
  );
  // The app assembles every module's routes; that is what routes are for.
  assert.deepEqual(
    reaching.filter((r) => !r.startsWith("app.ts ")),
    [],
    "Move what's shared into the module's service.ts and import that.",
  );
});

test("each shared write has one home", () => {
  const homes: [RegExp, string[]][] = [
    // A proposed change to a page: people, the assistant's rewrite and its tool.
    [/INSERT INTO doc_suggestions/, ["modules/docs/service.ts"]],
    // Moving or removing one session by hand, or through a reviewed change.
    [
      /UPDATE time_blocks SET start_at = \$2, end_at = \$3, source = 'manual'/,
      ["modules/planner/blocks.ts"],
    ],
    [
      /DELETE FROM time_blocks WHERE id = \$1 AND user_id = \$2/,
      ["modules/planner/blocks.ts"],
    ],
    // Study cards: written when pages change, never when Study is read.
    [/INSERT INTO study_cards/, ["modules/study/service.ts"]],
  ];
  for (const [write, allowed] of homes) {
    const found = files
      .filter(({ text }) => write.test(text))
      .map(({ rel }) => rel)
      .sort();
    assert.deepEqual(found, allowed, `${write}`);
  }
});

test("the search service is the one place pages are searched and ranked", () => {
  // The search ranking (words, lifted for recent changes, plus a title
  // that looks right) is written once; find_passages ranks lines its own way.
  const ranks = files
    .filter(({ text }) =>
      /\* \(1 \+ 0\.5 \* exp\(-\(extract\(epoch FROM now\(\)/.test(text),
    )
    .map(({ rel }) => rel);
  assert.deepEqual(ranks, ["modules/search/rank.ts"]);
  const pageSearch = files
    .filter(({ text }) => /export async function searchPages\(/.test(text))
    .map(({ rel }) => rel);
  assert.deepEqual(pageSearch, ["modules/search/service.ts"]);
});
