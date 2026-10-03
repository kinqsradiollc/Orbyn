import { defaultNightShift } from "@orbyn/core";
import "./setup.js";
import { before, after, afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import type { UserRow } from "../src/lib/auth.js";
const { pool, transaction } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { assistantPrincipal } =
  await import("../src/modules/agents/assistant.js");
const { createMaintainedPageBinding } =
  await import("../src/modules/docs/maintenance.js");
const {
  queueMaintainedPageRun,
  claimMaintainedPageRun,
  guardMaintainedPageRun,
  reserveMaintainedPageModel,
  stageMaintainedPageRun,
  decideMaintainedPageRun,
  PAGE_RUN_LEASE_MS,
} = await import("../src/modules/docs/maintenance-runs.js");
const { processMaintainedPageRun } =
  await import("../src/worker/maintained-pages.js");
const { resolveMaintainedPageModel } =
  await import("../src/modules/docs/maintenance-model.js");
const { default: Fastify } = await import("fastify");
const loggerApp = Fastify({ logger: false });
const log = loggerApp.log;
const time = new Date("2026-10-05T09:00:00Z");
const people: string[] = [];
const seen: any[] = [];
let responseHook: undefined | ((body: any) => Promise<string>);
let providerId: string;
let original: {
  provider_id: string | null;
  model: string;
  night_token_budget: number;
};
const provider = createServer((req, res) => {
  let raw = "";
  req.on("data", (chunk) => (raw += chunk));
  req.on("end", () => {
    void (async () => {
      const body = JSON.parse(raw);
      seen.push(body);
      const input = JSON.parse(body.messages.at(-1).content);
      const content = responseHook
        ? await responseHook(body)
        : JSON.stringify({
            expected_revision: input.expected_revision,
            replacements: [
              {
                id: "summary",
                type: "paragraph",
                text: "Generated scoped summary.",
              },
            ],
          });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          choices: [{ finish_reason: "stop", message: { content } }],
        }),
      );
    })().catch(() => {
      res.writeHead(500);
      res.end("{}");
    });
  });
});
before(async () => {
  await migrate();
  await new Promise<void>((resolve) =>
    provider.listen(0, "127.0.0.1", resolve),
  );
  const address = provider.address() as { port: number };
  original = (
    await pool.query(
      "SELECT provider_id,model,night_token_budget FROM ai_settings WHERE id",
    )
  ).rows[0];
  providerId = (
    await pool.query(
      "INSERT INTO ai_providers(kind,name,base_url) VALUES('openai','Scoped provider',$1) RETURNING id",
      [`http://127.0.0.1:${address.port}/v1`],
    )
  ).rows[0].id;
  await pool.query(
    "UPDATE ai_settings SET provider_id=$1,model='fixture-model' WHERE id",
    [providerId],
  );
});
afterEach(async () => {
  await pool.query("UPDATE ai_settings SET night_token_budget=$1 WHERE id", [
    original.night_token_budget,
  ]);
  responseHook = undefined;
  seen.length = 0;
  await pool.query(
    "UPDATE assistant_page_runs SET state='cancelled',lease_token=NULL,lease_expires_at=NULL,waiting_id=NULL WHERE user_id=ANY($1::uuid[]) AND state IN ('queued','running','waiting')",
    [people],
  );
});
after(async () => {
  await pool.query("UPDATE ai_settings SET provider_id=$1,model=$2 WHERE id", [
    original.provider_id,
    original.model,
  ]);
  await pool.query("DELETE FROM ai_providers WHERE id=$1", [providerId]);
  await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [people]);
  await new Promise<void>((resolve) => provider.close(() => resolve()));
  await loggerApp.close();
  await pool.end();
});
async function fixture(
  opts: { night?: boolean; accountDefault?: boolean } = {},
) {
  const id = randomUUID();
  people.push(id);
  const user = (
    await pool.query<UserRow>(
      "INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,'Scoped consumer','unusable') RETURNING *",
      [id, `consumer-${id}@orbyn.test`],
    )
  ).rows[0];
  const principal = {
    ...(await assistantPrincipal(user)),
    assistant_lane: "background" as const,
  };
  const doc = (
    await pool.query(
      "INSERT INTO docs(user_id,title,content) VALUES($1,'Never sent title',$2::jsonb) RETURNING id,version",
      [
        id,
        JSON.stringify([
          {
            id: "human",
            type: "paragraph",
            text: "Human private material must not be transmitted.",
          },
          {
            id: "summary",
            type: "paragraph",
            text: "Authorized selected source.",
          },
        ]),
      ],
    )
  ).rows[0];
  const binding = await transaction((db) =>
    createMaintainedPageBinding(db, user, principal, doc.id, {
      block_ids: ["summary"],
      expected_doc_version: 1,
      instruction: "Update this selected source only.",
      rrule: "FREQ=DAILY",
      timezone: "UTC",
      next_run_at: time.toISOString(),
      paused: false,
    }),
  );
  if (opts.accountDefault) {
    const c = (
      await pool.query(
        "INSERT INTO chatgpt_identity_connections(user_id,issuer,subject,client_id) VALUES($1,'https://auth.openai.com',$2,'oaiapp_fixture') RETURNING id",
        [user.id, randomUUID()],
      )
    ).rows[0].id;
    await pool.query(
      "INSERT INTO chatgpt_model_preferences(connection_id,model) VALUES($1,'account-model')",
      [c],
    );
  }
  let nightId: string | null = null;
  if (opts.night) {
    await pool.query(
      `INSERT INTO agent_settings(user_id,night_shift) VALUES($1,$2::jsonb) ON CONFLICT(user_id) DO UPDATE SET night_shift=excluded.night_shift`,
      [
        user.id,
        JSON.stringify({
          ...defaultNightShift(),
          enabled: true,
          start: "08:00",
          end: "10:00",
        }),
      ],
    );
    nightId = (
      await pool.query(
        "INSERT INTO assistant_nights(user_id,local_day) VALUES($1,'2026-10-05') RETURNING id",
        [user.id],
      )
    ).rows[0].id;
  }
  const run = await transaction((db) =>
    queueMaintainedPageRun(
      db,
      user,
      principal,
      binding.id,
      time,
      nightId
        ? {
            kind: "overnight",
            nightId,
            endAt: new Date(time.getTime() + 3600000),
          }
        : { kind: "background" },
    ),
  );
  assert.ok(run);
  return { user, principal, doc, binding, run };
}
const options = (runId: string) => ({ now: () => time, runId });
const current = async (id: string) =>
  (await pool.query("SELECT * FROM assistant_page_runs WHERE id=$1", [id]))
    .rows[0];

test("real hosted completion sends only selected blocks, sets an output cap and commits guarded changes", async () => {
  const f = await fixture();
  const result = await processMaintainedPageRun(
    log,
    "background",
    options(f.run.id),
  );
  assert.equal(result.state, "done");
  assert.equal(seen.length, 1);
  const serialized = JSON.stringify(seen[0]);
  assert.ok(serialized.includes("Authorized selected source."));
  for (const hidden of [
    "Human private material",
    "Never sent title",
    f.user.email,
    f.principal.grant_id,
  ])
    assert.ok(!serialized.includes(hidden));
  assert.equal(seen[0].tools, undefined);
  assert.ok(
    seen[0].max_completion_tokens > 0 && seen[0].max_completion_tokens <= 4096,
  );
  const saved = await current(f.run.id);
  assert.equal(saved.state, "done");
  assert.equal(saved.reserved_tokens, 0);
  assert.ok(
    saved.token_estimate > 0 && saved.token_estimate <= saved.token_budget,
  );
  assert.equal(
    (await pool.query("SELECT content FROM docs WHERE id=$1", [f.doc.id]))
      .rows[0].content[0].text,
    "Human private material must not be transmitted.",
  );
});

test("approval applies the staged result without making a second provider call", async () => {
  const f = await fixture();
  await pool.query("UPDATE agent_grants SET trust='ask' WHERE id=$1", [
    f.principal.grant_id,
  ]);
  assert.equal(
    (await processMaintainedPageRun(log, "background", options(f.run.id)))
      .state,
    "waiting",
  );
  const waiting = await current(f.run.id);
  assert.ok(waiting.waiting_id);
  assert.equal(seen.length, 1);
  await transaction((db) =>
    decideMaintainedPageRun(
      db,
      f.user.id,
      f.run.id,
      waiting.waiting_id,
      true,
      time,
    ),
  );
  assert.equal(
    (await processMaintainedPageRun(log, "background", options(f.run.id)))
      .state,
    "idle",
  );
  assert.equal((await current(f.run.id)).state, "done");
  assert.equal(seen.length, 1);
});

test("changed source after provider transmission holds output and leaves the page untouched", async () => {
  const f = await fixture();
  responseHook = async () => {
    await pool.query("UPDATE docs SET version=version+1 WHERE id=$1", [
      f.doc.id,
    ]);
    return JSON.stringify({
      expected_revision: 1,
      replacements: [
        { id: "summary", type: "paragraph", text: "Stale generation." },
      ],
    });
  };
  assert.equal(
    (await processMaintainedPageRun(log, "background", options(f.run.id)))
      .state,
    "failed",
  );
  const job = await current(f.run.id);
  assert.equal(job.proposal, null);
  const doc = (
    await pool.query("SELECT content FROM docs WHERE id=$1", [f.doc.id])
  ).rows[0];
  assert.equal(doc.content[1].text, "Authorized selected source.");
});

test("a selected ChatGPT account default is never silently sent to a hosted provider", async () => {
  const f = await fixture();
  const connection = (
    await pool.query(
      "INSERT INTO chatgpt_identity_connections(user_id,issuer,subject,client_id) VALUES($1,'https://auth.openai.com',$2,'oaiapp_fixture') RETURNING id",
      [f.user.id, randomUUID()],
    )
  ).rows[0].id;
  await pool.query(
    "INSERT INTO chatgpt_model_preferences(connection_id,model) VALUES($1,'account-model')",
    [connection],
  );
  assert.equal(
    (await processMaintainedPageRun(log, "background", options(f.run.id)))
      .state,
    "deferred",
  );
  assert.equal(seen.length, 0);
  const job = await current(f.run.id);
  assert.equal(job.state, "queued");
  assert.equal(job.token_estimate, 0);
  assert.equal(job.attempts, 0);
  assert.ok(job.retry_after > time);
  assert.equal(
    (await processMaintainedPageRun(log, "background", options(f.run.id)))
      .state,
    "idle",
  );
});

test("an unknown in-flight model request is not automatically retried after lease loss", async () => {
  const f = await fixture();
  const run = await transaction((db) =>
    claimMaintainedPageRun(db, "background", time, f.run.id),
  );
  assert.ok(run?.lease_token);
  const model = await resolveMaintainedPageModel(f.user.id);
  await transaction((db) =>
    reserveMaintainedPageModel(
      db,
      run!.id,
      run!.lease_token!,
      5000,
      model.key,
      time,
    ),
  );
  assert.equal(
    await transaction((db) =>
      claimMaintainedPageRun(
        db,
        "background",
        new Date(time.getTime() + PAGE_RUN_LEASE_MS + 1),
        f.run.id,
      ),
    ),
    null,
  );
  const job = await current(f.run.id);
  assert.equal(job.state, "failed");
  assert.equal(job.token_estimate, 5000);
  assert.equal(seen.length, 0);
});

test("a recovered staged result is reused and unknown file attachments are held", async () => {
  const f = await fixture();
  const model = await resolveMaintainedPageModel(f.user.id);
  const run = await transaction((db) =>
    claimMaintainedPageRun(db, "background", time, f.run.id),
  );
  assert.ok(run?.lease_token);
  await transaction((db) =>
    reserveMaintainedPageModel(
      db,
      run!.id,
      run!.lease_token!,
      5000,
      model.key,
      time,
    ),
  );
  await transaction((db) =>
    stageMaintainedPageRun(
      db,
      run!.id,
      run!.lease_token!,
      {
        expected_revision: 1,
        replacements: [
          { id: "summary", type: "paragraph", text: "Staged before restart." },
        ],
      },
      5000,
      time,
    ),
  );
  const clock = new Date(time.getTime() + PAGE_RUN_LEASE_MS + 1);
  assert.equal(
    (
      await processMaintainedPageRun(log, "background", {
        now: () => clock,
        runId: f.run.id,
      })
    ).state,
    "done",
  );
  assert.equal(seen.length, 0);
  const another = await fixture();
  responseHook = async () =>
    JSON.stringify({
      expected_revision: 1,
      replacements: [
        {
          id: "summary",
          type: "image",
          file: randomUUID(),
          text: "Unknown file",
        },
      ],
    });
  assert.equal(
    (await processMaintainedPageRun(log, "background", options(another.run.id)))
      .state,
    "failed",
  );
  assert.equal(
    (await pool.query("SELECT content FROM docs WHERE id=$1", [another.doc.id]))
      .rows[0].content[1].type,
    "paragraph",
  );
});

test("invalid model output never advances a binding and an already stopped consumer never claims work", async () => {
  const f = await fixture();
  const abort = new AbortController();
  abort.abort();
  assert.equal(
    (
      await processMaintainedPageRun(log, "background", {
        ...options(f.run.id),
        signal: abort.signal,
      })
    ).state,
    "stopped",
  );
  assert.equal((await current(f.run.id)).state, "queued");
  responseHook = async () => "not valid JSON";
  assert.equal(
    (await processMaintainedPageRun(log, "background", options(f.run.id)))
      .state,
    "failed",
  );
  assert.equal((await current(f.run.id)).proposal, null);
  assert.equal(
    (
      await pool.query(
        "SELECT revision FROM assistant_page_bindings WHERE id=$1",
        [f.binding.id],
      )
    ).rows[0].revision,
    1,
  );
});

test("removing a selected account cannot turn its queued work into a hosted request", async () => {
  const f = await fixture({ accountDefault: true });
  assert.equal(f.run.model_origin.kind, "chatgpt");
  await pool.query(
    "DELETE FROM chatgpt_identity_connections WHERE user_id=$1",
    [f.user.id],
  );
  assert.equal(
    (await processMaintainedPageRun(log, "background", options(f.run.id)))
      .state,
    "deferred",
  );
  assert.equal(seen.length, 0);
});

test("saved Overnight changes remain manually reviewable in the morning without another model call", async () => {
  const f = await fixture({ night: true });
  assert.equal(
    (await processMaintainedPageRun(log, "overnight", options(f.run.id))).state,
    "waiting",
  );
  const waiting = await current(f.run.id);
  assert.equal(seen.length, 1);
  await pool.query("UPDATE assistant_nights SET status='done' WHERE id=$1", [
    f.run.night_id,
  ]);
  const morning = new Date(time.getTime() + 7200000);
  const decision = await transaction((db) =>
    decideMaintainedPageRun(
      db,
      f.user.id,
      f.run.id,
      waiting.waiting_id,
      true,
      morning,
    ),
  );
  assert.equal(decision.state, "done");
  assert.equal(seen.length, 1);
  assert.equal((await current(f.run.id)).state, "done");
});

test("Night cost is reserved before transmission and old night accounting cannot erase page reservations", async () => {
  const f = await fixture({ night: true });
  await pool.query("UPDATE ai_settings SET night_token_budget=10000 WHERE id");
  const legacy = (
    await pool.query(
      "INSERT INTO ai_jobs(user_id,state,result) VALUES($1,'done',$2::jsonb) RETURNING id",
      [f.user.id, JSON.stringify({ assistant_run: { token_estimate: 500 } })],
    )
  ).rows[0].id;
  await pool.query(
    "INSERT INTO assistant_night_runs(night_id,job_id,kind) VALUES($1,$2,'plan')",
    [f.run.night_id, legacy],
  );
  const { recordNightRun } =
    await import("../src/modules/ai/agent/night-status.js");
  await transaction((db) =>
    recordNightRun(db, legacy, "A completed night task.", "kept"),
  );
  responseHook = async (body) => {
    const row = (
      await pool.query("SELECT budget_used FROM assistant_nights WHERE id=$1", [
        f.run.night_id,
      ])
    ).rows[0];
    assert.ok(row.budget_used > 500 && row.budget_used <= 10000);
    const input = JSON.parse(body.messages.at(-1).content);
    return JSON.stringify({
      expected_revision: input.expected_revision,
      replacements: [
        { id: "summary", type: "paragraph", text: "Night summary." },
      ],
    });
  };
  assert.equal(
    (await processMaintainedPageRun(log, "overnight", options(f.run.id))).state,
    "waiting",
  );
  const run = await current(f.run.id);
  assert.ok(run.token_estimate > 0 && run.token_estimate <= 9500);
  await transaction((db) =>
    recordNightRun(db, legacy, "Kept after the page task.", "kept"),
  );
  assert.equal(
    (
      await pool.query("SELECT budget_used FROM assistant_nights WHERE id=$1", [
        f.run.night_id,
      ])
    ).rows[0].budget_used,
    500 + run.token_estimate,
  );
});

test("budget exhaustion and disabled Night policy prevent provider calls", async () => {
  const f = await fixture({ night: true });
  await pool.query("UPDATE ai_settings SET night_token_budget=1000 WHERE id");
  assert.equal(
    (await processMaintainedPageRun(log, "overnight", options(f.run.id))).state,
    "failed",
  );
  assert.equal(seen.length, 0);
  assert.equal((await current(f.run.id)).token_estimate, 0);
  const other = await fixture({ night: true });
  await pool.query(
    "UPDATE agent_settings SET night_shift=jsonb_set(night_shift,'{enabled}','false') WHERE user_id=$1",
    [other.user.id],
  );
  assert.equal(
    (await processMaintainedPageRun(log, "overnight", options(other.run.id)))
      .state,
    "failed",
  );
  assert.equal(seen.length, 0);
});

test("switching hosted provider identity is detected even when endpoint and model are identical", async () => {
  const f = await fixture();
  const first = await resolveMaintainedPageModel(f.user.id, f.run.model_origin);
  const base = (
    await pool.query("SELECT base_url FROM ai_providers WHERE id=$1", [
      providerId,
    ])
  ).rows[0].base_url;
  const replacement = (
    await pool.query(
      "INSERT INTO ai_providers(kind,name,base_url) VALUES('openai','Other provider identity',$1) RETURNING id",
      [base],
    )
  ).rows[0].id;
  try {
    await pool.query("UPDATE ai_settings SET provider_id=$1 WHERE id", [
      replacement,
    ]);
    const next = await resolveMaintainedPageModel(
      f.user.id,
      f.run.model_origin,
    );
    assert.notEqual(next.key, first.key);
    let calls = 0;
    const result = await processMaintainedPageRun(log, "background", {
      ...options(f.run.id),
      resolveModel: async () => (++calls === 1 ? first : next),
    });
    assert.equal(result.state, "failed");
    assert.equal(seen.length, 0);
  } finally {
    await pool.query("UPDATE ai_settings SET provider_id=$1 WHERE id", [
      providerId,
    ]);
    await pool.query("DELETE FROM ai_providers WHERE id=$1", [replacement]);
  }
});

test("a queued Night review requirement cannot be weakened by a later preference change", async () => {
  const f = await fixture({ night: true });
  assert.equal(f.run.requires_review, true);
  await pool.query(
    "UPDATE agent_settings SET night_shift=jsonb_set(night_shift,'{wait_for_ok}','false') WHERE user_id=$1",
    [f.user.id],
  );
  assert.equal(
    (await processMaintainedPageRun(log, "overnight", options(f.run.id))).state,
    "waiting",
  );
  assert.equal(
    (await pool.query("SELECT version FROM docs WHERE id=$1", [f.doc.id]))
      .rows[0].version,
    1,
  );
});

test("shutdown after claim releases uncharged work without losing its retry allowance", async () => {
  const f = await fixture();
  const run = await transaction((db) =>
    claimMaintainedPageRun(db, "background", time, f.run.id),
  );
  assert.ok(run?.lease_token);
  const controller = new AbortController();
  controller.abort();
  const result = await processMaintainedPageRun(log, "background", {
    claimedRun: run!,
    signal: controller.signal,
    now: () => time,
  });
  assert.equal(result.state, "stopped");
  const job = await current(run!.id);
  assert.equal(job.state, "queued");
  assert.equal(job.attempts, 0);
  assert.equal(job.lease_token, null);
  assert.equal(seen.length, 0);
});

test("shutdown preserves staged output and resumption never calls the provider twice", async () => {
  const f = await fixture();
  const model = await resolveMaintainedPageModel(f.user.id);
  const run = await transaction((db) =>
    claimMaintainedPageRun(db, "background", time, f.run.id),
  );
  assert.ok(run?.lease_token);
  await transaction((db) =>
    reserveMaintainedPageModel(
      db,
      run!.id,
      run!.lease_token!,
      5000,
      model.key,
      time,
    ),
  );
  await transaction((db) =>
    stageMaintainedPageRun(
      db,
      run!.id,
      run!.lease_token!,
      {
        expected_revision: 1,
        replacements: [
          { id: "summary", type: "paragraph", text: "Retained staged output." },
        ],
      },
      5000,
      time,
    ),
  );
  const controller = new AbortController();
  controller.abort();
  assert.equal(
    (
      await processMaintainedPageRun(log, "background", {
        claimedRun: run!,
        signal: controller.signal,
        now: () => time,
      })
    ).state,
    "stopped",
  );
  const held = await current(run!.id);
  assert.equal(held.state, "queued");
  assert.ok(held.proposal);
  assert.equal(held.token_estimate, 5000);
  assert.equal(
    (await processMaintainedPageRun(log, "background", options(run!.id))).state,
    "done",
  );
  assert.equal(seen.length, 0);
});

test("shutdown during an uncertain transmitted request holds it instead of charging again", async () => {
  const f = await fixture();
  const controller = new AbortController();
  let requests = 0;
  assert.equal(
    (
      await processMaintainedPageRun(log, "background", {
        ...options(f.run.id),
        signal: controller.signal,
        request: async () => {
          requests++;
          controller.abort();
          throw new Error("private provider failure");
        },
      })
    ).state,
    "failed",
  );
  const held = await current(f.run.id);
  assert.equal(held.state, "failed");
  assert.ok(held.reserved_tokens > 0);
  assert.equal(held.error_message, "The model request could not finish.");
  assert.equal(
    (await processMaintainedPageRun(log, "background", options(f.run.id)))
      .state,
    "idle",
  );
  assert.equal(requests, 1);
});

test("page and chat jobs serialize Overnight work for the same person", async () => {
  const f = await fixture({ night: true });
  const { initialAssistantRun } =
    await import("../src/modules/ai/agent/run.js");
  const { claimAssistantJob } =
    await import("../src/modules/ai/agent/runner.js");
  const { releaseMaintainedPageRun } =
    await import("../src/modules/docs/maintenance-runs.js");
  const page = await transaction((db) =>
    claimMaintainedPageRun(db, "overnight", time, f.run.id),
  );
  assert.ok(page?.lease_token);
  const chat = (
    await pool.query(
      "INSERT INTO ai_chats(id,user_id,title) VALUES(gen_random_uuid(),$1,'Serial Night') RETURNING id",
      [f.user.id],
    )
  ).rows[0];
  const checkpoint = initialAssistantRun({
    chat_id: chat.id,
    turn_id: randomUUID(),
    message: "Night task",
    timezone: "UTC",
    history: [],
    scope: null,
    automation: { kind: "night" },
  });
  const job = (
    await pool.query(
      "INSERT INTO ai_jobs(user_id,chat_id,turn_id,state,run_state) VALUES($1,$2,$3,'queued',$4) RETURNING id",
      [
        f.user.id,
        chat.id,
        checkpoint.request.turn_id,
        JSON.stringify(checkpoint),
      ],
    )
  ).rows[0];
  try {
    assert.equal(await claimAssistantJob("parallel-night", "overnight"), null);
    assert.equal(
      await transaction((db) =>
        releaseMaintainedPageRun(db, page!.id, page!.lease_token!, time),
      ),
      true,
    );
    assert.equal(
      await transaction((db) =>
        claimMaintainedPageRun(db, "overnight", time, f.run.id),
      ),
      null,
    );
    assert.equal(
      (await claimAssistantJob("serial-night", "overnight"))?.id,
      job.id,
    );
    assert.equal(
      await transaction((db) =>
        claimMaintainedPageRun(db, "overnight", time, f.run.id),
      ),
      null,
    );
    await pool.query(
      "UPDATE ai_jobs SET state='waiting',lease_until=NULL WHERE id=$1",
      [job.id],
    );
    assert.equal(
      (
        await transaction((db) =>
          claimMaintainedPageRun(db, "overnight", time, f.run.id),
        )
      )?.id,
      page!.id,
    );
  } finally {
    await pool.query("DELETE FROM ai_jobs WHERE id=$1", [job.id]);
  }
});
