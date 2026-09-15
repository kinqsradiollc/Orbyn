/**
 * End-to-end smoke test: exercises every API endpoint through the shared
 * client against a running server, and prints a pass/fail line for each.
 *
 *   SMOKE_API_URL=http://localhost:8008 SMOKE_ADMIN_EMAIL=admin@example.com \
 *   SMOKE_ADMIN_PASSWORD=... npm run smoke -w backend
 *
 * The admin account is signed in (or registered, which makes it an admin when
 * it is listed in the server's ADMIN_EMAILS or no admin exists yet). Set
 * SMOKE_AI=skip to skip the AI checks. Accounts it creates are deleted at the end.
 */
import { randomUUID } from "node:crypto";
import { OrbynClient, HttpError } from "@orbyn/api-client";
import { freshItem, itemBody, type Item } from "@orbyn/core";

const baseUrl = process.env.SMOKE_API_URL || "http://localhost:8008";
const adminEmail = process.env.SMOKE_ADMIN_EMAIL || "smoke-admin@orbyn.local";
const adminPassword =
  process.env.SMOKE_ADMIN_PASSWORD || "smoke-admin-password";
const password = "smoke-test-password";
const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

let passed = 0;
const failures: string[] = [];

async function check(name: string, fn: () => Promise<unknown>) {
  try {
    const note = await fn();
    passed++;
    console.log(`  ✓ ${name}${typeof note === "string" ? `  (${note})` : ""}`);
  } catch (error) {
    const message =
      error instanceof HttpError
        ? `HTTP ${error.status}: ${error.message}`
        : error instanceof Error
          ? error.message
          : String(error);
    failures.push(`${name}: ${message}`);
    console.log(`  ✗ ${name}  -> ${message}`);
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function expectStatus(status: number, fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (error) {
    if (error instanceof HttpError && error.status === status) return;
    throw error;
  }
  throw new Error(`expected HTTP ${status}, the call succeeded`);
}

function session() {
  let token = "";
  const client = new OrbynClient({ baseUrl, getToken: () => token });
  return {
    client,
    set token(value: string) {
      token = value;
    },
  };
}

async function signUp(label: string) {
  const s = session();
  const email = `smoke-${label}-${randomUUID().slice(0, 8)}@example.com`;
  const auth = await s.client.register({
    email,
    password,
    name: `Smoke ${label}`,
  });
  s.token = auth.token;
  return { ...s, email, user: auth.user };
}

const soon = (minutes: number) =>
  new Date(Date.now() + minutes * 60_000).toISOString();

console.log(`Orbyn smoke test against ${baseUrl}\n`);

const admin = session();
const created: string[] = [];

console.log("Health and auth");
await check("GET /health", async () => {
  const h = await admin.client.health();
  assert(h.status === "ok", "health not ok");
});
await check("admin sign-in (POST /auth/login or /auth/register)", async () => {
  try {
    admin.token = (
      await admin.client.login({ email: adminEmail, password: adminPassword })
    ).token;
  } catch (error) {
    if (!(error instanceof HttpError) || error.status !== 401) throw error;
    admin.token = (
      await admin.client.register({
        email: adminEmail,
        password: adminPassword,
        name: "Smoke admin",
      })
    ).token;
  }
  const me = await admin.client.me();
  assert(
    me.role === "admin",
    `${adminEmail} is ${me.role}; add it to ADMIN_EMAILS`,
  );
});

const alice = await signUp("alice");
const bob = await signUp("bob");
const carol = await signUp("carol");
created.push(alice.user.id, bob.user.id, carol.user.id);

await check("POST /auth/register creates members", async () => {
  for (const u of [alice, bob, carol])
    assert(u.user.role === "member", `${u.email} is ${u.user.role}`);
});
await check("POST /auth/login", async () => {
  const s = session();
  s.token = (await s.client.login({ email: bob.email, password })).token;
  assert((await s.client.me()).id === bob.user.id, "wrong user");
  await s.client.logout();
});
await check("POST /auth/login rejects a wrong password (401)", () =>
  expectStatus(401, () =>
    session().client.login({
      email: bob.email,
      password: "wrong-password-123",
    }),
  ),
);

console.log("\nProfile");
await check("GET /me", async () => {
  const me = await alice.client.me();
  assert(me.email === alice.email, "wrong email");
});
await check("PUT /me", async () => {
  const off = await alice.client.updatePreferences({ email_reminders: false });
  assert(off.email_reminders === false, "not updated");
  await alice.client.updatePreferences({ email_reminders: true });
});

console.log("\nPersonal items");
let personal: Item | undefined;
await check("POST /items", async () => {
  personal = await alice.client.createItem({
    ...freshItem(),
    title: "Smoke personal",
    priority: "high",
    due_at: soon(120),
  });
  assert(personal.id && personal.version === 1, "bad item");
});
await check("GET /items", async () => {
  const items = await alice.client.listAllItems();
  assert(
    items.some((i) => i.id === personal!.id),
    "item missing",
  );
});
await check("PUT /items/:id", async () => {
  personal = await alice.client.updateItem(personal!.id, {
    ...itemBody(personal!),
    status: "done",
  });
  assert(personal.status === "done" && personal.version === 2, "not updated");
});
await check("PUT /items/:id rejects a stale version (409)", () =>
  expectStatus(409, () =>
    alice.client.updateItem(personal!.id, {
      ...itemBody(personal!),
      version: 1,
    }),
  ),
);
await check("other users cannot touch a personal item (404)", () =>
  expectStatus(404, () =>
    bob.client.deleteItem(personal!.id, personal!.version),
  ),
);
await check("DELETE /items/:id", async () => {
  await alice.client.deleteItem(personal!.id, personal!.version);
  assert(
    !(await alice.client.listAllItems()).some((i) => i.id === personal!.id),
    "still listed",
  );
});

console.log("\nTeams");
let teamId = "";
let teamItem: Item | undefined;
await check("POST /teams", async () => {
  const team = await alice.client.createTeam({ name: "Smoke team" });
  teamId = team.id;
  assert(team.role === "owner", "creator is not owner");
});
await check("GET /teams", async () => {
  assert(
    (await alice.client.listTeams()).some((t) => t.id === teamId),
    "team missing",
  );
});
await check("POST /teams/:id/members", async () => {
  await alice.client.addTeamMember(teamId, {
    email: bob.email,
    role: "member",
  });
  await alice.client.addTeamMember(teamId, {
    email: carol.email,
    role: "viewer",
  });
});
await check("GET /teams/:id", async () => {
  const detail = await bob.client.getTeam(teamId);
  assert(
    detail.members.length === 3,
    `expected 3 members, got ${detail.members.length}`,
  );
});
await check("PUT /teams/:id", async () => {
  const t = await alice.client.updateTeam(teamId, {
    name: "Smoke team renamed",
  });
  assert(t.name === "Smoke team renamed", "not renamed");
});
await check("PUT /teams/:id/members/:userId", async () => {
  const m = await alice.client.updateTeamMember(teamId, carol.user.id, {
    role: "member",
  });
  assert(m.role === "member", "role not changed");
  await alice.client.updateTeamMember(teamId, carol.user.id, {
    role: "viewer",
  });
});
await check("members create team items", async () => {
  teamItem = await bob.client.createItem({
    ...freshItem(),
    title: "Smoke team item",
    team_id: teamId,
    due_at: soon(1),
    reminder_minutes: 30,
  });
  assert(teamItem.team_id === teamId, "not a team item");
});
await check("GET /items?team_id= lists team items for a viewer", async () => {
  const items = await carol.client.listItems({ team_id: teamId });
  assert(
    items.some((i) => i.id === teamItem!.id),
    "viewer cannot see it",
  );
});
await check("viewers cannot write team items (403)", () =>
  expectStatus(403, () =>
    carol.client.createItem({ ...freshItem(), title: "Nope", team_id: teamId }),
  ),
);
await check("team admins cannot grant owner (403)", async () => {
  await alice.client.updateTeamMember(teamId, bob.user.id, { role: "admin" });
  await expectStatus(403, () =>
    bob.client.updateTeamMember(teamId, carol.user.id, { role: "owner" }),
  );
});
await check("the only owner cannot leave (409)", () =>
  expectStatus(409, () => alice.client.removeTeamMember(teamId, alice.user.id)),
);

console.log("\nReminders and devices");
await check("POST /devices", () =>
  alice.client.registerDevice(
    `ExponentPushToken[smoke${randomUUID().replace(/-/g, "")}]`,
  ),
);
await check("DELETE /devices", async () => {
  const token = `ExponentPushToken[smoke${randomUUID().replace(/-/g, "")}]`;
  await alice.client.registerDevice(token);
  await alice.client.removeDevice(token);
});
await check("GET /notifications (worker delivers team reminders)", async () => {
  for (let i = 0; i < 25; i++) {
    const notices = await carol.client.listNotifications();
    const notice = notices.find((n) => n.title.includes("Smoke team item"));
    if (notice) {
      await carol.client.markNotificationRead(notice.id);
      return "reminder reached a viewer";
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error("no reminder after 50s; is the worker running?");
});
await check("POST /notifications/:id/read", async () => {
  const notice = (await carol.client.listNotifications()).find((n) =>
    n.title.includes("Smoke team item"),
  );
  assert(notice?.read, "not marked read");
});

console.log("\nAI assistant");
if (process.env.SMOKE_AI === "skip") console.log("  - skipped (SMOKE_AI=skip)");
else {
  let proposalId = "";
  let summary = "";
  await check("POST /ai/chat (summary)", async () => {
    try {
      const reply = await alice.client.chat(
        "Summarize my week in one sentence",
        timezone,
      );
      summary = reply.summary;
      assert(reply.actions.length === 0, "a summary proposed changes");
      return reply.summary.slice(0, 60);
    } catch (error) {
      if (error instanceof HttpError && error.status === 503)
        return "AI not configured on this server";
      throw error;
    }
  });
  if (summary)
    await check("POST /ai/chat (create, with history)", async () => {
      const reply = await alice.client.chat(
        "Add a personal task called Smoke AI task for tomorrow at 2pm",
        timezone,
        [
          { role: "user", content: "Summarize my week in one sentence" },
          { role: "assistant", content: summary },
        ],
      );
      proposalId = reply.id;
      assert(
        reply.actions.some((a) => a.operation === "create"),
        "no create action proposed",
      );
      const due = reply.actions[0].data?.due_at;
      return due ? `due ${due}` : "no due date";
    });
  if (proposalId) {
    await check("POST /ai/proposals/:id/apply", async () => {
      await alice.client.applyProposal(proposalId);
      const items = await alice.client.listAllItems();
      assert(
        items.some((i) => /smoke ai task/i.test(i.title)),
        "applied item missing",
      );
    });
    await check("proposals cannot be applied by another user (404)", () =>
      expectStatus(404, () => bob.client.applyProposal(proposalId)),
    );
  }
}

console.log("\nAdmin console");
await check("members cannot open the admin console (403)", () =>
  expectStatus(403, () => alice.client.adminOverview()),
);
await check("GET /admin/overview", async () => {
  const o = await admin.client.adminOverview();
  assert(o.users >= 4 && o.admins >= 1 && o.teams >= 1, "counts look wrong");
  return `${o.users} users, ${o.teams} teams, ${o.items} items`;
});
await check("GET /admin/users", async () => {
  const page = await admin.client.adminListUsers({ search: bob.email });
  assert(page.total === 1 && page.rows[0].id === bob.user.id, "search failed");
});
await check("PUT /admin/users/:id (disable blocks the account)", async () => {
  const u = await admin.client.adminUpdateUser(bob.user.id, { disabled: true });
  assert(u.disabled, "not disabled");
  await expectStatus(401, () => bob.client.me());
  await expectStatus(403, () =>
    session().client.login({ email: bob.email, password }),
  );
  await admin.client.adminUpdateUser(bob.user.id, { disabled: false });
});
await check("PUT /admin/users/:id (role)", async () => {
  assert(
    (await admin.client.adminUpdateUser(carol.user.id, { role: "admin" }))
      .role === "admin",
    "not promoted",
  );
  assert(
    (await admin.client.adminUpdateUser(carol.user.id, { role: "member" }))
      .role === "member",
    "not demoted",
  );
});
await check("GET /admin/teams", async () => {
  assert(
    (await admin.client.adminListTeams()).some((t) => t.id === teamId),
    "team missing",
  );
});
await check("admins manage any team but cannot read its items", async () => {
  const detail = await admin.client.getTeam(teamId);
  assert(
    detail.role === null && detail.members.length === 3,
    "unexpected detail",
  );
  await expectStatus(404, () => admin.client.listItems({ team_id: teamId }));
});
await check("GET /admin/audit", async () => {
  const log = await admin.client.adminListAudit({ limit: 100 });
  const actions = new Set(log.rows.map((e) => e.action));
  for (const a of [
    "team.created",
    "team.member_added",
    "user.disabled",
    "user.role_changed",
  ])
    assert(actions.has(a), `missing ${a}`);
  return `${log.total} entries`;
});

console.log("\nCleanup");
await check("DELETE /teams/:id/members/:userId (leave)", () =>
  carol.client.removeTeamMember(teamId, carol.user.id),
);
await check("DELETE /teams/:id", () => alice.client.deleteTeam(teamId));
await check("POST /auth/logout", async () => {
  await alice.client.logout();
  await expectStatus(401, () => alice.client.me());
});
await check("DELETE /admin/users/:id", async () => {
  for (const id of created) await admin.client.adminDeleteUser(id);
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
