import { test } from "node:test";
import assert from "node:assert/strict";

/**
 * Cleaning what outside agents read (capabilities/format.ts), on its own:
 * ordinary text is never cut into, and no text, however it's built, makes
 * cleaning slow. The image and tag cases that could leak data are in
 * mcp-matrix.test.ts.
 */

const { clean, cleanTitle, fence, labelled, maskEmails, titleFor } =
  await import("../src/capabilities/format.js");

test("text that looks like a link definition is ordinary text, and stays", () => {
  for (const title of [
    "[PROJ-123]: fix login",
    "[URGENT]: call the bank",
    "[x]: https://example.com",
  ])
    assert.equal(cleanTitle(title), title);
  for (const text of [
    "Agenda:\n- [Budget]: approve Q4 numbers\n- [Hiring]: two offers out",
    "1. [Setup]: install node\n2) [Test]: run it",
    "> [Note]: read this first\n> [Later]: tidy up",
    '[1]: https://example.com/paper.pdf "The paper"\n\nSee [the paper][1].',
    "* [a]:\n  b",
  ])
    assert.equal(clean(text), text);
  // A definition beside an image that loads from elsewhere stays too: the
  // image is its description now, so nothing can load from it.
  assert.equal(
    clean("See ![chart][c].\n\n[c]: https://evil.example/c.png"),
    "See [image: chart].\n\n[c]: https://evil.example/c.png",
  );
});

test("titles of tasks sent by email are left out when outside content is hidden", () => {
  assert.equal(
    titleFor("Invoice from Acme", "inbound_email", true),
    "Task from email",
  );
  assert.equal(
    titleFor("Invoice from Acme", "inbound_email", false),
    "Invoice from Acme",
  );
  assert.equal(titleFor("Chat with Gus", "booking_guest", true), "Booking");
  assert.equal(titleFor("Imported notes", "import", true), "Imported notes");
});

test("email addresses are hidden wherever they are, and nothing else is", () => {
  assert.equal(
    maskEmails("Write to gus@guest.example or a.b+c@x.co.uk today"),
    "Write to [email hidden] or [email hidden] today",
  );
  // A match that ends inside a word leaves the rest to be read again.
  assert.equal(
    maskEmails("a@b.cc1x@d.ee and @@ and x@y and me@"),
    "[email hidden][email hidden] and @@ and x@y and me@",
  );
  assert.equal(maskEmails("no addresses here"), "no addresses here");
});

/** Text of `length` characters made by repeating `unit`. */
const built = (unit: string, length: number) =>
  unit.repeat(Math.ceil(length / unit.length)).slice(0, length);

/** How long `fn(text)` takes, in milliseconds (the faster of two runs). */
function timed(fn: (text: string) => unknown, text: string): number {
  let best = Infinity;
  for (let run = 0; run < 2; run++) {
    const started = performance.now();
    fn(text);
    best = Math.min(best, performance.now() - started);
  }
  return best;
}

test("cleaning stays linear on 100,000 characters built to slow it down", () => {
  // Each once took seconds: every image, tag or address looked to the end
  // of the text again (`![a](` by the thousand took 1.1 s at 25,000).
  const units = [
    "![a](",
    "![a][",
    "![",
    "![[",
    "![a](<",
    '![a](x "',
    "![a](x (",
    "![a](x",
    "![a](((",
    "![a](![b](",
    "- [\n",
    "- [a]:\n",
    "[a]: ",
    "> [",
    "<script",
    "<svg",
    "<img",
    "<img src=",
    "<<img",
    '<p style="display:none">',
    "<p style='",
    '<div style="font-size:0"',
    '<span style="display:none">x',
    '<a b="',
    "<a ",
    "<",
    "<!--",
    "<!-",
    "a",
    "a@",
    "a.",
    "\\![",
  ];
  const cleaners: [string, (text: string) => unknown][] = [
    ["clean", (t) => clean(t)],
    ["cleanTitle", (t) => cleanTitle(t)],
    ["fence", (t) => fence(t, "import")],
    ["booking text", (t) => labelled(t, "booking_guest")],
  ];
  // Warm up, so the first measurement isn't the compiler's.
  for (const [, fn] of cleaners) fn(built("![a](<p style='x'>", 2_000));
  const extra = [
    `<${" ".repeat(100_000)}`,
    `${"\\".repeat(50_000)}${"!![a](x)".repeat(6_250)}`,
    `<span ${'style="a" '.repeat(10_000)}>x</span>`,
    `${'<div style="display:none">'.repeat(3_800)}</div>`,
  ];
  const slow: string[] = [];
  for (const [name, fn] of cleaners)
    for (const text of [...units.map((u) => built(u, 100_000)), ...extra]) {
      const long = timed(fn, text);
      const quarter = timed(fn, text.slice(0, 25_000));
      // Linear: 4 times the text takes about 4 times as long (quadratic
      // would be 16), and well under a second either way.
      if (long > 400 || long > 10 * quarter + 60)
        slow.push(
          `${name} on ${JSON.stringify(text.slice(0, 12))}…: ${long.toFixed(0)} ms (${quarter.toFixed(0)} ms for a quarter)`,
        );
    }
  assert.deepEqual(slow, []);
});
