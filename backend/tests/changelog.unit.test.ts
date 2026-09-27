import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CHANGELOG,
  CHANGELOG_HEADINGS,
  CHANGELOG_SECTIONS,
  defineRelease,
  hasUnseenRelease,
  latestRelease,
  releaseCounts,
  releaseDate,
  releasesSince,
} from "@orbyn/core";

/**
 * What's new: one file per release in packages/core/src/changelog, listed
 * newest first by its index. These checks keep the folder and the list in
 * step, so a new file can't be forgotten and an old one can't be lost.
 */

const folder = fileURLToPath(
  new URL("../../packages/core/src/changelog/", import.meta.url),
);
const releaseFiles = readdirSync(folder)
  .filter((f) => /^\d{4}-\d{2}-\d{2}-[a-z0-9-]+\.ts$/.test(f))
  .map((f) => f.replace(/\.ts$/, ""));

test("every release file in the folder is in the index, and nothing else", () => {
  assert.ok(releaseFiles.length >= 10, "release files found");
  // Anything else in the folder is the shared shape, the index or the README.
  const others = readdirSync(folder).filter(
    (f) => !releaseFiles.includes(f.replace(/\.ts$/, "")),
  );
  assert.deepEqual(others.sort(), ["README.md", "index.ts", "release.ts"]);
  assert.deepEqual(CHANGELOG.map((r) => r.id).sort(), [...releaseFiles].sort());
  const index = readFileSync(join(folder, "index.ts"), "utf8");
  for (const id of releaseFiles)
    assert.match(index, new RegExp(`from "\\./${id}\\.js";`), id);
});

test("each release has a unique id matching its date and a real date", () => {
  const ids = new Set<string>();
  for (const r of CHANGELOG) {
    assert.ok(!ids.has(r.id), `duplicate id ${r.id}`);
    ids.add(r.id);
    assert.match(r.date, /^\d{4}-\d{2}-\d{2}$/, r.id);
    const day = new Date(`${r.date}T00:00:00Z`);
    assert.ok(!Number.isNaN(day.getTime()), `${r.id} date`);
    assert.equal(day.toISOString().slice(0, 10), r.date, `${r.id} real day`);
    assert.ok(r.id.startsWith(`${r.date}-`), `${r.id} starts with its date`);
  }
});

test("each release says something, in plain words", () => {
  for (const r of CHANGELOG) {
    assert.ok(r.title.trim(), `${r.id} title`);
    assert.ok(r.summary.trim(), `${r.id} summary`);
    assert.ok(releaseCounts(r).total >= 1, `${r.id} has no items`);
    for (const key of CHANGELOG_SECTIONS) {
      assert.deepEqual(r[key], r.sections[key], `${r.id} ${key}`);
      for (const line of r[key]) {
        assert.ok(line.trim().length > 3, `${r.id} empty item`);
        // No track codes, pull request numbers or file names in user copy.
        assert.doesNotMatch(line, /\b[PDAHN]\d[a-z]?\b|#\d+|\.tsx?\b/, line);
        assert.doesNotMatch(line, /self-hosted|bring your own/i, line);
      }
      assert.equal(new Set(r[key]).size, r[key].length, `${r.id} repeats`);
    }
  }
});

test("releases run newest first, and the newest is the latest", () => {
  for (let i = 1; i < CHANGELOG.length; i++)
    assert.ok(CHANGELOG[i - 1].date >= CHANGELOG[i].date, CHANGELOG[i].id);
  assert.equal(latestRelease(), CHANGELOG[0]);
});

test("What's new opens only for releases newer than the last one seen", () => {
  const newest = latestRelease().date;
  assert.equal(hasUnseenRelease(null), false);
  assert.equal(hasUnseenRelease(newest), false);
  assert.equal(hasUnseenRelease("2000-01-01"), true);
  // The sheet shows what is new since then, or the newest release alone.
  assert.deepEqual(releasesSince(newest), [CHANGELOG[0]]);
  assert.deepEqual(releasesSince(null), [CHANGELOG[0]]);
  const older = CHANGELOG.find((r) => r.date < newest)!;
  const since = releasesSince(older.date);
  assert.ok(since.length >= 1);
  assert.ok(since.every((r) => r.date > older.date));
});

test("a release file's notes fill in every heading", () => {
  const r = defineRelease({
    id: "2026-01-02-test",
    date: "2026-01-02",
    title: "Test",
    summary: "A test.",
    sections: { fixed: ["A thing works."] },
  });
  assert.deepEqual(r.new, []);
  assert.deepEqual(r.better, []);
  assert.deepEqual(r.fixed, ["A thing works."]);
  assert.deepEqual(releaseCounts(r), { new: 0, better: 0, fixed: 1, total: 1 });
  assert.equal(releaseDate(r), "2 January 2026");
  assert.deepEqual(CHANGELOG_HEADINGS, {
    new: "New",
    better: "Better",
    fixed: "No longer broken",
  });
});
