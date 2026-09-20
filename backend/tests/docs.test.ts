import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
// Connects only to a verified test database (see setup.ts).
import "./setup.js";

const { buildApp } = await import("../src/app.js");
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { parseDoc, serializeDoc, docPreview, parseDocInline } =
  await import("@orbyn/core");

const app = await buildApp();
let token = "";
let otherToken = "";

const call = (
  method: "GET" | "POST" | "PUT" | "DELETE",
  url: string,
  payload?: unknown,
  as = () => token,
) =>
  app.inject({
    method,
    url,
    headers: { authorization: `Bearer ${as()}` },
    ...(payload === undefined ? {} : { payload: payload as object }),
  });

const register = async (name: string) =>
  (
    await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: {
        email: `docs-${randomUUID()}@example.com`,
        password: "a-long-test-password",
        name,
      },
    })
  ).json().token as string;

before(async () => {
  await migrate();
  token = await register("Writer");
  otherToken = await register("Stranger");
});
after(async () => {
  await app.close();
  await pool.end();
});

test("Markdown round-trips through blocks, LaTeX included", () => {
  const source = [
    "# Convergence notes",
    "",
    "The key inequality is",
    "",
    "$$",
    "\\|x_{k+1}-x^*\\| \\le (1-\\eta\\mu)\\|x_k-x^*\\|",
    "$$",
    "",
    "- [x] Re-derive the bound",
    "- [ ] Add the plot",
    "> Keep the fixed step size.",
    "```ts",
    "const step = 0.1;",
    "```",
    "---",
  ].join("\n");

  const blocks = parseDoc(source);
  const kinds = blocks.map((b) => b.type);
  assert.deepEqual(kinds, [
    "heading",
    "paragraph",
    "math",
    "todo",
    "todo",
    "quote",
    "code",
    "divider",
  ]);

  const math = blocks[2];
  assert.equal(math.type, "math");
  // The LaTeX is kept verbatim, without the $$ fences.
  assert.match(math.type === "math" ? math.text : "", /\\le \(1-\\eta\\mu\)/);
  assert.equal(blocks[3].type === "todo" && blocks[3].done, true);
  assert.equal(blocks[4].type === "todo" && blocks[4].done, false);
  assert.equal(blocks[6].type === "code" && blocks[6].lang, "ts");

  // Serializing and re-parsing gives the same structure back.
  const again = parseDoc(serializeDoc(blocks));
  assert.deepEqual(again, blocks);
});

test("inline runs split maths, code, links and emphasis", () => {
  const runs = parseDocInline(
    "With $\\eta < 1/\\mu$ and `code` see [docs](https://x.test) and **bold**",
  );
  const math = runs.find((r) => r.math);
  assert.equal(math?.text, "\\eta < 1/\\mu");
  assert.ok(runs.some((r) => r.code && r.text === "code"));
  assert.ok(runs.some((r) => r.link === "https://x.test"));
  assert.ok(runs.some((r) => r.bold && r.text === "bold"));
  // A stray dollar is left as typed rather than eating the line.
  assert.equal(parseDocInline("costs $5 today")[0].text, "costs $5 today");
});

test("a preview is the plain text, shortened", () => {
  assert.equal(
    docPreview(parseDoc("# Title\n\nSome body text here.")),
    "Title Some body text here.",
  );
  assert.ok(docPreview(parseDoc("x".repeat(400)), 40).endsWith("…"));
});

test("create, read, edit and list a document", async () => {
  const created = await call("POST", "/docs", {
    title: "Convergence notes",
    content: parseDoc("# Setup\n\n$$\nE = mc^2\n$$"),
  });
  assert.equal(created.statusCode, 201, created.body);
  const doc = created.json();
  assert.equal(doc.title, "Convergence notes");
  assert.equal(doc.version, 1);
  assert.equal(doc.content[1].type, "math");

  const read = await call("GET", `/docs/${doc.id}`);
  assert.equal(read.statusCode, 200);
  assert.equal(read.json().content[1].text, "E = mc^2");

  const edited = await call("PUT", `/docs/${doc.id}`, {
    title: "Convergence notes v2",
    content: parseDoc("# Setup\n\nNow with words."),
    version: 1,
  });
  assert.equal(edited.statusCode, 200, edited.body);
  assert.equal(edited.json().version, 2);
  assert.equal(edited.json().title, "Convergence notes v2");

  const list = await call("GET", "/docs");
  assert.equal(list.statusCode, 200);
  const mine = list.json().find((d: { id: string }) => d.id === doc.id);
  assert.equal(mine.preview, "Setup Now with words.");
  assert.equal(mine.content, undefined, "the list stays light");
});

test("a stale edit is refused instead of overwriting", async () => {
  const doc = (
    await call("POST", "/docs", { title: "Race", content: [] })
  ).json();
  const first = await call("PUT", `/docs/${doc.id}`, {
    title: "First wins",
    version: 1,
  });
  assert.equal(first.statusCode, 200);
  const stale = await call("PUT", `/docs/${doc.id}`, {
    title: "Second loses",
    version: 1,
  });
  assert.equal(stale.statusCode, 409, stale.body);
  assert.equal(
    (await call("GET", `/docs/${doc.id}`)).json().title,
    "First wins",
  );
});

test("someone else's document is not found, and cannot be edited", async () => {
  const doc = (await call("POST", "/docs", { title: "Private" })).json();
  const get = await call("GET", `/docs/${doc.id}`, undefined, () => otherToken);
  assert.equal(get.statusCode, 404);
  const put = await call(
    "PUT",
    `/docs/${doc.id}`,
    { title: "Hijack", version: 1 },
    () => otherToken,
  );
  assert.equal(put.statusCode, 404);
  const theirList = await call("GET", "/docs", undefined, () => otherToken);
  assert.ok(!theirList.json().some((d: { id: string }) => d.id === doc.id));
});

test("Markdown export keeps the LaTeX", async () => {
  const doc = (
    await call("POST", "/docs", {
      title: "Export me",
      content: parseDoc("$$\n\\int_0^1 x^2 dx\n$$"),
    })
  ).json();
  const md = await call("GET", `/docs/${doc.id}/markdown`);
  assert.equal(md.statusCode, 200);
  assert.match(md.headers["content-type"] as string, /text\/markdown/);
  assert.match(md.body, /# Export me/);
  assert.match(md.body, /\\int_0\^1 x\^2 dx/);
});

test("a document is deleted", async () => {
  const doc = (await call("POST", "/docs", { title: "Temp" })).json();
  assert.equal((await call("DELETE", `/docs/${doc.id}`)).statusCode, 204);
  assert.equal((await call("GET", `/docs/${doc.id}`)).statusCode, 404);
});
