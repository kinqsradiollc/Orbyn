import "./setup.js";
import { after, afterEach, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
const adminEmail = `retry-admin-${randomUUID()}@example.com`;
process.env.ADMIN_EMAILS = adminEmail;
const { buildApp } = await import("../src/app.js");
const app = await buildApp();
let token: string;
const pages: string[] = [];
const extraUsers: string[] = [];
let entered: (() => void) | undefined;
let release: (() => void) | undefined;
let barrier: Promise<void> | undefined;
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { measureQueued } = await import("../src/modules/search/semantic.js");
let userId: string;
let providerId: string;
let requests = 0;
let failing = true;
const server = createServer((req, res) => {
  let raw = "";
  req.on("data", (chunk) => {
    raw += chunk;
  });
  req.on("end", async () => {
    requests++;
    const body = JSON.parse(raw);
    entered?.();
    if (barrier) await barrier;
    if (
      failing &&
      body.input.some((text: string) => text.includes("Failed passage"))
    ) {
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: {
            message: "private passage and credential must never be persisted",
          },
        }),
      );
    } else {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          data: body.input.map((_: string, index: number) => ({
            index,
            embedding: [1, 0, 0],
          })),
        }),
      );
    }
  });
});
before(async () => {
  await migrate();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const account = await app.inject({
    method: "POST",
    url: "/auth/register",
    payload: {
      email: adminEmail,
      name: "Retry fixture",
      password: "a-long-fixture-password",
    },
  });
  assert.equal(account.statusCode, 201, account.body);
  userId = account.json().user.id;
  token = account.json().token;
  providerId = (
    await pool.query(
      "INSERT INTO ai_providers(kind,name,base_url) VALUES('openai','Retry fixture',$1) RETURNING id",
      [`http://127.0.0.1:${(server.address() as { port: number }).port}`],
    )
  ).rows[0].id;
  await pool.query(
    "UPDATE ai_settings SET embedding_search_enabled=true,embedding_provider_id=$1,embedding_provider_revision=1,embedding_model='fixture',embedding_dimensions=3,semantic_accepted_at=now(),embedding_generation=gen_random_uuid()",
    [providerId],
  );
});
after(async () => {
  await pool.query(
    "UPDATE ai_settings SET embedding_search_enabled=false,embedding_provider_id=NULL,embedding_provider_revision=NULL,embedding_model='',embedding_dimensions=NULL,semantic_accepted_at=NULL,embedding_generation=gen_random_uuid()",
  );
  if (userId) await pool.query("DELETE FROM users WHERE id=$1", [userId]);
  await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [extraUsers]);
  if (providerId)
    await pool.query("DELETE FROM ai_providers WHERE id=$1", [providerId]);
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await app.close();
  await pool.end();
});
afterEach(async () => {
  release?.();
  entered = undefined;
  barrier = undefined;
  release = undefined;
  await pool.query("DELETE FROM docs WHERE id=ANY($1::uuid[])", [
    pages.splice(0),
  ]);
  await pool.query(
    "UPDATE ai_settings SET embedding_search_enabled=true,embedding_provider_revision=(SELECT embedding_revision FROM ai_providers WHERE id=$1),embedding_generation=gen_random_uuid()",
    [providerId],
  );
});
const page = async (text: string) => {
  const id = (
    await pool.query(
      "INSERT INTO docs(user_id,content) VALUES($1,$2::jsonb) RETURNING id",
      [userId, JSON.stringify([{ id: "passage", type: "paragraph", text }])],
    )
  ).rows[0].id as string;
  pages.push(id);
  return id;
};
const status = async () =>
  (
    await app.inject({
      method: "GET",
      url: "/ai/providers",
      headers: { authorization: `Bearer ${token}` },
    })
  ).json().settings;

test("retry status and setup retain auth, permission, parsing and rate-limit boundaries", async () => {
  assert.equal(
    (await app.inject({ method: "GET", url: "/ai/providers" })).statusCode,
    401,
  );
  const member = await app.inject({
    method: "POST",
    url: "/auth/register",
    remoteAddress: "10.82.0.1",
    payload: {
      email: `retry-member-${randomUUID()}@example.com`,
      name: "Member",
      password: "a-long-fixture-password",
    },
  });
  assert.equal(member.statusCode, 201, member.body);
  extraUsers.push(member.json().user.id);
  assert.equal(
    (
      await app.inject({
        method: "GET",
        url: "/ai/providers",
        headers: { authorization: `Bearer ${member.json().token}` },
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await app.inject({
        method: "PUT",
        url: "/ai/settings/semantic",
        remoteAddress: "10.82.0.2",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        payload: "{",
      })
    ).statusCode,
    400,
  );
  for (let at = 0; at < 11; at++)
    assert.equal(
      (
        await app.inject({
          method: "PUT",
          url: "/ai/settings/semantic",
          remoteAddress: "10.82.0.3",
          payload: { on: false },
        })
      ).statusCode,
      at === 10 ? 429 : 401,
    );
  assert.equal(requests, 0);
});

test("a failed page stays queued while a healthy later page is indexed", async () => {
  const bad = await page("Failed passage contains enough words to measure.");
  const good = await page("Healthy passage contains enough words to measure.");
  assert.equal(await measureQueued(), 1);
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM doc_embeddings WHERE doc_id=$1",
        [good],
      )
    ).rows[0].n,
    1,
  );
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM doc_embedding_queue WHERE doc_id=$1",
        [bad],
      )
    ).rows[0].n,
    1,
  );
  const failure = (
    await pool.query("SELECT * FROM doc_embedding_failures WHERE doc_id=$1", [
      bad,
    ])
  ).rows[0];
  assert.equal(failure.attempts, 1);
  const progress = await status();
  assert.equal(progress.embedding_failed_pages, 1);
  assert.equal(progress.embedding_pending_pages, 1);
  assert.equal(progress.embedding_indexed_pages, 1);
  assert.equal(
    progress.embedding_next_retry_at,
    new Date(failure.retry_at).toISOString(),
  );
  assert.equal(failure.error_code, "provider_unavailable");
  assert.ok(new Date(failure.retry_at).getTime() > Date.now());
  assert.doesNotMatch(
    JSON.stringify(failure),
    /private passage|credential|Failed passage/,
  );
  await migrate();
  await migrate();
  assert.equal(
    (
      await pool.query(
        "SELECT attempts FROM doc_embedding_failures WHERE doc_id=$1",
        [bad],
      )
    ).rows[0].attempts,
    1,
    "repeated migrations preserve failure state",
  );
  const before = requests;
  assert.equal(await measureQueued(), 0);
  assert.equal(requests, before, "backoff makes no request");
  const restarted = await promisify(execFile)(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
    if(!new URL(process.env.DATABASE_URL).pathname.endsWith('_test')) throw Error('Not a test database');
    const {pool}=await import('./backend/dist/db/pool.js');
    if((await pool.query("SELECT current_setting('orbyn.environment',true) AS env")).rows[0].env!=='test') throw Error('Missing marker');
    const {measureQueued}=await import('./backend/dist/modules/search/semantic.js');
    process.stdout.write(JSON.stringify({done:await measureQueued()}));await pool.end();
  `,
    ],
    {
      cwd: fileURLToPath(new URL("../../", import.meta.url)),
      env: process.env,
    },
  );
  assert.deepEqual(JSON.parse(restarted.stdout), { done: 0 });
  assert.equal(
    requests,
    before,
    "a fresh compiled process respects stored backoff",
  );
  await pool.query(
    "UPDATE doc_embedding_failures SET retry_at=now()-interval '1 second' WHERE doc_id=$1",
    [bad],
  );
  failing = false;
  assert.equal(await measureQueued(), 1);
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM doc_embedding_failures WHERE doc_id=$1",
        [bad],
      )
    ).rows[0].n,
    0,
  );
});

test("repeated failures have bounded persistent backoff and new edits reset it", async () => {
  failing = true;
  const id = await page("Failed passage has enough words for repeated errors.");
  for (let attempt = 1; attempt <= 8; attempt++) {
    assert.equal(await measureQueued(), 0);
    const row = (
      await pool.query(
        "SELECT attempts,extract(epoch FROM retry_at-failed_at)::int AS delay FROM doc_embedding_failures WHERE doc_id=$1",
        [id],
      )
    ).rows[0];
    assert.equal(row.attempts, attempt);
    assert.equal(row.delay, Math.min(3600, 60 * 2 ** (attempt - 1)));
    await pool.query(
      "UPDATE doc_embedding_failures SET retry_at=now()-interval '1 second' WHERE doc_id=$1",
      [id],
    );
  }
  await pool.query("UPDATE docs SET version=version+1 WHERE id=$1", [id]);
  assert.equal(
    (await status()).embedding_failed_pages,
    0,
    "old failure excluded after edit",
  );
  assert.equal(await measureQueued(), 0);
  assert.equal(
    (
      await pool.query(
        "SELECT attempts FROM doc_embedding_failures WHERE doc_id=$1",
        [id],
      )
    ).rows[0].attempts,
    1,
  );
});

for (const mutation of [
  "document",
  "configuration",
  "provider",
  "keep-out",
  "team",
] as const) {
  test(`failure after ${mutation} changed cannot delay newer work`, async () => {
    failing = true;
    const id = await page(
      "Failed passage changes while the provider is responding.",
    );
    let project: string | undefined;
    let team: string | undefined;
    if (mutation === "keep-out") {
      project = (
        await pool.query(
          "INSERT INTO projects(user_id,name) VALUES($1,'Visible') RETURNING id",
          [userId],
        )
      ).rows[0].id;
      await pool.query("UPDATE docs SET project_id=$2 WHERE id=$1", [
        id,
        project,
      ]);
    }
    if (mutation === "team") {
      team = (
        await pool.query(
          "INSERT INTO teams(name,created_by) VALUES('Visible',$1) RETURNING id",
          [userId],
        )
      ).rows[0].id;
      await pool.query("UPDATE docs SET team_id=$2 WHERE id=$1", [id, team]);
    }
    const arrived = new Promise<void>((resolve) => {
      entered = resolve;
    });
    barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const job = measureQueued();
    await arrived;
    if (mutation === "document")
      await pool.query("UPDATE docs SET version=version+1 WHERE id=$1", [id]);
    if (mutation === "configuration")
      await pool.query(
        "UPDATE ai_settings SET embedding_search_enabled=false,embedding_generation=gen_random_uuid()",
      );
    if (mutation === "provider")
      await pool.query(
        "UPDATE ai_providers SET options=options || '{\"revisionRace\":true}'::jsonb WHERE id=$1",
        [providerId],
      );
    if (mutation === "keep-out")
      await pool.query("UPDATE projects SET assistant_off=true WHERE id=$1", [
        project,
      ]);
    if (mutation === "team")
      await pool.query("UPDATE teams SET assistant_allowed=false WHERE id=$1", [
        team,
      ]);
    release!();
    assert.equal(await job, 0);
    assert.equal(
      (
        await pool.query(
          "SELECT count(*)::int AS n FROM doc_embedding_failures WHERE doc_id=$1",
          [id],
        )
      ).rows[0].n,
      0,
    );
    if (project)
      await pool.query("DELETE FROM projects WHERE id=$1", [project]);
    if (team) await pool.query("DELETE FROM teams WHERE id=$1", [team]);
  });
}

test("configuration change clears failures and hides old retry counts", async () => {
  failing = true;
  await page("Failed passage for a changed configuration fixture.");
  await measureQueued();
  assert.equal((await status()).embedding_failed_pages, 1);
  await pool.query(
    "UPDATE ai_settings SET embedding_generation=gen_random_uuid()",
  );
  assert.equal((await status()).embedding_failed_pages, 0);
  const off = await app.inject({
    method: "PUT",
    url: "/ai/settings/semantic",
    headers: { authorization: `Bearer ${token}` },
    payload: { on: false },
  });
  assert.equal(off.statusCode, 200, off.body);
  assert.equal(off.json().embedding_failed_pages, undefined);
  assert.equal(
    (await pool.query("SELECT count(*)::int AS n FROM doc_embedding_failures"))
      .rows[0].n,
    0,
  );
});
