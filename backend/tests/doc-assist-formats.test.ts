import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import "./setup.js";
const { buildApp } = await import("../src/app.js");
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const app = await buildApp();
let reply = "",
  system = "",
  token = "",
  userId = "",
  providerId = "";
let settings: { provider_id: string | null; model: string } | undefined;
const provider = createServer(async (req, res) => {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  const messages = JSON.parse(raw).messages;
  system =
    messages.find((message: any) => message.role === "system")?.content ?? "";
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(
    JSON.stringify({
      choices: [{ finish_reason: "stop", message: { content: reply } }],
    }),
  );
});
const call = (method: "GET" | "POST", url: string, payload?: object) =>
  app.inject({
    method,
    url,
    headers: { authorization: `Bearer ${token}` },
    ...(payload ? { payload } : {}),
  });
before(async () => {
  await migrate();
  settings = (
    await pool.query("SELECT provider_id,model FROM ai_settings WHERE id")
  ).rows[0];
  const registration = await app.inject({
    method: "POST",
    url: "/auth/register",
    payload: {
      email: `formats-${randomUUID()}@example.test`,
      password: "synthetic-format-test-password",
      name: "Writer",
    },
  });
  assert.equal(registration.statusCode, 201, registration.body);
  token = registration.json().token;
  userId = (
    await pool.query("SELECT id FROM users WHERE email=$1", [
      registration.json().user.email,
    ])
  ).rows[0].id;
  await new Promise<void>((resolve) =>
    provider.listen(0, "127.0.0.1", resolve),
  );
  providerId = (
    await pool.query(
      "INSERT INTO ai_providers(kind,name,base_url) VALUES ('openai-compatible','Format fixture',$1) RETURNING id",
      [`http://127.0.0.1:${(provider.address() as any).port}/v1`],
    )
  ).rows[0].id;
  await pool.query(
    "UPDATE ai_settings SET provider_id=$1,model='format-fixture' WHERE id",
    [providerId],
  );
});
after(async () => {
  try {
    if (settings)
      await pool.query(
        "UPDATE ai_settings SET provider_id=$1,model=$2 WHERE id",
        [settings.provider_id, settings.model],
      );
    if (userId) await pool.query("DELETE FROM users WHERE id=$1", [userId]);
    if (providerId)
      await pool.query("DELETE FROM ai_providers WHERE id=$1", [providerId]);
  } finally {
    const { closeLive } = await import("../src/modules/docs/live.js");
    await closeLive();
    await app.close();
    provider.close();
    await pool.end();
  }
});
for (const [format, block, replacement] of [
  [
    "Note",
    { type: "paragraph", text: "Original sentence", id: "passage" },
    "Revised sentence",
  ],
  [
    "Markdown equations",
    { type: "paragraph", text: "Energy is $E=mc^2$", id: "passage" },
    "Energy: $E=mc^2$",
  ],
  [
    "LaTeX",
    {
      type: "code",
      lang: "latex-document",
      id: "passage",
      text: String.raw`\documentclass{article}\begin{document}Original\end{document}`,
    },
    String.raw`\documentclass{article}\begin{document}Revised\end{document}`,
  ],
] as const)
  test(`${format} assistant proposal persists only after acceptance; rejection leaves the saved document unchanged`, async () => {
    const created = await call("POST", "/docs", {
      title: format,
      content: [block],
    });
    assert.equal(created.statusCode, 201, created.body);
    const id = created.json().id;
    reply = replacement;
    const make = () =>
      call("POST", `/docs/${id}/assist`, {
        block_id: block.id,
        range_start: 0,
        range_end: block.text.length,
        action: "improve",
      });
    const proposed = await make();
    assert.equal(proposed.statusCode, 201, proposed.body);
    assert.equal(
      (await call("GET", `/docs/${id}`)).json().content[0].text,
      block.text,
    );
    if (format === "LaTeX") assert.match(system, /standalone LaTeX source/);
    const rejected = await call(
      "POST",
      `/docs/${id}/suggestions/${proposed.json().id}`,
      { take: false },
    );
    assert.equal(rejected.statusCode, 200, rejected.body);
    assert.equal(
      (await call("GET", `/docs/${id}`)).json().content[0].text,
      block.text,
    );
    const second = await make();
    assert.equal(second.statusCode, 201, second.body);
    const accepted = await call(
      "POST",
      `/docs/${id}/suggestions/${second.json().id}`,
      { take: true },
    );
    assert.equal(accepted.statusCode, 200, accepted.body);
    const saved = (await call("GET", `/docs/${id}`)).json().content[0];
    assert.equal(saved.text, replacement);
    assert.equal(saved.id, block.id);
    if (format === "LaTeX") assert.equal(saved.lang, "latex-document");
  });
