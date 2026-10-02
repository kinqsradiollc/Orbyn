import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import "./setup.js";

const dir = await mkdtemp(join(tmpdir(), "orbyn-published-media-test-"));
process.env.FILES_SECRET =
  "publication-test-files-secret-at-least-32-characters";
process.env.FILES_DIR = dir;
process.env.PAGE_FILES_DIR = join(dir, "kept");
process.env.FILES_MIN_FREE_MB = "0";
const { buildApp } = await import("../src/app.js");
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { env } = await import("../src/config/env.js");
const app = await buildApp();
let beforeStoredRead: (() => Promise<void>) | undefined;
let storedGate: Promise<void> | undefined;
let storedEntered = 0;
app.addHook("onRequest", async (request) => {
  if (!request.url.startsWith("/files/r/")) return;
  const before = beforeStoredRead;
  beforeStoredRead = undefined;
  if (before) await before();
  if (storedGate) {
    storedEntered++;
    await storedGate;
  }
});
let token = "";
let address = 0;
const call = (
  method: "GET" | "PUT" | "POST" | "DELETE",
  url: string,
  payload?: object,
  auth = true,
  cookie?: string,
) =>
  app.inject({
    method,
    url,
    remoteAddress: `10.87.0.${address++ % 250}`,
    headers: {
      ...(auth ? { authorization: `Bearer ${token}` } : {}),
      ...(cookie ? { cookie } : {}),
    },
    ...(payload ? { payload } : {}),
  });
const png = await readFile(
  new URL("./fixtures/export-picture.png", import.meta.url),
);
before(async () => {
  await migrate();
  env.FILES_URL = await app.listen({ host: "127.0.0.1", port: 0 });
  const res = await call(
    "POST",
    "/auth/register",
    {
      email: `publication-${randomUUID()}@example.com`,
      password: "a-long-test-password",
      name: "Publisher",
    },
    false,
  );
  assert.equal(res.statusCode, 201, res.body);
  token = res.json().token;
});
after(async () => {
  const { closeLive } = await import("../src/modules/docs/live.js");
  await closeLive();
  await app.close();
  await pool.end();
  await rm(dir, { recursive: true, force: true });
});
async function fixture(
  password?: string,
  place: { team_id?: string; folder_id?: string } = {},
) {
  const page = await call("POST", "/docs", {
    title: "Published picture",
    ...place,
  });
  assert.equal(page.statusCode, 201, page.body);
  const doc = page.json();
  const made = await call("POST", `/docs/${doc.id}/files`, {
    name: "picture.png",
    bytes: png.length,
    width: 640,
    height: 240,
  });
  assert.equal(made.statusCode, 201, made.body);
  const upload = await app.inject({
    method: "PUT",
    url: made.json().upload_path,
    headers: {
      "content-type": "image/png",
      "content-length": String(png.length),
    },
    payload: png,
  });
  assert.equal(upload.statusCode, 201, upload.body);
  const saved = await call("PUT", `/docs/${doc.id}`, {
    version: doc.version,
    content: [
      { type: "image", file: made.json().file.id, text: "Published figure" },
    ],
  });
  assert.equal(saved.statusCode, 200, saved.body);
  const slug = `media-${randomUUID().slice(0, 8)}`;
  const published = await call("PUT", `/docs/${doc.id}/publish`, {
    slug,
    ...(password ? { password } : {}),
  });
  assert.equal(published.statusCode, 200, published.body);
  return { id: doc.id, file: made.json().file.id, slug, path: `/p/${slug}` };
}
async function imageUrl(path: string, cookie?: string) {
  const page = await call("GET", path, undefined, false, cookie);
  assert.equal(page.statusCode, 200, page.body);
  const src = /<img[^>]*src="([^"]+)"/.exec(page.body)?.[1];
  assert.ok(src, "Published page must contain its actual image URL");
  return src.startsWith("/api/") ? src.slice(4) : src;
}

test("unpublishing immediately revokes the image URL issued by the current published page", async () => {
  const doc = await fixture();
  const url = await imageUrl(doc.path);
  const shown = await call("GET", url, undefined, false);
  assert.equal(shown.statusCode, 200, shown.body);
  assert.deepEqual(shown.rawPayload, png);
  const removed = await call("DELETE", `/docs/${doc.id}/publish`);
  assert.equal(removed.statusCode, 200, removed.body);
  const stale = await call("GET", url, undefined, false);
  assert.equal(
    stale.statusCode,
    404,
    "Previously issued publication image URLs must check that publication still exists",
  );
  assert.doesNotMatch(stale.body, /data:image|iVBOR/);
});

async function unlock(path: string, password: string) {
  const response = await call("POST", `${path}/unlock`, { password }, false);
  assert.equal(response.statusCode, 303, response.body);
  return String(response.headers["set-cookie"]).split(";")[0];
}

test("published media requires the current password cookie and rejects cookies after password change", async () => {
  const doc = await fixture("first secret");
  const cookie = await unlock(doc.path, "first secret");
  const url = await imageUrl(doc.path, cookie);
  const locked = await call("GET", url, undefined, false);
  assert.equal(locked.statusCode, 401);
  assert.equal(locked.headers["cache-control"], "no-store");
  const opened = await call("GET", url, undefined, false, cookie);
  assert.equal(opened.statusCode, 200, opened.body);
  assert.deepEqual(opened.rawPayload, png);
  assert.equal(opened.headers["cache-control"], "no-store");
  assert.equal(opened.headers["x-content-type-options"], "nosniff");
  assert.match(String(opened.headers["content-security-policy"]), /sandbox/);
  const changed = await call("PUT", `/docs/${doc.id}/publish`, {
    password: "second secret",
  });
  assert.equal(changed.statusCode, 200, changed.body);
  assert.equal(
    (await call("GET", url, undefined, false, cookie)).statusCode,
    401,
  );
  const current = await unlock(doc.path, "second secret");
  assert.equal(
    (await call("GET", url, undefined, false, current)).statusCode,
    200,
  );
});

test("a published media URL cannot select another page or unreferenced file", async () => {
  const a = await fixture();
  const b = await fixture();
  for (const url of [
    `/p/${a.slug}/media/${b.id}/${b.file}`,
    `/p/${a.slug}/media/${a.id}/${b.file}`,
    `/p/${a.slug}/media/not-a-uuid/${a.file}`,
  ]) {
    const response = await call("GET", url, undefined, false);
    assert.equal(response.statusCode, 404, response.body);
    assert.equal(response.headers["cache-control"], "no-store");
    assert.notDeepEqual(response.rawPayload, png);
  }
  const url = await imageUrl(a.path);
  const doc = (await call("GET", `/docs/${a.id}`)).json();
  assert.equal(
    (await call("PUT", `/docs/${a.id}`, { version: doc.version, content: [] }))
      .statusCode,
    200,
  );
  assert.equal((await call("GET", url, undefined, false)).statusCode, 404);
});

test("taking a page to Trash revokes its existing public media URL", async () => {
  const doc = await fixture();
  const url = await imageUrl(doc.path);
  assert.equal((await call("DELETE", `/docs/${doc.id}`)).statusCode, 204);
  assert.equal((await call("GET", url, undefined, false)).statusCode, 404);
});

test("publication is rechecked after the file service returns bytes", async () => {
  const doc = await fixture();
  const url = await imageUrl(doc.path);
  beforeStoredRead = async () => {
    const removed = await call("DELETE", `/docs/${doc.id}/publish`);
    assert.equal(removed.statusCode, 200, removed.body);
  };
  const response = await call("GET", url, undefined, false);
  assert.equal(response.statusCode, 404, response.body);
  assert.notDeepEqual(response.rawPayload, png);
});

test("password changes during storage reads prevent bytes reaching the old reader", async () => {
  const doc = await fixture("initial secret");
  const cookie = await unlock(doc.path, "initial secret");
  const url = await imageUrl(doc.path, cookie);
  beforeStoredRead = async () => {
    assert.equal(
      (
        await call("PUT", `/docs/${doc.id}/publish`, {
          password: "replacement secret",
        })
      ).statusCode,
      200,
    );
  };
  const response = await call("GET", url, undefined, false, cookie);
  assert.equal(response.statusCode, 401, response.body);
  assert.notDeepEqual(response.rawPayload, png);
});

test("team publishing controls revoke media and preserve management security", async () => {
  const made = await call("POST", "/teams", { name: "Media publishing team" });
  assert.equal(made.statusCode, 201, made.body);
  const team = made.json().id;
  const doc = await fixture(undefined, { team_id: team });
  const url = await imageUrl(doc.path);
  assert.equal((await call("GET", url, undefined, false)).statusCode, 200);
  const off = await call("PUT", `/teams/${team}/publishing`, {
    allowed: false,
  });
  assert.equal(off.statusCode, 200, off.body);
  assert.equal((await call("GET", url, undefined, false)).statusCode, 404);
  const refused = await call("PUT", `/docs/${doc.id}/publish`, {});
  assert.equal(refused.statusCode, 403, refused.body);
  assert.equal(
    (await call("PUT", `/docs/${doc.id}/publish`, {}, false)).statusCode,
    401,
  );
  assert.equal(
    (await call("PUT", `/docs/${doc.id}/publish`, { slug: "invalid slug" }))
      .statusCode,
    422,
  );
});

test("published folder media is scoped to current direct children", async () => {
  const folder = await call("POST", "/folders", { name: "Media folder" });
  assert.equal(folder.statusCode, 201, folder.body);
  const id = folder.json().id;
  const doc = await fixture(undefined, { folder_id: id });
  assert.equal(
    (await call("DELETE", `/docs/${doc.id}/publish`)).statusCode,
    200,
  );
  const slug = `folder-media-${randomUUID().slice(0, 8)}`;
  assert.equal(
    (await call("PUT", `/folders/${id}/publish`, { slug })).statusCode,
    200,
  );
  const url = await imageUrl(`/p/${slug}/${doc.id}`);
  assert.equal((await call("GET", url, undefined, false)).statusCode, 200);
  const source = (await call("GET", `/docs/${doc.id}`)).json();
  const moved = await call("PUT", `/docs/${doc.id}`, {
    version: source.version,
    folder_id: null,
  });
  assert.equal(moved.statusCode, 200, moved.body);
  assert.equal((await call("GET", url, undefined, false)).statusCode, 404);
});

test("published media uses four bounded slots without queuing and recovers them after delivery", async () => {
  const doc = await fixture();
  const url = await imageUrl(doc.path);
  let resume!: () => void;
  storedGate = new Promise<void>((resolve) => {
    resume = resolve;
  });
  storedEntered = 0;
  const reads = Array.from({ length: 4 }, () =>
    call("GET", url, undefined, false),
  );
  try {
    const deadline = Date.now() + 5000;
    while (storedEntered < 4 && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(storedEntered, 4, "four storage reads should start");
    const busy = await call("GET", url, undefined, false);
    assert.equal(busy.statusCode, 503, busy.body);
    assert.equal(busy.headers["retry-after"], "5");
    assert.equal(busy.headers["cache-control"], "no-store");
  } finally {
    storedGate = undefined;
    resume();
    const results = await Promise.all(reads);
    for (const response of results) {
      assert.equal(response.statusCode, 200, response.body);
      assert.deepEqual(response.rawPayload, png);
    }
  }
  assert.equal((await call("GET", url, undefined, false)).statusCode, 200);
});

test("published media refuses excess requests with 429", async () => {
  let last = 0;
  for (let i = 0; i < 605; i++) {
    const response = await app.inject({
      method: "GET",
      url: "/p/unknown/media/bad-id/bad-file",
      remoteAddress: "10.88.44.1",
    });
    last = response.statusCode;
    if (last === 429) break;
    assert.equal(last, 404, response.body);
  }
  assert.equal(last, 429);
});

test("publication read byte reservations prevent large concurrent buffers and release after failure", async () => {
  const doc = await fixture();
  const url = await imageUrl(doc.path);
  const reserved = 24 * 1024 * 1024;
  await pool.query("UPDATE page_files SET bytes=$2 WHERE id=$1", [
    doc.file,
    reserved,
  ]);
  let resume!: () => void;
  storedGate = new Promise<void>((resolve) => {
    resume = resolve;
  });
  storedEntered = 0;
  const reads = Array.from({ length: 2 }, () =>
    call("GET", url, undefined, false),
  );
  try {
    const deadline = Date.now() + 5000;
    while (storedEntered < 2 && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(storedEntered, 2);
    const busy = await call("GET", url, undefined, false);
    assert.equal(busy.statusCode, 503, busy.body);
    assert.equal(busy.headers["retry-after"], "5");
  } finally {
    storedGate = undefined;
    resume();
    const responses = await Promise.all(reads);
    await pool.query("UPDATE page_files SET bytes=$2 WHERE id=$1", [
      doc.file,
      png.length,
    ]);
    for (const response of responses)
      assert.equal(
        response.statusCode,
        503,
        "mismatched stored size must fail closed",
      );
  }
  assert.equal((await call("GET", url, undefined, false)).statusCode, 200);
  await pool.query("UPDATE page_files SET bytes=$2 WHERE id=$1", [
    doc.file,
    65 * 1024 * 1024,
  ]);
  try {
    assert.equal((await call("GET", url, undefined, false)).statusCode, 413);
  } finally {
    await pool.query("UPDATE page_files SET bytes=$2 WHERE id=$1", [
      doc.file,
      png.length,
    ]);
  }
});
