import "./setup.js";
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
process.env.ASSISTANT_CONVERSATION_ENABLED = "true";
const { pool, transaction } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { assistantPrincipal } =
  await import("../src/modules/agents/assistant.js");
const { openPersonalConversation, registerOriginConversation } =
  await import("../src/modules/assistant-workspace/conversation-storage.js");
const { recordScheduleConversation } =
  await import("../src/modules/assistant-workspace/conversation-schedules.js");
const { saveAgentRoutine } =
  await import("../src/modules/assistant-workspace/routines.js");
const { startAssistantAutomation } =
  await import("../src/modules/ai/agent/run.js");
const { createMaintainedPageBinding, updateMaintainedPageBinding } =
  await import("../src/modules/documents/maintenance.js");
const { queueMaintainedPageRun } =
  await import("../src/modules/documents/maintenance-runs.js");
const owners: string[] = [];
const teams: string[] = [];
const provider = randomUUID();
let oldProvider: string | null, oldModel: string;
before(async () => {
  await migrate();
  const s = (
    await pool.query("SELECT provider_id,model FROM ai_settings WHERE id=true")
  ).rows[0];
  oldProvider = s.provider_id;
  oldModel = s.model;
  await pool.query(
    "INSERT INTO ai_providers(id,kind,name,enabled) VALUES($1,'openai_compatible','Conversation schedule fixture',true)",
    [provider],
  );
  await pool.query(
    "UPDATE ai_settings SET provider_id=$1,model='qa-model' WHERE id=true",
    [provider],
  );
});
after(async () => {
  await pool.query("DELETE FROM teams WHERE id=ANY($1::uuid[])", [teams]);
  await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [owners]);
  await pool.query(
    "UPDATE ai_settings SET provider_id=$1,model=$2 WHERE id=true",
    [oldProvider, oldModel],
  );
  await pool.query("DELETE FROM ai_providers WHERE id=$1", [provider]);
  await pool.end();
});
async function person() {
  const id = randomUUID();
  owners.push(id);
  const user = (
    await pool.query(
      "INSERT INTO users(id,email,password_hash,name) VALUES($1,$2,'test','Schedule QA') RETURNING *",
      [id, `schedule-${id}@example.test`],
    )
  ).rows[0];
  await assistantPrincipal(user);
  await pool.query(
    "INSERT INTO agent_settings(user_id,reminder_nudges) VALUES($1,$2) ON CONFLICT(user_id) DO UPDATE SET reminder_nudges=$2",
    [id, { quiet_start: "00:00", quiet_end: "00:00" }],
  );
  return user;
}
const routineInput = {
  instruction: "Review my project notes.",
  rrule: "FREQ=DAILY",
  timezone: "UTC",
  next_run_at: new Date(Date.now() + 86400000).toISOString(),
  paused: false,
};

test("pausing a routine cancels future occurrences without stopping or erasing its admitted run", async () => {
  const { scanAssistantRoutines } =
    await import("../src/worker/assistant-routines.js");
  const { assistantJobSourcesVisible } =
    await import("../src/lib/assistant-job-sources.js");
  const { flushConversationDeliveries } =
    await import("../src/modules/assistant-workspace/conversation-delivery.js");
  const { conversationFeed } =
    await import("../src/modules/assistant-workspace/conversation-feed.js");
  const u = await person();
  const home = await transaction((db) => openPersonalConversation(db, u.id));
  const routine = await transaction((db) =>
    saveAgentRoutine(db, u.id, null, routineInput),
  );
  await pool.query(
    "UPDATE agent_routines SET next_run_at=now()-interval '1 minute' WHERE id=$1",
    [routine.id],
  );
  assert.equal(await scanAssistantRoutines(new Date(), { only: [u.id] }), 1);
  const job = (
    await pool.query("SELECT current_job_id FROM agent_routines WHERE id=$1", [
      routine.id,
    ])
  ).rows[0].current_job_id;
  assert.ok(job);
  await pool.query(
    "UPDATE ai_jobs SET state='running',sources_checked=true WHERE id=$1",
    [job],
  );
  await transaction((db) =>
    saveAgentRoutine(db, u.id, routine.id, { paused: true }),
  );
  assert.equal(
    (await pool.query("SELECT state FROM ai_jobs WHERE id=$1", [job])).rows[0]
      .state,
    "running",
  );
  assert.equal(
    (
      await pool.query(
        `SELECT ${assistantJobSourcesVisible("j", "$2")} AS allowed FROM ai_jobs j WHERE j.id=$1`,
        [job, u.id],
      )
    ).rows[0].allowed,
    true,
  );
  await pool.query("UPDATE ai_jobs SET state='done',result=$2 WHERE id=$1", [
    job,
    { answer: "The admitted routine finished" },
  ]);
  await flushConversationDeliveries({ onlyOwner: u.id });
  assert.equal(
    (await conversationFeed(pool, u.id, home.id, {})).entries.length,
    1,
  );
  await pool.query(
    "UPDATE agent_routines SET next_run_at=now()-interval '1 minute' WHERE id=$1",
    [routine.id],
  );
  assert.equal(await scanAssistantRoutines(new Date(), { only: [u.id] }), 0);
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS count FROM ai_jobs WHERE user_id=$1",
        [u.id],
      )
    ).rows[0].count,
    1,
  );
  assert.equal(
    (await conversationFeed(pool, u.id, home.id, {})).entries.length,
    1,
  );
});

async function pageSchedule(
  u: Awaited<ReturnType<typeof person>>,
  sourceJob?: string,
) {
  const principal = {
    ...(await assistantPrincipal(u)),
    ...(sourceJob ? { assistant_job_id: sourceJob } : {}),
  };
  const doc = (
    await pool.query(
      "INSERT INTO docs(user_id,title,content) VALUES($1,'Schedule page',$2) RETURNING id,version",
      [
        u.id,
        JSON.stringify([
          { id: "summary", type: "paragraph", text: "Keep this current" },
        ]),
      ],
    )
  ).rows[0];
  const input = {
    instruction: "Update the summary",
    rrule: "FREQ=DAILY",
    timezone: "UTC",
    next_run_at: new Date(Date.now() - 86400000).toISOString(),
    expected_doc_version: doc.version,
    block_ids: ["summary"],
    paused: false,
  };
  const binding = await transaction((db) =>
    createMaintainedPageBinding(db, u, principal, doc.id, input),
  );
  return { principal, doc, input, binding };
}

async function selectedOrigin(u: Awaited<ReturnType<typeof person>>) {
  const { bindConversationWork, publishConversationIntent } =
    await import("../src/modules/assistant-workspace/conversation-delivery.js");
  const { prepareConversationContext } =
    await import("../src/modules/assistant-workspace/conversation-context.js");
  const { retainConversationTurn } =
    await import("../src/modules/assistant-workspace/conversation-storage.js");
  const home = await transaction((db) => openPersonalConversation(db, u.id));
  const grant = (
    await pool.query<{ id: string }>(
      "INSERT INTO agent_grants(user_id,kind,client_id,access,personal,team_ids) VALUES($1,'oauth','https://schedule-context.invalid','write',true,'{}') RETURNING id",
      [u.id],
    )
  ).rows[0].id;
  const work = randomUUID(),
    chat = randomUUID(),
    turn = randomUUID(),
    originJob = randomUUID();
  await pool.query(
    "INSERT INTO ai_chats(id,user_id,title,origin) VALUES($1,$2,'Selected source','task')",
    [chat, u.id],
  );
  await pool.query(
    "INSERT INTO ai_jobs(id,user_id,chat_id,state,run_origin,sources_checked) VALUES($1,$2,$3,'queued','task',true)",
    [work, u.id, chat],
  );
  await transaction((db) =>
    bindConversationWork(db, {
      ownerId: u.id,
      work: { kind: "job", id: work },
      lane: "background",
      timezone: "UTC",
      destinationId: home.id,
      grantId: grant,
    }),
  );
  await pool.query("UPDATE ai_jobs SET state='done',result=$2 WHERE id=$1", [
    work,
    { answer: "A selected source result" },
  ]);
  const intent = (
    await pool.query(
      "SELECT i.id FROM assistant_delivery_intents i JOIN assistant_delivery_bindings b ON b.id=i.binding_id WHERE b.work_id=$1",
      [work],
    )
  ).rows[0].id;
  await transaction((db) => publishConversationIntent(db, intent));
  const entry = (
    await pool.query(
      "SELECT id FROM assistant_conversation_entries WHERE intent_id=$1",
      [intent],
    )
  ).rows[0].id;
  await transaction(async (db) => {
    await prepareConversationContext(db, u.id, home.chat_id, turn, entry);
    await retainConversationTurn(db, u.id, home.chat_id, {
      role: "user",
      text: "Schedule a follow-up",
      turn_id: turn,
    });
    await db.query(
      "INSERT INTO ai_jobs(id,user_id,chat_id,turn_id,state,run_origin,sources_checked) VALUES($1,$2,$3,$4,'done','person',true)",
      [originJob, u.id, home.chat_id, turn],
    );
  });
  return { home, grant, entry, originJob };
}

test("routine admissions retain selected-entry authority after source-job cleanup and during rollback", async () => {
  const { env } = await import("../src/config/env.js");
  const { assistantJobSourcesVisible } =
    await import("../src/lib/assistant-job-sources.js");
  const previous = env.ASSISTANT_CONVERSATION_ENABLED;
  try {
    for (const deliveryEnabled of [true, false]) {
      env.ASSISTANT_CONVERSATION_ENABLED = "true";
      const u = await person(),
        source = await selectedOrigin(u);
      env.ASSISTANT_CONVERSATION_ENABLED = deliveryEnabled ? "true" : "false";
      const routine = await transaction((db) =>
        saveAgentRoutine(db, u.id, null, routineInput, {
          deliveryJobId: source.originJob,
        }),
      );
      await pool.query("DELETE FROM ai_jobs WHERE id=$1", [source.originJob]);
      const child = await startAssistantAutomation({
        userId: u.id,
        message: "Run this routine",
        timezone: "UTC",
        automation: { kind: "routine", id: routine.id },
      });
      assert.ok(child);
      await pool.query("UPDATE ai_jobs SET sources_checked=true WHERE id=$1", [
        child,
      ]);
      const allowed = async () =>
        (
          await pool.query(
            `SELECT j.id FROM ai_jobs j WHERE j.id=$2 AND ${assistantJobSourcesVisible("j", "$1", false)}`,
            [u.id, child],
          )
        ).rowCount;
      assert.equal(await allowed(), 1);
      await pool.query("UPDATE agent_grants SET revoked_at=now() WHERE id=$1", [
        source.grant,
      ]);
      assert.equal(
        await allowed(),
        0,
        "Delivery rollback cannot discard a schedule's source authority",
      );
    }
  } finally {
    env.ASSISTANT_CONVERSATION_ENABLED = previous;
  }
});

test("maintained-page guards retain selected-entry authority during delivery rollback", async () => {
  const { env } = await import("../src/config/env.js");
  const { claimMaintainedPageRun, guardMaintainedPageRun } =
    await import("../src/modules/documents/maintenance-runs.js");
  const previous = env.ASSISTANT_CONVERSATION_ENABLED;
  try {
    for (const deliveryEnabled of [true, false]) {
      env.ASSISTANT_CONVERSATION_ENABLED = "true";
      const u = await person(),
        source = await selectedOrigin(u);
      env.ASSISTANT_CONVERSATION_ENABLED = deliveryEnabled ? "true" : "false";
      const page = await pageSchedule(u, source.originJob),
        now = new Date();
      await pool.query("DELETE FROM ai_jobs WHERE id=$1", [source.originJob]);
      const run = await transaction((db) =>
        queueMaintainedPageRun(db, u, page.principal, page.binding.id, now, {
          kind: "background",
        }),
      );
      assert.ok(run);
      const claimed = await transaction((db) =>
        claimMaintainedPageRun(db, "background", now, run.id),
      );
      assert.ok(claimed?.lease_token);
      await transaction((db) =>
        guardMaintainedPageRun(db, run.id, claimed.lease_token, now),
      );
      await pool.query("UPDATE agent_grants SET revoked_at=now() WHERE id=$1", [
        source.grant,
      ]);
      await assert.rejects(
        transaction((db) =>
          guardMaintainedPageRun(db, run.id, claimed.lease_token, now),
        ),
        /sources for this page run changed/,
      );
    }
  } finally {
    env.ASSISTANT_CONVERSATION_ENABLED = previous;
  }
});

test("maintained-page schedules retain their explicit origin through edits, admission and retirement", async () => {
  const u = await person();
  const home = await transaction((db) => openPersonalConversation(db, u.id));
  const chat = randomUUID(),
    job = randomUUID();
  await pool.query(
    "INSERT INTO ai_chats(id,user_id,title) VALUES($1,$2,'Page schedule origin')",
    [chat, u.id],
  );
  const origin = await transaction((db) =>
    registerOriginConversation(db, u.id, chat),
  );
  await pool.query(
    "INSERT INTO ai_jobs(id,user_id,chat_id,state,run_origin,sources_checked) VALUES($1,$2,$3,'done','person',true)",
    [job, u.id, chat],
  );
  const f = await pageSchedule(u, job);
  const edited = await transaction((db) =>
    updateMaintainedPageBinding(
      db,
      u,
      { ...f.principal, assistant_job_id: undefined },
      f.doc.id,
      f.binding.id,
      {
        ...f.input,
        instruction: "Updated instruction",
        expected_revision: f.binding.revision,
      },
    ),
  );
  const snapshot = (
    await pool.query(
      "SELECT destination_id,personal_only FROM assistant_schedule_destinations WHERE owner_id=$1 AND source_kind='page_binding' AND source_id=$2",
      [u.id, f.binding.id],
    )
  ).rows[0];
  assert.equal(snapshot.destination_id, origin.id);
  assert.equal(snapshot.personal_only, false);
  const run = await transaction((db) =>
    queueMaintainedPageRun(db, u, f.principal, edited.id, new Date(), {
      kind: "background",
    }),
  );
  assert.ok(run);
  const route = (
    await pool.query(
      "SELECT destination_id,reason FROM assistant_delivery_bindings WHERE work_kind='page_run' AND work_id=$1",
      [run.id],
    )
  ).rows[0];
  assert.equal(route.destination_id, origin.id);
  assert.notEqual(route.destination_id, home.id);
  assert.equal(route.reason, "schedule");
  await pool.query(
    "UPDATE assistant_page_runs SET state='cancelled' WHERE id=$1",
    [run.id],
  );
  await pool.query(
    "UPDATE assistant_page_bindings SET next_run_at=now()-interval '1 day' WHERE id=$1",
    [edited.id],
  );
  await pool.query("DELETE FROM ai_chats WHERE id=$1", [chat]);
  const count = (
    await pool.query(
      "SELECT count(*)::int n FROM assistant_page_runs WHERE binding_id=$1",
      [edited.id],
    )
  ).rows[0].n;
  await assert.rejects(
    transaction((db) =>
      queueMaintainedPageRun(db, u, f.principal, edited.id, new Date(), {
        kind: "background",
      }),
    ),
    /Conversation not found/,
  );
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int n FROM assistant_page_runs WHERE binding_id=$1",
        [edited.id],
      )
    ).rows[0].n,
    count,
  );
});

test("a page schedule created before opening the personal conversation never adopts a later home", async () => {
  const u = await person();
  const f = await pageSchedule(u);
  const home = await transaction((db) => openPersonalConversation(db, u.id));
  const edited = await transaction((db) =>
    updateMaintainedPageBinding(db, u, f.principal, f.doc.id, f.binding.id, {
      ...f.input,
      expected_revision: f.binding.revision,
    }),
  );
  const run = await transaction((db) =>
    queueMaintainedPageRun(db, u, f.principal, edited.id, new Date(), {
      kind: "background",
    }),
  );
  assert.ok(run);
  assert.equal(
    (
      await pool.query(
        "SELECT 1 FROM assistant_delivery_bindings WHERE work_kind='page_run' AND work_id=$1",
        [run.id],
      )
    ).rowCount,
    0,
  );
  const snapshot = (
    await pool.query(
      "SELECT destination_id,personal_only FROM assistant_schedule_destinations WHERE owner_id=$1 AND source_kind='page_binding' AND source_id=$2",
      [u.id, edited.id],
    )
  ).rows[0];
  assert.equal(snapshot.destination_id, null);
  assert.equal(snapshot.personal_only, true);
  assert.ok(home.id);
});

test("admission pauses prevent automation and page work without creating execution chats", async () => {
  const u = await person();
  const f = await pageSchedule(u);
  const { updateWorkControls } =
    await import("../src/modules/assistant-workspace/work-controls.js");
  await transaction((db) =>
    updateWorkControls(db, u.id, { background_paused: true }),
  );
  const before = (
    await pool.query("SELECT count(*)::int n FROM ai_chats WHERE user_id=$1", [
      u.id,
    ])
  ).rows[0].n;
  assert.equal(
    await startAssistantAutomation({
      userId: u.id,
      message: "Paused work",
      timezone: "UTC",
      automation: { kind: "task" },
    }),
    null,
  );
  assert.equal(
    await transaction((db) =>
      queueMaintainedPageRun(db, u, f.principal, f.binding.id, new Date(), {
        kind: "background",
      }),
    ),
    null,
  );
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int n FROM ai_chats WHERE user_id=$1",
        [u.id],
      )
    ).rows[0].n,
    before,
  );
  assert.equal(
    (
      await pool.query(
        "SELECT 1 FROM assistant_page_runs WHERE binding_id=$1",
        [f.binding.id],
      )
    ).rowCount,
    0,
  );
  await transaction((db) =>
    updateWorkControls(db, u.id, {
      background_paused: false,
      overnight_paused: true,
    }),
  );
  assert.equal(
    await startAssistantAutomation({
      userId: u.id,
      message: "Paused night",
      timezone: "UTC",
      automation: { kind: "night" },
    }),
    null,
  );
  assert.ok(
    await startAssistantAutomation({
      userId: u.id,
      message: "Unpaused Background",
      timezone: "UTC",
      automation: { kind: "task" },
    }),
  );
});

test("routine creation captures its foreground origin and future admissions cannot adopt another home", async () => {
  const u = await person();
  const home = await transaction((db) => openPersonalConversation(db, u.id));
  const chat = randomUUID(),
    sourceJob = randomUUID();
  await pool.query(
    "INSERT INTO ai_chats(id,user_id,title) VALUES($1,$2,'Explicit routine origin')",
    [chat, u.id],
  );
  const origin = await transaction((db) =>
    registerOriginConversation(db, u.id, chat),
  );
  await pool.query(
    "INSERT INTO ai_jobs(id,user_id,chat_id,turn_id,state,run_origin,sources_checked) VALUES($1,$2,$3,$4,'done','person',true)",
    [sourceJob, u.id, chat, randomUUID()],
  );
  const routine = await transaction((db) =>
    saveAgentRoutine(db, u.id, null, routineInput, {
      deliveryJobId: sourceJob,
    }),
  );
  const job = await startAssistantAutomation({
    userId: u.id,
    message: "Run my routine",
    timezone: "UTC",
    automation: { kind: "routine", id: routine.id },
  });
  assert.ok(job);
  const binding = (
    await pool.query(
      "SELECT destination_id FROM assistant_delivery_bindings WHERE work_kind='job' AND work_id=$1",
      [job],
    )
  ).rows[0];
  assert.equal(binding.destination_id, origin.id);
  assert.notEqual(binding.destination_id, home.id);
  await pool.query("UPDATE ai_jobs SET state='failed' WHERE id=$1", [job]);
  await pool.query("DELETE FROM ai_chats WHERE id=$1", [chat]);
  const beforeCount = (
    await pool.query("SELECT count(*)::int n FROM ai_jobs WHERE user_id=$1", [
      u.id,
    ])
  ).rows[0].n;
  await assert.rejects(
    startAssistantAutomation({
      userId: u.id,
      message: "Retry routine",
      timezone: "UTC",
      automation: { kind: "routine", id: routine.id },
    }),
    /Conversation not found/,
  );
  assert.equal(
    (
      await pool.query("SELECT count(*)::int n FROM ai_jobs WHERE user_id=$1", [
        u.id,
      ])
    ).rows[0].n,
    beforeCount,
    "failed admission rolls back its job and execution chat",
  );
});

test("an unopened home is captured as absent and does not adopt a later generation", async () => {
  const u = await person();
  const routine = await transaction((db) =>
    saveAgentRoutine(db, u.id, null, routineInput),
  );
  await transaction((db) => openPersonalConversation(db, u.id));
  const job = await startAssistantAutomation({
    userId: u.id,
    message: "Run my routine",
    timezone: "UTC",
    automation: { kind: "routine", id: routine.id },
  });
  assert.ok(job);
  assert.equal(
    (
      await pool.query(
        "SELECT 1 FROM assistant_delivery_bindings WHERE work_kind='job' AND work_id=$1",
        [job],
      )
    ).rowCount,
    0,
  );
});

test("destination capture is transactional and ordinary edits do not change its generation", async () => {
  const u = await person();
  const home = await transaction((db) => openPersonalConversation(db, u.id));
  const id = randomUUID();
  await assert.rejects(
    transaction(async (db) => {
      await recordScheduleConversation(db, u.id, "goal", id);
      throw new Error("rollback");
    }),
    /rollback/,
  );
  assert.equal(
    (
      await pool.query(
        "SELECT 1 FROM assistant_schedule_destinations WHERE owner_id=$1 AND source_id=$2",
        [u.id, id],
      )
    ).rowCount,
    0,
  );
  await transaction((db) => recordScheduleConversation(db, u.id, "goal", id));
  await pool.query("DELETE FROM ai_chats WHERE id=$1", [home.chat_id]);
  const replacement = await transaction((db) =>
    openPersonalConversation(db, u.id),
  );
  await transaction((db) => recordScheduleConversation(db, u.id, "goal", id));
  const saved = (
    await pool.query(
      "SELECT destination_id FROM assistant_schedule_destinations WHERE owner_id=$1 AND source_id=$2",
      [u.id, id],
    )
  ).rows[0];
  assert.equal(saved.destination_id, home.id);
  assert.notEqual(saved.destination_id, replacement.id);
});

test("a child admitted after night destination retirement cannot capture the replacement home", async () => {
  const { bindConversationWork } =
    await import("../src/modules/assistant-workspace/conversation-delivery.js");
  const u = await person();
  const home = await transaction((db) => openPersonalConversation(db, u.id));
  const night = randomUUID();
  await pool.query(
    "INSERT INTO assistant_nights(id,user_id,local_day) VALUES($1,$2,current_date)",
    [night, u.id],
  );
  await transaction((db) =>
    bindConversationWork(db, {
      ownerId: u.id,
      work: { kind: "night", id: night },
      lane: "overnight",
      timezone: "UTC",
      sourcesChecked: true,
    }),
  );
  await pool.query("DELETE FROM ai_chats WHERE id=$1", [home.chat_id]);
  const replacement = await transaction((db) =>
    openPersonalConversation(db, u.id),
  );
  await assert.rejects(
    startAssistantAutomation({
      userId: u.id,
      message: "Night routine",
      timezone: "UTC",
      automation: {
        kind: "night",
        source_kind: "routine",
        id: randomUUID(),
        night_id: night,
        end_at: new Date(Date.now() + 3600000).toISOString(),
      },
    }),
    /Conversation not found/,
  );
  assert.equal(
    (
      await pool.query(
        "SELECT 1 FROM assistant_delivery_bindings WHERE owner_id=$1 AND work_kind='job' AND destination_id=$2",
        [u.id, replacement.id],
      )
    ).rowCount,
    0,
  );
});

test("routine edits through the ordinary API preserve a captured origin and cross-owner job metadata rolls back", async () => {
  const u = await person(),
    other = await person();
  const home = await transaction((db) => openPersonalConversation(db, u.id));
  const job = randomUUID();
  await pool.query(
    "INSERT INTO ai_jobs(id,user_id,chat_id,turn_id,state,run_origin,sources_checked) VALUES($1,$2,$3,$4,'done','person',true)",
    [job, u.id, home.chat_id, randomUUID()],
  );
  const routine = await transaction((db) =>
    saveAgentRoutine(db, u.id, null, routineInput, { deliveryJobId: job }),
  );
  await transaction((db) =>
    saveAgentRoutine(db, u.id, routine.id, { paused: true }),
  );
  assert.equal(
    (
      await pool.query(
        "SELECT destination_id FROM assistant_schedule_destinations WHERE source_kind=$1 AND source_id=$2",
        ["routine", routine.id],
      )
    ).rows[0].destination_id,
    home.id,
  );
  await assert.rejects(
    transaction((db) =>
      saveAgentRoutine(db, other.id, null, routineInput, {
        deliveryJobId: job,
      }),
    ),
    /originating conversation/,
  );
  assert.equal(
    (
      await pool.query("SELECT 1 FROM agent_routines WHERE user_id=$1", [
        other.id,
      ])
    ).rowCount,
    0,
  );
});

test("personal schedule snapshots retain personal-only publication scope", async () => {
  const { publishConversationIntent } =
    await import("../src/modules/assistant-workspace/conversation-delivery.js");
  const u = await person();
  const home = await transaction((db) => openPersonalConversation(db, u.id));
  const routine = await transaction((db) =>
    saveAgentRoutine(db, u.id, null, routineInput),
  );
  const job = await startAssistantAutomation({
    userId: u.id,
    message: "Run routine",
    timezone: "UTC",
    automation: { kind: "routine", id: routine.id },
  });
  assert.ok(job);
  assert.equal(
    (
      await pool.query(
        "SELECT reason FROM assistant_delivery_bindings WHERE work_kind='job' AND work_id=$1",
        [job],
      )
    ).rows[0].reason,
    "personal",
  );
  const team = randomUUID(),
    doc = randomUUID();
  teams.push(team);
  await pool.query(
    "INSERT INTO teams(id,name,created_by) VALUES($1,'Schedule source scope',$2)",
    [team, u.id],
  );
  await pool.query(
    "INSERT INTO team_members(team_id,user_id,role) VALUES($1,$2,'owner')",
    [team, u.id],
  );
  await pool.query(
    "INSERT INTO docs(id,user_id,title,team_id) VALUES($1,$2,'Team content',$3)",
    [doc, u.id, team],
  );
  await pool.query(
    "INSERT INTO assistant_job_sources(job_id,source_kind,source_id) VALUES($1,'doc',$2)",
    [job, doc],
  );
  await pool.query(
    "UPDATE ai_jobs SET state='done',sources_checked=true,result=$2 WHERE id=$1",
    [job, { answer: "A team-derived result" }],
  );
  const intent = (
    await pool.query(
      "SELECT i.id FROM assistant_delivery_intents i JOIN assistant_delivery_bindings b ON b.id=i.binding_id WHERE b.work_id=$1",
      [job],
    )
  ).rows[0].id;
  assert.equal(
    await transaction((db) => publishConversationIntent(db, intent)),
    false,
  );
  assert.equal(
    (
      await pool.query(
        "SELECT 1 FROM assistant_conversation_entries WHERE destination_id=$1",
        [home.id],
      )
    ).rowCount,
    0,
  );
  assert.deepEqual(
    (
      await pool.query(
        "SELECT state,reason FROM assistant_delivery_intents WHERE id=$1",
        [intent],
      )
    ).rows[0],
    { state: "blocked", reason: "permission_revoked" },
  );
  const sourceJob = randomUUID();
  await pool.query(
    "INSERT INTO ai_jobs(id,user_id,chat_id,turn_id,state,run_origin,sources_checked) VALUES($1,$2,$3,$4,'done','person',true)",
    [sourceJob, u.id, home.chat_id, randomUUID()],
  );
  const explicit = await transaction((db) =>
    saveAgentRoutine(db, u.id, null, routineInput, {
      deliveryJobId: sourceJob,
    }),
  );
  const requestedJob = await startAssistantAutomation({
    userId: u.id,
    message: "Run requested routine",
    timezone: "UTC",
    automation: { kind: "routine", id: explicit.id },
  });
  await pool.query(
    "INSERT INTO assistant_job_sources(job_id,source_kind,source_id) VALUES($1,'doc',$2)",
    [requestedJob, doc],
  );
  await pool.query(
    "UPDATE ai_jobs SET state='done',sources_checked=true,result=$2 WHERE id=$1",
    [
      requestedJob,
      { answer: "An explicitly requested, currently authorized result" },
    ],
  );
  const requestedIntent = (
    await pool.query(
      "SELECT i.id FROM assistant_delivery_intents i JOIN assistant_delivery_bindings b ON b.id=i.binding_id WHERE b.work_id=$1",
      [requestedJob],
    )
  ).rows[0].id;
  assert.equal(
    await transaction((db) => publishConversationIntent(db, requestedIntent)),
    true,
    JSON.stringify(
      (
        await pool.query(
          "SELECT state,reason FROM assistant_delivery_intents WHERE id=$1",
          [requestedIntent],
        )
      ).rows,
    ),
  );
});
