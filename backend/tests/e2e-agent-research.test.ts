import { test, before, after } from "node:test";
import assert from "node:assert/strict";
// Connects only to a verified test database (see setup.ts).
import "./setup.js";
import { trapNetwork, type Person } from "./mcp-helpers.js";
import { type AgentClient, idOf, scenario } from "./e2e-agent-helpers.js";

/**
 * H9 scenario (b): research becomes a brief with its sources. The agent
 * reads three web pages itself and keeps each with save_source as it goes
 * (Orbyn never opens an address: the network stays untouched), then writes
 * the brief in one apply_plan: the page with footnotes and [src: …] lines,
 * each source linked to the lines that use it, and the page filed in the
 * person's project. The page's Info (in the app and through fetch) lists
 * the sources; the project links to the brief; find_passages cites it.
 */

const { buildApp } = await import("../src/app.js");
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");

const app = await buildApp();
const { h, connect } = scenario(app);
const network = await trapNetwork();

let ria: Person;
let agent: AgentClient;
let project = "";

const SOURCES = [
  {
    url: "https://www.example.org/sleep/memory",
    title: "Sleep and memory consolidation",
    quote: "Slow-wave sleep supports the consolidation of declarative memory.",
    author: "J. Walker",
    accessed: "2026-09-25",
  },
  {
    url: "https://journals.example.com/articles/spacing-effect",
    title: "The spacing effect, revisited",
    quote: "Spaced practice beats massed practice across ages and subjects.",
    accessed: "2026-09-26",
  },
  {
    url: "https://news.example.net/students-and-sleep",
    title: "Students sleep less before exams",
    quote: "Two in three students cut sleep in exam weeks.",
    accessed: "2026-09-26",
    site: "Example News",
  },
];

before(async () => {
  await migrate();
  ria = await h.register("e2e-research-ria", "Ria");
  const made = await h.call(ria.token, "POST", "/projects", {
    name: "Thesis: sleep and study",
  });
  assert.equal(made.statusCode, 201, made.body);
  project = made.json().id;
  agent = await connect(ria, {
    toolsets: ["study", "workspace"],
    name: "Research agent",
  });
});

after(async () => {
  const { closeLive } = await import("../src/modules/docs/live.js");
  await closeLive();
  network.restore();
  await app.close();
  await pool.end();
});

test("research → a brief with its sources, filed in the project, never fetched", async () => {
  // 1. As it reads: each source kept once, with no page yet.
  const kept: string[] = [];
  for (const s of SOURCES) {
    const saved = await agent.ok("save_source", s);
    assert.equal(saved.saved, "new");
    assert.match(saved.source, /^source:/);
    assert.equal(saved.marker, `[src: ${s.title}]`);
    kept.push(saved.source);
  }
  assert.deepEqual(network.calls, [], "saving a source opens nothing");

  // 2. The brief in one job: the page, each source linked to its lines,
  // and the page filed in the project.
  const brief = [
    "# Does sleep help revision? ^top",
    "",
    "## Findings ^findings",
    "",
    `- Sleep consolidates what was learned [src: ${SOURCES[0].title}] [^1] ^sleep`,
    `- Spacing reviews out works better than cramming [src: ${SOURCES[1].title}] [^2] ^spacing`,
    `- Students cut sleep before exams [src: ${SOURCES[2].title}] ^cut`,
    "",
    "## Next steps ^next",
    "",
    "- [ ] Plan revision in short spaced sessions ^plan",
    "",
    `[^1]: ${SOURCES[0].author}, accessed ${SOURCES[0].accessed}.`,
    `[^2]: ${SOURCES[1].title}, accessed ${SOURCES[1].accessed}.`,
  ].join("\n");
  const job = await agent.ok("apply_plan", {
    summary: "A sourced brief on sleep and revision",
    steps: [
      {
        id: "brief",
        tool: "create_doc",
        args: { title: "Brief: sleep and revision", markdown: brief },
      },
      ...SOURCES.map((s, i) => ({
        id: `src${i}`,
        tool: "save_source",
        args: {
          url: s.url,
          title: s.title,
          doc: "$brief.id",
          lines: [
            ["$brief.lines.sleep", "$brief.lines.spacing", "$brief.lines.cut"][
              i
            ],
          ],
        },
      })),
      {
        id: "file",
        tool: "link",
        args: {
          action: "link",
          kind: "doc_project",
          from: "$brief.id",
          to: `project:${project}`,
        },
      },
    ],
  });
  assert.equal(job.status, "done");
  const doc = idOf(job.steps[0].done[0].id);
  // The same three sources, now used on the page: none kept twice.
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM sources WHERE user_id = $1",
        [ria.id],
      )
    ).rows[0].n,
    3,
  );

  // 3. The page's Info lists them, with the lines that use each.
  const info = await h.call(ria.token, "GET", `/docs/${doc}/info`);
  assert.equal(info.statusCode, 200, info.body);
  const listed = info.json().sources as any[];
  assert.deepEqual(
    listed.map((s) => s.title).sort(),
    SOURCES.map((s) => s.title).sort(),
  );
  assert.ok(listed.every((s) => s.lines.length === 1));
  const sleep = listed.find((s) => s.title === SOURCES[0].title);
  assert.equal(sleep.quote, SOURCES[0].quote, "the quote from reading");
  assert.equal(sleep.author, SOURCES[0].author);
  // The agent sees the same through fetch, and opens one, fenced.
  const read = await agent.ok("fetch", { id: `doc:${doc}` });
  for (const id of kept) assert.match(read.text, new RegExp(id));
  assert.match(read.text, /\[\^1\]/, "footnotes kept");
  assert.match(
    read.text,
    new RegExp(`\\[src: ${SOURCES[1].title}\\]`),
    "source lines kept",
  );
  const opened = await agent.ok("fetch", { id: kept[2] });
  assert.match(opened.text, /<untrusted-content source="web_source">/);
  assert.match(opened.text, new RegExp(`Used on: doc:${doc}`));

  // 4. Filed in the project: its links and hub show it; passages cite it.
  const links = await agent.ok("get_links", {
    of: `project:${project}`,
    direction: "in",
  });
  assert.ok(JSON.stringify(links).includes(doc), "the project links to it");
  const hub = await agent.ok("get_project", { project: `project:${project}` });
  assert.ok(JSON.stringify(hub).includes("Brief: sleep and revision"));
  const passages = await agent.ok("find_passages", {
    query: "spacing cramming",
    project: `project:${project}`,
  });
  assert.ok(
    passages.passages.some(
      (p: any) => p.source?.includes?.(doc) || JSON.stringify(p).includes(doc),
    ),
    JSON.stringify(passages),
  );

  // Nothing Orbyn did reached an outside address.
  assert.deepEqual(network.calls, []);
});
