import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import "./setup.js";
import { defaultNightShift } from "@orbyn/core";
const { pool, transaction } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { assistantPrincipal } =
  await import("../src/modules/agents/assistant.js");
const { reflectionEvidence, pendingReflectionSources, claimReflectionSources } =
  await import("../src/modules/ai/agent/reflection.js");
const { recordAssistantSources, visibleAssistantJobs } =
  await import("../src/lib/assistant-job-sources.js");
const { scanNightShift } = await import("../src/worker/night-shift.js");
const { latestNight } =
  await import("../src/modules/assistant-workspace/overnight.js");
const users: string[] = [];
const teams: string[] = [];
before(() => migrate());
after(async () => {
  await pool.query("DELETE FROM teams WHERE id=ANY($1::uuid[])", [teams]);
  await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [users]);
  await pool.end();
});
async function person() {
  const id = randomUUID();
  users.push(id);
  await pool.query(
    "INSERT INTO users(id,email,password_hash,name) VALUES($1,$2,'test','Reflection tester')",
    [id, `reflection-${id}@example.test`],
  );
  await assistantPrincipal({ id, name: "Reflection tester", role: "member" });
  return id;
}
// Evidence precedes the JS scan cutoff: Postgres timestamps have microseconds,
// while Date only has milliseconds. Same-tick fixture inserts can look newer.
async function source(user: string, project: string | null = null) {
  const chat = randomUUID();
  const job = randomUUID();
  await pool.query(
    "INSERT INTO ai_chats(id,user_id,title,origin,project_id) VALUES($1,$2,'Review draft','person',$3)",
    [chat, user, project],
  );
  await pool.query(
    "INSERT INTO ai_jobs(id,user_id,chat_id,turn_id,state,result,sources_checked,created_at) VALUES($1,$2,$3,$4,'done',$5::jsonb,true,now()-interval '1 second')",
    [
      job,
      user,
      chat,
      randomUUID(),
      JSON.stringify({
        answer: "The draft is complete; one question remains.",
      }),
    ],
  );
  return { chat, job };
}
async function task(user: string) {
  return (
    await pool.query(
      "INSERT INTO items(user_id,title,notes,updated_at) VALUES($1,'Review the draft','Check the sources',now()-interval '1 second') RETURNING id",
      [user],
    )
  ).rows[0].id as string;
}
async function reflectionJob(user: string) {
  return (
    await pool.query(
      "INSERT INTO ai_jobs(user_id,state) VALUES($1,'queued') RETURNING id",
      [user],
    )
  ).rows[0].id as string;
}
async function enableReflection(user: string, now: Date) {
  const prefs = defaultNightShift();
  prefs.enabled = true;
  prefs.start = "00:00";
  prefs.end = "23:59";
  for (const kind of Object.keys(prefs.kinds) as (keyof typeof prefs.kinds)[])
    prefs.kinds[kind] = kind === "reflection";
  await pool.query(
    "INSERT INTO agent_settings(user_id,night_shift) VALUES($1,$2::jsonb) ON CONFLICT(user_id) DO UPDATE SET night_shift=EXCLUDED.night_shift",
    [user, JSON.stringify(prefs)],
  );
  return prefs;
}

test("reflection evidence is bounded, current and excludes another person's work", async () => {
  const user = await person();
  const other = await person();
  const own = await source(user);
  await source(other);
  const ownTask = await task(user);
  await task(other);
  const first = await pendingReflectionSources(pool, user, new Date());
  assert.equal(first.length, 2);
  assert.ok(first.some((s) => s.kind === "job" && s.id === own.job));
  assert.ok(first.some((s) => s.kind === "task" && s.id === ownTask));
  await pool.query(
    "UPDATE ai_jobs SET last_polled_at=now(),heartbeat_at=now() WHERE id=$1",
    [own.job],
  );
  assert.deepEqual(
    await pendingReflectionSources(pool, user, new Date()),
    first,
    "polling is not new evidence",
  );
  await pool.query(
    "UPDATE items SET status='done',version=version+1 WHERE id=$1",
    [ownTask],
  );
  const current = await reflectionEvidence(pool, user, first);
  assert.equal(
    current.length,
    1,
    "a queued stale task revision is not sent to the model",
  );
  for (let i = 0; i < 24; i++) await task(user);
  assert.equal(
    (await pendingReflectionSources(pool, user, new Date())).length,
    20,
  );
});

test("reflection uses current Personal scope when collecting and rechecking evidence", async () => {
  const user = await person();
  const own = await source(user);
  const ownTask = await task(user);
  const now = new Date();
  const allowed = { userId: user, teamIds: [], personal: true };
  const denied = { ...allowed, personal: false };
  const selected = await pendingReflectionSources(pool, user, now, allowed);
  assert.equal(selected.length, 2);
  assert.ok(selected.some((entry) => entry.id === own.job));
  assert.ok(selected.some((entry) => entry.id === ownTask));
  assert.deepEqual(await pendingReflectionSources(pool, user, now, denied), []);
  assert.deepEqual(
    await reflectionEvidence(pool, user, selected, now, denied),
    [],
  );
  assert.equal(
    (await reflectionEvidence(pool, user, selected, now, allowed)).length,
    2,
  );
});

test("reflection restricts teams and rechecks membership and project exclusions", async () => {
  const user = await person();
  const owner = await person();
  const jobs: string[] = [];
  const tasks: string[] = [];
  const projects: string[] = [];
  for (let index = 0; index < 2; index++) {
    const team = randomUUID();
    teams.push(team);
    await pool.query(
      "INSERT INTO teams(id,name,created_by) VALUES($1,'Reflection team',$2)",
      [team, owner],
    );
    await pool.query(
      "INSERT INTO team_members(team_id,user_id,role) VALUES($1,$2,'owner'),($1,$3,'member')",
      [team, owner, user],
    );
    const project = (
      await pool.query(
        "INSERT INTO projects(user_id,team_id,name) VALUES($1,$2,'Team evidence') RETURNING id",
        [owner, team],
      )
    ).rows[0].id;
    projects.push(project);
    jobs.push((await source(user, project)).job);
    tasks.push(
      (
        await pool.query(
          "INSERT INTO items(user_id,team_id,project_id,title,updated_at) VALUES($1,$2,$3,'Team task',now()-interval '1 second') RETURNING id",
          [owner, team, project],
        )
      ).rows[0].id,
    );
  }
  const scope = { userId: user, teamIds: [teams.at(-2)!], personal: false };
  const now = new Date();
  const selected = await pendingReflectionSources(pool, user, now, scope);
  assert.deepEqual(
    new Set(selected.map((entry) => entry.id)),
    new Set([jobs[0], tasks[0]]),
  );
  assert.deepEqual(
    await reflectionEvidence(pool, user, selected, now, {
      ...scope,
      teamIds: [teams.at(-1)!],
    }),
    [],
  );
  await pool.query("UPDATE projects SET assistant_off=true WHERE id=$1", [
    projects[0],
  ]);
  assert.deepEqual(
    await reflectionEvidence(pool, user, selected, now, scope),
    [],
  );
  await pool.query("UPDATE projects SET assistant_off=false WHERE id=$1", [
    projects[0],
  ]);
  await pool.query("DELETE FROM team_members WHERE team_id=$1 AND user_id=$2", [
    scope.teamIds[0],
    user,
  ]);
  assert.deepEqual(
    await reflectionEvidence(pool, user, selected, now, scope),
    [],
  );
  assert.deepEqual(await pendingReflectionSources(pool, user, now, scope), []);
});

test("reflection rejects a scope belonging to another principal", async () => {
  const user = await person();
  const other = await person();
  await source(user);
  await task(other);
  const restriction = { userId: other, teamIds: null, personal: true };
  assert.deepEqual(
    await reflectionEvidence(pool, user, undefined, new Date(), restriction),
    [],
  );
  assert.deepEqual(
    await pendingReflectionSources(pool, user, new Date(), restriction),
    [],
  );
});

test("reflection scan cutoff excludes later evidence at sub-millisecond precision", async () => {
  const user = await person();
  const original = await source(user);
  const cutoff = new Date("2026-10-02T01:00:00.000Z");
  await pool.query(
    "UPDATE ai_jobs SET created_at=$2::timestamptz+interval '0.5 milliseconds' WHERE id=$1",
    [original.job, cutoff],
  );
  assert.deepEqual(await pendingReflectionSources(pool, user, cutoff), []);
  const included = await pendingReflectionSources(
    pool,
    user,
    new Date(cutoff.getTime() + 1),
  );
  assert.equal(included.length, 1);
  assert.equal(included[0].id, original.job);
});

test("reflection distinguishes failed work and the question still awaiting a person", async () => {
  const user = await person();
  const failed = await source(user);
  const waiting = await source(user);
  await pool.query(
    "UPDATE ai_jobs SET state='failed',result=NULL,error_message='The document became unavailable.' WHERE id=$1",
    [failed.job],
  );
  await pool.query(
    "UPDATE ai_jobs SET state='waiting',result=NULL,run_state=$2::jsonb WHERE id=$1",
    [
      waiting.job,
      JSON.stringify({
        state: {
          waiting: { kind: "question", question: "Which draft should I use?" },
        },
      }),
    ],
  );
  const evidence = await reflectionEvidence(pool, user);
  assert.equal(
    evidence.find((entry) => entry.source.id === failed.job)?.facts.failure,
    "The document became unavailable.",
  );
  const question = evidence.find((entry) => entry.source.id === waiting.job)!;
  assert.equal(question.facts.question, "Which draft should I use?");
  assert.equal(question.facts.waiting_for, "question");
  assert.equal(question.facts.failure, null);
});

test("receipts prevent duplicate reflections and only failed runs may retry", async () => {
  const user = await person();
  await source(user);
  await task(user);
  const refs = await pendingReflectionSources(pool, user, new Date());
  const job = await reflectionJob(user);
  await transaction((db) => claimReflectionSources(db, user, job, refs));
  assert.deepEqual(await pendingReflectionSources(pool, user, new Date()), []);
  await assert.rejects(
    transaction((db) => claimReflectionSources(db, user, job, refs)),
    /already has a reflection/,
  );
  await pool.query("UPDATE ai_jobs SET state='failed' WHERE id=$1", [job]);
  assert.deepEqual(
    await pendingReflectionSources(pool, user, new Date()),
    refs,
  );
  const retry = await reflectionJob(user);
  await transaction((db) => claimReflectionSources(db, user, retry, refs));
  await pool.query("UPDATE ai_jobs SET state='done' WHERE id=$1", [retry]);
  assert.deepEqual(await pendingReflectionSources(pool, user, new Date()), []);
});

test("deleted and kept-out sources block both new evidence and saved derived output", async () => {
  const user = await person();
  const project = (
    await pool.query(
      "INSERT INTO projects(user_id,name) VALUES($1,'Private project') RETURNING id",
      [user],
    )
  ).rows[0].id;
  const original = await source(user, project);
  const refs = await pendingReflectionSources(pool, user, new Date());
  const evidence = await reflectionEvidence(pool, user, refs);
  assert.equal(
    evidence.length,
    1,
    "the fixture must supply the source being revoked",
  );
  assert.equal(evidence[0].source.id, original.job);
  const derived = await source(user);
  await recordAssistantSources(derived.job, user, evidence);
  assert.ok(
    (await visibleAssistantJobs(pool, user, [derived.job])).has(derived.job),
  );
  await pool.query("UPDATE projects SET assistant_off=true WHERE id=$1", [
    project,
  ]);
  assert.equal((await reflectionEvidence(pool, user, refs)).length, 0);
  assert.equal((await visibleAssistantJobs(pool, user, [derived.job])).size, 0);
  await pool.query("UPDATE projects SET assistant_off=false WHERE id=$1", [
    project,
  ]);
  await pool.query("DELETE FROM ai_chats WHERE id=$1", [original.chat]);
  assert.equal((await visibleAssistantJobs(pool, user, [derived.job])).size, 0);
});

test("reflection retains underlying document permissions through source transcripts", async () => {
  const user = await person();
  const project = (
    await pool.query(
      "INSERT INTO projects(user_id,name) VALUES($1,'Source documents') RETURNING id",
      [user],
    )
  ).rows[0].id;
  const doc = (
    await pool.query(
      "INSERT INTO docs(user_id,project_id,title) VALUES($1,$2,'Source evidence') RETURNING id",
      [user, project],
    )
  ).rows[0].id;
  const original = await source(user);
  await recordAssistantSources(original.job, user, { kind: "doc", id: doc });
  const refs = await pendingReflectionSources(pool, user, new Date());
  const evidence = await reflectionEvidence(pool, user, refs);
  assert.equal(
    evidence.length,
    1,
    "the fixture must supply the source being revoked",
  );
  assert.equal(evidence[0].source.id, original.job);
  const derived = await source(user);
  await recordAssistantSources(derived.job, user, evidence);
  const dependencies = (
    await pool.query(
      "SELECT source_kind,source_id FROM assistant_job_sources WHERE job_id=$1 ORDER BY source_kind,source_id",
      [derived.job],
    )
  ).rows;
  assert.ok(
    dependencies.some(
      (entry) =>
        entry.source_kind === "chat" && entry.source_id === original.chat,
    ),
  );
  assert.ok(
    dependencies.some(
      (entry) => entry.source_kind === "doc" && entry.source_id === doc,
    ),
  );
  assert.ok(
    (await visibleAssistantJobs(pool, user, [derived.job])).has(derived.job),
  );
  await pool.query("UPDATE projects SET assistant_off=true WHERE id=$1", [
    project,
  ]);
  assert.equal((await reflectionEvidence(pool, user, refs)).length, 0);
  assert.equal((await visibleAssistantJobs(pool, user, [derived.job])).size, 0);
  await pool.query("UPDATE projects SET assistant_off=false WHERE id=$1", [
    project,
  ]);
  assert.ok(
    (await visibleAssistantJobs(pool, user, [derived.job])).has(derived.job),
  );
  await pool.query("DELETE FROM docs WHERE id=$1", [doc]);
  assert.equal((await visibleAssistantJobs(pool, user, [derived.job])).size, 0);
});

test("a night without new evidence queues no reflection or provider work", async () => {
  const user = await person();
  const now = new Date();
  now.setUTCHours(12, 0, 0, 0);
  await enableReflection(user, now);
  const count = await scanNightShift(now, { only: [user], ai: {} as never });
  assert.equal(count, 0);
  assert.equal(
    (await pool.query("SELECT 1 FROM ai_jobs WHERE user_id=$1", [user]))
      .rowCount,
    0,
  );
});

test("the scanner claims one reflection with references only and numbered source links", async () => {
  const user = await person();
  const original = await source(user);
  await task(user);
  // A real-current window, with enough time remaining for a scheduled run.
  const now = new Date();
  now.setUTCSeconds(now.getUTCSeconds() + 2);
  await enableReflection(user, now);
  assert.equal(await scanNightShift(now, { only: [user], ai: {} as never }), 1);
  assert.equal(await scanNightShift(now, { only: [user], ai: {} as never }), 0);
  const run = (
    await pool.query(
      "SELECT j.* FROM assistant_night_runs nr JOIN ai_jobs j ON j.id=nr.job_id WHERE j.user_id=$1 AND nr.kind='reflection'",
      [user],
    )
  ).rows[0];
  assert.equal(run.runtime_lane, "overnight");
  const request = run.run_state.request;
  assert.equal(request.automation.reflection_sources.length, 2);
  assert.doesNotMatch(
    JSON.stringify(request),
    /The draft is complete|Check the sources/,
  );
  assert.ok(run.run_state.state.token_budget <= 30000);
  const evidence = await reflectionEvidence(
    pool,
    user,
    request.automation.reflection_sources,
  );
  await recordAssistantSources(run.id, user, evidence);
  const night = await transaction((db) => latestNight(db, user));
  const card = night!.runs.find((r) => r.kind === "reflection")!;
  assert.equal(card.reflection_sources?.length, 2);
  assert.deepEqual(
    card.reflection_sources?.map((s) => s.number),
    [1, 2],
  );
  assert.ok(
    card.reflection_sources?.some(
      (s) => s.kind === "chat" && s.id === original.chat,
    ),
  );
  await pool.query("UPDATE ai_jobs SET state='done' WHERE id=$1", [run.id]);
  assert.deepEqual(
    await pendingReflectionSources(pool, user, now),
    [],
    "the reflection itself is never fresh evidence",
  );
});

test("the real Overnight worker saves a reflection but refuses inferred memory writes under full trust", async () => {
  const { createServer } = await import("node:http");
  const { startTestAssistantRuntime } =
    await import("./helpers/assistant-runtime.js");
  const user = await person();
  await source(user);
  const now = new Date();
  now.setUTCSeconds(now.getUTCSeconds() + 2);
  const prefs = await enableReflection(user, now);
  prefs.wait_for_ok = false;
  await pool.query(
    "UPDATE agent_settings SET night_shift=$2::jsonb WHERE user_id=$1",
    [user, JSON.stringify(prefs)],
  );
  await pool.query(
    "UPDATE agent_grants SET trust='full',space_trust='{}'::jsonb WHERE user_id=$1 AND kind='assistant'",
    [user],
  );
  let calls = 0;
  const sent: string[] = [];
  const toolResults: string[] = [];
  let beforeReply: (() => Promise<void>) | undefined;
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const request = JSON.parse(body);
    calls++;
    sent.push(body);
    await beforeReply?.();
    const names =
      request.tools?.map((tool: any) => tool.function?.name ?? tool.name) ?? [];
    const previous = [...request.messages]
      .reverse()
      .find((message: any) => message.role === "tool");
    if (previous) toolResults.push(previous.content);
    const tool = names.includes("delegate")
      ? previous
        ? {
            name: "finish",
            arguments: {
              answer:
                "What happened: the draft finished [1]. Lessons to consider: shorter tasks may help; this is an interpretation. Open questions: confirm the next review. Suggested next actions: review the draft.",
              steps: [],
            },
          }
        : {
            name: "delegate",
            arguments: {
              tasks: [
                {
                  specialist: "memory",
                  brief:
                    "Remember the inferred lesson that I dislike long tasks.",
                  want_options: false,
                },
              ],
            },
          }
      : previous
        ? {
            name: "report",
            arguments: {
              status: "done",
              summary: "The inferred lesson was not saved.",
              findings: [],
              steps: [],
              open_questions: [],
            },
          }
        : {
            name: "manage_memory",
            arguments: {
              action: "remember",
              topic: "Inferred lesson",
              facts: ["Dislikes long tasks"],
            },
          };
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        choices: [
          {
            finish_reason: "tool_calls",
            message: {
              content: null,
              tool_calls: [
                {
                  id: `call_${calls}`,
                  type: "function",
                  function: {
                    name: tool.name,
                    arguments: JSON.stringify(tool.arguments),
                  },
                },
              ],
            },
          },
        ],
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`;
  const old = (
    await pool.query("SELECT provider_id,model FROM ai_settings WHERE id")
  ).rows[0];
  const provider = (
    await pool.query(
      "INSERT INTO ai_providers(kind,name,base_url) VALUES('openai-compatible','Reflection test',$1) RETURNING id",
      [url],
    )
  ).rows[0].id;
  let stop: (() => Promise<void>) | undefined;
  try {
    await pool.query(
      "UPDATE ai_settings SET provider_id=$1,model='reflection-test' WHERE id",
      [provider],
    );
    assert.equal(
      await scanNightShift(now, { only: [user], ai: {} as never }),
      1,
    );
    const job = (
      await pool.query(
        "SELECT j.id FROM assistant_night_runs nr JOIN ai_jobs j ON j.id=nr.job_id WHERE j.user_id=$1 AND nr.kind='reflection'",
        [user],
      )
    ).rows[0].id;
    stop = await startTestAssistantRuntime("overnight");
    let saved: any;
    for (let attempt = 0; attempt < 200; attempt++) {
      saved = (
        await pool.query(
          "SELECT state,result,chat_id FROM ai_jobs WHERE id=$1",
          [job],
        )
      ).rows[0];
      if (saved.state === "done" || saved.state === "failed") break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.equal(saved.state, "done", JSON.stringify(saved));
    assert.match(saved.result.answer, /What happened/);
    assert.ok(
      sent.some((body) => body.includes("The draft is complete")),
      "source evidence reaches the lead",
    );
    assert.ok(
      toolResults.some((text) => /no changes may be staged/i.test(text)),
      "the attempted memory write is refused",
    );
    assert.equal(
      (
        await pool.query(
          "SELECT 1 FROM docs WHERE user_id=$1 AND title='Inferred lesson'",
          [user],
        )
      ).rowCount,
      0,
    );
    assert.equal(
      (
        await pool.query("SELECT 1 FROM memory_queue WHERE chat_id=$1", [
          saved.chat_id,
        ])
      ).rowCount,
      0,
    );
    assert.equal(
      (await pool.query("SELECT 1 FROM proposals WHERE user_id=$1", [user]))
        .rowCount,
      0,
    );
    const beforeIdle = calls;
    await stop();
    stop = await startTestAssistantRuntime("overnight");
    await new Promise((resolve) => setTimeout(resolve, 1200));
    assert.equal(
      calls,
      beforeIdle,
      "idle and restarted workers never repeat completed reflection",
    );
    const turns = (
      await pool.query("SELECT turns FROM ai_chats WHERE id=$1", [
        saved.chat_id,
      ])
    ).rows[0].turns;
    assert.equal(
      turns.filter((turn: any) => turn.role === "assistant").length,
      1,
    );
    const revokedUser = await person();
    const project = (
      await pool.query(
        "INSERT INTO projects(user_id,name) VALUES($1,'Revoked during reflection') RETURNING id",
        [revokedUser],
      )
    ).rows[0].id;
    await source(revokedUser, project);
    const later = new Date();
    later.setUTCSeconds(later.getUTCSeconds() + 2);
    await enableReflection(revokedUser, later);
    const beforeRevocation = calls;
    beforeReply = async () => {
      beforeReply = undefined;
      await pool.query("UPDATE projects SET assistant_off=true WHERE id=$1", [
        project,
      ]);
    };
    assert.equal(
      await scanNightShift(later, { only: [revokedUser], ai: {} as never }),
      1,
    );
    const revokedJob = (
      await pool.query(
        "SELECT j.id FROM assistant_night_runs nr JOIN ai_jobs j ON j.id=nr.job_id WHERE j.user_id=$1 AND nr.kind='reflection'",
        [revokedUser],
      )
    ).rows[0].id;
    let revokedState = "";
    for (let attempt = 0; attempt < 200; attempt++) {
      revokedState = (
        await pool.query("SELECT state FROM ai_jobs WHERE id=$1", [revokedJob])
      ).rows[0].state;
      if (revokedState === "failed" || revokedState === "done") break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.equal(
      revokedState,
      "failed",
      "permission revocation stops the reflection",
    );
    assert.equal(
      calls,
      beforeRevocation + 1,
      "revoked evidence is never sent to another provider step",
    );
    assert.equal(
      (await visibleAssistantJobs(pool, revokedUser, [revokedJob])).size,
      0,
    );
  } finally {
    await stop?.();
    await pool.query(
      "UPDATE ai_settings SET provider_id=$1,model=$2 WHERE id",
      [old.provider_id, old.model],
    );
    await pool.query("DELETE FROM ai_providers WHERE id=$1", [provider]);
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("reflection reserves one of ten runs and reports the remaining handed work", async () => {
  const user = await person();
  const now = new Date();
  now.setUTCSeconds(now.getUTCSeconds() + 2);
  const prefs = await enableReflection(user, now);
  prefs.kinds.handed = true;
  await pool.query(
    "UPDATE agent_settings SET night_shift=$2::jsonb WHERE user_id=$1",
    [user, JSON.stringify(prefs)],
  );
  const grant = (
    await pool.query(
      "SELECT id FROM agent_grants WHERE user_id=$1 AND kind='assistant'",
      [user],
    )
  ).rows[0].id;
  for (let i = 0; i < 12; i++)
    await pool.query(
      "INSERT INTO items(user_id,title,agent_grant_id,agent_state,agent_when) VALUES($1,$2,$3,'queued','tonight')",
      [user, `Handed work ${i}`, grant],
    );
  // Ensure every synthetic source falls inside the same stable test instant.
  const instant = new Date(Date.now() + 2000);
  for (let i = 0; i < 10; i++) {
    assert.equal(
      await scanNightShift(instant, { only: [user], ai: {} as never }),
      1,
    );
    await pool.query(
      "UPDATE ai_jobs SET state='done',sources_checked=true WHERE user_id=$1 AND state='queued'",
      [user],
    );
  }
  assert.equal(
    await scanNightShift(instant, { only: [user], ai: {} as never }),
    0,
  );
  const runs = (
    await pool.query(
      "SELECT nr.kind FROM assistant_night_runs nr JOIN assistant_nights n ON n.id=nr.night_id WHERE n.user_id=$1 ORDER BY nr.created_at,nr.id",
      [user],
    )
  ).rows;
  assert.equal(runs.length, 10);
  assert.equal(runs.filter((run) => run.kind === "reflection").length, 1);
  assert.equal(runs[9].kind, "reflection");
  const summary = (
    await pool.query("SELECT summary FROM assistant_nights WHERE user_id=$1", [
      user,
    ])
  ).rows[0].summary;
  assert.equal(
    summary.not_done.filter((entry: any) => entry.kind === "handed").length,
    3,
  );
});
