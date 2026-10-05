import { test } from "node:test";
import assert from "node:assert/strict";
import {
  objectRefsIn,
  redactLine,
  keepLinkLabels,
  hiddenLinkLabels,
  webLinks,
  parseDocInline,
} from "@orbyn/core";
const id = "12345678-1234-1234-1234-123456789abc";
const href = `orbyn://doc/${id}`;

for (const title of [
  '"Private hint"',
  "'Private hint'",
  "(Private hint)",
  '"Private \\"quote\\" hint"',
]) {
  test(`private inline link ${title} collects its target and redacts label and hint`, () => {
    const source = `Before [**Secret** and \\] text](<${href}> ${title}) after`;
    assert.deepEqual(objectRefsIn(source), [{ kind: "doc", id }]);
    const result = redactLine(source, () => true);
    assert.equal(result.text, `Before [Private page](${href}) after`);
    assert.ok(!result.text.includes("Secret") && !result.text.includes("hint"));
    const at = source.indexOf("after");
    assert.equal(result.toShown(at), result.text.indexOf("after"));
    assert.equal(result.toStored(result.text.indexOf("after")), at);
    assert.equal(redactLine(source, () => false).text, source);
  });
}

test("case-insensitive object schemes cannot bypass privacy collection/redaction", () => {
  const source = `[Secret](OrByN://DOC/${id} "Hint")`;
  assert.deepEqual(objectRefsIn(source), [{ kind: "doc", id }]);
  assert.equal(
    redactLine(source, () => true).text,
    `[Private page](OrByN://DOC/${id})`,
  );
});

test("literal code, math, escaped markers and unsupported object targets never become actionable object matches", () => {
  for (const source of [
    `\`[Secret](${href} "Hint")\``,
    `$[Secret](${href} "Hint")$`,
    `\\[Secret](${href} "Hint")`,
    `[Secret](orbyn://unknown/${id} "Hint")`,
  ]) {
    assert.deepEqual(objectRefsIn(source), []);
    assert.equal(redactLine(source, () => true).text, source);
    assert.equal(webLinks(source, "https://orbyn.test"), source);
  }
});

test("private quote redaction knows formatted label words and authored title hints", () => {
  const source = `[**Secret**](${href} "Private hint")`;
  const labels = hiddenLinkLabels(source, () => true);
  assert.equal(labels.get("Secret"), "Private page");
  assert.equal(labels.get("**Secret**"), "Private page");
  assert.equal(labels.get("Private hint"), "Private page");
});

test("saving neutral words preserves the hidden source label and authored hint while authorized edits remain editable", () => {
  const source = `[**Secret**](${href} "Private hint")`;
  const neutral = redactLine(source, () => true).text;
  assert.equal(
    keepLinkLabels(neutral, source, () => true),
    source,
  );
  assert.equal(
    keepLinkLabels(neutral, source, () => false),
    neutral,
  );
  const edited = `[Changed](${href} "New title")`;
  assert.equal(
    keepLinkLabels(edited, source, () => false),
    edited,
  );
});

test("export converts titled/formatted object links and preserves decoded title semantics", () => {
  const source = `[**Guide**](${href} 'A "quote" & hint')`;
  const output = webLinks(source, "https://orbyn.test/");
  const runs = parseDocInline(output);
  assert.equal(runs[0].link, `https://orbyn.test/app/doc/${id}`);
  assert.equal(runs[0].linkTitle, 'A "quote" & hint');
  assert.equal(runs[0].bold, true);
  assert.ok(!output.includes("orbyn://"));
});
