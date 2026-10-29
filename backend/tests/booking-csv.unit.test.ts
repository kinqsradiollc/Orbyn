import { test } from "node:test";
import assert from "node:assert/strict";
import { csvCell } from "../src/modules/booking/csv.js";

test("booking CSV neutralizes formulas after leading whitespace or controls", () => {
  for (const prefix of ["=", "+", "-", "@"]) {
    for (const leading of [
      "",
      " ",
      "\t",
      "\r",
      "\n",
      "\0",
      "\u001f",
      "\u0085",
      "\u00a0",
      "\ufeff",
      " \t\r\n",
    ]) {
      const text = `${leading}${prefix}1+1`;
      const escaped = `'${text}`;
      assert.equal(
        csvCell(text),
        /[\n\r]/.test(text) ? `"${escaped}"` : escaped,
      );
    }
  }
  assert.equal(
    csvCell('=HYPERLINK("https://example.invalid","x")'),
    '"\'=HYPERLINK(""https://example.invalid"",""x"")"',
  );
});

test("booking CSV preserves ordinary text and CSV quoting", () => {
  for (const value of [null, undefined, ""]) assert.equal(csvCell(value), "");
  assert.equal(csvCell(42), "42");
  assert.equal(csvCell("Guest name"), "Guest name");
  assert.equal(csvCell(" guest@example.com"), " guest@example.com");
  assert.equal(csvCell("a+b=c"), "a+b=c");
  assert.equal(csvCell("'@already text"), "'@already text");
  assert.equal(csvCell('Guest, "Sam"'), '"Guest, ""Sam"""');
  assert.equal(csvCell("First\nSecond"), '"First\nSecond"');
  assert.equal(csvCell("First\rSecond"), '"First\rSecond"');
});
