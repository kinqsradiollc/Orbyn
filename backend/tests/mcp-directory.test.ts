import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
// Connects only to a verified test database (see setup.ts).
import "./setup.js";
import { bearer, helpers, trapNetwork, type Person } from "./mcp-helpers.js";

/**
 * A7: getting listed. The reviewer account and the 5 + 3 directory test
 * cases (run with no AI model), the annotations audit, the MCP Registry's
 * server.json and the plugins, the install links, the incident game day
 * (kill switches L1–L4), and the optional MCP Apps cards behind their
 * switch.
 */

const { buildApp } = await import("../src/app.js");
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { invalidateSettings } = await import("../src/lib/settings.js");
const { limiter, strikes } =
  await import("../src/modules/mcp-server/routes.js");
const { createAgentKey } = await import("../src/modules/agents/service.js");
const { auditAnnotations, buildCatalog } =
  await import("../src/capabilities/catalog.js");
const { registry } = await import("../src/capabilities/index.js");
const { seedDirectoryAccount } =
  await import("../scripts/directory-account.js");
const { DIRECTORY_CASES } = await import("../scripts/directory-cases.js");
const { REGISTRY_NAME, SHORT_DESCRIPTION, versionOf, agentsPrivacyText } =
  await import("../scripts/distribution-files.js");
const { localGameDay } = await import("../scripts/gameday.js");
const { APP_CARDS, APP_MIME } =
  await import("../src/modules/mcp-server/apps.js");
const core = await import("@orbyn/core");

const app = await buildApp();
const h = helpers(app);
const network = await trapNetwork();

let admin: Person;
let reviewer: Awaited<ReturnType<typeof seedDirectoryAccount>>;
let key = "";
let classmateDoc = "";

before(async () => {
  await migrate();
  admin = await h.register("dir-admin", "Ada");
  await pool.query("UPDATE users SET role = 'admin' WHERE id = $1", [admin.id]);
  reviewer = await seedDirectoryAccount(app, {
    email: `reviewer-${Date.now()}@orbyn.test`,
    password: "a-long-reviewer-password",
  });
  key = (
    await createAgentKey(reviewer.userId, { name: "Reviewer", access: "write" })
  ).key;
  const classmate = await h.register("dir-classmate", "Cam");
  classmateDoc = (
    await h.call(classmate.token, "POST", "/docs", {
      title: "Cam's private notes",
    })
  ).json().id;
});
after(async () => {
  network.restore();
  await app.close();
  await pool.end();
});

type Result = {
  content: { type: string; text: string }[];
  structuredContent?: any;
  isError?: boolean;
  _meta?: Record<string, any>;
};
const tool = async (name: string, args: Record<string, unknown> = {}) => {
  limiter.reset();
  strikes.reset();
  const r = await h.tool(key, name, args);
  assert.ok(r, `${name}: no result`);
  return r as Result;
};
const code = (r: Result) => r._meta?.["orbyn/error"]?.code as string;

test("the reviewer account: a verified member, Terms accepted, no two-step sign-in, demo content once", async () => {
  const row = (
    await pool.query(
      `SELECT role, email_verified, terms_version, disabled,
              EXISTS (SELECT 1 FROM user_totp t WHERE t.user_id = u.id) AS totp
         FROM users u WHERE id = $1`,
      [reviewer.userId],
    )
  ).rows[0];
  assert.equal(row.role, "member");
  assert.equal(row.email_verified, true);
  assert.ok(row.terms_version);
  assert.equal(row.disabled, false);
  assert.equal(row.totp, false);
  // Running it again without DIRECTORY_RESET changes nothing.
  await assert.rejects(
    seedDirectoryAccount(app, {
      email: reviewer.email,
      password: "another-long-reviewer-password",
    }),
    /already has an account/,
  );
  // With it, it resets the password and adds nothing twice.
  const again = await seedDirectoryAccount(app, {
    email: reviewer.email,
    password: "another-long-reviewer-password",
    reset: true,
  });
  assert.equal(again.userId, reviewer.userId);
  assert.equal(again.doc, reviewer.doc);
  assert.equal(again.task, reviewer.task);
  const tasks = (
    await pool.query(
      "SELECT count(*)::int AS n FROM items WHERE user_id = $1 AND title = 'Finish the lab report'",
      [reviewer.userId],
    )
  ).rows[0].n;
  assert.equal(tasks, 1);
  const login = await app.inject({
    method: "POST",
    url: "/auth/login",
    payload: {
      email: reviewer.email,
      password: "another-long-reviewer-password",
    },
  });
  assert.equal(login.statusCode, 200);
});

test("the reviewer script never touches an admin's account, even when asked to reset", async () => {
  const before = (
    await pool.query(
      "SELECT email, password_hash, role FROM users WHERE id = $1",
      [admin.id],
    )
  ).rows[0];
  await pool.query(
    "INSERT INTO user_totp (user_id, secret_encrypted, confirmed_at) VALUES ($1, 'test', now()) ON CONFLICT DO NOTHING",
    [admin.id],
  );
  for (const reset of [false, true])
    await assert.rejects(
      seedDirectoryAccount(app, {
        email: before.email.toUpperCase(),
        password: "a-long-reviewer-password",
        reset,
      }),
      /belongs to an admin/,
    );
  const after = (
    await pool.query(
      `SELECT password_hash, role,
              EXISTS (SELECT 1 FROM user_totp t WHERE t.user_id = u.id) AS totp
         FROM users u WHERE id = $1`,
      [admin.id],
    )
  ).rows[0];
  assert.equal(after.password_hash, before.password_hash);
  assert.equal(after.role, "admin");
  assert.equal(after.totp, true);
  await pool.query("DELETE FROM user_totp WHERE user_id = $1", [admin.id]);
});

/** Each directory case, run as the app would call it. */
const RUN: Record<string, () => Promise<void>> = {
  P1: async () => {
    const r = await tool("get_today");
    assert.ok(!r.isError, r.content[0]?.text);
    assert.match(r.structuredContent.day, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(r.structuredContent.url);
  },
  P2: async () => {
    const r = await tool("search", { query: "photosynthesis" });
    assert.ok(!r.isError, r.content[0]?.text);
    const ids = r.structuredContent.results.map((x: { id: string }) => x.id);
    assert.ok(
      ids.some((id: string) => id.includes(reviewer.doc)),
      JSON.stringify(ids),
    );
  },
  P3: async () => {
    const r = await tool("fetch", { id: `doc:${reviewer.doc}` });
    assert.ok(!r.isError, r.content[0]?.text);
    assert.match(JSON.stringify(r.structuredContent), /stroma/);
  },
  P4: async () => {
    const r = await tool("plan_schedule", { days: 7 });
    assert.ok(!r.isError, r.content[0]?.text);
    assert.ok(r.structuredContent.plan_token);
    const titles = [
      ...r.structuredContent.sessions,
      ...r.structuredContent.unplaced,
    ].map((s: { title: string }) => s.title);
    assert.ok(
      titles.some((t: string) => /lab report|chapter 6/.test(t)),
      JSON.stringify(titles),
    );
  },
  P5: async () => {
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString();
    const r = await tool("create_tasks", {
      tasks: [{ title: "Email my study group", due_at: tomorrow }],
    });
    assert.ok(!r.isError, r.content[0]?.text);
    assert.equal(r.structuredContent.status, "done");
    assert.ok(r.structuredContent.done[0].url);
  },
  N1: async () => {
    // No tool reads the web or the weather, and fetch opens only Orbyn.
    for (const cap of registry.all)
      assert.doesNotMatch(cap.name, /weather|web|browse|http|url/);
    const r = await tool("fetch", { id: "https://weather.example/paris" });
    assert.ok(r.isError);
    assert.ok(["NOT_FOUND", "INVALID"].includes(code(r)), code(r));
  },
  N2: async () => {
    const lecture = (
      await pool.query(
        "SELECT id, version FROM items WHERE user_id = $1 AND title = 'Biology lecture'",
        [reviewer.userId],
      )
    ).rows[0];
    const r = await tool("propose_changes", {
      summary: "Invite Sam to the lecture",
      changes: [
        {
          type: "invite",
          target: `event:${lecture.id}`,
          version: lecture.version,
          emails: ["sam@example.com"],
        },
      ],
    });
    assert.ok(!r.isError, r.content[0]?.text);
    assert.equal(r.structuredContent.status, "pending_review");
    assert.match(r.structuredContent.pending.review_url, /^https?:\/\//);
    assert.equal(
      (
        await pool.query("SELECT 1 FROM item_attendees WHERE item_id = $1", [
          lecture.id,
        ])
      ).rowCount,
      0,
      "nobody was invited",
    );
  },
  N3: async () => {
    const r = await tool("fetch", { id: `doc:${classmateDoc}` });
    assert.ok(r.isError);
    assert.equal(code(r), "NOT_FOUND");
    assert.doesNotMatch(JSON.stringify(r), /Cam's private notes/);
  },
};

test("the directory cases: five that work and three that don't, each run", async () => {
  assert.equal(DIRECTORY_CASES.filter((c) => c.kind === "positive").length, 5);
  assert.equal(DIRECTORY_CASES.filter((c) => c.kind === "negative").length, 3);
  for (const c of DIRECTORY_CASES) {
    const run = RUN[c.id];
    assert.ok(run, `${c.id} has no check`);
    if (c.tool) assert.ok(registry.get(c.tool), `${c.id}: ${c.tool} exists`);
    await run();
  }
});

test("the annotations audit finds nothing to fix", () => {
  const audit = auditAnnotations();
  assert.ok(audit.length >= 21);
  for (const a of audit) assert.deepEqual(a.issues, [], a.name);
});

test("server.json, the plugins and the privacy text match the server, and describe a hosted service", async () => {
  const root = new URL("../../distribution/", import.meta.url);
  const read = (p: string) => readFile(new URL(p, root), "utf8");
  const catalog = JSON.parse(await read("../docs/mcp-catalog.json"));
  const server = JSON.parse(await read("mcp-registry/server.json"));
  assert.equal(server.name, REGISTRY_NAME);
  assert.match(server.name, /^[a-zA-Z0-9.-]+\/[a-zA-Z0-9._-]+$/);
  assert.ok(server.description.length <= 100);
  assert.equal(server.description, SHORT_DESCRIPTION);
  assert.equal(server.version, versionOf(catalog.version));
  assert.deepEqual(server.remotes, [
    { type: "streamable-http", url: catalog.server.address },
  ]);
  assert.equal(server.packages, undefined, "nothing to install locally");
  const skill = await readFile(
    new URL("../../docs/agent-skill/orbyn/SKILL.md", import.meta.url),
    "utf8",
  );
  for (const p of [
    "claude-code/skills/orbyn/SKILL.md",
    "codex/skills/orbyn/SKILL.md",
  ])
    assert.equal(await read(p), skill, p);
  for (const p of ["claude-code/.mcp.json", "codex/.mcp.json"])
    assert.deepEqual(JSON.parse(await read(p)), {
      mcpServers: { orbyn: { type: "http", url: catalog.server.address } },
    });
  const gemini = JSON.parse(await read("gemini/gemini-extension.json"));
  assert.equal(gemini.mcpServers.orbyn.httpUrl, catalog.server.address);
  assert.doesNotMatch(gemini.name, /_/, "Gemini: no underscore in the name");
  assert.match(await read("codex/config.toml"), /\[mcp_servers\.orbyn\]/);
  const privacy = await read("directory/privacy.md");
  assert.ok(privacy.includes(agentsPrivacyText()));
  // Hosted, always.
  for (const p of [
    "README.md",
    "directory/README.md",
    "directory/privacy.md",
    "claude-code/.claude-plugin/plugin.json",
    "gemini/GEMINI.md",
  ]) {
    const text = await read(p);
    assert.doesNotMatch(text, /self-hosted|bring your own/i, p);
  }
  // The catalog builder names the same address.
  assert.equal(
    buildCatalog({
      protocol_versions: [],
      instructions: "",
      mcp_url: catalog.server.address,
    }).server.address,
    server.remotes[0].url,
  );
});

test("install links carry only the address, for Cursor, VS Code, Goose and LM Studio", () => {
  const url = "https://mcp.orbyn.dev/mcp";
  const links = core.agentInstallLinks(url);
  assert.deepEqual(
    links.map((l) => l.app),
    ["cursor", "vscode", "goose", "lmstudio"],
  );
  const cursor = new URL(links[0].href);
  assert.equal(cursor.protocol, "cursor:");
  assert.deepEqual(
    JSON.parse(
      Buffer.from(cursor.searchParams.get("config")!, "base64").toString(),
    ),
    { url },
  );
  const vscode = new URL(links[1].href);
  assert.equal(vscode.hostname, "vscode.dev");
  assert.deepEqual(JSON.parse(vscode.searchParams.get("config")!), {
    type: "http",
    url,
  });
  assert.equal(new URL(links[2].href).searchParams.get("url"), url);
  assert.deepEqual(
    JSON.parse(
      Buffer.from(
        new URL(links[3].href).searchParams.get("config")!,
        "base64",
      ).toString(),
    ),
    { url },
  );
  for (const l of links) assert.doesNotMatch(l.href, /oak_|ok_|oat_|Bearer/);
  // The encoder matches Node's for any text.
  for (const text of ["", "a", "ab", "abc", "Orbyn · plans ✓", "🙂 hi"])
    assert.equal(core.base64(text), Buffer.from(text).toString("base64"));
});

test("the cards' dark palette is the web's dark theme, token for token", async () => {
  const css = await readFile(
    new URL("../../desktop/src/styles/theme.css", import.meta.url),
    "utf8",
  );
  const dark = /:root\[data-theme="dark"\] \{([\s\S]*?)\n\}/.exec(css)![1];
  for (const [name, value] of Object.entries(core.darkColors)) {
    const m = new RegExp(`--color-${name}: (#[0-9a-f]+);`).exec(dark);
    assert.ok(m, `--color-${name} in theme.css`);
    assert.equal(value, m[1], name);
  }
  assert.deepEqual(Object.keys(core.darkColors), Object.keys(core.colors));
});

test("MCP Apps cards: off by default, then Today, a plan preview and a proposal, from palette tokens", async () => {
  limiter.reset();
  const off = await h.legacy(key, "tools/list");
  const today = off.body.result.tools.find(
    (t: { name: string }) => t.name === "get_today",
  );
  assert.equal(today._meta.ui, undefined);
  const hidden = await h.legacy(key, "resources/read", {
    uri: "ui://orbyn/today.html",
  });
  assert.ok(hidden.body.error);

  const on = await h.call(admin.token, "PUT", "/admin/agents", {
    mcp_apps_enabled: true,
  });
  assert.equal(on.statusCode, 200, on.body);
  assert.equal(on.json().mcp_apps_enabled, true);
  invalidateSettings();
  try {
    limiter.reset();
    const init = await h.legacy(key, "initialize", {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "test", version: "1" },
    });
    assert.ok(
      init.body.result.capabilities.extensions["io.modelcontextprotocol/ui"],
    );
    const list = await h.legacy(key, "tools/list");
    const byName = (n: string) =>
      list.body.result.tools.find((t: { name: string }) => t.name === n);
    assert.equal(
      byName("get_today")._meta.ui.resourceUri,
      "ui://orbyn/today.html",
    );
    assert.equal(
      byName("plan_schedule")._meta.ui.resourceUri,
      "ui://orbyn/plan.html",
    );
    assert.equal(byName("search")._meta.ui, undefined);
    let listed: { uri: string }[] = [];
    let cursor: string | undefined;
    do {
      const page = await h.legacy(
        key,
        "resources/list",
        cursor ? { cursor } : {},
      );
      listed = [...listed, ...page.body.result.resources];
      cursor = page.body.result.nextCursor;
    } while (cursor);
    for (const c of APP_CARDS)
      assert.ok(
        listed.some((r) => r.uri === c.uri),
        c.uri,
      );
    for (const c of APP_CARDS) {
      const read = await h.legacy(key, "resources/read", { uri: c.uri });
      const content = read.body.result.contents[0];
      assert.equal(content.mimeType, APP_MIME);
      const html: string = content.text;
      assert.match(html, /^<!doctype html>/);
      // Colours only from the palette, as variables.
      assert.ok(html.includes(`--color-accent:${core.colors.accent}`));
      assert.ok(html.includes(`--color-accent:${core.darkColors.accent}`));
      assert.doesNotMatch(
        html.replace(/--color-\w+:#[0-9a-f]{6};/g, ""),
        /#[0-9a-f]{3,8}\b/i,
      );
      // Nothing from outside, and data is never markup.
      assert.doesNotMatch(html, /<script[^>]+src=|<link |https?:\/\/(?!mcp)/);
      assert.doesNotMatch(html, /innerHTML/);
      assert.deepEqual(content._meta.ui.csp, {
        connectDomains: [],
        resourceDomains: [],
      });
    }
    // Approving never happens in a card: it only opens Orbyn.
    const review = APP_CARDS.find((c) => c.uri.endsWith("review.html"))!;
    assert.doesNotMatch(review.script, /apply|approve/i);
  } finally {
    await h.call(admin.token, "PUT", "/admin/agents", {
      mcp_apps_enabled: false,
    });
    invalidateSettings();
  }
});

test("admin sees old API keys' last day on MCP", async () => {
  const r = await h.call(admin.token, "GET", "/admin/agents");
  assert.equal(r.statusCode, 200);
  assert.ok("legacy_keys_until" in r.json());
  assert.equal(r.json().mcp_apps_enabled, false);
  // Only admins.
  const member = await h.register("dir-member");
  assert.equal(
    (await h.call(member.token, "GET", "/admin/agents")).statusCode,
    403,
  );
  assert.equal((await h.call(null, "GET", "/admin/agents")).statusCode, 401);
  const bad = await h.call(admin.token, "PUT", "/admin/agents", {
    mcp_apps_enabled: "yes",
  });
  // Validation problems are 422 across the API.
  assert.equal(bad.statusCode, 422);
});

test("game day: every kill switch stops an agent, and everything is put back", async () => {
  const before = (await h.call(admin.token, "GET", "/admin/agents")).json();
  const drills = await localGameDay(app);
  assert.deepEqual(
    drills.map((d) => d.level),
    ["L1", "L2", "L3", "L4"],
  );
  for (const d of drills) assert.ok(d.ok, `${d.level}: ${d.detail}`);
  invalidateSettings();
  const after = (await h.call(admin.token, "GET", "/admin/agents")).json();
  assert.equal(after.agents_enabled, before.agents_enabled);
  assert.equal(after.agents_writes_enabled, before.agents_writes_enabled);
  assert.deepEqual(after.blocked_client_ids, before.blocked_client_ids);
  // The reviewer's key still works afterwards.
  limiter.reset();
  const r = await h.post(
    { jsonrpc: "2.0", id: 1, method: "ping" },
    bearer(key),
  );
  assert.equal(r.status, 200);
});

test("nothing reached the network", () => {
  assert.deepEqual(network.calls, []);
});
