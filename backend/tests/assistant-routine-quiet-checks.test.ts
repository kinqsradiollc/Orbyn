import "./setup.js";
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage } from "node:http";
import {
  routineRecovery,
  routineRetryPolicyPage,
  assistantRoutineRunsPage,
  type RoutineRecovery,
  type RoutineRetryPolicy,
} from "@orbyn/core";
import { startTestAssistantRuntime } from "./helpers/assistant-runtime.js";
import { runtimeOutcome } from "../src/modules/ai/agent/outcome.js";

type Request = {
  messages?: { role: string; content: string | null }[];
  tools?: { function?: { name?: string } }[];
};
type Script = {
  mode:
    | "fail"
    | "finish"
    | "create"
    | "question"
    | "watch"
    | "skip"
    | "useful"
    | "partial";
  source?: string;
  sources?: string[];
  calls: number;
  title: string;
};
const scripts = new Map<string, Script>(),
  providerErrors: string[] = [];
const bodyOf = (req: IncomingMessage) =>
  new Promise<string>((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
const provider = createServer(async (req, res) => {
  try {
    const body = JSON.parse(await bodyOf(req)) as Request,
      prompt = (body.messages ?? [])
        .map((message) => message.content ?? "")
        .join("\n");
    const marker = [...prompt.matchAll(/RoutineCase:([0-9a-f-]{36})/gi)].at(
      -1,
    )?.[1];
    assert.ok(marker, "Only a marked local routine may reach the fixture");
    const script = scripts.get(marker);
    assert.ok(script);
    script.calls++;
    if (script.mode === "fail") {
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: { message: "Temporary local fixture rejection" },
        }),
      );
      return;
    }
    const names = (body.tools ?? []).map((tool) => tool.function?.name),
      previous = [...(body.messages ?? [])]
        .reverse()
        .find((message) => message.role === "tool");
    let reply: { name: string; arguments: Record<string, unknown> };
    if (["watch", "skip", "useful", "partial"].includes(script.mode)) {
      const fetched = previous?.content ? JSON.parse(previous.content) : null;
      const readIds = new Set(
        (body.messages ?? [])
          .filter((m) => m.role === "tool")
          .flatMap((m) => {
            try {
              const v = JSON.parse(m.content ?? "{}");
              return v.metadata ? [v.id] : [];
            } catch {
              return [];
            }
          }),
      );
      const nextSource = script.sources?.find((id) => !readIds.has(id));
      if (script.mode !== "skip" && nextSource)
        reply = { name: "fetch", arguments: { id: nextSource } };
      else if (script.mode !== "skip" && !fetched?.metadata)
        reply = { name: "fetch", arguments: { id: script.source! } };
      else if (fetched?.metadata?.next_block && script.mode !== "partial")
        reply = {
          name: "fetch",
          arguments: {
            id: script.source!,
            next_block: fetched.metadata.next_block,
          },
        };
      else
        reply =
          script.mode === "useful"
            ? {
                name: "finish",
                arguments: {
                  answer: "A useful report still deserves attention.",
                  steps: [],
                },
              }
            : { name: "report_no_change", arguments: {} };
    } else if (script.mode === "question")
      reply = {
        name: "ask_person",
        arguments: {
          question: "Which note should I summarize?",
          choices: ["First", "Second"],
        },
      };
    else if (script.mode === "create" && names.includes("delegate")) {
      if (!previous)
        reply = {
          name: "delegate",
          arguments: {
            tasks: [
              {
                specialist: "projects",
                want_options: false,
                brief: `RoutineCase:${marker} Create exactly one task titled ${script.title}.`,
              },
            ],
          },
        };
      else {
        const reports = JSON.parse(previous.content ?? "[]") as {
          staged_step_ids?: string[];
        }[];
        const steps = reports.flatMap((report) => report.staged_step_ids ?? []);
        assert.equal(steps.length, 1, JSON.stringify(reports));
        reply = {
          name: "finish",
          arguments: { answer: "Created the one requested task.", steps },
        };
      }
    } else if (script.mode === "create" && names.includes("report")) {
      if (!previous)
        reply = {
          name: "create_tasks",
          arguments: { tasks: [{ title: script.title, kind: "task" }] },
        };
      else {
        const staged = JSON.parse(previous.content ?? "{}");
        assert.ok(staged.step_id);
        reply = {
          name: "report",
          arguments: {
            status: "done",
            summary: "Staged one task.",
            findings: [],
            steps: [staged.step_id],
            open_questions: [],
          },
        };
      }
    } else
      reply = {
        name: "finish",
        arguments: {
          answer: "A concise local routine summary is ready for review.",
          steps: [],
        },
      };
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        usage: { prompt_tokens: 17, completion_tokens: 11, total_tokens: 28 },
        choices: [
          {
            finish_reason: "tool_calls",
            message: {
              content: null,
              tool_calls: [
                {
                  id: `routine_${script.calls}`,
                  type: "function",
                  function: {
                    name: reply.name,
                    arguments: JSON.stringify(reply.arguments),
                  },
                },
              ],
            },
          },
        ],
      }),
    );
  } catch (error) {
    providerErrors.push(String(error));
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Local routine fixture mismatch" }));
  }
});
process.env.ASSISTANT_CONVERSATION_ENABLED = "true";
const { pool, transaction } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { buildApiService } = await import("../src/app.js");
const { assistantPrincipal } =
  await import("../src/modules/agents/assistant.js");
const { invalidateSettings } = await import("../src/lib/settings.js");
const { scanAssistantRoutines } =
  await import("../src/worker/assistant-routines.js");
const { scanNightShift } = await import("../src/worker/night-shift.js");
const { settleRoutineRecoveries, scanRoutineRetries } =
  await import("../src/worker/routine-recovery.js");
const { stopRoutineRecovery } =
  await import("../src/modules/assistant-workspace/routine-recovery.js");
const app = await buildApiService(),
  users: string[] = [];
let providerId: string | undefined,
  original: { provider_id: string | null; model: string },
  stopRuntime: (() => Promise<void>) | undefined,
  address = 0;
const remote = () =>
  `10.78.${Math.floor(address / 250)}.${(address++ % 250) + 1}`;
before(async () => {
  await migrate();
  original = (
    await pool.query("SELECT provider_id,model FROM ai_settings WHERE id")
  ).rows[0];
  await new Promise<void>((resolve) =>
    provider.listen(0, "127.0.0.1", resolve),
  );
  const port = (provider.address() as { port: number }).port;
  providerId = (
    await pool.query(
      "INSERT INTO ai_providers(kind,name,base_url) VALUES('openai-compatible','Routine recovery fixture',$1) RETURNING id",
      [`http://127.0.0.1:${port}/v1`],
    )
  ).rows[0].id;
  await pool.query(
    "UPDATE ai_settings SET provider_id=$1,model='routine-recovery-fixture' WHERE id",
    [providerId],
  );
  invalidateSettings();
});
after(async () => {
  await stopRuntime?.();
  await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [users]);
  if (original)
    await pool.query(
      "UPDATE ai_settings SET provider_id=$1,model=$2 WHERE id",
      [original.provider_id, original.model],
    );
  if (providerId)
    await pool.query("DELETE FROM ai_providers WHERE id=$1", [providerId]);
  invalidateSettings();
  await app.close();
  await new Promise<void>((resolve, reject) =>
    provider.close((error) => (error ? reject(error) : resolve())),
  );
  await pool.end();
  assert.deepEqual(providerErrors, []);
});
const defaults: RoutineRetryPolicy = {
  enabled: true,
  max_attempts: 3,
  token_limit: 200000,
  max_elapsed_minutes: 180,
  backoff_seconds: 5,
};
async function fixture(
  options: {
    enabled?: boolean;
    policy?: Partial<RoutineRetryPolicy>;
    mode?: Script["mode"];
    final?: boolean;
  } = {},
) {
  const registered = await app.inject({
    method: "POST",
    url: "/auth/register",
    remoteAddress: remote(),
    payload: {
      email: `routine-recovery-${randomUUID()}@example.com`,
      password: "a-long-test-password",
      name: "Routine tester",
    },
  });
  assert.equal(registered.statusCode, 201, registered.body);
  const { user, token } = registered.json();
  users.push(user.id);
  await assistantPrincipal({ id: user.id, name: user.name, role: "member" });
  const { openPersonalConversation } =
    await import("../src/modules/assistant-workspace/conversation-storage.js");
  await transaction((db) => openPersonalConversation(db, user.id));
  const request = (
    method: "GET" | "POST" | "PUT",
    url: string,
    payload?: unknown,
  ) =>
    app.inject({
      method,
      url,
      remoteAddress: remote(),
      headers: { authorization: `Bearer ${token}` },
      ...(payload === undefined ? {} : { payload }),
    });
  const marker = randomUUID(),
    script: Script = {
      mode: options.mode ?? "fail",
      calls: 0,
      title: `Routine task ${marker.slice(0, 8)}`,
    };
  scripts.set(marker, script);
  const due = new Date(Date.now() + 2000),
    until = new Date(due.getTime() + 60000)
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d{3}Z$/, "Z");
  const made = await request("POST", "/me/agent-routines", {
    instruction: `RoutineCase:${marker} ${script.mode === "create" ? "Create exactly one personal task." : "Summarize my saved routine notes."}`,
    rrule: options.final ? `FREQ=DAILY;UNTIL=${until}` : "FREQ=DAILY",
    timezone: "UTC",
    next_run_at: due.toISOString(),
  });
  assert.equal(made.statusCode, 201, made.body);
  const routine = made.json();
  if (script.mode === "create") {
    const scopes = await request("PUT", "/me/assistant/approval-scopes", {
      tasks: { scope: "routine", id: routine.id },
    });
    assert.equal(scopes.statusCode, 200, scopes.body);
  }
  const base = await request(
    "GET",
    `/me/agent-routines/${routine.id}/retry-policy`,
  );
  assert.equal(base.statusCode, 200, base.body);
  const initial = routineRetryPolicyPage.parse(base.json());
  assert.equal(initial.policy.enabled, false);
  if (options.enabled === true) {
    const body = {
      request_id: randomUUID(),
      expected_revision: initial.revision,
      policy: { ...defaults, ...options.policy },
    };
    const saved = await request(
      "PUT",
      `/me/agent-routines/${routine.id}/retry-policy`,
      body,
    );
    assert.equal(saved.statusCode, 200, saved.body);
    const again = await request(
      "PUT",
      `/me/agent-routines/${routine.id}/retry-policy`,
      body,
    );
    assert.equal(again.statusCode, 200, again.body);
    assert.equal(again.json().revision, saved.json().revision);
  }
  return { user, token, request, routine, due, script, marker };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function initial(f: Fixture) {
  const counts = await Promise.all([
    scanAssistantRoutines(new Date(f.due.getTime() + 1), { only: [f.user.id] }),
    scanAssistantRoutines(new Date(f.due.getTime() + 1), { only: [f.user.id] }),
  ]);
  assert.equal(
    counts.reduce((sum, count) => sum + count, 0),
    1,
  );
  const runs = (
    await pool.query(
      "SELECT * FROM assistant_routine_runs WHERE routine_id=$1",
      [f.routine.id],
    )
  ).rows;
  assert.equal(runs.length, 1);
  return runs[0] as { id: string; job_id: string; scheduled_for: Date };
}

async function waitJob(id: string, wanted = ["done", "failed"]) {
  for (let n = 0; n < 500; n++) {
    const row = (
      await pool.query(
        "SELECT state,result,terminal_evidence,error_message FROM ai_jobs WHERE id=$1",
        [id],
      )
    ).rows[0];
    if (row && wanted.includes(row.state)) return row;
    await new Promise((r) => setTimeout(r, 25));
  }
  assert.fail(`Job ${id} failed to settle`);
}
async function setupWatch(mode: Script["mode"] = "watch", content?: unknown[]) {
  const f = await fixture({ mode });
  const { openPersonalConversation } =
    await import("../src/modules/assistant-workspace/conversation-storage.js");
  await transaction((db) => openPersonalConversation(db, f.user.id));
  await pool.query(
    "INSERT INTO agent_settings(user_id,reminder_nudges) VALUES($1,$2) ON CONFLICT(user_id) DO UPDATE SET reminder_nudges=$2",
    [f.user.id, { quiet_start: "00:00", quiet_end: "00:00" }],
  );
  const source = content
    ? (
        await pool.query(
          "INSERT INTO docs(user_id,title,content) VALUES($1,'Watched page',$2::jsonb) RETURNING id",
          [f.user.id, JSON.stringify(content)],
        )
      ).rows[0].id
    : (
        await pool.query(
          "INSERT INTO items(user_id,title,notes,kind) VALUES($1,'Watched task','All task notes','task') RETURNING id",
          [f.user.id],
        )
      ).rows[0].id;
  const kind = content ? "doc" : "task";
  f.script.source = `${kind}:${source}`;
  const before = await f.request(
    "GET",
    `/me/agent-routines/${f.routine.id}/quiet-check-policy`,
  );
  assert.equal(before.statusCode, 200, before.body);
  assert.equal(before.json().policy.enabled, false);
  const body = {
    request_id: randomUUID(),
    expected_revision: before.json().revision,
    policy: { enabled: true, sources: [{ kind, id: source }] },
  };
  const saved = await f.request(
    "PUT",
    `/me/agent-routines/${f.routine.id}/quiet-check-policy`,
    body,
  );
  assert.equal(saved.statusCode, 200, saved.body);
  const again = await f.request(
    "PUT",
    `/me/agent-routines/${f.routine.id}/quiet-check-policy`,
    body,
  );
  assert.equal(again.statusCode, 200, again.body);
  assert.equal(again.json().revision, saved.json().revision);
  return { ...f, source, kind };
}
async function runWatch(f: Awaited<ReturnType<typeof setupWatch>>) {
  await pool.query(
    "UPDATE agent_routines SET next_run_at=now()-interval '1 second',claimed_at=NULL,current_job_id=NULL,paused=false WHERE id=$1",
    [f.routine.id],
  );
  assert.equal(
    await scanAssistantRoutines(new Date(), { only: [f.user.id] }),
    1,
  );
  const run = (
    await pool.query(
      "SELECT * FROM assistant_routine_runs WHERE routine_id=$1 ORDER BY scheduled_for DESC LIMIT 1",
      [f.routine.id],
    )
  ).rows[0];
  stopRuntime = await startTestAssistantRuntime("background");
  try {
    const job = await waitJob(run.job_id);
    assert.equal(job.state, "done", JSON.stringify(job));
    const row = (
      await pool.query("SELECT * FROM assistant_quiet_checks WHERE job_id=$1", [
        run.job_id,
      ])
    ).rows[0];
    assert.ok(row);
    return { run, job, row };
  } finally {
    await stopRuntime();
    stopRuntime = undefined;
  }
}
const { routineQuietDeliveryProof } =
  await import("../src/modules/assistant-workspace/routine-quiet-checks.js");
test("real runtime records a visible baseline then verifies a fresh unchanged check; changed/useful results stay visible", async () => {
  const f = await setupWatch();
  const first = await runWatch(f);
  assert.equal(first.row.status, "baseline", JSON.stringify(first));
  assert.equal(first.row.checked_count, 1);
  assert.match(first.job.result.answer, /first comparable/);
  const second = await runWatch(f);
  assert.equal(second.row.status, "verified_unchanged", JSON.stringify(second));
  assert.equal(
    await transaction((db) =>
      routineQuietDeliveryProof(db, f.user.id, second.run.job_id),
    ),
    true,
  );
  const { publishConversationIntent } =
    await import("../src/modules/assistant-workspace/conversation-delivery.js");
  const intent = (
    await pool.query(
      "SELECT i.id FROM assistant_delivery_intents i JOIN assistant_delivery_bindings b ON b.id=i.binding_id WHERE b.work_kind='job' AND b.work_id=$1 AND i.payload->>'event'='result'",
      [second.run.job_id],
    )
  ).rows[0];
  assert.ok(
    intent,
    "Expected the routine result delivery intent in its captured destination",
  );
  assert.equal(
    await transaction((db) => publishConversationIntent(db, intent.id)),
    false,
  );
  assert.equal(
    (
      await pool.query(
        "SELECT reason FROM assistant_delivery_intents WHERE id=$1",
        [intent.id],
      )
    ).rows[0].reason,
    "unchanged",
  );
  await pool.query(
    "UPDATE items SET notes='New observation',version=version+1 WHERE id=$1",
    [f.source],
  );
  assert.equal(
    await transaction((db) =>
      routineQuietDeliveryProof(db, f.user.id, second.run.job_id),
    ),
    false,
  );
  const changed = await runWatch(f);
  assert.equal(changed.row.status, "changed", JSON.stringify(changed));
  f.script.mode = "useful";
  const useful = await runWatch(f);
  assert.equal(useful.row.status, "reported", JSON.stringify(useful));
  assert.match(useful.job.result.answer, /useful report/);
  assert.equal(
    await transaction((db) =>
      routineQuietDeliveryProof(db, f.user.id, useful.run.job_id),
    ),
    false,
  );
});
test("a model no-change assertion without a read never becomes coverage", async () => {
  const f = await setupWatch("skip");
  const result = await runWatch(f);
  assert.equal(result.row.status, "incomplete", JSON.stringify(result));
  assert.equal(result.row.checked_count, 0);
});
test("partial page and overlong single block cannot certify complete content", async () => {
  const f = await setupWatch(
    "partial",
    Array.from({ length: 8 }, (_, n) => ({
      id: `b${n}`,
      type: "paragraph",
      text: "x".repeat(4000),
    })),
  );
  const partial = await runWatch(f);
  assert.equal(partial.row.status, "incomplete", JSON.stringify(partial));
  await pool.query(
    "UPDATE docs SET content=$2::jsonb,version=version+1 WHERE id=$1",
    [
      f.source,
      JSON.stringify([
        { id: "long", type: "paragraph", text: "x".repeat(30000) },
      ]),
    ],
  );
  // A previously supported source which becomes unsupported fails closed before inference.
  await pool.query(
    "UPDATE agent_routines SET next_run_at=now()-interval '1 second',claimed_at=NULL,current_job_id=NULL WHERE id=$1",
    [f.routine.id],
  );
  assert.equal(
    await scanAssistantRoutines(new Date(), { only: [f.user.id] }),
    1,
  );
  const check = (
    await pool.query(
      "SELECT * FROM assistant_quiet_checks WHERE routine_id=$1 ORDER BY created_at DESC LIMIT 1",
      [f.routine.id],
    )
  ).rows[0];
  stopRuntime = await startTestAssistantRuntime("background");
  await waitJob(check.job_id);
  await stopRuntime();
  stopRuntime = undefined;
  const { settleFailedRoutineQuietChecks } =
    await import("../src/modules/assistant-workspace/routine-quiet-checks.js");
  await settleFailedRoutineQuietChecks("background");
  assert.equal(
    (
      await pool.query(
        "SELECT status FROM assistant_quiet_checks WHERE id=$1",
        [check.id],
      )
    ).rows[0].status,
    "incomplete",
  );
});
test("all continuation pages are required for a comparable baseline", async () => {
  const f = await setupWatch(
    "watch",
    Array.from({ length: 8 }, (_, n) => ({
      id: `b${n}`,
      type: "paragraph",
      text: `Block ${n} ` + "x".repeat(4000),
    })),
  );
  const baseline = await runWatch(f);
  assert.equal(baseline.row.status, "baseline", JSON.stringify(baseline));
  const reads = (
    await pool.query(
      "SELECT * FROM assistant_quiet_read_receipts WHERE check_id=$1 ORDER BY start_index",
      [baseline.row.id],
    )
  ).rows;
  assert.ok(reads.length > 1);
  assert.equal(reads[0].start_index, 0);
  assert.equal(reads.at(-1).end_index, 8);
  const unchanged = await runWatch(f);
  assert.equal(
    unchanged.row.status,
    "verified_unchanged",
    JSON.stringify(unchanged),
  );
});
test("actual applied work is visible and cannot establish a quiet baseline", async () => {
  const f = await setupWatch("create");
  const result = await runWatch(f);
  assert.equal(
    result.job.terminal_evidence.effects,
    "applied",
    JSON.stringify(result),
  );
  assert.equal(result.row.status, "incomplete");
  assert.equal(result.row.snapshot_aggregate, null);
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int n FROM items WHERE user_id=$1 AND title=$2",
        [f.user.id, f.script.title],
      )
    ).rows[0].n,
    1,
  );
});
test("a real question remains pending and records its decision history; inaccessible evidence is metadata only", async () => {
  const f = await setupWatch("question");
  await pool.query(
    "UPDATE agent_routines SET next_run_at=now()-interval '1 second',claimed_at=NULL,current_job_id=NULL WHERE id=$1",
    [f.routine.id],
  );
  assert.equal(
    await scanAssistantRoutines(new Date(), { only: [f.user.id] }),
    1,
  );
  const row = (
    await pool.query(
      "SELECT * FROM assistant_quiet_checks WHERE routine_id=$1 ORDER BY created_at DESC LIMIT 1",
      [f.routine.id],
    )
  ).rows[0];
  stopRuntime = await startTestAssistantRuntime("background");
  await waitJob(row.job_id, ["waiting"]);
  await stopRuntime();
  stopRuntime = undefined;
  const current = (
    await pool.query("SELECT * FROM assistant_quiet_checks WHERE id=$1", [
      row.id,
    ])
  ).rows[0];
  assert.equal(current.status, "pending");
  assert.equal(current.decision_seen, true);
  const page = await f.request(
    "GET",
    `/me/agent-routines/${f.routine.id}/runs/${row.occurrence_id}/quiet-checks`,
  );
  assert.equal(page.statusCode, 200, page.body);
  assert.equal(page.json().checks[0].visibility, "available");
  await pool.query("DELETE FROM items WHERE id=$1", [f.source]);
  const restricted = await f.request(
    "GET",
    `/me/agent-routines/${f.routine.id}/runs/${row.occurrence_id}/quiet-checks`,
  );
  assert.equal(restricted.statusCode, 200, restricted.body);
  assert.equal(restricted.json().checks[0].visibility, "restricted");
  assert.equal(JSON.stringify(restricted.json()).includes(f.source), false);
  assert.equal(restricted.json().checks[0].job_id, undefined);
  const settings = await f.request(
    "GET",
    `/me/agent-routines/${f.routine.id}/quiet-check-policy`,
  );
  assert.equal(settings.json().visibility, "restricted");
  const cleared = await f.request(
    "PUT",
    `/me/agent-routines/${f.routine.id}/quiet-check-policy`,
    {
      request_id: randomUUID(),
      expected_revision: settings.json().revision,
      policy: { enabled: false, sources: [] },
    },
  );
  assert.equal(cleared.statusCode, 200, cleared.body);
  assert.equal(cleared.json().policy.enabled, false);
});
test("the full twenty-source watch can complete within its bounded read loop", async () => {
  const f = await setupWatch();
  const ids = [
    f.source,
    ...(
      await pool.query(
        "INSERT INTO items(user_id,title,kind) SELECT $1,'Watch item '||n,'task' FROM generate_series(1,19) n RETURNING id",
        [f.user.id],
      )
    ).rows.map((r) => r.id),
  ];
  const page = await f.request(
    "GET",
    `/me/agent-routines/${f.routine.id}/quiet-check-policy`,
  );
  const saved = await f.request(
    "PUT",
    `/me/agent-routines/${f.routine.id}/quiet-check-policy`,
    {
      request_id: randomUUID(),
      expected_revision: page.json().revision,
      policy: {
        enabled: true,
        sources: ids.map((id) => ({ kind: "task", id })),
      },
    },
  );
  assert.equal(saved.statusCode, 200, saved.body);
  f.script.sources = ids.map((id) => `task:${id}`);
  const result = await runWatch(f);
  assert.equal(result.row.status, "baseline", JSON.stringify(result));
  assert.equal(result.row.expected_count, 20);
  assert.equal(result.row.checked_count, 20);
});
test("a watch-policy change after admission stops the old job before inference", async () => {
  const f = await setupWatch();
  await pool.query(
    "UPDATE agent_routines SET next_run_at=now()-interval '1 second',claimed_at=NULL,current_job_id=NULL WHERE id=$1",
    [f.routine.id],
  );
  assert.equal(
    await scanAssistantRoutines(new Date(), { only: [f.user.id] }),
    1,
  );
  const check = (
    await pool.query(
      "SELECT * FROM assistant_quiet_checks WHERE routine_id=$1 ORDER BY created_at DESC LIMIT 1",
      [f.routine.id],
    )
  ).rows[0];
  const page = await f.request(
    "GET",
    `/me/agent-routines/${f.routine.id}/quiet-check-policy`,
  );
  const saved = await f.request(
    "PUT",
    `/me/agent-routines/${f.routine.id}/quiet-check-policy`,
    {
      request_id: randomUUID(),
      expected_revision: page.json().revision,
      policy: { enabled: false, sources: [] },
    },
  );
  assert.equal(saved.statusCode, 200, saved.body);
  stopRuntime = await startTestAssistantRuntime("background");
  const job = await waitJob(check.job_id);
  await stopRuntime();
  stopRuntime = undefined;
  assert.equal(job.state, "failed");
  assert.equal(f.script.calls, 0);
  const { settleFailedRoutineQuietChecks } =
    await import("../src/modules/assistant-workspace/routine-quiet-checks.js");
  await settleFailedRoutineQuietChecks("background");
  assert.equal(
    (
      await pool.query(
        "SELECT status FROM assistant_quiet_checks WHERE id=$1",
        [check.id],
      )
    ).rows[0].status,
    "incomplete",
  );
});
