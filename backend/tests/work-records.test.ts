import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import "./setup.js";

const { buildApp } = await import("../src/app.js");
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const app = await buildApp();
let lead = "";
let stranger = "";
let leadId = "";
let strangerId = "";
let strangerEmail = "";

const call = (
  method: "GET" | "POST" | "PUT" | "DELETE",
  url: string,
  payload?: unknown,
  token = lead,
) =>
  app.inject({
    method,
    url,
    headers: { authorization: `Bearer ${token}` },
    ...(payload === undefined ? {} : { payload: payload as object }),
  });

before(async () => {
  await migrate();
  for (const [name, save] of [
    [
      "Lead",
      (body: { token: string; user: { id: string } }) => {
        lead = body.token;
        leadId = body.user.id;
      },
    ],
    [
      "Stranger",
      (body: { token: string; user: { id: string } }) => {
        stranger = body.token;
        strangerId = body.user.id;
      },
    ],
  ] as const) {
    const email = `records-${randomUUID()}@example.com`;
    if (name === "Stranger") strangerEmail = email;
    const result = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: {
        email,
        password: "a-long-test-password",
        name,
      },
    });
    assert.equal(result.statusCode, 201, result.body);
    save(result.json());
  }
});

test("an offered team promise needs the owner’s response", async () => {
  const team = await call("POST", "/teams", { name: "Promise test team" });
  assert.equal(team.statusCode, 201, team.body);
  const teamId = team.json().id as string;
  assert.equal(
    (
      await call("POST", `/teams/${teamId}/members`, {
        email: strangerEmail,
        role: "viewer",
      })
    ).statusCode,
    201,
  );
  const project = await call("POST", "/projects", {
    name: "Shared work",
    team_id: teamId,
  });
  assert.equal(project.statusCode, 201, project.body);
  const made = await call("POST", "/work-records", {
    kind: "promise",
    title: "Review the work",
    team_id: teamId,
    project_id: project.json().id,
    owner_id: strangerId,
  });
  assert.equal(made.statusCode, 201, made.body);
  const record = made.json();
  assert.equal(record.status, "proposed");
  assert.equal(
    (
      await call(
        "PUT",
        `/work-records/${record.id}`,
        { version: 1, status: "done" },
        stranger,
      )
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await call("POST", `/work-records/${record.id}/respond`, {
        decision: "accept",
      })
    ).statusCode,
    404,
  );
  const accepted = await call(
    "POST",
    `/work-records/${record.id}/respond`,
    { decision: "accept" },
    stranger,
  );
  assert.equal(accepted.statusCode, 200, accepted.body);
  assert.equal(accepted.json().status, "open");
  assert.equal(
    (
      await call(
        "POST",
        `/work-records/${record.id}/respond`,
        { decision: "decline" },
        stranger,
      )
    ).statusCode,
    409,
  );
  assert.equal(
    (
      await call(
        "GET",
        `/work-records?owner_id=${strangerId}`,
        undefined,
        stranger,
      )
    ).json().length,
    1,
  );
  assert.equal(
    (
      await call("GET", `/work-records?owner_id=${leadId}`, undefined, stranger)
    ).json().length,
    0,
  );
});
after(async () => {
  await app.close();
  await pool.end();
});

test("records require auth and valid input", async () => {
  assert.equal(
    (await app.inject({ method: "GET", url: "/work-records" })).statusCode,
    401,
  );
  assert.equal(
    (await call("POST", "/work-records", { kind: "promise", title: "" }))
      .statusCode,
    422,
  );
  assert.equal((await call("GET", "/work-records?limit=201")).statusCode, 422);
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/work-records",
        headers: {
          authorization: `Bearer ${lead}`,
          "content-type": "application/json",
        },
        payload: "{",
      })
    ).statusCode,
    400,
  );
});

test("a promise stays private and follows its linked task", async () => {
  const project = await call("POST", "/projects", {
    name: "Record test project",
  });
  assert.equal(project.statusCode, 201, project.body);
  const task = await call("POST", "/items", {
    title: "Ship the draft",
    kind: "task",
  });
  assert.equal(task.statusCode, 201, task.body);
  const projectId = project.json().id as string;
  const taskId = task.json().id as string;
  assert.equal(
    (await call("PUT", `/items/${taskId}/project`, { project_id: projectId }))
      .statusCode,
    200,
  );
  const made = await call("POST", "/work-records", {
    kind: "promise",
    title: "Send a draft",
    project_id: projectId,
    linked_item_id: taskId,
  });
  assert.equal(made.statusCode, 201, made.body);
  const record = made.json();
  assert.equal(record.linked_item_title, "Ship the draft");
  assert.equal(record.status, "open");
  assert.equal(
    (await call("GET", `/work-records/${record.id}`, undefined, stranger))
      .statusCode,
    404,
  );
  assert.ok(
    !(await call("GET", "/work-records", undefined, stranger))
      .json()
      .some((row: { id: string }) => row.id === record.id),
  );
  assert.equal(
    (await call("GET", `/work-records?project_id=${projectId}`)).json().length,
    1,
  );
  const changed = await call("PUT", `/work-records/${record.id}`, {
    version: 1,
    status: "done",
    outcome: "Draft sent",
  });
  assert.equal(changed.statusCode, 200, changed.body);
  assert.equal(changed.json().outcome, "Draft sent");
  assert.equal(
    (
      await call("PUT", `/work-records/${record.id}`, {
        version: 1,
        status: "open",
      })
    ).statusCode,
    409,
  );
  const history = await call("GET", `/projects/${projectId}/activity`);
  assert.equal(history.statusCode, 200, history.body);
  assert.ok(
    history
      .json()
      .some((event: { kind: string }) => event.kind === "record_changed"),
  );
});

test("records reject links to someone else’s private task or project", async () => {
  const task = (
    await call(
      "POST",
      "/items",
      { title: "Private work", kind: "task" },
      stranger,
    )
  ).json();
  const project = (
    await call("POST", "/projects", { name: "Private project" }, stranger)
  ).json();
  const wrongTask = await call("POST", "/work-records", {
    kind: "decision",
    title: "Link",
    linked_item_id: task.id,
  });
  assert.equal(wrongTask.statusCode, 404, wrongTask.body);
  const wrongProject = await call("POST", "/work-records", {
    kind: "promise",
    title: "Link",
    project_id: project.id,
  });
  assert.equal(wrongProject.statusCode, 404, wrongProject.body);
  const wrongOwner = await call("POST", "/work-records", {
    kind: "promise",
    title: "Offer",
    owner_id: project.user_id,
  });
  assert.equal(wrongOwner.statusCode, 422, wrongOwner.body);
});

test("deleting a cited note preserves its record and clears the line link", async () => {
  const doc = await call("POST", "/docs", {
    title: "Decision note",
    content: [
      { id: "decision-line", type: "paragraph", text: "Try a short launch" },
    ],
  });
  assert.equal(doc.statusCode, 201, doc.body);
  const made = await call("POST", "/work-records", {
    kind: "decision",
    title: "Use a short launch",
    source_doc_id: doc.json().id,
    source_block_id: "decision-line",
  });
  assert.equal(made.statusCode, 201, made.body);
  assert.equal(
    (await call("DELETE", `/docs/${doc.json().id}`)).statusCode,
    204,
  );
  const kept = await call("GET", `/work-records/${made.json().id}`);
  assert.equal(kept.statusCode, 200, kept.body);
  assert.equal(kept.json().source_doc_id, null);
  assert.equal(kept.json().source_block_id, null);
});

test("meeting effort is durable and limited to meeting outcomes", async () => {
  const made = await call("POST", "/work-records", {
    kind: "meeting_outcome",
    title: "Launch review",
    meeting_minutes: 45,
    participant_count: 4,
  });
  assert.equal(made.statusCode, 201, made.body);
  assert.equal(made.json().meeting_minutes, 45);
  assert.equal(made.json().participant_count, 4);
  const read = await call("GET", `/work-records/${made.json().id}`);
  assert.equal(read.statusCode, 200, read.body);
  assert.equal(
    read.json().meeting_minutes * read.json().participant_count,
    180,
  );
  const incomplete = await call("POST", "/work-records", {
    kind: "meeting_outcome",
    title: "Incomplete",
    meeting_minutes: 45,
  });
  assert.equal(incomplete.statusCode, 422, incomplete.body);
  const misplaced = await call("POST", "/work-records", {
    kind: "promise",
    title: "Misplaced",
    meeting_minutes: 45,
    participant_count: 4,
  });
  assert.equal(misplaced.statusCode, 422, misplaced.body);
});

test("a plan experiment keeps its review and result", async () => {
  const review = new Date(Date.now() + 7 * 86400_000).toISOString();
  const made = await call("POST", "/work-records", {
    kind: "experiment",
    title: "Protect mornings",
    details: "Finish priority work in normal hours",
    review_at: review,
  });
  assert.equal(made.statusCode, 201, made.body);
  assert.equal(made.json().review_at, review);
  assert.equal(made.json().status, "open");
  const finished = await call("PUT", `/work-records/${made.json().id}`, {
    version: made.json().version,
    status: "done",
    outcome: "Three focused mornings; keep this pattern",
  });
  assert.equal(finished.statusCode, 200, finished.body);
  assert.equal(finished.json().status, "done");
  assert.match(finished.json().outcome, /keep this pattern/);
  const listed = await call("GET", "/work-records?kind=experiment");
  assert.equal(listed.statusCode, 200, listed.body);
  assert.ok(
    listed.json().some((row: { id: string }) => row.id === made.json().id),
  );
});

test("an offered promise reaches the owner, and their answer comes back", async () => {
  const team = await call("POST", "/teams", { name: "Promise notice team" });
  const teamId = team.json().id as string;
  await call("POST", `/teams/${teamId}/members`, {
    email: strangerEmail,
    role: "member",
  });
  const made = await call("POST", "/work-records", {
    kind: "promise",
    title: "Send the launch notes",
    team_id: teamId,
    owner_id: strangerId,
  });
  assert.equal(made.statusCode, 201, made.body);
  const id = made.json().id as string;
  const offered = (
    await call("GET", "/notifications", undefined, stranger)
  ).json() as { kind: string; ref: string; title: string }[];
  const notice = offered.find((n) => n.kind === "promise" && n.ref === id);
  assert.ok(notice, "the owner is told about the offer");
  assert.match(notice.title, /asked you to promise: Send the launch notes/);

  await call(
    "POST",
    `/work-records/${id}/respond`,
    { decision: "accept" },
    stranger,
  );
  const answered = (await call("GET", "/notifications")).json() as {
    kind: string;
    ref: string;
    title: string;
  }[];
  assert.ok(
    answered.some(
      (n) => n.kind === "promise" && n.ref === id && /promised:/.test(n.title),
    ),
    "whoever offered it hears the answer",
  );
});

test("an experiment shows the same span before it and while it ran", async () => {
  const made = await call("POST", "/work-records", {
    kind: "experiment",
    title: "No meetings before noon",
    review_at: new Date(Date.now() + 14 * 86400_000).toISOString(),
  });
  assert.equal(made.statusCode, 201, made.body);
  const evidence = await call(
    "GET",
    `/work-records/${made.json().id}/evidence`,
  );
  assert.equal(evidence.statusCode, 200, evidence.body);
  const { before: was, during } = evidence.json();
  for (const period of [was, during]) {
    assert.equal(typeof period.focus_minutes_per_week, "number");
    assert.equal(typeof period.tasks_done_per_week, "number");
    assert.ok(period.from < period.to);
  }
  // The comparison window is the same length on both sides, a week at least.
  const span = (p: { from: string; to: string }) =>
    new Date(p.to).getTime() - new Date(p.from).getTime();
  assert.equal(span(was), span(during));
  assert.ok(span(during) >= 7 * 86400_000 - 1000);
  assert.equal(was.to, during.from);
  assert.equal(
    (
      await call(
        "GET",
        `/work-records/${made.json().id}/evidence`,
        undefined,
        stranger,
      )
    ).statusCode,
    404,
  );
});

test("meeting outcomes can be found from the meeting they came from", async () => {
  const start = new Date(Date.now() - 2 * 3600_000);
  const meeting = await call("POST", "/items", {
    kind: "event",
    title: "Planning sync",
    due_at: start.toISOString(),
    end_at: new Date(start.getTime() + 3600_000).toISOString(),
  });
  assert.equal(meeting.statusCode, 201, meeting.body);
  const outcome = await call("POST", "/work-records", {
    kind: "meeting_outcome",
    title: "Agreed the launch date",
    source_item_id: meeting.json().id,
    meeting_minutes: 60,
    participant_count: 4,
  });
  assert.equal(outcome.statusCode, 201, outcome.body);
  await call("POST", "/work-records", {
    kind: "meeting_outcome",
    title: "Unrelated meeting",
  });
  const found = await call(
    "GET",
    `/work-records?source_item_id=${meeting.json().id}`,
  );
  assert.equal(found.statusCode, 200, found.body);
  assert.deepEqual(
    found.json().map((r: { id: string }) => r.id),
    [outcome.json().id],
  );
});
