import "./setup.js";
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
const { pool, transaction } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { assistantPrincipal } =
  await import("../src/modules/agents/assistant.js");
const { replaceAssistantRules } =
  await import("../src/modules/agents/assistant-rules.js");
const { execute } = await import("../src/capabilities/execute.js");
const { registry } = await import("../src/capabilities/index.js");
const { assistantReplayAuthority } =
  await import("../src/capabilities/assistant-replay.js");
const { assertAssistantReplayTargets, assistantReplayReferences } =
  await import("../src/capabilities/assistant-replay-targets.js");
const owners: string[] = [];
const teams: string[] = [];
before(() => migrate());
after(async () => {
  await pool.query("DELETE FROM teams WHERE id=ANY($1::uuid[])", [teams]);
  await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [owners]);
  await pool.end();
});
async function fixture(withJob = false) {
  const id = randomUUID();
  owners.push(id);
  await pool.query(
    "INSERT INTO users(id,email,password_hash,name) VALUES($1,$2,'test','Replay tester')",
    [id, `replay-${id}@example.test`],
  );
  const user = { id, name: "Replay tester", role: "member" as const };
  const p = await assistantPrincipal(user);
  p.assistant_lane = "background";
  const chat = randomUUID();
  const job = randomUUID();
  const project = randomUUID();
  const doc = randomUUID();
  if (withJob) {
    await pool.query(
      "INSERT INTO projects(id,user_id,name) VALUES($1,$2,'Source project')",
      [project, id],
    );
    await pool.query(
      "INSERT INTO docs(id,user_id,project_id,title) VALUES($1,$2,$3,'Source page')",
      [doc, id, project],
    );
    await pool.query(
      "INSERT INTO ai_chats(id,user_id,title,origin) VALUES($1,$2,'Replay source','task')",
      [chat, id],
    );
    await pool.query(
      "INSERT INTO ai_jobs(id,user_id,chat_id,state,sources_checked,run_origin,run_state) VALUES($1,$2,$3,'running',true,'task',$4)",
      [
        job,
        id,
        chat,
        { version: 1, request: { automation: { kind: "task" } } },
      ],
    );
    await pool.query(
      "INSERT INTO assistant_job_sources(job_id,source_kind,source_id) VALUES($1,'doc',$2)",
      [job, doc],
    );
    p.assistant_job_id = job;
  }
  const args = {
    client_ref: randomUUID(),
    tasks: [{ title: "Private cached task title" }],
  };
  const call = (principal = p) =>
    execute(registry, principal, "create_tasks", args, { write: transaction });
  const first = await call();
  assert.equal(first.result.isError, undefined, JSON.stringify(first));
  return { p, user, call, first, chat, job, project, doc };
}
async function held(f: Awaited<ReturnType<typeof fixture>>, p = f.p) {
  const retry = await f.call(p);
  assert.equal(retry.result.isError, true, JSON.stringify(retry));
  assert.match(JSON.stringify(retry.result), /cached result.*held/i);
  assert.doesNotMatch(
    JSON.stringify(retry.result),
    /Private cached task title/,
  );
  assert.deepEqual(retry.targets, []);
  assert.equal(
    (
      await pool.query("SELECT count(*)::int n FROM items WHERE user_id=$1", [
        p.user.id,
      ])
    ).rows[0].n,
    1,
  );
}

async function completedDraftFixture() {
  const f = await fixture();
  await pool.query(
    "INSERT INTO projects(id,user_id,name) VALUES($1,$2,'Draft destination')",
    [f.project, f.user.id],
  );
  await pool.query(
    "INSERT INTO docs(id,user_id,project_id,title) VALUES($1,$2,$3,'Private completed draft title')",
    [f.doc, f.user.id, f.project],
  );
  const draft = randomUUID();
  const done = {
    status: "done",
    done: [
      {
        id: `doc:${f.doc}`,
        title: "Private completed draft title",
        url: "",
        app_url: "",
        version: 1,
        change: "Written",
      },
    ],
    pending: null,
    skipped: [],
  };
  await pool.query(
    "INSERT INTO agent_doc_drafts(id,user_id,grant_id,title,target,done) VALUES($1,$2,$3,'Completed draft','{}',$4)",
    [draft, f.user.id, f.p.grant_id, done],
  );
  const replay = (p = f.p) =>
    execute(
      registry,
      p,
      "append_doc",
      {
        client_ref: randomUUID(),
        draft: `draft:${draft}`,
        finish: true,
      },
      { write: transaction },
    );
  return { ...f, replay };
}

test("a completed draft replays its saved page once without creating another page", async () => {
  const f = await completedDraftFixture();
  const result = await f.replay();
  assert.equal(result.result.isError, undefined, JSON.stringify(result));
  assert.match(JSON.stringify(result.result), /Private completed draft title/);
  assert.equal(
    (
      await pool.query("SELECT count(*)::int n FROM docs WHERE user_id=$1", [
        f.user.id,
      ])
    ).rows[0].n,
    1,
  );
});

test("completed draft result is held after its destination project is excluded", async () => {
  const f = await completedDraftFixture();
  await pool.query("UPDATE projects SET assistant_off=true WHERE id=$1", [
    f.project,
  ]);
  const result = await f.replay();
  assert.equal(result.result.isError, true, JSON.stringify(result));
  assert.doesNotMatch(
    JSON.stringify(result.result),
    /Private completed draft title/,
  );
  assert.deepEqual(result.targets, []);
});

test("completed draft result is held after its saved page is deleted", async () => {
  const f = await completedDraftFixture();
  await pool.query("DELETE FROM docs WHERE id=$1", [f.doc]);
  const result = await f.replay();
  assert.equal(result.result.isError, true, JSON.stringify(result));
  assert.doesNotMatch(
    JSON.stringify(result.result),
    /Private completed draft title/,
  );
  assert.deepEqual(result.targets, []);
});

test("completed draft result uses the earlier caller's restricted Personal scope", async () => {
  const f = await completedDraftFixture();
  const result = await f.replay({ ...f.p, personal: false });
  assert.equal(result.result.isError, true, JSON.stringify(result));
  assert.doesNotMatch(
    JSON.stringify(result.result),
    /Private completed draft title/,
  );
  assert.deepEqual(result.targets, []);
});

test("restoring a completed draft destination returns the saved result without duplicating pages", async () => {
  const f = await completedDraftFixture();
  await pool.query("UPDATE projects SET assistant_off=true WHERE id=$1", [
    f.project,
  ]);
  assert.equal((await f.replay()).result.isError, true);
  await pool.query("UPDATE projects SET assistant_off=false WHERE id=$1", [
    f.project,
  ]);
  const result = await f.replay();
  assert.equal(result.result.isError, undefined, JSON.stringify(result));
  assert.match(JSON.stringify(result.result), /Private completed draft title/);
  assert.equal(
    (
      await pool.query("SELECT count(*)::int n FROM docs WHERE user_id=$1", [
        f.user.id,
      ])
    ).rows[0].n,
    1,
  );
});

test("unchanged assistant authority replays the original result without another mutation", async () => {
  const f = await fixture();
  const retry = await f.call();
  assert.equal(retry.result.isError, undefined);
  assert.equal(retry.replayed, true);
  assert.deepEqual(retry.targets, f.first.targets);
  assert.equal(
    (
      await pool.query("SELECT count(*)::int n FROM items WHERE user_id=$1", [
        f.user.id,
      ])
    ).rows[0].n,
    1,
  );
});
test("refreshed rules cannot bypass authorization using an old cached result", async () => {
  const f = await fixture();
  await replaceAssistantRules(f.user.id, {
    expected_revision: 1,
    rules: [
      {
        id: randomUUID(),
        lane: "background",
        action: "create",
        scope: { kind: "all" },
        decision: "deny",
      },
    ],
  });
  const current = await assistantPrincipal(f.user);
  current.assistant_lane = "background";
  await held(f, current);
});
test("narrowed Personal scope with an otherwise allowed capability holds cached private content", async () => {
  const f = await fixture();
  await pool.query("UPDATE agent_grants SET personal=false WHERE id=$1", [
    f.p.grant_id,
  ]);
  await held(f);
});
test("changing the server-selected lane holds an earlier lane's cached result", async () => {
  const f = await fixture();
  f.p.assistant_lane = "overnight";
  await held(f);
});
test("legacy assistant results without authority evidence are held without repeating work", async () => {
  const f = await fixture();
  await pool.query(
    "UPDATE mcp_request_state SET value=value-'assistant_authority' WHERE grant_id=$1 AND kind='client_ref'",
    [f.p.grant_id],
  );
  await held(f);
});
test("unchanged producing job and source evidence allow an idempotent replay", async () => {
  const f = await fixture(true);
  assert.equal((await f.call()).replayed, true);
});
test("source project excluded from AI holds the cached producing job result", async () => {
  const f = await fixture(true);
  await pool.query("UPDATE projects SET assistant_off=true WHERE id=$1", [
    f.project,
  ]);
  await held(f);
});
test("deleted source holds the cached result even when grant authority is unchanged", async () => {
  const f = await fixture(true);
  await pool.query("DELETE FROM docs WHERE id=$1", [f.doc]);
  await held(f);
});
test("unknown source evidence and deleted producing jobs cannot replay cached content", async () => {
  const f = await fixture(true);
  await pool.query("UPDATE ai_jobs SET sources_checked=false WHERE id=$1", [
    f.job,
  ]);
  await held(f);
  await pool.query("DELETE FROM ai_jobs WHERE id=$1", [f.job]);
  await held(f);
});
test("stricter trust holds the old completed result without making another proposal or task", async () => {
  const f = await fixture();
  await pool.query("UPDATE agent_grants SET trust='ask' WHERE id=$1", [
    f.p.grant_id,
  ]);
  await held(f);
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int n FROM proposals WHERE user_id=$1",
        [f.user.id],
      )
    ).rows[0].n,
    0,
  );
});
test("authority digest ignores names and set ordering, but binds effective job and flags", async () => {
  const f = await fixture();
  const p = structuredClone(f.p);
  p.trust.spaces = { personal: "full", [randomUUID()]: "ask" };
  const before = assistantReplayAuthority(p);
  p.user.name = "Renamed owner";
  p.client.name = "Renamed assistant";
  p.toolsets.reverse();
  p.trust.spaces = Object.fromEntries(Object.entries(p.trust.spaces).reverse());
  assert.equal(assistantReplayAuthority(p), before);
  p.assistant_job_id = randomUUID();
  assert.notEqual(assistantReplayAuthority(p), before);
  delete p.assistant_job_id;
  p.flags.hide_outside_content = !p.flags.hide_outside_content;
  assert.notEqual(assistantReplayAuthority(p), before);
});
test("cached task receipt is held when its current project is kept out of AI", async () => {
  const f = await fixture();
  await pool.query(
    "INSERT INTO projects(id,user_id,name,assistant_off) VALUES($1,$2,'Kept out',true)",
    [f.project, f.user.id],
  );
  const task = f.first.targets[0].replace(/^task:/, "");
  await pool.query("UPDATE items SET project_id=$2 WHERE id=$1", [
    task,
    f.project,
  ]);
  await held(f);
});
test("a producing source moved into a newly joined team does not expand caller scope", async () => {
  const f = await fixture(true);
  const team = randomUUID();
  teams.push(team);
  await pool.query("INSERT INTO teams(id,name) VALUES($1,'New team')", [team]);
  await pool.query(
    "INSERT INTO team_members(team_id,user_id,role) VALUES($1,$2,'owner')",
    [team, f.user.id],
  );
  await pool.query("UPDATE docs SET team_id=$2,project_id=NULL WHERE id=$1", [
    f.doc,
    team,
  ]);
  await held(f);
});

test("all persistent receipt families preserve authorized replay and reject another owner", async () => {
  const f = await fixture();
  const other = await fixture();
  await pool.query(
    "INSERT INTO docs(id,user_id,title) VALUES($1,$2,'Receipt page')",
    [f.doc, f.user.id],
  );
  const seeds: [string, string][] = [
    ["doc", "INSERT INTO docs(user_id,title) VALUES($1,'Page')"],
    ["project", "INSERT INTO projects(user_id,name) VALUES($1,'Project')"],
    [
      "record",
      "INSERT INTO work_records(created_by,kind,title) VALUES($1,'promise','Record')",
    ],
    ["goal", "INSERT INTO goals(user_id,title) VALUES($1,'Goal')"],
    [
      "routine",
      "INSERT INTO agent_routines(user_id,instruction,rrule,next_run_at) VALUES($1,'Read','FREQ=DAILY',now())",
    ],
    [
      "habit",
      "INSERT INTO habits(user_id,name,cadence,duration_minutes) VALUES($1,'Habit',1,30)",
    ],
    [
      "calendar",
      "INSERT INTO calendar_subscriptions(user_id,name,url) VALUES($1,'Calendar','https://example.test/calendar')",
    ],
    [
      "template",
      "INSERT INTO project_templates(user_id,name,tasks) VALUES($1,'Template','[]')",
    ],
    [
      "page_template",
      "INSERT INTO page_templates(user_id,name) VALUES($1,'Page template')",
    ],
    [
      "view",
      "INSERT INTO saved_views(user_id,name,source,definition) VALUES($1,'View','tasks','{}')",
    ],
    ["folder", "INSERT INTO folders(user_id,name) VALUES($1,'Folder')"],
    ["list", "INSERT INTO lists(user_id,name) VALUES($1,'List')"],
    ["tag", "INSERT INTO tags(user_id,name) VALUES($1,'Tag')"],
    [
      "field",
      "INSERT INTO custom_fields(user_id,name,applies_to,type) VALUES($1,'Field','page','text')",
    ],
    [
      "source",
      "INSERT INTO sources(user_id,title,url,accessed_on) VALUES($1,'Source','https://example.test/source',current_date)",
    ],
    [
      "frame",
      "INSERT INTO frames(user_id,name,days,start_time,end_time) VALUES($1,'Frame','{1}','09:00','10:00')",
    ],
    [
      "place",
      "INSERT INTO places(user_id,label,match,travel_minutes) VALUES($1,'Place','Place',10)",
    ],
    [
      "card",
      "INSERT INTO study_cards(user_id,doc_id,card_key,question,answer) SELECT $1,id,'card','Q','A' FROM docs WHERE user_id=$1 LIMIT 1",
    ],
    [
      "exam",
      "INSERT INTO study_exams(user_id,exam_key,title,starts_at,own) VALUES($1,'own:receipt','Exam',now()+interval '1 day',true)",
    ],
    [
      "focus",
      "INSERT INTO focus_sessions(id,user_id,kind,started_at,ended_at,planned_minutes,minutes,completed) VALUES(gen_random_uuid(),$1,'work',now()-interval '30 minutes',now(),30,30,true)",
    ],
    [
      "import",
      "INSERT INTO imports(user_id,file_name,file_type,bytes) VALUES($1,'Synthetic.pdf','pdf',1)",
    ],
    [
      "draft",
      "INSERT INTO agent_doc_drafts(user_id,grant_id,title) SELECT $1,id,'Draft' FROM agent_grants WHERE user_id=$1 AND kind='assistant'",
    ],
    [
      "question",
      "INSERT INTO agent_questions(user_id,grant_id,question,choices,expires_at) SELECT $1,id,'Question','{}',now()+interval '1 day' FROM agent_grants WHERE user_id=$1 AND kind='assistant'",
    ],
    [
      "inbox",
      "INSERT INTO agent_inbox(user_id,grant_id,kind,dedupe_key,title) SELECT $1,id,'ask','receipt','Inbox' FROM agent_grants WHERE user_id=$1 AND kind='assistant'",
    ],
    [
      "change",
      "INSERT INTO agent_activity(user_id,grant_id,tool,outcome) SELECT $1,id,'test','ok' FROM agent_grants WHERE user_id=$1 AND kind='assistant'",
    ],
    [
      "proposal",
      "INSERT INTO proposals(user_id,grant_id,actions) SELECT $1,id,'[]' FROM agent_grants WHERE user_id=$1 AND kind='assistant'",
    ],
  ];
  const answer = (targets: string[]) => ({
    structured: {},
    markdown: "Receipt",
    targets,
    outcome: "ok" as const,
  });
  const refs: string[] = [
    f.first.targets[0],
    f.first.targets[0].replace("task:", "event:"),
  ];
  for (const [kind, sql] of seeds) {
    const row = (await pool.query(`${sql} RETURNING id::text`, [f.user.id]))
      .rows[0];
    refs.push(`${kind}:${row.id}`);
  }
  refs.push("exam:own:receipt");
  const page = (
    await pool.query(
      "INSERT INTO booking_pages(owner_id,slug,title) VALUES($1,$2,'Booking') RETURNING id",
      [f.user.id, `replay-${randomUUID()}`],
    )
  ).rows[0].id;
  const booking = (
    await pool.query(
      "INSERT INTO bookings(page_id,start_at,end_at,name,email) VALUES($1,now(),now()+interval '1 hour','Synthetic','synthetic@example.test') RETURNING id",
      [page],
    )
  ).rows[0].id;
  refs.push(`booking:${booking}`);
  for (const ref of refs) {
    await assertAssistantReplayTargets(pool, f.p, answer([ref]));
    await assert.rejects(
      assertAssistantReplayTargets(pool, other.p, answer([ref])),
      /cached result.*held/i,
      ref,
    );
  }
  await assertAssistantReplayTargets(pool, f.p, answer(refs));
});
test("synthetic settings/focus receipts remain idempotent and honor Personal scope", async () => {
  const f = await fixture();
  const targets = [
    "settings:planner",
    "settings:originals",
    "settings:agent",
    "focus:current",
    "instructions:personal",
  ];
  const answer = {
    structured: {},
    markdown: "",
    targets,
    outcome: "ok" as const,
  };
  await assertAssistantReplayTargets(pool, f.p, answer);
  await assert.rejects(
    assertAssistantReplayTargets(pool, { ...f.p, personal: false }, answer),
    /cached result.*held/i,
  );
  await assert.rejects(
    assertAssistantReplayTargets(pool, f.p, {
      ...answer,
      targets: ["settings:unknown"],
    }),
    /cached result.*held/i,
  );
});
test("structured destination links are checked without interpreting prose or step labels", () => {
  const id = randomUUID();
  const answer = {
    structured: {
      steps: [
        {
          id: "step-one",
          done: [
            {
              id: "focus:current",
              url: `http://localhost:8080/app/task/${id}`,
            },
          ],
        },
      ],
      note: `doc:${randomUUID()}`,
    },
    markdown: `doc:${randomUUID()}`,
    outcome: "ok" as const,
  };
  assert.deepEqual(assistantReplayReferences(answer), [
    { kind: "focus", id: "current" },
    { kind: "task", id },
  ]);
});
test("team and team instruction receipts use effective membership, not owner membership alone", async () => {
  const f = await fixture();
  const team = randomUUID();
  teams.push(team);
  await pool.query("INSERT INTO teams(id,name) VALUES($1,'Receipt team')", [
    team,
  ]);
  await pool.query(
    "INSERT INTO team_members(team_id,user_id,role) VALUES($1,$2,'owner')",
    [team, f.user.id],
  );
  const p = await assistantPrincipal(f.user);
  const answer = {
    structured: {},
    markdown: "",
    targets: [`team:${team}`, `instructions:${team}`],
    outcome: "ok" as const,
  };
  await assertAssistantReplayTargets(pool, p, answer);
  await assert.rejects(
    assertAssistantReplayTargets(pool, f.p, answer),
    /cached result.*held/i,
  );
  await pool.query("UPDATE teams SET agent_access='off' WHERE id=$1", [team]);
  await assert.rejects(
    assertAssistantReplayTargets(pool, p, answer),
    /cached result.*held/i,
  );
});
test("restoring cached target access permits the same original answer without repeating work", async () => {
  const f = await fixture();
  await pool.query(
    "INSERT INTO projects(id,user_id,name,assistant_off) VALUES($1,$2,'Held then restored',true)",
    [f.project, f.user.id],
  );
  await pool.query("UPDATE items SET project_id=$2 WHERE id=$1", [
    f.first.targets[0].slice(5),
    f.project,
  ]);
  await held(f);
  await pool.query("UPDATE projects SET assistant_off=false WHERE id=$1", [
    f.project,
  ]);
  const replay = await f.call();
  assert.equal(replay.replayed, true, JSON.stringify(replay));
  assert.deepEqual(replay.targets, f.first.targets);
  assert.equal(
    (
      await pool.query("SELECT count(*)::int n FROM items WHERE user_id=$1", [
        f.user.id,
      ])
    ).rows[0].n,
    1,
  );
});
test("cached synthetic receipts also check their original destination link", async () => {
  const f = await fixture();
  const task = f.first.targets[0].slice(5);
  const answer = {
    structured: {
      done: [
        { id: "focus:current", url: `http://localhost:8080/app/task/${task}` },
      ],
    },
    markdown: "",
    targets: ["focus:current"],
    outcome: "ok" as const,
  };
  await assertAssistantReplayTargets(pool, f.p, answer);
  await pool.query(
    "INSERT INTO projects(id,user_id,name,assistant_off) VALUES($1,$2,'Hidden focus source',true)",
    [f.project, f.user.id],
  );
  await pool.query("UPDATE items SET project_id=$2 WHERE id=$1", [
    task,
    f.project,
  ]);
  await assert.rejects(
    assertAssistantReplayTargets(pool, f.p, answer),
    /cached result.*held/i,
  );
});
