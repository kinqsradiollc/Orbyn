import "./setup.js";
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { helpers } from "./mcp-helpers.js";
const { buildApp } = await import("../src/app.js");
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const app = await buildApp();
const h = helpers(app);
let owner: Awaited<ReturnType<typeof h.register>>;
let other: typeof owner;
let address = 0;
const call = (
  method: "POST" | "PUT" | "GET" | "DELETE",
  url: string,
  payload?: unknown,
  token?: string,
) =>
  app.inject({
    method,
    url,
    remoteAddress: `10.88.0.${++address % 250}`,
    headers: token ? { authorization: `Bearer ${token}` } : {},
    ...(payload === undefined ? {} : { payload: payload as object }),
  });
before(async () => {
  await migrate();
  owner = await h.register("scoped-publisher");
  other = await h.register("scoped-outsider");
});
after(async () => {
  const { closeLive } = await import("../src/modules/documents/live.js");
  await closeLive();
  await app.close();
  await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [
    [owner.id, other.id],
  ]);
  await pool.end();
});
const content = [
  { id: "chosen", type: "paragraph", text: "Explicit public source." },
  { id: "private", type: "paragraph", text: "Unselected confidential words." },
];
async function fixture(mode: "snapshot" | "live" = "snapshot") {
  const made = await call(
    "POST",
    "/docs",
    { title: "Selected publication", content },
    owner.token,
  );
  assert.equal(made.statusCode, 201, made.body);
  const doc = made.json();
  const input = {
    expected_doc_version: doc.version,
    expected_revision: 0,
    block_ids: ["chosen"],
    mode,
    expires_at: null,
    consent: true,
  };
  const result = await call(
    "PUT",
    `/docs/${doc.id}/publication`,
    input,
    owner.token,
  );
  assert.equal(result.statusCode, 200, result.body);
  return { doc, input, publication: result.json() };
}
test("anonymous publication exposes only selected content and requires explicit consent and current revisions", async () => {
  const f = await fixture();
  const rendered = await call("GET", f.publication.path);
  assert.equal(rendered.statusCode, 200, rendered.body);
  assert.ok(rendered.body.includes("Explicit public source."));
  assert.ok(!rendered.body.includes("Unselected confidential words."));
  assert.equal(rendered.headers["cache-control"], "no-store");
  assert.match(
    String(rendered.headers["content-security-policy"]),
    /default-src 'none'/,
  );
  const endpoint = `/docs/${f.doc.id}/publication`;
  assert.equal(
    (await call("PUT", endpoint, { ...f.input, consent: false }, owner.token))
      .statusCode,
    422,
  );
  assert.equal(
    (await call("PUT", endpoint, f.input, owner.token)).statusCode,
    409,
  );
  assert.equal(
    (
      await call(
        "PUT",
        endpoint,
        { ...f.input, expected_revision: 1, block_ids: ["missing"] },
        owner.token,
      )
    ).statusCode,
    409,
  );
  assert.equal(
    (
      await call(
        "PUT",
        endpoint,
        { ...f.input, expected_revision: 1 },
        other.token,
      )
    ).statusCode,
    404,
  );
  assert.equal(
    (await call("DELETE", endpoint, undefined, other.token)).statusCode,
    404,
  );
  assert.equal((await call("GET", endpoint)).statusCode, 401);
});
for (const mode of ["snapshot", "live"] as const)
  test(`${mode} updates cannot silently broaden selected scope`, async () => {
    const f = await fixture(mode);
    const changed = [
      { ...content[0], text: "Updated chosen text." },
      content[1],
      {
        id: "new",
        type: "paragraph",
        text: "Never automatically publish this.",
      },
    ];
    await pool.query(
      "UPDATE docs SET content=$2::jsonb,version=version+1 WHERE id=$1",
      [f.doc.id, JSON.stringify(changed)],
    );
    const rendered = await call("GET", f.publication.path);
    assert.equal(rendered.statusCode, 200, rendered.body);
    assert.ok(
      rendered.body.includes(
        mode === "snapshot"
          ? "Explicit public source."
          : "Updated chosen text.",
      ),
    );
    assert.ok(!rendered.body.includes("Never automatically publish"));
    assert.ok(!rendered.body.includes("Unselected confidential"));
    if (mode === "live") {
      await pool.query(
        "UPDATE docs SET content=$2::jsonb,version=version+1 WHERE id=$1",
        [f.doc.id, JSON.stringify([content[1]])],
      );
      assert.equal((await call("GET", f.publication.path)).statusCode, 404);
    }
  });
test("revocation, expiry, trash and disabled publisher stop anonymous reads", async () => {
  for (const reason of ["revoke", "expiry", "trash", "disabled"]) {
    const f = await fixture();
    if (reason === "revoke")
      assert.equal(
        (
          await call(
            "DELETE",
            `/docs/${f.doc.id}/publication`,
            undefined,
            owner.token,
          )
        ).statusCode,
        200,
      );
    if (reason === "expiry")
      await pool.query(
        "UPDATE scoped_page_publications SET expires_at=now()-interval '1 second' WHERE doc_id=$1",
        [f.doc.id],
      );
    if (reason === "trash")
      await pool.query("UPDATE docs SET deleted_at=now() WHERE id=$1", [
        f.doc.id,
      ]);
    if (reason === "disabled")
      await pool.query("UPDATE users SET disabled=true WHERE id=$1", [
        owner.id,
      ]);
    try {
      assert.equal((await call("GET", f.publication.path)).statusCode, 404);
    } finally {
      if (reason === "disabled")
        await pool.query("UPDATE users SET disabled=false WHERE id=$1", [
          owner.id,
        ]);
    }
  }
});
test("recreating a revoked publication cannot revive the old token", async () => {
  const f = await fixture();
  await call("DELETE", `/docs/${f.doc.id}/publication`, undefined, owner.token);
  const made = await call(
    "PUT",
    `/docs/${f.doc.id}/publication`,
    f.input,
    owner.token,
  );
  assert.equal(made.statusCode, 200, made.body);
  assert.notEqual(made.json().path, f.publication.path);
  assert.equal((await call("GET", f.publication.path)).statusCode, 404);
  assert.equal(
    (
      await call(
        "GET",
        `${made.json().path}/media/------------------------------------`,
      )
    ).statusCode,
    404,
  );
});

test("anonymous output strips internal labels and never includes page comments", async () => {
  const f = await fixture("live");
  const secretId = randomUUID();
  await pool.query(
    "UPDATE docs SET content=$2::jsonb,version=version+1 WHERE id=$1",
    [
      f.doc.id,
      JSON.stringify([
        {
          ...content[0],
          text: `See [Confidential target name](orbyn://doc/${secretId}) and [Public site](https://example.com).`,
        },
        content[1],
      ]),
    ],
  );
  await pool.query(
    "INSERT INTO doc_comments(doc_id,user_id,body) VALUES($1,$2,'Do not publish discussion text.')",
    [f.doc.id, owner.id],
  );
  const rendered = await call("GET", f.publication.path);
  assert.equal(rendered.statusCode, 200, rendered.body);
  assert.ok(!rendered.body.includes("Confidential target name"));
  assert.ok(!rendered.body.includes(secretId));
  assert.ok(!rendered.body.includes("Do not publish discussion"));
  assert.ok(rendered.body.includes("Public site"));
});

test("moving a published page to another space withdraws its existing link", async () => {
  const f = await fixture();
  const team = await h.team(owner, "Publication move");
  try {
    await pool.query(
      "UPDATE docs SET team_id=$2,version=version+1 WHERE id=$1",
      [f.doc.id, team],
    );
    assert.equal((await call("GET", f.publication.path)).statusCode, 404);
  } finally {
    await pool.query("DELETE FROM teams WHERE id=$1", [team]);
  }
});

test("current team publishing policy and publisher membership fence reads", async () => {
  const team = await h.team(owner, "Publication policy", [[other, "member"]]);
  try {
    const made = await call(
      "POST",
      "/docs",
      { title: "Team page", team_id: team, content },
      other.token,
    );
    assert.equal(made.statusCode, 201, made.body);
    const doc = made.json();
    const input = {
      expected_doc_version: doc.version,
      expected_revision: 0,
      block_ids: ["chosen"],
      mode: "snapshot",
      expires_at: null,
      consent: true,
    };
    const published = await call(
      "PUT",
      `/docs/${doc.id}/publication`,
      input,
      other.token,
    );
    assert.equal(published.statusCode, 200, published.body);
    const path = published.json().path;
    await pool.query("UPDATE teams SET publishing_allowed=false WHERE id=$1", [
      team,
    ]);
    assert.equal((await call("GET", path)).statusCode, 404);
    assert.equal(
      (
        await call(
          "PUT",
          `/docs/${doc.id}/publication`,
          { ...input, expected_revision: 1 },
          other.token,
        )
      ).statusCode,
      403,
    );
    await pool.query("UPDATE teams SET publishing_allowed=true WHERE id=$1", [
      team,
    ]);
    assert.equal((await call("GET", path)).statusCode, 200);
    await pool.query(
      "DELETE FROM team_members WHERE team_id=$1 AND user_id=$2",
      [team, other.id],
    );
    assert.equal((await call("GET", path)).statusCode, 404);
  } finally {
    await pool.query("DELETE FROM teams WHERE id=$1", [team]);
  }
});
