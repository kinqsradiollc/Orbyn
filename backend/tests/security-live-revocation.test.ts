import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { FastifyReply } from "fastify";
import "./setup.js";
const { pool, closeDatabase } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { streamDocChanges, announceDocChange, closeLive } =
  await import("../src/modules/documents/live.js");
await migrate();
after(async () => {
  await closeLive();
  await closeDatabase();
});
test("existing document stream stops releasing notifications after access revocation", async () => {
  const docId = randomUUID();
  const writes: string[] = [];
  let allowed = true,
    checks = 0;
  const reply = {
    raw: {
      destroyed: false,
      writeHead() {},
      write(value: string) {
        writes.push(value);
      },
      end() {},
    },
    getHeaders: () => ({}),
  } as unknown as FastifyReply;
  const stop = await streamDocChanges(reply, docId, "reader", async () => {
    checks++;
    return allowed;
  });
  const waitFor = async (expected: number) => {
    const until = Date.now() + 2000;
    while (checks < expected && Date.now() < until)
      await new Promise((resolve) => setTimeout(resolve, 10));
    assert.ok(checks >= expected, "notification reached authorization guard");
  };
  try {
    await announceDocChange(pool, docId, 1, "writer");
    await waitFor(1);
    assert.ok(writes.some((value) => value.includes('"version":1')));
    allowed = false;
    await announceDocChange(pool, docId, 2, "writer");
    await waitFor(2);
    assert.ok(!writes.some((value) => value.includes('"version":2')));
  } finally {
    stop();
  }
});

test("authenticated CRDT SSE closes a revoked session and retains the authorized reader", async () => {
  const { buildApp } = await import("../src/app.js");
  const { announceCrdtUpdate } =
    await import("../src/modules/documents/live.js");
  const { get } = await import("node:http");
  const { createHash } = await import("node:crypto");
  const app = await buildApp();
  const email = `sse-${randomUUID()}@example.com`;
  const password = "a-long-test-password";
  const registered = (
    await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { email, password, name: "SSE fixture" },
    })
  ).json();
  const login = (
    await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email, password },
    })
  ).json();
  const token: string = registered.token;
  const controlToken: string = login.token;
  assert.ok(token && controlToken);
  const page = (
    await app.inject({
      method: "POST",
      url: "/docs",
      headers: { authorization: `Bearer ${token}` },
      payload: { title: "SSE fixture", content: [] },
    })
  ).json();
  assert.ok(page.id);
  const baseline = (
    await pool.query(
      "INSERT INTO doc_updates(doc_id,editor_id,update) VALUES($1,'baseline',$2) RETURNING seq",
      [page.id, Buffer.from("existing-baseline")],
    )
  ).rows[0].seq;
  const address = await app.listen({ port: 0, host: "127.0.0.1" });
  const open = (bearer: string) =>
    new Promise<{ text: string; ended: boolean; stop: () => void }>(
      (resolve, reject) => {
        const request = get(
          `${address}/events/docs/${page.id}?since=${baseline}`,
          { headers: { authorization: `Bearer ${bearer}` } },
          (response) => {
            assert.equal(response.statusCode, 200);
            const state = {
              text: "",
              ended: false,
              stop: () => {
                response.destroy();
                request.destroy();
              },
            };
            response.setEncoding("utf8");
            response.on("data", (chunk: string) => {
              state.text += chunk;
            });
            response.on("end", () => {
              state.ended = true;
            });
            response.on("error", reject);
            resolve(state);
          },
        );
        request.on("error", reject);
      },
    );
  const revoked = await open(token);
  const control = await open(controlToken);
  const until = async (condition: () => boolean, description: string) => {
    const deadline = Date.now() + 3000;
    while (!condition() && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 10));
    assert.ok(condition(), description);
  };
  const update = async (bytes: Buffer) => {
    const row = (
      await pool.query(
        "INSERT INTO doc_updates(doc_id,editor_id,update) VALUES($1,'writer',$2) RETURNING seq",
        [page.id, bytes],
      )
    ).rows[0];
    await announceCrdtUpdate(pool, page.id, "writer");
    return `"seq":${row.seq},`;
  };
  try {
    await until(
      () => revoked.text.includes(": open") && control.text.includes(": open"),
      "both authenticated streams opened",
    );
    const initial = await update(Buffer.from("authorized-initial-update"));
    await until(
      () => revoked.text.includes(initial) && control.text.includes(initial),
      "both readers received the initial CRDT parcel",
    );
    await pool.query("DELETE FROM sessions WHERE token_hash=$1", [
      createHash("sha256").update(token).digest("hex"),
    ]);
    const later = await update(Buffer.from("must-not-reach-revoked-reader"));
    await until(
      () => revoked.ended && control.text.includes(later),
      "revoked stream closed; authorized control received the later CRDT parcel",
    );
    assert.ok(!revoked.text.includes(later));
    assert.ok(
      !revoked.text.includes(
        Buffer.from("must-not-reach-revoked-reader").toString("base64"),
      ),
    );
    assert.equal(control.ended, false);
  } finally {
    revoked.stop();
    control.stop();
    await app.close();
    await pool.query("DELETE FROM docs WHERE id=$1", [page.id]);
    await pool.query("DELETE FROM users WHERE email=$1", [email]);
  }
});

test("document SSE delivers only authorized current Trash terminal state", async (t) => {
  const { buildApp } = await import("../src/app.js");
  const { announceCrdtUpdate } =
    await import("../src/modules/documents/live.js");
  const { get } = await import("node:http");
  const { createHash } = await import("node:crypto");
  const app = await buildApp();
  const users: string[] = [];
  const docs: string[] = [];
  const teams: string[] = [];
  type Stream = { text: string; ended: boolean; stop: () => void };
  const streams: Stream[] = [];
  const register = async () => {
    const response = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: {
        email: `trash-sse-${randomUUID()}@example.com`,
        password: "a-long-test-password",
        name: "Trash SSE fixture",
      },
    });
    const value = response.json();
    assert.ok(value.user?.id && value.token);
    users.push(value.user.id);
    return value as { token: string; user: { id: string; email: string } };
  };
  const createDoc = async (token: string, teamId?: string) => {
    const response = await app.inject({
      method: "POST",
      url: "/docs",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        title: "Terminal Trash fixture",
        content: [{ type: "paragraph", text: "Private document contents" }],
        ...(teamId ? { team_id: teamId } : {}),
      },
    });
    assert.equal(response.statusCode, 201);
    const value = response.json();
    assert.ok(value.id && Number.isSafeInteger(value.version));
    docs.push(value.id);
    return value as { id: string; version: number };
  };
  const until = async (condition: () => boolean, message: string) => {
    const deadline = Date.now() + 5000;
    while (!condition() && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 10));
    assert.ok(condition(), message);
  };
  const frames = (stream: Stream): Record<string, unknown>[] =>
    stream.text
      .split("\n")
      .filter((line) => line.startsWith("data: "))
      .map((line) => JSON.parse(line.slice(6)) as Record<string, unknown>);
  let address = "";
  const open = (
    token: string,
    id: string,
    since?: number | string,
    terminal: string | null = "preserve-drafts-v1",
    legacyPath = false,
  ) =>
    new Promise<Stream>((resolve, reject) => {
      const query = new URLSearchParams();
      if (since !== undefined) query.set("since", String(since));
      if (terminal !== null) query.set("terminal", terminal);
      const path = legacyPath ? `/docs/${id}/live` : `/events/docs/${id}`;
      const request = get(
        `${address}${path}${query.size ? `?${query}` : ""}`,
        { headers: { authorization: `Bearer ${token}` } },
        (response) => {
          if (response.statusCode !== 200) {
            response.resume();
            reject(new Error(`Unexpected SSE status ${response.statusCode}`));
            return;
          }
          const stream: Stream = {
            text: "",
            ended: false,
            stop: () => {
              response.destroy();
              request.destroy();
            },
          };
          streams.push(stream);
          response.setEncoding("utf8");
          response.on("data", (chunk: string) => {
            stream.text += chunk;
          });
          response.on("end", () => {
            stream.ended = true;
          });
          response.on("error", reject);
          resolve(stream);
        },
      );
      request.on("error", reject);
    });
  const trash = async (id: string) =>
    (
      await pool.query<{ version: number }>(
        "UPDATE docs SET deleted_at=now(),version=version+1 WHERE id=$1 RETURNING version",
        [id],
      )
    ).rows[0].version;
  const appendUpdate = async (id: string, text: string) =>
    (
      await pool.query<{ seq: string }>(
        "INSERT INTO doc_updates(doc_id,editor_id,update) VALUES($1,'other-editor',$2) RETURNING seq",
        [id, Buffer.from(text)],
      )
    ).rows[0].seq;
  try {
    const owner = await register();
    const member = await register();
    address = await app.listen({ port: 0, host: "127.0.0.1" });
    await t.test(
      "current authorized Trash is minimal, delivered once, and closes; new admission stays404",
      async () => {
        const doc = await createDoc(owner.token);
        const stream = await open(owner.token, doc.id);
        await until(
          () => stream.text.includes(": open"),
          "document SSE opened",
        );
        const version = await trash(doc.id);
        await announceDocChange(pool, doc.id, version, "other-editor", {
          trashed: true,
        });
        // A second queued guard must not duplicate the terminal notice.
        await announceDocChange(pool, doc.id, version, "other-editor", {
          trashed: true,
        });
        await until(
          () => stream.ended,
          "current Trash terminal closes the SSE",
        );
        assert.deepEqual(frames(stream), [{ version, trashed: true }]);
        assert.ok(!stream.text.includes("Private document contents"));
        const denied = await app.inject({
          method: "GET",
          url: `/events/docs/${doc.id}?terminal=preserve-drafts-v1`,
          headers: { authorization: `Bearer ${owner.token}` },
        });
        assert.equal(denied.statusCode, 404, "a new stream cannot enter Trash");
      },
    );
    await t.test(
      "CRDT guard reaching current Trash first sends terminal only, never the queued bytes",
      async () => {
        const doc = await createDoc(owner.token);
        const baseline = await appendUpdate(
          doc.id,
          "existing authorized baseline",
        );
        const stream = await open(owner.token, doc.id, baseline);
        await until(() => stream.text.includes(": open"), "CRDT SSE opened");
        const version = await trash(doc.id);
        const secret = "must-not-release-CRDT-after-Trash";
        await appendUpdate(doc.id, secret);
        // The CRDT authorization check must itself deliver the terminal state;
        // no doc_changed notification is needed to wake this test.
        await announceCrdtUpdate(pool, doc.id, "other-editor");
        await until(() => stream.ended, "CRDT guard closed the trashed stream");
        assert.deepEqual(frames(stream), [{ version, trashed: true }]);
        assert.ok(
          !stream.text.includes(Buffer.from(secret).toString("base64")),
        );
      },
    );
    await t.test(
      "default legacy and unknown terminal modes close on Trash without any payload",
      async () => {
        const doc = await createDoc(owner.token);
        const baseline = await appendUpdate(doc.id, "legacy baseline");
        const legacy = await open(owner.token, doc.id, baseline, null, true);
        const unknown = await open(
          owner.token,
          doc.id,
          baseline,
          "unsupported-terminal-v1",
        );
        await until(
          () =>
            legacy.text.includes(": open") && unknown.text.includes(": open"),
          "default legacy and unrecognized negotiation readers opened",
        );
        const version = await trash(doc.id);
        await appendUpdate(doc.id, "must-not-reach-legacy-after-Trash");
        await announceCrdtUpdate(pool, doc.id, "other-editor");
        await announceDocChange(pool, doc.id, version, "other-editor", {
          trashed: true,
        });
        await until(
          () => legacy.ended && unknown.ended,
          "both non-opted modes close without terminal delivery",
        );
        assert.deepEqual(frames(legacy), []);
        assert.deepEqual(frames(unknown), []);
        const denied = await app.inject({
          method: "GET",
          url: `/docs/${doc.id}/live`,
          headers: { authorization: `Bearer ${owner.token}` },
        });
        assert.equal(
          denied.statusCode,
          404,
          "legacy admission also excludes Trash",
        );
      },
    );
    await t.test(
      "membership or session revoked before Trash yields no terminal metadata or CRDT body",
      async () => {
        const team = (
          await pool.query<{ id: string }>(
            "INSERT INTO teams(name,created_by) VALUES('Trash SSE team',$1) RETURNING id",
            [owner.user.id],
          )
        ).rows[0].id;
        teams.push(team);
        await pool.query(
          "INSERT INTO team_members(team_id,user_id,role) VALUES($1,$2,'owner'),($1,$3,'member')",
          [team, owner.user.id, member.user.id],
        );
        const shared = await createDoc(owner.token, team);
        const personal = await createDoc(member.token);
        const baselineShared = await appendUpdate(shared.id, "shared baseline");
        const baselinePersonal = await appendUpdate(
          personal.id,
          "personal baseline",
        );
        const membership = await open(member.token, shared.id, baselineShared);
        const membershipLegacy = await open(
          member.token,
          shared.id,
          baselineShared,
          null,
        );
        const session = await open(member.token, personal.id, baselinePersonal);
        const sessionLegacy = await open(
          member.token,
          personal.id,
          baselinePersonal,
          null,
        );
        await until(
          () =>
            membership.text.includes(": open") &&
            membershipLegacy.text.includes(": open") &&
            session.text.includes(": open") &&
            sessionLegacy.text.includes(": open"),
          "both soon-to-be-revoked readers opened",
        );
        await pool.query(
          "DELETE FROM team_members WHERE team_id=$1 AND user_id=$2",
          [team, member.user.id],
        );
        // Keep this session valid until membership denial has independently run.
        const sharedVersion = await trash(shared.id);
        await appendUpdate(shared.id, "membership-revoked-private-bytes");
        await announceCrdtUpdate(pool, shared.id, "other-editor");
        await announceDocChange(
          pool,
          shared.id,
          sharedVersion,
          "other-editor",
          { trashed: true },
        );
        await until(
          () => membership.ended && membershipLegacy.ended,
          "both membership-revoked modes closed",
        );
        assert.deepEqual(frames(membership), []);
        assert.deepEqual(frames(membershipLegacy), []);
        await pool.query("DELETE FROM sessions WHERE token_hash=$1", [
          createHash("sha256").update(member.token).digest("hex"),
        ]);
        const personalVersion = await trash(personal.id);
        await appendUpdate(personal.id, "session-revoked-private-bytes");
        await announceCrdtUpdate(pool, personal.id, "other-editor");
        await announceDocChange(
          pool,
          personal.id,
          personalVersion,
          "other-editor",
          { trashed: true },
        );
        await until(
          () => session.ended && sessionLegacy.ended,
          "both session-revoked modes closed",
        );
        assert.deepEqual(frames(session), []);
        assert.deepEqual(frames(sessionLegacy), []);
      },
    );
    await t.test(
      "delayed Trash after restore is ignored and ordinary current changes still stream",
      async () => {
        const doc = await createDoc(owner.token);
        const stream = await open(owner.token, doc.id);
        const legacy = await open(owner.token, doc.id, undefined, null, true);
        await until(
          () => stream.text.includes(": open"),
          "restoration control opened",
        );
        const staleVersion = await trash(doc.id);
        const version = (
          await pool.query<{ version: number }>(
            "UPDATE docs SET deleted_at=null,version=version+1 WHERE id=$1 RETURNING version",
            [doc.id],
          )
        ).rows[0].version;
        await announceDocChange(pool, doc.id, staleVersion, "other-editor", {
          trashed: true,
        });
        await announceDocChange(pool, doc.id, version, "other-editor");
        await until(
          () =>
            frames(stream).some(
              (frame) => frame.version === version && !frame.trashed,
            ),
          "ordinary current event survives the delayed stale Trash notice",
        );
        await until(
          () =>
            frames(legacy).some((frame) => frame.trashed === true) &&
            frames(legacy).some(
              (frame) => frame.version === version && !frame.trashed,
            ),
          "legacy restored stream retains prior stale-hint forwarding semantics",
        );
        assert.equal(legacy.ended, false);
        assert.equal(stream.ended, false);
        assert.ok(
          frames(stream).every((frame) => !frame.trashed),
          "stale Trash never reaches editor",
        );
      },
    );
  } finally {
    streams.forEach((stream) => stream.stop());
    await app.close();
    if (docs.length)
      await pool.query("DELETE FROM docs WHERE id=ANY($1::uuid[])", [docs]);
    if (teams.length)
      await pool.query("DELETE FROM teams WHERE id=ANY($1::uuid[])", [teams]);
    if (users.length)
      await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [users]);
  }
});
