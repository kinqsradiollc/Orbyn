import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAddDeepLink } from "@orbyn/core";

// The deep-link parser is pure, so it's unit-tested here (the mobile app has
// no test runner of its own). The device wiring — handling the incoming URL
// and calling quickAdd — is verified by hand.

test("an add deep link yields the text to capture", () => {
  assert.equal(parseAddDeepLink("orbyn://add?text=Buy%20milk"), "Buy milk");
  assert.equal(
    parseAddDeepLink("orbyn://add?text=Call%20Sam%20tomorrow%203pm"),
    "Call Sam tomorrow 3pm",
  );
  assert.equal(parseAddDeepLink("orbyn://add/?text=Ship"), "Ship");
  assert.equal(
    parseAddDeepLink("https://app.example.com/add?text=Ship"),
    "Ship",
  );
});

test("non-add or empty links are ignored", () => {
  assert.equal(parseAddDeepLink(null), null);
  assert.equal(parseAddDeepLink(undefined), null);
  assert.equal(parseAddDeepLink("orbyn://open?text=x"), null);
  assert.equal(parseAddDeepLink("orbyn://add"), null);
  assert.equal(parseAddDeepLink("orbyn://add?text=%20%20"), null);
  assert.equal(parseAddDeepLink("not a url"), null);
  assert.equal(parseAddDeepLink("https://example.com/tasks?text=x"), null);
});
