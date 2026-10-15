import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import "./setup.js";
const { buildApp } = await import("../src/app.js");
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { env } = await import("../src/config/env.js");
const { buildPdfService } = await import("../src/modules/docs/pdf-service.js");
const bytes = Buffer.from("%PDF-1.7\nsynthetic compiler fixture");
let render: () => Promise<Buffer> = async () => bytes;
const compiler = buildPdfService({
  key: "latex-boundary-fixture-private-key-32-characters",
  executable: "fixture",
  sourceKind: "latex",
  limit: 1,
  render: () => render(),
});
const app = await buildApp();
const users: string[] = [],
  teams: string[] = [];
const previous = [env.DOC_LATEX_URL, env.DOC_PDF_KEY];
let ip = 1;
const call = (token: string | null, url: string, payload: object) =>
  app.inject({
    method: "POST",
    url,
    remoteAddress: `127.1.0.${ip++}`,
    headers: token ? { authorization: `Bearer ${token}` } : {},
    payload,
  });
async function account() {
  const response = await call(null, "/auth/register", {
    email: `latex-${randomUUID()}@example.test`,
    password: "synthetic-latex-fixture-password",
    name: "Compiler fixture",
  });
  assert.equal(response.statusCode, 201, response.body);
  const value = response.json();
  users.push(value.user.id);
  return { id: value.user.id as string, token: value.token as string };
}
async function page(user: Awaited<ReturnType<typeof account>>) {
  const response = await call(user.token, "/docs", {
    title: "Compiler boundary fixture",
  });
  assert.equal(response.statusCode, 201, response.body);
  return response.json() as { id: string; version: number };
}
before(async () => {
  await migrate();
  env.DOC_LATEX_URL = await compiler.listen({ host: "127.0.0.1", port: 0 });
  env.DOC_PDF_KEY = "latex-boundary-fixture-private-key-32-characters";
});
after(async () => {
  try {
    if (teams.length)
      await pool.query("DELETE FROM teams WHERE id=ANY($1::uuid[])", [teams]);
    if (users.length)
      await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [users]);
  } finally {
    [env.DOC_LATEX_URL, env.DOC_PDF_KEY] = previous;
    await app.close();
    await compiler.close();
    await pool.end();
  }
});
const body = (version: number) => ({
  source: "\\documentclass{article}\\begin{document}Test\\end{document}",
  version,
});
test("LaTeX preview rejects unauthenticated, unowned, stale and oversized snapshots before compiling", async () => {
  const user = await account(),
    other = await account(),
    doc = await page(user);
  let runs = 0;
  render = async () => {
    runs++;
    return bytes;
  };
  const url = `/docs/${doc.id}/latex/preview`;
  assert.equal((await call(null, url, body(doc.version))).statusCode, 401);
  assert.equal(
    (await call(other.token, url, body(doc.version))).statusCode,
    404,
  );
  assert.equal(
    (await call(user.token, url, body(doc.version + 1))).statusCode,
    409,
  );
  const over = await call(user.token, url, {
    version: doc.version,
    source: "é".repeat(140000),
  });
  assert.equal(over.statusCode, 413, over.body);
  assert.equal(runs, 0);
  const result = await call(user.token, url, body(doc.version));
  assert.equal(result.statusCode, 200, result.body);
  assert.equal(result.headers["cache-control"], "no-store");
  assert.equal(result.headers["content-type"], "application/pdf");
  assert.deepEqual(result.rawPayload, bytes);
  assert.equal(runs, 1);
});
test("missing and failing compiler return recoverable errors without partial PDFs", async () => {
  const user = await account(),
    doc = await page(user),
    url = `/docs/${doc.id}/latex/preview`;
  const configured = env.DOC_LATEX_URL;
  env.DOC_LATEX_URL = "";
  try {
    assert.equal(
      (await call(user.token, url, body(doc.version))).statusCode,
      503,
    );
  } finally {
    env.DOC_LATEX_URL = configured;
  }
  render = async () => {
    throw Error("private path and source");
  };
  const failure = await call(user.token, url, body(doc.version));
  assert.equal(failure.statusCode, 503, failure.body);
  assert.doesNotMatch(failure.body, /private path and source|%PDF-/);
  render = async () => bytes;
  assert.equal(
    (await call(user.token, url, body(doc.version))).statusCode,
    200,
  );
});
test("revision change during compilation discards the finished PDF", async () => {
  const user = await account(),
    doc = await page(user);
  let started!: () => void, finish!: (value: Buffer) => void;
  const ready = new Promise<void>((resolve) => (started = resolve));
  render = () => {
    started();
    return new Promise((resolve) => (finish = resolve));
  };
  const response = call(
    user.token,
    `/docs/${doc.id}/latex/preview`,
    body(doc.version),
  );
  const pending = response.then((value) => value);
  await Promise.race([
    ready,
    pending.then((result) => {
      throw new Error(
        `Compiler was not reached: ${result.statusCode} ${result.body}`,
      );
    }),
  ]);
  await pool.query("UPDATE docs SET version=version+1 WHERE id=$1", [doc.id]);
  finish(bytes);
  const result = await pending;
  assert.equal(result.statusCode, 409, result.body);
  assert.doesNotMatch(result.body, /%PDF-/);
});
test("permission removal during compilation discards private PDF output", async () => {
  const owner = await account(),
    member = await account(),
    doc = await page(owner);
  const team = (
    await pool.query<{ id: string }>(
      "INSERT INTO teams(name,created_by) VALUES('Compiler permissions',$1) RETURNING id",
      [owner.id],
    )
  ).rows[0].id;
  teams.push(team);
  await pool.query(
    "INSERT INTO team_members(team_id,user_id,role) VALUES($1,$2,'owner'),($1,$3,'member')",
    [team, owner.id, member.id],
  );
  await pool.query("UPDATE docs SET team_id=$1 WHERE id=$2", [team, doc.id]);
  let started!: () => void, finish!: (value: Buffer) => void;
  const ready = new Promise<void>((resolve) => (started = resolve));
  render = () => {
    started();
    return new Promise((resolve) => (finish = resolve));
  };
  const pending = call(
    member.token,
    `/docs/${doc.id}/latex/preview`,
    body(doc.version),
  ).then((value) => value);
  await Promise.race([
    ready,
    pending.then((result) => {
      throw new Error(
        `Compiler was not reached: ${result.statusCode} ${result.body}`,
      );
    }),
  ]);
  await pool.query("DELETE FROM team_members WHERE team_id=$1 AND user_id=$2", [
    team,
    member.id,
  ]);
  finish(bytes);
  const result = await pending;
  assert.equal(result.statusCode, 404, result.body);
  assert.doesNotMatch(result.body, /%PDF-/);
});
