import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import "./setup.js";
import { helpers } from "./mcp-helpers.js";
import { mermaidFixtures } from "./helpers/mermaid-fixtures.js";

const dir = await mkdtemp(join(tmpdir(), "orbyn-published-diagrams-"));
process.env.FILES_SECRET =
  "publication-diagrams-test-files-secret-at-least-32-characters";
process.env.FILES_DIR = dir;
process.env.PAGE_FILES_DIR = join(dir, "kept");
process.env.FILES_MIN_FREE_MB = "0";
const { startTestPdfService } = await import("./helpers/pdf-service.js");
const { renderPdfSnapshot, renderHtmlSnapshot } =
  await import("../src/modules/docs/pdf-renderer.js");
let beforeRender: (() => Promise<void>) | undefined;
let jobs = 0;
let lastInput = "";
const renderer = await startTestPdfService(
  renderPdfSnapshot,
  async (options) => {
    jobs++;
    lastInput = options.html;
    const action = beforeRender;
    beforeRender = undefined;
    if (action) await action();
    return renderHtmlSnapshot(options);
  },
);
const { buildApp } = await import("../src/app.js");
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { env } = await import("../src/config/env.js");
const core = await import("@orbyn/core");
const app = await buildApp();
const h = helpers(app);
let token = "";
let address = 0;
const call = (
  method: "GET" | "PUT" | "POST" | "DELETE",
  url: string,
  payload?: unknown,
  auth = true,
  cookie?: string,
) =>
  app.inject({
    method,
    url,
    remoteAddress: `10.86.0.${address++ % 250}`,
    headers: {
      ...(auth ? { authorization: `Bearer ${token}` } : {}),
      ...(cookie ? { cookie } : {}),
    },
    ...(payload !== undefined ? { payload } : {}),
  });
const diagram = {
  type: "code",
  lang: "mermaid",
  text: "flowchart LR\nA[Review] --> B[Result]",
};
before(async () => {
  await migrate();
  env.FILES_URL = await app.listen({ host: "127.0.0.1", port: 0 });
  token = (await h.register("publication-renderer")).token;
});
after(async () => {
  const { closeLive } = await import("../src/modules/docs/live.js");
  await closeLive();
  await app.close();
  await renderer.close();
  await pool.end();
  await rm(dir, { recursive: true, force: true });
});
async function fixture(
  content: unknown[] = [diagram],
  password?: string,
  place: { team_id?: string; folder_id?: string } = {},
) {
  const created = await call("POST", "/docs", {
    title: "Published diagram",
    content,
    ...place,
  });
  assert.equal(created.statusCode, 201, created.body);
  const doc = created.json();
  const slug = `diagrams-${randomUUID().slice(0, 8)}`;
  const published = await call("PUT", `/docs/${doc.id}/publish`, {
    slug,
    ...(password ? { password } : {}),
  });
  assert.equal(published.statusCode, 200, published.body);
  return { ...doc, slug, path: `/p/${slug}` };
}
async function unlock(path: string, password: string) {
  const response = await call("POST", `${path}/unlock`, { password }, false);
  assert.equal(response.statusCode, 303, response.body);
  return String(response.headers["set-cookie"]).split(";")[0];
}

test("plain publication keeps working without starting a private renderer job", async () => {
  const before = jobs;
  const doc = await fixture([
    { type: "paragraph", text: "Plain published notes" },
  ]);
  const response = await call("GET", doc.path, undefined, false);
  assert.equal(response.statusCode, 200, response.body);
  assert.match(response.body, /Plain published notes/);
  assert.equal(jobs, before);
});

test("published pages render all ten Mermaid families as inert images with math and retained source", async () => {
  const doc = await fixture([
    { type: "math", text: "\\frac{a}{b}" },
    ...mermaidFixtures.flatMap((item) => [
      { type: "heading", level: 2, text: item.kind },
      { type: "code", lang: "mermaid", text: item.source },
    ]),
  ]);
  const response = await call("GET", doc.path, undefined, false);
  assert.equal(response.statusCode, 200, response.body.slice(0, 300));
  const svgs = [
    ...response.body.matchAll(
      /src="data:image\/svg\+xml;charset=utf-8,([^"]+)"/g,
    ),
  ].map((m) => decodeURIComponent(m[1]));
  assert.equal(svgs.length, 10);
  assert.equal(
    (response.body.match(/<summary>Diagram source<\/summary>/g) ?? []).length,
    10,
  );
  assert.doesNotMatch(
    response.body,
    /<script|<iframe|data-orbyn-publication-diagram=|Diagram rendering unavailable/,
  );
  assert.match(response.body, /<math/);
  for (const item of mermaidFixtures)
    assert.match(response.body, new RegExp(item.kind));
  assert.equal(response.headers["cache-control"], "no-store");
  assert.match(
    String(response.headers["content-security-policy"]),
    /img-src 'self' data:/,
  );
  assert.match(
    String(response.headers["content-security-policy"]),
    /form-action 'self'/,
  );
  assert.doesNotMatch(
    String(response.headers["content-security-policy"]),
    /script-src 'unsafe-inline'/,
  );
});

test("password forms and authorized live publication media stay outside the private diagram snapshot", async () => {
  const doc = await fixture([diagram], "read secret");
  const locked = await call("GET", doc.path, undefined, false);
  assert.equal(locked.statusCode, 401, locked.body);
  assert.match(locked.body, /<form/);
  const png = await readFile(
    new URL("./fixtures/export-picture.png", import.meta.url),
  );
  const file = await call("POST", `/docs/${doc.id}/files`, {
    name: "figure.png",
    bytes: png.length,
    width: 640,
    height: 240,
  });
  assert.equal(file.statusCode, 201, file.body);
  const uploaded = await app.inject({
    method: "PUT",
    url: file.json().upload_path,
    headers: {
      "content-type": "image/png",
      "content-length": String(png.length),
    },
    payload: png,
  });
  assert.equal(uploaded.statusCode, 201, uploaded.body);
  const saved = await call("PUT", `/docs/${doc.id}`, {
    version: doc.version,
    content: [
      diagram,
      { type: "image", file: file.json().file.id, text: "Published figure" },
    ],
  });
  assert.equal(saved.statusCode, 200, saved.body);
  const cookie = await unlock(doc.path, "read secret");
  const response = await call("GET", doc.path, undefined, false, cookie);
  assert.equal(response.statusCode, 200, response.body.slice(0, 300));
  assert.doesNotMatch(lastInput, /<form|\/p\/|\/files\/|data:image\/png/);
  const url = /src="(\/p\/[^" ]+\/media\/[^" ]+)"/.exec(response.body)?.[1];
  assert.ok(url, "public raster image URL must remain available");
  assert.equal((await call("GET", url, undefined, false)).statusCode, 401);
  const media = await call("GET", url, undefined, false, cookie);
  assert.equal(media.statusCode, 200, media.body);
  assert.deepEqual(media.rawPayload, png);
});

for (const mode of ["unpublish", "trash", "edit", "password"] as const)
  test(`published snapshot is refused after ${mode} while rendering`, async () => {
    const doc = await fixture(
      [diagram, { type: "paragraph", text: "Original publication body" }],
      mode === "password" ? "initial secret" : undefined,
    );
    const cookie =
      mode === "password"
        ? await unlock(doc.path, "initial secret")
        : undefined;
    beforeRender = async () => {
      const response =
        mode === "unpublish"
          ? await call("DELETE", `/docs/${doc.id}/publish`)
          : mode === "trash"
            ? await call("DELETE", `/docs/${doc.id}`)
            : mode === "password"
              ? await call("PUT", `/docs/${doc.id}/publish`, {
                  password: "replacement secret",
                })
              : await call("PUT", `/docs/${doc.id}`, {
                  version: doc.version,
                  content: [{ type: "paragraph", text: "New revision" }],
                });
      assert.ok(response.statusCode < 300, response.body);
    };
    const response = await call("GET", doc.path, undefined, false, cookie);
    assert.equal(
      response.statusCode,
      mode === "password" ? 401 : mode === "edit" ? 409 : 404,
      response.body,
    );
    assert.equal(response.headers["cache-control"], "no-store");
    assert.doesNotMatch(
      response.body,
      /Original publication body|data:image\/svg/,
    );
  });

test("publication link privacy is rechecked after diagram rendering", async () => {
  const target = await fixture([
    { type: "paragraph", text: "Linked public notes" },
  ]);
  const source = await fixture([
    diagram,
    {
      type: "paragraph",
      text: core.linkMarkdown(
        { kind: "doc", id: target.id },
        "Target title must disappear",
      ),
    },
  ]);
  beforeRender = async () => {
    assert.equal(
      (await call("DELETE", `/docs/${target.id}/publish`)).statusCode,
      200,
    );
  };
  const response = await call("GET", source.path, undefined, false);
  assert.equal(response.statusCode, 409, response.body);
  assert.doesNotMatch(
    response.body,
    /Target title must disappear|data:image\/svg/,
  );
});

test("team publication policy is rechecked after diagram rendering", async () => {
  const team = (
    await call("POST", "/teams", { name: "Published diagram team" })
  ).json().id;
  const doc = await fixture([diagram], undefined, { team_id: team });
  beforeRender = async () => {
    assert.equal(
      (await call("PUT", `/teams/${team}/publishing`, { allowed: false }))
        .statusCode,
      200,
    );
  };
  const response = await call("GET", doc.path, undefined, false);
  assert.equal(response.statusCode, 404, response.body);
  assert.doesNotMatch(response.body, /data:image\/svg/);
});

test("a folder child moved out during rendering cannot return its old published body", async () => {
  const folder = (
    await call("POST", "/folders", { name: "Published diagrams folder" })
  ).json().id;
  const doc = await fixture([diagram], undefined, { folder_id: folder });
  assert.equal(
    (await call("DELETE", `/docs/${doc.id}/publish`)).statusCode,
    200,
  );
  const slug = `diagram-folder-${randomUUID().slice(0, 8)}`;
  assert.equal(
    (await call("PUT", `/folders/${folder}/publish`, { slug })).statusCode,
    200,
  );
  beforeRender = async () => {
    assert.equal(
      (
        await call("PUT", `/docs/${doc.id}`, {
          version: doc.version,
          folder_id: null,
        })
      ).statusCode,
      200,
    );
  };
  const response = await call("GET", `/p/${slug}/${doc.id}`, undefined, false);
  assert.equal(response.statusCode, 404, response.body);
  assert.doesNotMatch(response.body, /data:image\/svg/);
});

test("invalid diagram preserves an explicit unavailable result and escaped source", async () => {
  const doc = await fixture([
    {
      type: "code",
      lang: "mermaid",
      text: "not a diagram <script>alert(1)</script>",
    },
  ]);
  const response = await call("GET", doc.path, undefined, false);
  assert.equal(response.statusCode, 200, response.body);
  assert.match(response.body, /Diagram rendering unavailable; source retained/);
  assert.match(response.body, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(response.body, /<script/);
});

test("folder navigation changed while a child renders cannot return stale titles", async () => {
  const folder = (
    await call("POST", "/folders", { name: "Navigation fixture" })
  ).json().id;
  const doc = await fixture([diagram], undefined, { folder_id: folder });
  await call("DELETE", `/docs/${doc.id}/publish`);
  const sibling = (
    await call("POST", "/docs", {
      title: "Old navigation title",
      folder_id: folder,
      content: [],
    })
  ).json();
  const slug = `navigation-${randomUUID().slice(0, 8)}`;
  assert.equal(
    (await call("PUT", `/folders/${folder}/publish`, { slug })).statusCode,
    200,
  );
  beforeRender = async () => {
    assert.equal(
      (
        await call("PUT", `/docs/${sibling.id}`, {
          version: sibling.version,
          title: "Changed navigation title",
        })
      ).statusCode,
      200,
    );
  };
  const response = await call("GET", `/p/${slug}/${doc.id}`, undefined, false);
  assert.equal(response.statusCode, 409, response.body);
  assert.equal(response.headers["cache-control"], "no-store");
  assert.doesNotMatch(response.body, /Old navigation title|data:image\/svg/);
});
