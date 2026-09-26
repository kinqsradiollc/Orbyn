import { test, before, after } from "node:test";
import assert from "node:assert/strict";
// Connects only to a verified test database (see setup.ts).
import "./setup.js";
import { helpers, type Person } from "./mcp-helpers.js";

/**
 * D3aF: a picker link keeps, in its brackets, the title its target had when
 * it was made. A page shared with a team may link someone's private page,
 * another team's task or project, or a page since deleted for good; every
 * reader who can't open the target must see "Private page", "Private task"
 * or "Private project" instead of its title — in the page itself, its
 * exports and history, "Linked here" lines, hover cards, search, what
 * agents fetch and the published web page — while the stored page keeps
 * the titles for the people who can open them.
 */

const { buildApp } = await import("../src/app.js");
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { linkMarkdown } = await import("@orbyn/core");

const app = await buildApp();
const h = helpers(app);

let ana: Person; // in Lab and Side
let ben: Person; // in Lab only
let stranger: Person;
let lab = "";
let side = "";
let sharedId = ""; // the Lab page that links everything
let openId = ""; // a Lab page Ben can read
let personalId = ""; // Ana's own page
let sideTaskId = "";
let sideProjectId = "";
let goneId = ""; // a Lab page deleted for good

const SECRETS = [
  "Budget 2027 private",
  "Side quest secret",
  "Moonshot secret",
  "Gone forever notes",
];

const call = (
  who: Person | null,
  method: "GET" | "POST" | "PUT" | "DELETE",
  url: string,
  payload?: unknown,
) => h.call(who?.token ?? null, method, url, payload);

const noSecrets = (text: string, where: string) => {
  for (const s of SECRETS)
    assert.ok(!text.includes(s), `${where} shows "${s}": ${text}`);
};

const para = (text: string, id: string) => ({ type: "paragraph", text, id });

before(async () => {
  await migrate();
  ana = await h.register("privacy-ana", "Ana");
  ben = await h.register("privacy-ben", "Ben");
  stranger = await h.register("privacy-stranger", "Stranger");
  lab = await h.team(ana, "Lab", [[ben, "member"]]);
  side = await h.team(ana, "Side");
  const doc = async (title: string, team_id?: string) =>
    (
      await call(ana, "POST", "/docs", {
        title,
        ...(team_id ? { team_id } : {}),
      })
    ).json().id as string;
  openId = await doc("Lab 3 notes", lab);
  personalId = await doc("Budget 2027 private");
  goneId = await doc("Gone forever notes", lab);
  sideTaskId = (
    await call(ana, "POST", "/items", {
      title: "Side quest secret",
      team_id: side,
    })
  ).json().id;
  sideProjectId = (
    await call(ana, "POST", "/projects", {
      name: "Moonshot secret",
      team_id: side,
    })
  ).json().id;
  sharedId = await doc("Team plan", lab);
  const content = [
    para(
      `Plan: ${linkMarkdown({ kind: "doc", id: personalId }, "Budget 2027 private")} and ${linkMarkdown({ kind: "doc", id: openId }, "Lab 3 notes")}`,
      "b1",
    ),
    para(
      `Do ${linkMarkdown({ kind: "task", id: sideTaskId }, "Side quest secret")} for ${linkMarkdown({ kind: "project", id: sideProjectId }, "Moonshot secret")}`,
      "b2",
    ),
    para(
      `Old: ${linkMarkdown({ kind: "doc", id: goneId }, "Gone forever notes")} quarterly review`,
      "b3",
    ),
  ];
  const saved = await call(ana, "PUT", `/docs/${sharedId}`, {
    version: 1,
    content,
  });
  assert.equal(saved.statusCode, 200, saved.body);
  // The deleted target: to Trash, then gone for good.
  assert.equal((await call(ana, "DELETE", `/docs/${goneId}`)).statusCode, 204);
  assert.equal(
    (await call(ana, "DELETE", `/docs/${goneId}/forever`)).statusCode,
    204,
  );
});

after(async () => {
  const { closeLive } = await import("../src/modules/docs/live.js");
  await closeLive();
  await app.close();
  await pool.end();
});

test("the page still needs a sign-in (401) and stays hidden from outsiders (404)", async () => {
  assert.equal((await call(null, "GET", `/docs/${sharedId}`)).statusCode, 401);
  assert.equal(
    (await call(stranger, "GET", `/docs/${sharedId}`)).statusCode,
    404,
  );
});

test("a reader sees neutral words for a personal target, another team's task and project, and a deleted page; a readable one keeps its title", async () => {
  const res = await call(ben, "GET", `/docs/${sharedId}`);
  assert.equal(res.statusCode, 200);
  noSecrets(res.body, "GET /docs/:id");
  const text = (res.json().content as { text: string }[]).map((b) => b.text);
  assert.equal(
    text[0],
    `Plan: [Private page](orbyn://doc/${personalId}) and [Lab 3 notes](orbyn://doc/${openId})`,
  );
  assert.equal(
    text[1],
    `Do [Private task](orbyn://task/${sideTaskId}) for [Private project](orbyn://project/${sideProjectId})`,
  );
  assert.equal(
    text[2],
    `Old: [Private page](orbyn://doc/${goneId}) quarterly review`,
  );
  // The owner still reads the titles she can open; the page gone for good
  // is gone for her too.
  const own = (await call(ana, "GET", `/docs/${sharedId}`)).body;
  for (const s of SECRETS.slice(0, 3)) assert.ok(own.includes(s), s);
  assert.ok(!own.includes("Gone forever notes"));
  // Nothing about the target's id leaks into the words.
  assert.ok(!text.join(" ").includes(`Private page ${personalId}`));
  // The page list's preview follows the same rule.
  const list = await call(ben, "GET", `/docs`);
  noSecrets(
    JSON.stringify(list.json().find((d: { id: string }) => d.id === sharedId)),
    "GET /docs preview",
  );
});

test("exports keep no private titles", async () => {
  for (const format of ["md", "txt", "html"]) {
    const res = await call(
      ben,
      "GET",
      `/docs/${sharedId}/export?format=${format}`,
    );
    assert.equal(res.statusCode, 200, format);
    noSecrets(res.body, `export ${format}`);
    assert.match(res.body, /Private page/);
    assert.match(res.body, /Lab 3 notes/);
  }
  const md = await call(ben, "GET", `/docs/${sharedId}/markdown`);
  noSecrets(md.body, "markdown");
  assert.match(md.body, /\[Private task\]\(/);
  // Ana's own export still names them.
  const own = await call(ana, "GET", `/docs/${sharedId}/export?format=md`);
  assert.match(own.body, /Side quest secret/);
});

test("'Linked here' lines and hover cards show the neutral words", async () => {
  const here = await call(ben, "GET", `/links/here?kind=doc&id=${openId}`);
  assert.equal(here.statusCode, 200);
  noSecrets(here.body, "links/here");
  const row = here.json().items.find((i: { id: string }) => i.id === sharedId);
  assert.ok(row, here.body);
  assert.match(row.context.before, /Private page/);
  assert.equal(row.context.linked, "Lab 3 notes");
  // Ana's line still names her page.
  const own = await call(ana, "GET", `/links/here?kind=doc&id=${openId}`);
  assert.match(own.body, /Budget 2027 private/);
  const card = await call(ben, "GET", `/links/card?kind=doc&id=${sharedId}`);
  assert.equal(card.statusCode, 200);
  noSecrets(card.body, "links/card");
});

test("search neither finds a page by a private title nor shows it in a snippet", async () => {
  const hits = await call(ben, "GET", "/search?q=quarterly&type=doc");
  assert.equal(hits.statusCode, 200);
  assert.ok(
    hits.json().some((h: { id: string }) => h.id === sharedId),
    hits.body,
  );
  noSecrets(hits.body, "search snippet");
  const byTitle = await call(ben, "GET", "/search?q=Moonshot&type=doc");
  assert.ok(
    !byTitle.json().some((h: { id: string }) => h.id === sharedId),
    "found by a link's words",
  );
});

test("agents fetch the neutral words, and a connection limited to one team can't read the rest", async () => {
  const { key } = await h.agentKey(ben, { team_ids: [lab] });
  const got = await h.tool(key, "fetch", { id: `doc:${sharedId}` });
  assert.ok(got && !got.isError, JSON.stringify(got));
  const text = got!.content.map((c) => c.text).join("\n");
  noSecrets(text, "fetch");
  assert.match(text, /Private task/);
  assert.match(text, /Lab 3 notes/);
  // Ana can open everything, but this connection reaches Lab only.
  const limited = await h.agentKey(ana, { team_ids: [lab], personal: false });
  const seen = await h.tool(limited.key, "fetch", { id: `doc:${sharedId}` });
  const words = seen!.content.map((c) => c.text).join("\n");
  noSecrets(words, "fetch (Lab only)");
  const full = await h.agentKey(ana, { team_ids: [lab, side] });
  const all = await h.tool(full.key, "fetch", { id: `doc:${sharedId}` });
  assert.match(all!.content.map((c) => c.text).join("\n"), /Moonshot secret/);
});

test("a save of the words shown keeps the page's own titles", async () => {
  const doc = (await call(ben, "GET", `/docs/${sharedId}`)).json();
  const content = doc.content.map((b: { id: string; text: string }) =>
    b.id === "b2" ? { ...b, text: `${b.text} soon` } : b,
  );
  const saved = await call(ben, "PUT", `/docs/${sharedId}`, {
    version: doc.version,
    content,
  });
  assert.equal(saved.statusCode, 200, saved.body);
  noSecrets(saved.body, "save answer");
  const stored = (
    await pool.query<{ content: { id: string; text: string }[] }>(
      "SELECT content FROM docs WHERE id = $1",
      [sharedId],
    )
  ).rows[0].content;
  assert.equal(
    stored.find((b) => b.id === "b2")!.text,
    `Do [Side quest secret](orbyn://task/${sideTaskId}) for [Moonshot secret](orbyn://project/${sideProjectId}) soon`,
  );
  assert.match(stored.find((b) => b.id === "b1")!.text, /Budget 2027 private/);
  // The kept version reads neutrally to Ben as well.
  const versions = (
    await call(ben, "GET", `/docs/${sharedId}/versions`)
  ).json();
  const past = await call(
    ben,
    "GET",
    `/docs/${sharedId}/versions/${versions[0].version}`,
  );
  assert.equal(past.statusCode, 200);
  noSecrets(past.body, "version");
});

test("a remark on the words shown lands on the same words in the stored line", async () => {
  const shown = (await call(ben, "GET", `/docs/${sharedId}`)).json().content;
  const line = shown.find((b: { id: string }) => b.id === "b3").text as string;
  const start = line.indexOf("quarterly");
  const made = await call(ben, "POST", `/docs/${sharedId}/comments`, {
    body: "Which quarter?",
    block_id: "b3",
    quote: "quarterly",
    range_start: start,
    range_end: start + "quarterly".length,
  });
  assert.equal(made.statusCode, 201, made.body);
  // Answered in Ben's own counting.
  assert.equal(made.json().range_start, start);
  const row = (
    await pool.query<{ range_start: number; range_end: number }>(
      "SELECT range_start, range_end FROM doc_comments WHERE id = $1",
      [made.json().id],
    )
  ).rows[0];
  const stored = (
    await pool.query<{ content: { id: string; text: string }[] }>(
      "SELECT content FROM docs WHERE id = $1",
      [sharedId],
    )
  ).rows[0].content.find((b) => b.id === "b3")!.text;
  assert.equal(stored.slice(row.range_start, row.range_end), "quarterly");
  // Read back, each sees it in their own line's counting.
  const benSees = (await call(ben, "GET", `/docs/${sharedId}/comments`))
    .json()
    .find((c: { id: string }) => c.id === made.json().id);
  assert.equal(benSees.range_start, start);
  const anaSees = (await call(ana, "GET", `/docs/${sharedId}/comments`))
    .json()
    .find((c: { id: string }) => c.id === made.json().id);
  // The page gone for good reads "Private page" to Ana as well, so her
  // line counts the same as Ben's.
  assert.equal(anaSees.range_start, start);
  assert.notEqual(row.range_start, start);
});

test("a published page names only published pages", async () => {
  const res = await call(ana, "PUT", `/docs/${sharedId}/publish`, {});
  assert.equal(res.statusCode, 200, res.body);
  const page = await call(null, "GET", res.json().published.path);
  assert.equal(page.statusCode, 200);
  noSecrets(page.body, "published page");
  assert.ok(!page.body.includes("Lab 3 notes"), "unpublished page named");
  assert.match(page.body, /Private task/);
  await call(ana, "DELETE", `/docs/${sharedId}/publish`);
});

test("a proposal made on the words shown is taken into the stored line", async () => {
  const shown = (await call(ben, "GET", `/docs/${sharedId}`)).json().content;
  const line = shown.find((b: { id: string }) => b.id === "b2").text as string;
  const at = line.indexOf("soon");
  const made = await call(ben, "POST", `/docs/${sharedId}/suggestions`, {
    changes: [
      {
        block_id: "b2",
        kind: "replace",
        range_start: at,
        range_end: at + 4,
        // Written over the words shown, a hidden link and all.
        text: `today, then [Private task](orbyn://task/${sideTaskId})`,
        quote: "soon",
      },
    ],
  });
  assert.equal(made.statusCode, 201, made.body);
  noSecrets(made.body, "proposal answer");
  const taken = await call(
    ana,
    "POST",
    `/docs/${sharedId}/suggestions/${made.json()[0].id}`,
    { take: true },
  );
  assert.equal(taken.statusCode, 200, taken.body);
  const stored = (
    await pool.query<{ content: { id: string; text: string }[] }>(
      "SELECT content FROM docs WHERE id = $1",
      [sharedId],
    )
  ).rows[0].content.find((b) => b.id === "b2")!.text;
  assert.equal(
    stored,
    `Do [Side quest secret](orbyn://task/${sideTaskId}) for [Moonshot secret](orbyn://project/${sideProjectId}) today, then [Side quest secret](orbyn://task/${sideTaskId})`,
  );
});

// ---- Quoted words, live embeds and study cards (D3aF review) ----

const commentsFor = async (who: Person) =>
  (await call(who, "GET", `/docs/${sharedId}/comments`)).json() as {
    id: string;
    quote: string | null;
    range_start: number | null;
    range_end: number | null;
  }[];

test("a remark on the words 'Private page' never hands the title back", async () => {
  const shown = (await call(ben, "GET", `/docs/${sharedId}`)).json().content;
  const line = shown.find((b: { id: string }) => b.id === "b1").text as string;
  const start = line.indexOf("Private page");
  assert.ok(start > 0, line);
  const made = await call(ben, "POST", `/docs/${sharedId}/comments`, {
    body: "What is this?",
    block_id: "b1",
    quote: "Private page",
    range_start: start,
    range_end: start + "Private page".length,
  });
  assert.equal(made.statusCode, 201, made.body);
  noSecrets(made.body, "comment answer");
  assert.equal(made.json().quote, "Private page");
  assert.equal(made.json().range_start, start);
  const list = await call(ben, "GET", `/docs/${sharedId}/comments`);
  noSecrets(list.body, "GET comments");
  const again = list
    .json()
    .find((c: { id: string }) => c.id === made.json().id);
  assert.equal(again.quote, "Private page");
  assert.equal(line.slice(again.range_start, again.range_end), "Private page");
  // The page keeps the title, and Ana, who can open it, reads it.
  const own = (await commentsFor(ana)).find((c) => c.id === made.json().id)!;
  assert.equal(own.quote, "Budget 2027 private");
});

test("words Ana quotes from inside a link, or a line cut short, read neutrally to Ben", async () => {
  const stored = (
    await pool.query<{ content: { id: string; text: string }[] }>(
      "SELECT content FROM docs WHERE id = $1",
      [sharedId],
    )
  ).rows[0].content.find((b) => b.id === "b1")!.text;
  const at = stored.indexOf("2027 priv");
  const part = await call(ana, "POST", `/docs/${sharedId}/comments`, {
    body: "Which year?",
    block_id: "b1",
    quote: "2027 priv",
    range_start: at,
    range_end: at + "2027 priv".length,
  });
  assert.equal(part.statusCode, 201, part.body);
  assert.equal(part.json().quote, "2027 priv");
  // A whole line's quote cut off in the middle of a link's address.
  const cut = stored.slice(0, stored.indexOf("orbyn://doc/") + 20);
  const whole = await call(ana, "POST", `/docs/${sharedId}/comments`, {
    body: "About this line",
    block_id: "b1",
    quote: cut,
  });
  assert.equal(whole.statusCode, 201, whole.body);
  // A remark whose line has gone, quoting the title as plain words.
  const gone = await call(ana, "POST", `/docs/${sharedId}/comments`, {
    body: "Gone line",
    block_id: "no-such-line",
    quote: "see Budget 2027 private first",
  });
  assert.equal(gone.statusCode, 201, gone.body);

  const list = await call(ben, "GET", `/docs/${sharedId}/comments`);
  noSecrets(list.body, "GET comments (Ana's quotes)");
  const seen = await commentsFor(ben);
  const benPart = seen.find((c) => c.id === part.json().id)!;
  assert.equal(benPart.quote, "Private page");
  const line = (await call(ben, "GET", `/docs/${sharedId}`))
    .json()
    .content.find((b: { id: string }) => b.id === "b1").text as string;
  assert.equal(
    line.slice(benPart.range_start!, benPart.range_end!),
    "Private page",
  );
  assert.match(
    seen.find((c) => c.id === whole.json().id)!.quote!,
    /^Plan: \[Private page\]\(orbyn:\/\/doc\//,
  );
  assert.equal(
    seen.find((c) => c.id === gone.json().id)!.quote,
    "see Private page first",
  );
  // Ana still reads her own words.
  const hers = await commentsFor(ana);
  assert.equal(hers.find((c) => c.id === part.json().id)!.quote, "2027 priv");
  assert.equal(hers.find((c) => c.id === whole.json().id)!.quote, cut);
});

test("a proposal's quote reads neutrally to a reader who can't open the link", async () => {
  const stored = (
    await pool.query<{ content: { id: string; text: string }[] }>(
      "SELECT content FROM docs WHERE id = $1",
      [sharedId],
    )
  ).rows[0].content.find((b) => b.id === "b1")!.text;
  const at = stored.indexOf("Budget 2027 private");
  const made = await call(ana, "POST", `/docs/${sharedId}/suggestions`, {
    changes: [
      {
        block_id: "b1",
        kind: "replace",
        range_start: at,
        range_end: at + "Budget 2027".length,
        text: "Budget 2028",
        quote: "Budget 2027",
      },
    ],
  });
  assert.equal(made.statusCode, 201, made.body);
  const list = await call(ben, "GET", `/docs/${sharedId}/suggestions`);
  noSecrets(list.body, "GET suggestions");
  const row = list
    .json()
    .find((s: { id: string }) => s.id === made.json()[0].id);
  assert.equal(row.quote, "Private page");
  await call(ana, "DELETE", `/docs/${sharedId}/suggestions/${row.id}`);
});

test("a live embed of a shared page hides the words of links the reader can't open", async () => {
  const line = await call(ben, "GET", `/docs/${sharedId}/section?block=b1`);
  assert.equal(line.statusCode, 200, line.body);
  noSecrets(line.body, "section");
  assert.match(line.body, /Private page/);
  assert.match(line.body, /Lab 3 notes/);
  const first = await call(ben, "GET", `/docs/${sharedId}/section`);
  noSecrets(first.body, "section (first lines)");
  const own = await call(ana, "GET", `/docs/${sharedId}/section?block=b1`);
  assert.match(own.body, /Budget 2027 private/);
});

test("study cards made from a shared line show the neutral words", async () => {
  const cards = (
    await call(ana, "POST", "/docs", { title: "Lab cards", team_id: lab })
  ).json().id as string;
  const saved = await call(ana, "PUT", `/docs/${cards}`, {
    version: 1,
    content: [
      para(
        `What is ${linkMarkdown({ kind: "doc", id: personalId }, "Budget 2027 private")} :: the answer`,
        "c1",
      ),
    ],
  });
  assert.equal(saved.statusCode, 200, saved.body);
  const queue = await call(ben, "GET", `/study/queue?doc_id=${cards}`);
  assert.equal(queue.statusCode, 200, queue.body);
  noSecrets(queue.body, "study queue");
  const card = queue.json()[0];
  assert.ok(card, queue.body);
  assert.match(card.question, /Private page/);
  const reviewed = await call(ben, "POST", `/study/cards/${card.id}/review`, {
    rating: "again",
  });
  assert.equal(reviewed.statusCode, 200, reviewed.body);
  noSecrets(reviewed.body, "card review");
  noSecrets((await call(ben, "GET", "/study")).body, "study overview");
  // Ana's own card still names her page.
  const hers = await call(ana, "GET", `/study/queue?doc_id=${cards}`);
  assert.match(hers.body, /Budget 2027 private/);
});
