// Disposable local UI fixture. Never runs against a development or production database.
import "../setup.js";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { writeFile } from "node:fs/promises";
import { agreementVersion, type ReminderNudgeCard } from "@orbyn/core";
const { pool } = await import("../../src/db/pool.js");
const { migrate } = await import("../../src/db/migrate.js");
const { buildApp } = await import("../../src/app.js");
const { settings } = await import("../../src/lib/settings.js");
if (new URL(process.env.TEST_DATABASE_URL!).pathname !== "/orbyn_r1r10_ui_test")
  throw new Error("UI fixture requires its dedicated test database.");
await migrate();
const provider = createServer(async (request, response) => {
  let text = "";
  for await (const chunk of request) text += chunk;
  const body = JSON.parse(text),
    tools =
      body.tools?.map(
        (tool: { function?: { name?: string } }) => tool.function?.name,
      ) ?? [];
  response.writeHead(200, { "content-type": "application/json" });
  response.end(
    JSON.stringify({
      choices: [
        {
          finish_reason: "tool_calls",
          message: {
            content: null,
            tool_calls: [
              {
                id: randomUUID(),
                type: "function",
                function: {
                  name: tools.includes("finish") ? "finish" : "report",
                  arguments: JSON.stringify(
                    tools.includes("finish")
                      ? { answer: "UI run completed.", steps: [] }
                      : {
                          status: "done",
                          summary: "UI fixture report",
                          findings: [],
                          steps: [],
                          open_questions: [],
                        },
                  ),
                },
              },
            ],
          },
        },
      ],
    }),
  );
});
await new Promise<void>((resolve) =>
  provider.listen(18009, "127.0.0.1", resolve),
);
const providerId = (
  await pool.query(
    "INSERT INTO ai_providers(kind,name,base_url) VALUES('openai-compatible','Local UI mock','http://127.0.0.1:18009/v1') RETURNING id",
  )
).rows[0].id;
await pool.query(
  "UPDATE ai_settings SET provider_id=$1,model='ui-mock' WHERE id",
  [providerId],
);
const app = await buildApp();
const restoreChat = randomUUID(),
  reminderChat = randomUUID(),
  nudgeId = randomUUID(),
  turnId = randomUUID();
let held = false,
  release: (() => void) | undefined;
app.addHook("onRequest", async (request) => {
  if (
    held &&
    request.method === "GET" &&
    request.url === `/ai/chats/${restoreChat}`
  )
    await new Promise<void>((resolve) => {
      release = resolve;
    });
});
app.post("/__test/hold-restore", async () => {
  held = true;
  return { held };
});
app.post("/__test/release-restore", async () => {
  held = false;
  release?.();
  return { held };
});

const email = `r1r10-ui-${randomUUID()}@example.test`,
  password = "Disposable-verification-2050!";
const registered = await app.inject({
  method: "POST",
  url: "/auth/register",
  payload: {
    email,
    password,
    name: "UI verifier",
    accept_terms: agreementVersion((await settings()).legal),
  },
});
if (registered.statusCode !== 201)
  throw new Error("Fixture registration failed.");
const user = registered.json().user;
await pool.query(
  "INSERT INTO ai_chats(id,user_id,title,origin,turns) VALUES($1,$2,'Restorable chat','person',$3::jsonb)",
  [
    restoreChat,
    user.id,
    JSON.stringify([
      { role: "user", turn_id: turnId, text: "Original saved message" },
      {
        role: "assistant",
        turn_id: turnId,
        text: "Original saved reply",
        outcome: "info",
      },
    ]),
  ],
);
const item = (
  await pool.query(
    "INSERT INTO items(user_id,title,due_at) VALUES($1,'UI reminder task','2050-01-10T17:00:00Z') RETURNING id",
    [user.id],
  )
).rows[0].id;
const card: ReminderNudgeCard = {
  id: nudgeId,
  key: `task:${item}`,
  entity_kind: "task",
  entity_id: item,
  actions: ["done", "move", "skip", "book"],
};
await pool.query(
  "INSERT INTO assistant_nudges(id,user_id,nudge_key,entity_kind,entity_id,local_day) VALUES($1,$2,$3,'task',$4,'2050-01-01')",
  [nudgeId, user.id, card.key, item],
);
await pool.query(
  "INSERT INTO ai_chats(id,user_id,title,origin,turns) VALUES($1,$2,'Reminders','reminders',$3::jsonb)",
  [
    reminderChat,
    user.id,
    JSON.stringify([
      {
        role: "assistant",
        turn_id: nudgeId,
        text: "UI reminder task needs your attention.",
        outcome: "info",
        nudge: card,
      },
    ]),
  ],
);
const nights = [];
for (const day of ["2050-01-01", "2050-01-02"]) {
  const night = (
    await pool.query(
      "INSERT INTO assistant_nights(user_id,local_day,status) VALUES($1,$2,'done') RETURNING id",
      [user.id, day],
    )
  ).rows[0].id;
  const job = (
    await pool.query(
      'INSERT INTO ai_jobs(user_id,state,sources_checked,result) VALUES($1,\'done\',true,\'{"assistant_run":{"outcome":"info"}}\') RETURNING id',
      [user.id],
    )
  ).rows[0].id;
  await pool.query(
    "INSERT INTO assistant_night_runs(night_id,job_id,kind,summary) VALUES($1,$2,'tidy',$3)",
    [night, job, `Fixture result for ${day}`],
  );
  nights.push(night);
}
await writeFile(
  "/tmp/orbyn-r1r10-ui-fixture.json",
  JSON.stringify({
    email,
    password,
    userId: user.id,
    restoreChat,
    reminderChat,
    nudgeId,
    item,
    nights,
  }),
  { mode: 0o600 },
);
await app.listen({ port: 18008, host: "127.0.0.1" });
process.on(
  "SIGTERM",
  () =>
    void app
      .close()
      .then(() => pool.end())
      .then(() => provider.close())
      .then(() => process.exit(0)),
);
