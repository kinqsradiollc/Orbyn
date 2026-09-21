import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
// Connects only to a verified test database (see setup.ts).
import "./setup.js";

const { buildApp } = await import("../src/app.js");
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const {
  parseDoc,
  serializeDoc,
  docPreview,
  parseDocInline,
  mathToText,
  mergeDocs,
} = await import("@orbyn/core");

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
  const { closeLive } = await import("../src/modules/docs/live.js");
  await closeLive();
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

test("a preview reads maths as symbols, not markup", () => {
  const preview = docPreview(
    parseDoc(
      [
        "With $0 < \\eta < 1/\\mu$ it converges.",
        "",
        "$$",
        "\\int_{0}^{1} x^2 \\, dx = \\frac{1}{3}",
        "$$",
      ].join("\n"),
    ),
  );
  assert.equal(
    preview,
    "With 0 < \u03b7 < 1/\u03bc it converges. \u222b_0^1 x^2 dx = 1/3",
  );
});

test("a preview leaves ordinary text alone", () => {
  // A lone dollar is money, not maths, and other markup is left as typed.
  assert.equal(
    docPreview(parseDoc("Costs $5 today and **bold** stays.")),
    "Costs $5 today and **bold** stays.",
  );
});

test("maths reads with its norms and grouping intact", () => {
  // Norm bars survive, and a subscript keeps its grouping rather than
  // collapsing to a misleading "x_k+1".
  assert.equal(
    mathToText("$\\|x_{k+1}-x^*\\| \\le (1-\\eta\\mu)\\,\\|x_k - x^*\\|$"),
    "\u2016x_(k+1)-x^*\u2016 \u2264 (1-\u03b7\u03bc) \u2016x_k - x^*\u2016",
  );
  assert.equal(
    mathToText("$\\frac{1}{3} + \\int_{0}^{1} x^2$"),
    "1/3 + \u222b_0^1 x^2",
  );
});

test("an unknown command keeps its name, without the backslash", () => {
  assert.equal(
    docPreview(parseDoc("$\\widehat{x}$ and $\\zeta$")),
    "widehatx and zeta",
  );
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

test("edits in different parts of a document merge without loss", () => {
  const base = parseDoc("# Title\n\nFirst line.\n\nSecond line.");
  // I rewrite the first line; they rewrite the second.
  const mine = parseDoc("# Title\n\nMy first line.\n\nSecond line.");
  const theirs = parseDoc("# Title\n\nFirst line.\n\nTheir second line.");

  const { blocks, conflicts } = mergeDocs(base, mine, theirs);
  assert.equal(conflicts.length, 0, "different lines never conflict");
  const text = blocks.map((b) => (b.type === "divider" ? "" : b.text));
  assert.deepEqual(text, ["Title", "My first line.", "Their second line."]);
});

test("the same line changed twice keeps both, theirs applied", () => {
  const base = parseDoc("One line.");
  const mine = parseDoc("My version.");
  const theirs = parseDoc("Their version.");

  const { blocks, conflicts } = mergeDocs(base, mine, theirs);
  // Theirs is already saved, so it stands where the line was; mine follows it
  // on the page rather than being dropped.
  assert.equal(blocks.length, 2);
  assert.equal(
    blocks[0].type === "paragraph" && blocks[0].text,
    "Their version.",
  );
  assert.equal(blocks[1].type === "paragraph" && blocks[1].text, "My version.");
  assert.equal(conflicts.length, 1);
  assert.equal(
    conflicts[0].mine.type === "paragraph" && conflicts[0].mine.text,
    "My version.",
  );
});

test("a line added at the end by either side is kept", () => {
  const base = parseDoc("One.");
  const mine = parseDoc("One.\n\nMine at the end.");
  const theirs = parseDoc("One.");
  assert.equal(mergeDocs(base, mine, theirs).blocks.length, 2);
  // And the other way round.
  assert.equal(mergeDocs(base, theirs, mine).blocks.length, 2);
});

test("an identical edit on both sides is not a conflict", () => {
  const base = parseDoc("Old.");
  const same = parseDoc("New.");
  const { blocks, conflicts } = mergeDocs(base, same, same);
  assert.equal(conflicts.length, 0);
  assert.equal(blocks[0].type === "paragraph" && blocks[0].text, "New.");
});

test("a change to a document reaches the people watching it", async () => {
  const { announceDocChange, streamDocChanges, watcherCount } =
    await import("../src/modules/docs/live.js");
  const docId = randomUUID();
  const written: string[] = [];
  // Stands in for the HTTP response: we only care what goes down the wire.
  const reply = {
    getHeaders: () => ({}),
    raw: {
      writeHead: () => {},
      write: (chunk: string) => written.push(chunk),
    },
  } as never;

  const stop = await streamDocChanges(reply, docId, "tab-a");
  assert.equal(watcherCount(docId), 1);

  // The watcher's own save is not news to them.
  await announceDocChange(pool, docId, 4, "tab-a");
  // Someone else's is.
  await announceDocChange(pool, docId, 5, "tab-b");

  const deadline = Date.now() + 5000;
  while (!written.some((c) => c.startsWith("data:")) && Date.now() < deadline)
    await new Promise((r) => setTimeout(r, 25));

  const events = written
    .filter((c) => c.startsWith("data:"))
    .map((c) => JSON.parse(c.slice(5)) as { version: number; by: string });
  assert.equal(events.length, 1, "only the other tab's save is announced");
  assert.equal(events[0].version, 5);

  stop();
  assert.equal(watcherCount(docId), 0);
});

test("the live stream keeps the CORS headers Fastify set", async () => {
  const { streamDocChanges, closeLive } =
    await import("../src/modules/docs/live.js");
  let sent: Record<string, string> = {};
  // Writing to the raw socket goes around Fastify, so a header it set has to
  // be carried over by hand or the stream is unreadable from any other
  // origin — every phone, and every split deployment.
  const reply = {
    getHeaders: () => ({
      "access-control-allow-origin": "https://app.example",
      "access-control-expose-headers": "ETag",
      "x-something-else": "ignored",
    }),
    raw: {
      writeHead: (_code: number, headers: Record<string, string>) => {
        sent = headers;
      },
      write: () => {},
    },
  } as never;

  const stop = await streamDocChanges(reply, randomUUID(), "tab-a");
  assert.equal(sent["access-control-allow-origin"], "https://app.example");
  assert.equal(sent["access-control-expose-headers"], "ETag");
  assert.equal(sent["x-something-else"], undefined);
  assert.equal(sent["content-type"], "text/event-stream");
  stop();
  await closeLive();
});

test("a comment can be written about one line, and survives that line going", async () => {
  const made = await call("POST", "/docs", {
    title: "Anchored",
    content: [
      { type: "paragraph", text: "First line.", id: "b-one" },
      { type: "paragraph", text: "Second line.", id: "b-two" },
    ],
  });
  const id = made.json().id as string;

  const onLine = await call("POST", `/docs/${id}/comments`, {
    body: "Is this still true?",
    block_id: "b-two",
    quote: "Second line.",
  });
  assert.equal(onLine.statusCode, 201);
  assert.equal(onLine.json().block_id, "b-two");
  assert.equal(onLine.json().quote, "Second line.");

  // A remark about the page as a whole carries no anchor.
  const onPage = await call("POST", `/docs/${id}/comments`, {
    body: "Good start.",
  });
  assert.equal(onPage.json().block_id, null);

  const listed = (await call("GET", `/docs/${id}/comments`)).json() as {
    block_id: string | null;
    quote: string | null;
  }[];
  assert.deepEqual(
    listed.map((c) => c.block_id),
    ["b-two", null],
  );

  // The line it was written about is deleted; the comment is kept, with the
  // words it was about, so it can be shown apart rather than vanishing.
  await call("PUT", `/docs/${id}`, {
    version: 1,
    content: [{ type: "paragraph", text: "First line.", id: "b-one" }],
  });
  const after = (await call("GET", `/docs/${id}/comments`)).json() as {
    block_id: string | null;
    quote: string | null;
  }[];
  assert.equal(after.length, 2);
  assert.equal(after[0].quote, "Second line.");
});

test("saving keeps the state it replaced, and a restore brings it back", async () => {
  const made = await call("POST", "/docs", {
    title: "Draft",
    content: [{ type: "paragraph", text: "First words." }],
  });
  const id = made.json().id as string;
  // Nothing has been replaced yet, so nothing is kept.
  assert.deepEqual((await call("GET", `/docs/${id}/versions`)).json(), []);

  const v2 = await call("PUT", `/docs/${id}`, {
    version: 1,
    content: [{ type: "paragraph", text: "Second words." }],
  });
  assert.equal(v2.json().version, 2);
  const kept = (await call("GET", `/docs/${id}/versions`)).json() as {
    version: number;
    blocks: number;
    author: string;
  }[];
  assert.equal(kept.length, 1, "the state before the save is kept");
  assert.equal(kept[0].version, 1);
  assert.equal(kept[0].blocks, 1);
  assert.equal(kept[0].author, "Writer");

  // A second save in the same sitting does not add another row.
  await call("PUT", `/docs/${id}`, {
    version: 2,
    content: [{ type: "paragraph", text: "Third words." }],
  });
  assert.equal(
    ((await call("GET", `/docs/${id}/versions`)).json() as unknown[]).length,
    1,
    "saves within a sitting coalesce",
  );

  const one = (await call("GET", `/docs/${id}/versions/1`)).json() as {
    content: { text: string }[];
  };
  assert.equal(one.content[0].text, "First words.");

  const restored = await call("POST", `/docs/${id}/versions/1/restore`);
  assert.equal(restored.statusCode, 200);
  const doc = restored.json() as {
    version: number;
    content: { text: string }[];
  };
  assert.equal(doc.content[0].text, "First words.");
  assert.equal(doc.version, 4, "a restore is a new version on top");
  // The state a restore replaced is kept too, so nothing is ever lost.
  const after = (await call("GET", `/docs/${id}/versions`)).json() as {
    version: number;
  }[];
  assert.deepEqual(
    after.map((v) => v.version),
    [3, 1],
  );

  const missing = await call("GET", `/docs/${id}/versions/99`);
  assert.equal(missing.statusCode, 404);
  const stranger = await call(
    "GET",
    `/docs/${id}/versions`,
    undefined,
    () => otherToken,
  );
  assert.equal(stranger.statusCode, 404);
});

test("a stranger cannot watch a document they may not read", async () => {
  const made = await call("POST", "/docs", { title: "Private" });
  const id = made.json().id as string;
  const res = await call(
    "GET",
    `/docs/${id}/live`,
    undefined,
    () => otherToken,
  );
  assert.equal(res.statusCode, 404);
});

// --- Comments on words, not lines -----------------------------------------

test("a remark follows its words when the line around them is edited", async () => {
  const made = await call("POST", "/docs", {
    title: "Anchors",
    content: [
      {
        type: "paragraph",
        text: "ship the connector to every workspace",
        id: "b1",
      },
    ],
  });
  const doc = made.json();
  const put = await call("POST", `/docs/${doc.id}/comments`, {
    body: "Which ones first?",
    block_id: "b1",
    quote: "every workspace",
    range_start: 22,
    range_end: 37,
  });
  assert.equal(put.statusCode, 201);
  const comment = put.json();
  assert.equal(comment.range_start, 22);
  assert.equal(comment.detached, false);

  // Words put in before the quote push it along the line.
  const edited = await call("PUT", `/docs/${doc.id}`, {
    version: doc.version,
    content: [
      {
        type: "paragraph",
        text: "we should ship the connector to every workspace",
        id: "b1",
      },
    ],
  });
  assert.equal(edited.statusCode, 200);
  const after = (await call("GET", `/docs/${doc.id}/comments`)).json();
  assert.equal(after[0].range_start, 32);
  assert.equal(after[0].range_end, 47);
  assert.equal(after[0].detached, false);
  assert.equal(
    "we should ship the connector to every workspace".slice(32, 47),
    "every workspace",
  );
});

test("a remark whose words are deleted comes loose but is kept", async () => {
  const doc = (
    await call("POST", "/docs", {
      title: "Loose",
      content: [{ type: "paragraph", text: "cut this phrase out", id: "b1" }],
    })
  ).json();
  await call("POST", `/docs/${doc.id}/comments`, {
    body: "Why?",
    block_id: "b1",
    quote: "this phrase",
    range_start: 4,
    range_end: 15,
  });
  await call("PUT", `/docs/${doc.id}`, {
    version: doc.version,
    content: [{ type: "paragraph", text: "cut out", id: "b1" }],
  });
  const after = (await call("GET", `/docs/${doc.id}/comments`)).json();
  assert.equal(after.length, 1, "the remark is not thrown away");
  assert.equal(after[0].detached, true);
  assert.equal(
    after[0].quote,
    "this phrase",
    "it still says what it was about",
  );
});

test("a half range is refused", async () => {
  const doc = (
    await call("POST", "/docs", {
      title: "Half",
      content: [{ type: "paragraph", text: "hello", id: "b1" }],
    })
  ).json();
  const bad = await call("POST", `/docs/${doc.id}/comments`, {
    body: "?",
    block_id: "b1",
    quote: "hello",
    range_start: 0,
  });
  assert.equal(bad.statusCode, 422);
});

test("replies join one thread, however deep they are aimed", async () => {
  const doc = (
    await call("POST", "/docs", {
      title: "Threads",
      content: [{ type: "paragraph", text: "a point", id: "b1" }],
    })
  ).json();
  const root = (
    await call("POST", `/docs/${doc.id}/comments`, {
      body: "First",
      block_id: "b1",
      quote: "a point",
      range_start: 0,
      range_end: 7,
    })
  ).json();
  const reply = (
    await call("POST", `/docs/${doc.id}/comments`, {
      body: "Second",
      parent_id: root.id,
    })
  ).json();
  assert.equal(reply.parent_id, root.id);
  // Replying to a reply still lands in the same thread, one deep.
  const deeper = (
    await call("POST", `/docs/${doc.id}/comments`, {
      body: "Third",
      parent_id: reply.id,
    })
  ).json();
  assert.equal(deeper.parent_id, root.id);
});

test("a restore moves remarks with the words it brings back", async () => {
  const doc = (
    await call("POST", "/docs", {
      title: "Restore",
      content: [{ type: "paragraph", text: "the first wording", id: "b1" }],
    })
  ).json();
  await call("POST", `/docs/${doc.id}/comments`, {
    body: "On the wording",
    block_id: "b1",
    quote: "first wording",
    range_start: 4,
    range_end: 17,
  });
  const second = (
    await call("PUT", `/docs/${doc.id}`, {
      version: doc.version,
      content: [
        { type: "paragraph", text: "a much later first wording", id: "b1" },
      ],
    })
  ).json();
  const moved = (await call("GET", `/docs/${doc.id}/comments`)).json();
  assert.equal(moved[0].range_start, 13);
  const kept = (await call("GET", `/docs/${doc.id}/versions`)).json();
  const back = await call(
    "POST",
    `/docs/${doc.id}/versions/${kept[kept.length - 1].version}/restore`,
    {},
  );
  assert.equal(back.statusCode, 200);
  assert.ok(second.version);
  const after = (await call("GET", `/docs/${doc.id}/comments`)).json();
  assert.equal(after[0].range_start, 4, "back where it started");
  assert.equal(after[0].detached, false);
});
