import { test } from "node:test";
import assert from "node:assert/strict";
import {
  decodeSnapshot,
  encodeSnapshot,
  SNAPSHOT_MAX_AGE_MS,
  SNAPSHOT_VERSION,
  type PlannerSnapshot,
} from "@orbyn/core";

// The offline snapshot codec is pure, so it's unit-tested here in the backend
// runner (the mobile app has no test runner of its own). The device wiring —
// AsyncStorage reads/writes, hydrating the UI — is verified by hand.

const sample = (): PlannerSnapshot => ({
  items: [{ id: "i1", title: "Write report" } as never],
  user: { id: "u1", email: "a@b.c" } as never,
  notices: [],
  teams: [],
  lists: [],
  tags: [],
});

test("a snapshot round-trips through encode/decode", () => {
  const raw = encodeSnapshot(sample(), 1_000);
  const back = decodeSnapshot(raw, { now: 2_000 });
  assert.ok(back);
  assert.equal(back!.items.length, 1);
  assert.equal(back!.items[0].title, "Write report");
  assert.equal(back!.user?.email, "a@b.c");
});

test("missing, empty or corrupt data decodes to null (never throws)", () => {
  assert.equal(decodeSnapshot(null), null);
  assert.equal(decodeSnapshot(""), null);
  assert.equal(decodeSnapshot("not json"), null);
  assert.equal(decodeSnapshot("42"), null);
  assert.equal(decodeSnapshot("{}"), null);
});

test("a snapshot from another app version is ignored", () => {
  const raw = JSON.stringify({
    v: SNAPSHOT_VERSION + 1,
    savedAt: Date.now(),
    data: sample(),
  });
  assert.equal(decodeSnapshot(raw), null);
});

test("a snapshot past its max age is ignored", () => {
  const raw = encodeSnapshot(sample(), 0);
  assert.equal(decodeSnapshot(raw, { now: SNAPSHOT_MAX_AGE_MS + 1 }), null);
  // Just inside the window is still good.
  assert.ok(decodeSnapshot(raw, { now: SNAPSHOT_MAX_AGE_MS - 1 }));
});

test("a snapshot missing a collection is rejected", () => {
  const raw = JSON.stringify({
    v: SNAPSHOT_VERSION,
    savedAt: Date.now(),
    data: { items: [], user: null, notices: [], teams: [], lists: [] }, // no tags
  });
  assert.equal(decodeSnapshot(raw), null);
});

test("decoding keeps only the known collections", () => {
  const raw = JSON.stringify({
    v: SNAPSHOT_VERSION,
    savedAt: Date.now(),
    data: { ...sample(), secret: "leak" },
  });
  const back = decodeSnapshot(raw)!;
  assert.ok(back);
  assert.equal((back as Record<string, unknown>).secret, undefined);
});
