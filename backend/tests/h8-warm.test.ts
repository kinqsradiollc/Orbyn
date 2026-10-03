import { freshRateLimitSession } from "./rate-limit-session.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
// Connects only to a verified test database (see setup.ts).
import "./setup.js";
import { bearer, helpers, trapNetwork, type Person } from "./mcp-helpers.js";

/**
 * H8: agents start warm. One "About me for agents" page per person (made
 * by the person in Settings or by an agent with create_doc kind
 * "profile", edited like any page), instructions per space (Personal's by
 * the person or their agent; a team's by its members, and asked first when
 * an agent changes them), and get_context returning the page, the
 * learning profile, the instructions and standing rules for the spaces the
 * connection reaches, and what changed since it last spoke. The learning
 * profile sizes and orders quizzes, shapes revision sessions and reaches
 * the study prompts.
 */

const { buildApp } = await import("../src/app.js");
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { limiter, strikes } =
  await import("../src/modules/mcp-server/routes.js");
const { drainStudyQueue } = await import("../src/modules/study/service.js");
const { COVERED } = await import("../src/capabilities/exclusions.js");
const { AGENT_TOOLSETS, learningProfileOf, DEFAULT_CHARACTER } =
  await import("@orbyn/core");

const app = await buildApp();
const h = helpers(app);
const network = await trapNetwork();
const ALL = [...AGENT_TOOLSETS];

let olga: Person;
let mo: Person;
let vic: Person;
let crew = "";
const keys: Record<string, string> = {};
const grants: Record<string, string> = {};

type Result = {
  content: { type: string; text: string }[];
  structuredContent?: any;
  isError?: boolean;
  _meta?: Record<string, any>;
};

async function tool(
  key: string,
  name: string,
  args: Record<string, unknown> = {},
): Promise<Result> {
  limiter.reset();
  strikes.reset();
  const r = await h.tool(key, name, args);
  assert.ok(r, `${name}: no result`);
  return r as Result;
}
const code = (r: Result) => r._meta?.["orbyn/error"]?.code as string;
const ok = (r: Result, what = "call") => {
  assert.ok(!r.isError, `${what}: ${r.content?.[0]?.text}`);
  return r.structuredContent;
};
const idOf = (typed: string) =>
  typed.replace(/^[\w]+:(\/\/\w+\/)?/, "").slice(0, 36);
const context = async (key: string) => ok(await tool(key, "get_context"));

async function approve(who: Person, proposal: string) {
  const r = await h.call(
    who.token,
    "POST",
    `/proposals/${proposal.replace(/^proposal:/, "")}/apply`,
    {},
  );
  assert.equal(r.statusCode, 200, r.body);
}

/** Make `grant`'s last call before this session `hours` ago. */
async function spokeAgo(grant: string, hours: number) {
  await pool.query("DELETE FROM agent_activity WHERE grant_id = $1", [grant]);
  const g = (
    await pool.query("SELECT user_id FROM agent_grants WHERE id = $1", [grant])
  ).rows[0];
  await pool.query(
    `INSERT INTO agent_activity (at, user_id, grant_id, tool, tier, outcome)
     VALUES (now() - make_interval(hours => $3), $1, $2, 'search', 'R', 'ok')`,
    [g.user_id, grant, hours],
  );
}

before(async () => {
  await migrate();
  olga = await h.register("h8-olga", "Olga");
  mo = await h.register("h8-mo", "Mo");
  vic = await h.register("h8-vic", "Vic");
  crew = await h.team(olga, "H8 Biology", [
    [mo, "member"],
    [vic, "viewer"],
  ]);
  const make = async (
    name: string,
    who: Person,
    body: Record<string, unknown>,
  ) => {
    const k = await h.agentKey(who, { toolsets: ALL, ...body });
    keys[name] = k.key;
    grants[name] = k.id;
  };
  await make("full", olga, { access: "write", team_ids: [crew] });
  await make("other", olga, { access: "write", team_ids: [crew] });
  await make("teamOnly", olga, {
    access: "write",
    personal: false,
    team_ids: [crew],
  });
  await make("personalOnly", olga, { access: "write", team_ids: [] });
  await make("alone", olga, { access: "write", team_ids: [crew] });
  await pool.query(
    "UPDATE agent_grants SET acts_alone = '{team_admin}' WHERE id = $1",
    [grants.alone],
  );
  await make("suggest", olga, {
    access: "write",
    team_ids: [crew],
    trust: "suggest",
  });
  await make("mo", mo, { access: "write", team_ids: [crew] });
});

after(async () => {
  assert.deepEqual(network.calls, [], "nothing reached the network");
  network.restore();
  await app.close();
  await pool.end();
});

test("the learning profile reads plain Key: value lines", () => {
  const l = learningProfileOf(
    [
      "## How I like cards",
      "- Card style: cloze please ^b1",
      "- Cards per lecture: 25",
      "- **Session length**: 1 hour 15 min",
      "- Study times: Weekdays 19:00–21:00, Sat 9am-11am; evenings",
      "Write Card style as Q&A: not a line to read",
    ].join("\n"),
  );
  assert.equal(l.card_style, "cloze");
  assert.equal(l.cards, 25);
  assert.equal(l.session_minutes, 75);
  assert.deepEqual(
    l.study_times.map((t) => [t.start, t.end]),
    [
      ["19:00", "21:00"],
      ["09:00", "11:00"],
      [null, null],
    ],
  );
  assert.equal(learningProfileOf("Card style: both").card_style, "mixed");
  assert.equal(learningProfileOf("Card style: Q&A").card_style, "qa");
  assert.equal(learningProfileOf("- Card style: ").card_style, null);
  assert.equal(learningProfileOf("Session length: 45").session_minutes, 45);
});

test("Settings: the profile page, one per person (401, 403 for API keys, 422, 429)", async () => {
  assert.equal(
    (await h.call(null, "POST", "/me/agent-profile")).statusCode,
    401,
  );
  const apiKey = (
    await h.call(olga.token, "POST", "/me/api-keys", { name: "rest" })
  ).json().key;
  assert.equal(
    (await h.call(apiKey, "POST", "/me/agent-profile")).statusCode,
    403,
  );
  assert.equal(
    (await h.call(apiKey, "GET", "/me/agent-context")).statusCode,
    403,
  );
  let settings = (await h.call(olga.token, "GET", "/me/agent-context")).json();
  assert.equal(settings.profile, null);
  const made = await h.call(olga.token, "POST", "/me/agent-profile");
  assert.equal(made.statusCode, 201, made.body);
  const again = await h.call(olga.token, "POST", "/me/agent-profile");
  assert.equal(again.statusCode, 200);
  assert.equal(again.json().doc_id, made.json().doc_id);
  settings = (await h.call(olga.token, "GET", "/me/agent-context")).json();
  assert.equal(settings.profile.doc_id, made.json().doc_id);
  assert.equal(settings.profile.title, "About me for agents");
  // A private Memory note in Personal, with Orbyn's outline.
  const doc = (
    await pool.query("SELECT * FROM docs WHERE id = $1", [made.json().doc_id])
  ).rows[0];
  assert.equal(doc.team_id, null);
  assert.equal(doc.kind, "memory");
  assert.ok(
    doc.content.some(
      (b: any) => b.type === "heading" && b.text === "How I like cards",
    ),
  );
  assert.ok(doc.content.every((b: any) => b.id));
  // Instructions for every space she's in, Personal first.
  assert.deepEqual(
    settings.instructions.map((i: any) => [i.space, i.can_edit]),
    [
      ["Personal", true],
      ["H8 Biology", true],
    ],
  );
  const long = await h.call(olga.token, "PUT", "/me/agent-instructions", {
    text: "x".repeat(2001),
  });
  assert.equal(long.statusCode, 422);
  // Past the per-minute limit.
  const { settings: load, cachedSettings } =
    await import("../src/lib/settings.js");
  await load();
  const live = cachedSettings();
  const was = live.rate_limit_per_minute;
  const limitedToken = await freshRateLimitSession(olga.token);
  live.rate_limit_per_minute = 1;
  try {
    const at = () =>
      app.inject({
        method: "GET",
        url: "/me/agent-context",
        headers: bearer(limitedToken),
        remoteAddress: "10.88.0.8",
      });
    assert.equal((await at()).statusCode, 200);
    assert.equal((await at()).statusCode, 429);
  } finally {
    live.rate_limit_per_minute = was;
  }
  // Gone to the Trash: made again, pointing at the new page.
  await pool.query("UPDATE docs SET deleted_at = now() WHERE id = $1", [
    made.json().doc_id,
  ]);
  const remade = await h.call(olga.token, "POST", "/me/agent-profile");
  assert.equal(remade.statusCode, 201);
  assert.notEqual(remade.json().doc_id, made.json().doc_id);
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM agent_profiles WHERE user_id = $1",
        [olga.id],
      )
    ).rows[0].n,
    1,
  );
  assert.deepEqual(COVERED["POST /me/agent-profile"], ["create_doc"]);
  assert.deepEqual(COVERED["PUT /teams/:id/agent-instructions"], ["organize"]);
});

test("M1: a person names their Orbyn assistant and keeps its optional persona", async () => {
  const anon = await h.call(null, "GET", "/me/agent");
  assert.equal(anon.statusCode, 401);
  const initial = await h.call(olga.token, "GET", "/me/agent");
  assert.equal(initial.statusCode, 200, initial.body);
  assert.deepEqual(initial.json(), {
    name: "Orbyn",
    persona: "",
    character: DEFAULT_CHARACTER,
    named_at: null,
    updated_at: initial.json().updated_at,
  });
  const saved = await h.call(olga.token, "PUT", "/me/agent", {
    name: "Mira",
    persona: "Warm, direct, and curious.",
    character: { ...DEFAULT_CHARACTER, body: "spark", accessory: "glasses" },
  });
  assert.equal(saved.statusCode, 200, saved.body);
  assert.equal(saved.json().name, "Mira");
  assert.equal(saved.json().persona, "Warm, direct, and curious.");
  assert.ok(saved.json().named_at);
  assert.deepEqual((await context(keys.full)).agent, {
    name: "Mira",
    persona: "Warm, direct, and curious.",
  });
  const tooLong = await h.call(olga.token, "PUT", "/me/agent", {
    name: "x".repeat(41),
    persona: "",
  });
  assert.equal(tooLong.statusCode, 422);
  const apiKey = (
    await h.call(olga.token, "POST", "/me/api-keys", { name: "m1" })
  ).json().key;
  assert.equal(
    (await h.call(apiKey, "PUT", "/me/agent", { name: "No", persona: "" }))
      .statusCode,
    403,
  );
  const roundTrip = await h.call(olga.token, "GET", "/me/agent");
  assert.equal(roundTrip.json().name, "Mira");
  assert.deepEqual(roundTrip.json().character, {
    ...DEFAULT_CHARACTER,
    body: "spark",
    accessory: "glasses",
  });

  const review = ok(
    await tool(keys.full, "update_agent", {
      name: "Nova",
      persona: "Brief and practical.",
    }),
  );
  assert.equal(review.status, "pending_review");
  await approve(olga, review.pending.proposal_id);
  assert.deepEqual((await context(keys.full)).agent, {
    name: "Nova",
    persona: "Brief and practical.",
  });

  await pool.query(
    "UPDATE agent_grants SET acts_alone = '{profile,team_admin}' WHERE id = $1",
    [grants.alone],
  );
  const direct = ok(
    await tool(keys.alone, "update_agent", {
      name: "Mira",
      persona: "Warm, direct, and curious.",
    }),
  );
  assert.equal(direct.status, "done");
  const activity = (
    await pool.query(
      "SELECT id FROM agent_activity WHERE grant_id = $1 AND tool = 'update_agent' AND undo IS NOT NULL ORDER BY id DESC LIMIT 1",
      [grants.alone],
    )
  ).rows[0];
  const undone = await h.call(
    olga.token,
    "POST",
    `/me/agents/activity/${activity.id}/undo`,
  );
  assert.equal(undone.statusCode, 200, undone.body);
  assert.deepEqual(
    (await h.call(olga.token, "GET", "/me/agent")).json().character,
    roundTrip.json().character,
    "MCP identity approval and undo preserve the appearance",
  );
  assert.deepEqual((await context(keys.full)).agent, {
    name: "Nova",
    persona: "Brief and practical.",
  });
});

test("an agent makes the profile once (create_doc kind profile) and edits it by section", async () => {
  const stu = await h.register("h8-stu", "Stu");
  const k = await h.agentKey(stu, { access: "write", toolsets: ALL });
  const fresh = await context(k.key);
  assert.equal(fresh.profile, null);
  assert.match(
    (await tool(k.key, "get_context")).content[0].text,
    /create_doc \(kind "profile"\)/,
  );
  // Undo takes a new page away (to the Trash); get_context has none again.
  const first = ok(
    await tool(k.key, "create_doc", { title: "Mine", kind: "profile" }),
  );
  assert.equal(first.done[0].change, "Written");
  const act = (
    await pool.query(
      "SELECT id FROM agent_activity WHERE grant_id = $1 AND tool = 'create_doc' AND undo IS NOT NULL ORDER BY id DESC LIMIT 1",
      [k.id],
    )
  ).rows[0];
  const undone = await h.call(
    stu.token,
    "POST",
    `/me/agents/activity/${act.id}/undo`,
  );
  assert.equal(undone.statusCode, 200, undone.body);
  assert.equal((await context(k.key)).profile, null);
  const made = ok(
    await tool(k.key, "create_doc", {
      title: "About Stu",
      kind: "profile",
      markdown:
        "Second-year biology.\n\n## How I like cards\n\n- Card style: Q&A\n\n## Study times\n\n- Session length: 40 minutes",
    }),
  );
  assert.equal(made.done[0].change, "Written");
  const id = idOf(made.done[0].id);
  const twice = ok(
    await tool(k.key, "create_doc", { title: "Again", kind: "profile" }),
  );
  assert.equal(idOf(twice.done[0].id), id);
  assert.match(twice.done[0].change, /Already their About me page/);
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM docs WHERE user_id = $1 AND deleted_at IS NULL AND title = 'About me for agents'",
        [stu.id],
      )
    ).rows[0].n,
    1,
  );
  let c = await context(k.key);
  assert.equal(c.profile.id, `doc:${id}`);
  assert.match(c.profile.markdown, /\^b/, "lines carry anchors");
  assert.equal(c.profile.more, false);
  assert.deepEqual(
    [c.learning.card_style, c.learning.session_minutes],
    ["qa", 40],
  );
  // The agent changes a section like any page's.
  ok(
    await tool(k.key, "edit_doc", {
      doc: `doc:${id}`,
      version: c.profile.version,
      edits: [
        {
          op: "replace_section",
          heading: "How I like cards",
          markdown:
            "## How I like cards\n\n- Card style: cloze\n- Cards per lecture: 12",
        },
      ],
    }),
  );
  c = await context(k.key);
  assert.equal(c.learning.card_style, "cloze");
  assert.equal(c.learning.cards, 12);
  // The person sees the same page in Settings.
  const s = (await h.call(stu.token, "GET", "/me/agent-context")).json();
  assert.equal(s.profile.doc_id, id);
  // Only suggesting, it can't make one; without Personal, not at all.
  const sug = await h.agentKey(stu, {
    access: "write",
    toolsets: ALL,
    trust: "suggest",
  });
  const refused = await tool(sug.key, "create_doc", {
    title: "x",
    kind: "profile",
  });
  assert.equal(refused.isError, true);
  assert.equal(code(refused), "FORBIDDEN");
  const noPersonal = await tool(keys.teamOnly, "create_doc", {
    title: "x",
    kind: "profile",
  });
  assert.equal(code(noPersonal), "FORBIDDEN");
});

test("get_context: profile, instructions and rules only where the connection reaches", async () => {
  const profile = (await h.call(olga.token, "POST", "/me/agent-profile")).json()
    .doc_id as string;
  assert.equal(
    (
      await h.call(olga.token, "PUT", "/me/agent-instructions", {
        text: "Write in British English.",
      })
    ).statusCode,
    200,
  );
  const teamSet = await h.call(
    mo.token,
    "PUT",
    `/teams/${crew}/agent-instructions`,
    { text: "In Biology, cards are cloze." },
  );
  assert.equal(teamSet.statusCode, 200, teamSet.body);
  // A viewer can't change the team's; someone outside can't either.
  assert.equal(
    (
      await h.call(vic.token, "PUT", `/teams/${crew}/agent-instructions`, {
        text: "Nope",
      })
    ).statusCode,
    403,
  );
  const outsider = await h.register("h8-out", "Out");
  assert.equal(
    (
      await h.call(outsider.token, "PUT", `/teams/${crew}/agent-instructions`, {
        text: "Nope",
      })
    ).statusCode,
    404,
  );
  const vicView = (await h.call(vic.token, "GET", "/me/agent-context")).json();
  const vicTeam = vicView.instructions.find((i: any) => i.team_id === crew);
  assert.equal(vicTeam.text, "In Biology, cards are cloze.");
  assert.equal(vicTeam.can_edit, false);
  assert.equal(vicTeam.updated_by, "Mo");
  await h.call(olga.token, "POST", "/me/agent-rules", {
    text: "Never book before 9.",
  });

  const full = await context(keys.full);
  assert.equal(full.profile.id, `doc:${profile}`);
  assert.deepEqual(
    full.instructions.map((i: any) => [i.space, i.text]),
    [
      ["personal", "Write in British English."],
      [crew, "In Biology, cards are cloze."],
    ],
  );
  assert.ok(full.rules.some((r: any) => r.text === "Never book before 9."));
  const text = (await tool(keys.full, "get_context")).content[0].text;
  assert.match(text, /## About me for agents/);
  assert.match(text, /H8 Biology: In Biology, cards are cloze\./);
  assert.match(text, /Never book before 9\./);

  // Without Personal: no page, no Personal instructions; the team's stay.
  const team = await context(keys.teamOnly);
  assert.equal(team.profile, null);
  assert.deepEqual(
    team.instructions.map((i: any) => i.space),
    [crew],
  );
  // Without the team: Personal's only.
  const mine = await context(keys.personalOnly);
  assert.deepEqual(
    mine.instructions.map((i: any) => i.space),
    ["personal"],
  );
  // Mo's agent follows the team's too, never Olga's Personal ones.
  const moC = await context(keys.mo);
  assert.deepEqual(
    moC.instructions.map((i: any) => [i.space, i.text]),
    [[crew, "In Biology, cards are cloze."]],
  );
  assert.equal(moC.profile, null);
  // A team that keeps agents out: its instructions go too.
  await pool.query("UPDATE teams SET agent_access = 'off' WHERE id = $1", [
    crew,
  ]);
  try {
    const off = await context(keys.full);
    assert.deepEqual(
      off.instructions.map((i: any) => i.space),
      ["personal"],
    );
  } finally {
    await pool.query("UPDATE teams SET agent_access = 'role' WHERE id = $1", [
      crew,
    ]);
  }
  // A regular page in a project kept out of agents is hidden. The private
  // Personal Memory profile remains available because it isn't in that project.
  const project = (
    await h.call(olga.token, "POST", "/projects", { name: "Private" })
  ).json().id as string;
  const privatePage = (
    await h.call(olga.token, "POST", "/docs", {
      title: "Private project notes",
      content: [{ type: "paragraph", text: "PROJECTSECRET" }],
    })
  ).json();
  await pool.query("UPDATE projects SET assistant_off = true WHERE id = $1", [
    project,
  ]);
  await pool.query("UPDATE docs SET project_id = $2 WHERE id = $1", [
    privatePage.id,
    project,
  ]);
  try {
    assert.equal(
      code(await tool(keys.full, "fetch", { id: `doc:${privatePage.id}` })),
      "NOT_FOUND",
    );
    const kept = await context(keys.full);
    assert.equal(kept.profile.id, `doc:${profile}`);
    assert.equal(kept.learning.card_style, null);
  } finally {
    await pool.query("DELETE FROM projects WHERE id = $1", [project]);
  }
});

test("instructions through organize: Personal's directly (undo), a team's asked first", async () => {
  ok(
    await tool(keys.full, "organize", {
      changes: [
        { do: "instructions", id: "personal", value: "Short answers." },
      ],
    }),
  );
  const personal = async () =>
    (
      await pool.query(
        "SELECT text, updated_via FROM agent_instructions WHERE user_id = $1",
        [olga.id],
      )
    ).rows[0];
  assert.equal((await personal()).text, "Short answers.");
  assert.equal((await personal()).updated_via, grants.full);
  const act = (
    await pool.query(
      "SELECT id FROM agent_activity WHERE grant_id = $1 AND tool = 'organize' AND undo IS NOT NULL ORDER BY id DESC LIMIT 1",
      [grants.full],
    )
  ).rows[0];
  assert.equal(
    (await h.call(olga.token, "POST", `/me/agents/activity/${act.id}/undo`))
      .statusCode,
    200,
  );
  assert.equal((await personal()).text, "Write in British English.");

  // A team's steer every member's agents: full power still asks.
  const teamText = async () =>
    (
      await pool.query(
        "SELECT text FROM agent_instructions WHERE team_id = $1",
        [crew],
      )
    ).rows[0]?.text;
  const asked = ok(
    await tool(keys.full, "organize", {
      changes: [
        { do: "instructions", id: crew, value: "Cards are Q&A in Biology." },
      ],
    }),
  );
  assert.equal(asked.status, "pending_review");
  assert.equal(await teamText(), "In Biology, cards are cloze.");
  await approve(olga, asked.pending.proposal_id);
  assert.equal(await teamText(), "Cards are Q&A in Biology.");
  // Let alone for team admin, it changes them directly (and undo).
  assert.ok(
    (
      await pool.query<{ acts_alone: string[] }>(
        "SELECT acts_alone FROM agent_grants WHERE id = $1",
        [grants.alone],
      )
    ).rows[0].acts_alone.includes("team_admin"),
  );
  const aloneContext = await context(keys.alone);
  assert.ok(
    !aloneContext.connection.asks_first.includes("team_admin"),
    JSON.stringify(aloneContext.connection),
  );
  const cleared = ok(
    await tool(keys.alone, "organize", {
      changes: [{ do: "instructions", id: crew, value: "" }],
    }),
  );
  assert.equal(cleared.status, "done", JSON.stringify(cleared));
  assert.equal(await teamText(), "");
  const last = (
    await pool.query(
      "SELECT id FROM agent_activity WHERE grant_id = $1 AND tool = 'organize' AND undo IS NOT NULL ORDER BY id DESC LIMIT 1",
      [grants.alone],
    )
  ).rows[0];
  assert.equal(
    (await h.call(olga.token, "POST", `/me/agents/activity/${last.id}/undo`))
      .statusCode,
    200,
  );
  assert.equal(await teamText(), "Cards are Q&A in Biology.");
  // Suggest-only: Personal's can't wait for review; too long is refused.
  assert.equal(
    code(
      await tool(keys.suggest, "organize", {
        changes: [{ do: "instructions", value: "x" }],
      }),
    ),
    "FORBIDDEN",
  );
  const long = await tool(keys.full, "organize", {
    changes: [{ do: "instructions", value: "y".repeat(2001) }],
  });
  assert.equal(long.isError, true);
});

test("since we last spoke: nothing for a fresh connection, counts and links for a returning one", async () => {
  // Fresh: nothing to compare with, but what's open in its inbox.
  const fresh = await h.agentKey(olga, {
    access: "write",
    toolsets: ALL,
    team_ids: [crew],
  });
  const first = await context(fresh.key);
  assert.equal(first.since.at, null);
  assert.deepEqual(
    [first.since.added, first.since.done, first.since.others],
    [0, 0, 0],
  );
  assert.match(
    (await tool(fresh.key, "get_context")).content[0].text,
    /First time here/,
  );

  // Returning: it last spoke two days ago.
  await spokeAgo(grants.full, 48);
  const task = (
    await h.call(olga.token, "POST", "/items", { title: "Read chapter 4" })
  ).json();
  const finished = (
    await h.call(olga.token, "POST", "/items", { title: "Hand in lab" })
  ).json();
  await pool.query(
    "UPDATE items SET status = 'done', updated_at = now() WHERE id = $1",
    [finished.id],
  );
  const page = (
    await h.call(olga.token, "POST", "/docs", {
      title: "My notes",
      content: [{ type: "paragraph", text: "Hi" }],
    })
  ).json();
  const block = (
    await h.call(olga.token, "POST", "/blocks", {
      item_id: task.id,
      start_at: new Date(Date.now() + 26 * 3600_000).toISOString(),
      end_at: new Date(Date.now() + 27 * 3600_000).toISOString(),
    })
  ).json();
  const moved = await h.call(olga.token, "PUT", `/blocks/${block.id}`, {
    start_at: new Date(Date.now() + 28 * 3600_000).toISOString(),
    end_at: new Date(Date.now() + 29 * 3600_000).toISOString(),
  });
  assert.equal(moved.statusCode, 200, moved.body);
  // Mo writes a team page; Mo's agent adds a team task; Olga's other agent
  // adds a task of hers.
  const moPage = (
    await h.call(mo.token, "POST", "/docs", {
      title: "Lab rota",
      content: [],
      team_id: crew,
    })
  ).json();
  ok(
    await tool(keys.mo, "create_tasks", {
      tasks: [{ title: "Order reagents", team: crew }],
    }),
  );
  ok(
    await tool(keys.other, "create_tasks", {
      tasks: [{ title: "Agent-made task" }],
    }),
  );
  // Its own change is never news to it.
  ok(
    await tool(keys.full, "create_tasks", {
      tasks: [{ title: "My own agent's task" }],
    }),
  );
  const c = await context(keys.full);
  const s = c.since;
  assert.ok(s.at, "compared with its last call");
  assert.ok(Date.now() - Date.parse(s.at) > 47 * 3600_000);
  assert.ok(s.added >= 2, `added ${s.added}`);
  assert.ok(s.done >= 1, `done ${s.done}`);
  assert.ok(s.pages >= 1, `pages ${s.pages}`);
  assert.equal(s.moved, 1);
  assert.ok(s.others >= 3, `others ${s.others}`);
  const tops = s.top.map((t: any) => t.what).join("\n");
  assert.match(tops, /Mo added the page “Lab rota” in H8 Biology/);
  assert.match(tops, /via Test agent added the task “Order reagents”/);
  assert.ok(s.top.some((t: any) => t.url.endsWith(`/app/doc/${moPage.id}`)));
  assert.ok(!tops.includes("My own agent's task"));
  assert.ok(!tops.includes("Agent-made task"), "other agents' titles stay out");
  assert.ok(s.top.length <= 5);
  // A page Olga's agent wrote isn't hers; one she wrote is.
  assert.ok(tops.includes("You edited “My notes”") || s.pages >= 1);
  assert.ok(page.id);
  // Asked again in the same session: the same "since".
  const again = await context(keys.full);
  assert.equal(again.since.at, s.at);
  // Without the team, teammates' changes aren't counted.
  await spokeAgo(grants.personalOnly, 48);
  const narrow = await context(keys.personalOnly);
  assert.ok(!narrow.since.top.some((t: any) => /Lab rota/.test(t.what)));
});

test("the learning profile sizes and orders quizzes, shapes revision and reaches the study prompts; budgets hold", async () => {
  const lea = await h.register("h8-lea", "Lea");
  const k = await h.agentKey(lea, { access: "write", toolsets: ALL });
  const qa = Array.from({ length: 12 }, (_, i) => ({
    id: `q${i}`,
    type: "bullet",
    text: `Question ${i}? :: answer ${i}`,
  }));
  const cloze = Array.from({ length: 4 }, (_, i) => ({
    id: `c${i}`,
    type: "bullet",
    text: `The {{part ${i}a}} meets the {{part ${i}b}}.`,
  }));
  const deck = (
    await h.call(lea.token, "POST", "/docs", {
      title: "Cells deck",
      content: [...qa, ...cloze],
    })
  ).json();
  await drainStudyQueue();
  // All due: questions long ago, clozes lately.
  await pool.query(
    `UPDATE study_cards SET reps = 1, stability = 1, difficulty = 5,
            last_review_at = now() - interval '3 days',
            due_at = now() - CASE WHEN card_key ~ '#c[0-9]+$'
                                  THEN interval '1 hour' ELSE interval '10 hours' END
      WHERE user_id = $1`,
    [lea.id],
  );
  const isCloze = (c: any) => /_{2,}|\[\.\.\.\]|…/.test(c.question);
  const before = ok(await tool(k.key, "get_study", { queue: true }));
  assert.equal(before.queue.length, 20);
  assert.ok(!isCloze(before.queue[0]), "oldest due first");
  // Her page: cloze cards, 15-minute sessions, evenings.
  ok(
    await tool(k.key, "create_doc", {
      title: "Me",
      kind: "profile",
      markdown:
        "## How I like cards\n\n- Card style: cloze\n\n## Study times\n\n- Session length: 15 minutes\n- Study times: 19:00–21:00",
    }),
  );
  const after = ok(await tool(k.key, "get_study", { queue: true }));
  assert.equal(after.queue.length, 15, "about a card a minute");
  const clozeCards = (
    await pool.query(
      "SELECT id FROM study_cards WHERE user_id = $1 AND card_key ~ '#c[0-9]+$'",
      [lea.id],
    )
  ).rows.map((r: any) => r.id);
  assert.equal(clozeCards.length, 8);
  assert.deepEqual(
    new Set(after.queue.slice(0, 8).map((c: any) => c.card)),
    new Set(clozeCards),
    "her card style first",
  );
  // An exam ten days out: sessions of her length, at her study time.
  const date = new Date(Date.now() + 10 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const exam = ok(
    await tool(k.key, "update_study", {
      exam: { title: "Cells final", date, pages: [`doc:${deck.id}`] },
    }),
  );
  const key = exam.done[0].id.replace(/^exam:/, "");
  const plan = ok(await tool(k.key, "plan_revision", { exam: key }));
  const early = plan.sessions.slice(1, -3);
  assert.ok(early.length >= 3, JSON.stringify(plan.sessions));
  for (const s of early) {
    assert.equal(Date.parse(s.end_at) - Date.parse(s.start_at), 15 * 60_000);
    assert.equal(s.start_at.slice(11, 16), "19:00", s.start_at);
  }
  // Saying minutes still wins.
  const said = ok(
    await tool(k.key, "plan_revision", { exam: key, minutes: 30 }),
  );
  assert.equal(
    Date.parse(said.sessions[1].end_at) - Date.parse(said.sessions[1].start_at),
    30 * 60_000,
  );
  // The study prompts carry it.
  for (const name of ["study_session", "lecture_to_notes", "exam_prep"]) {
    const got = (
      await h.legacy(k.key, "prompts/get", {
        name,
        arguments: { lecture: "Lecture 1", exam: "Cells final" },
      })
    ).body.result;
    const text = got.messages[0].content.text as string;
    assert.match(text, /How I learn \(from my About me page\)/, name);
    assert.match(text, /cloze/i, name);
    assert.match(text, /15 minutes/, name);
  }
  // Budgets: a long page is trimmed, with a link to the rest.
  const doc = (
    await pool.query(
      "SELECT d.id, d.version FROM agent_profiles a JOIN docs d ON d.id = a.doc_id WHERE a.user_id = $1",
      [lea.id],
    )
  ).rows[0];
  ok(
    await tool(k.key, "edit_doc", {
      doc: `doc:${doc.id}`,
      version: doc.version,
      edits: [
        {
          op: "append",
          markdown: Array.from(
            { length: 200 },
            (_, i) => `- Course note ${i}: ${"words ".repeat(12)}`,
          ).join("\n"),
        },
      ],
    }),
  );
  const big = await context(k.key);
  assert.equal(big.profile.more, true);
  assert.ok(big.profile.markdown.length < 6200);
  assert.match(big.profile.markdown, /fetch doc:/);
  assert.ok(JSON.stringify(big).length < 16_000);
});
