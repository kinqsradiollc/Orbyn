import { test } from "node:test";
import assert from "node:assert/strict";
import { HttpError } from "@orbyn/core";
import { asCapabilityError } from "../src/capabilities/execute.js";
import { CapabilityError } from "../src/capabilities/registry.js";

test("a 409 from a version-checked write becomes VERSION_CONFLICT with a fix", () => {
  const e = asCapabilityError(
    new HttpError(409, "This task changed since you read it."),
  );
  assert.equal(e.code, "VERSION_CONFLICT");
  assert.match(e.fix ?? "", /current version/);
});

test("404, 403 and other 4xx keep their codes", () => {
  assert.equal(asCapabilityError(new HttpError(404, "x")).code, "NOT_FOUND");
  assert.equal(asCapabilityError(new HttpError(403, "x")).code, "FORBIDDEN");
  assert.equal(asCapabilityError(new HttpError(400, "x")).code, "INVALID");
});

test("a STALE capability error passes through unchanged", () => {
  const stale = new CapabilityError("STALE", "The plan is out of date.");
  assert.equal(asCapabilityError(stale), stale);
});
