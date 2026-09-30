import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAppLink } from "@orbyn/core";
import {
  deepLinkOf,
  deepLinkPath,
  fromAppLink,
} from "../../desktop/src/app/deep-link.js";
const id = "8f34a876-3d45-4c29-8a5a-3192ef9dd221";

test("historical Overnight links preserve identity across web, desktop and phone parsing", () => {
  for (const url of [
    `https://orbyn.dev/app/overnight/${id}`,
    `orbyn://overnight/${id}`,
  ]) {
    const link = parseAppLink(url);
    assert.deepEqual(link, { kind: "overnight", id });
    assert.deepEqual(fromAppLink(link!), { kind: "overnight", id });
  }
  assert.deepEqual(deepLinkOf(`/app/overnight/${id}`), {
    kind: "overnight",
    id,
  });
  assert.equal(deepLinkPath({ kind: "overnight", id }), `/app/overnight/${id}`);
  assert.deepEqual(deepLinkOf("/app/overnight"), { kind: "overnight" });
  assert.equal(deepLinkPath({ kind: "overnight" }), "/app/overnight");
});

test("malformed historical links are rejected rather than silently opening the latest night", () => {
  for (const path of [
    "/app/overnight/not-a-uuid",
    `/app/overnight/${id}/extra`,
  ]) {
    assert.equal(deepLinkOf(path), null);
    assert.equal(parseAppLink(`https://orbyn.dev${path}`), null);
  }
});
