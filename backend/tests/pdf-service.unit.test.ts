import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildPdfService,
  pdfRequestHeaders,
} from "../src/modules/docs/pdf-service.js";

const key = "test-only-document-pdf-key-at-least-32-characters";
const html = "<!doctype html><html><p>Authorized snapshot</p></html>";
const pdf = Buffer.from("%PDF-1.7\nfixture");
const inject = (
  app: ReturnType<typeof buildPdfService>,
  content = html,
  headers = pdfRequestHeaders(content, key),
) => app.inject({ method: "POST", url: "/render", payload: content, headers });

test("private PDF service authenticates exact content and rejects missing, forged, expired and replayed requests", async () => {
  let runs = 0;
  const app = buildPdfService({
    key,
    executable: "fixture",
    render: async ({ html: value }) => {
      assert.equal(value, html);
      runs++;
      return pdf;
    },
  });
  try {
    assert.equal(
      (await inject(app, html, {} as ReturnType<typeof pdfRequestHeaders>))
        .statusCode,
      401,
    );
    assert.equal(
      (
        await inject(
          app,
          html,
          pdfRequestHeaders(html, "wrong-secret-at-least-32-characters"),
        )
      ).statusCode,
      401,
    );
    assert.equal(
      (
        await inject(
          app,
          html,
          pdfRequestHeaders(html, key, Date.now() - 120000),
        )
      ).statusCode,
      401,
    );
    assert.equal(
      (await inject(app, html + "tampered", pdfRequestHeaders(html, key)))
        .statusCode,
      401,
    );
    const headers = pdfRequestHeaders(html, key);
    const result = await inject(app, html, headers);
    assert.equal(result.statusCode, 200);
    assert.deepEqual(result.rawPayload, pdf);
    assert.equal((await inject(app, html, headers)).statusCode, 409);
    assert.equal(runs, 1);
  } finally {
    await app.close();
  }
});

test("PDF service refuses concurrent work rather than creating an unbounded queue", async () => {
  let finish!: (value: Buffer) => void;
  let started!: () => void;
  const ready = new Promise<void>((done) => (started = done));
  let first = true;
  const app = buildPdfService({
    key,
    executable: "fixture",
    limit: 1,
    render: async () => {
      if (!first) return pdf;
      first = false;
      started();
      return new Promise<Buffer>((done) => (finish = done));
    },
  });
  try {
    const active = inject(app);
    await ready;
    const busy = await inject(app);
    assert.equal(busy.statusCode, 503);
    assert.equal(busy.headers["retry-after"], "5");
    finish(pdf);
    assert.equal((await active).statusCode, 200);
    assert.equal((await inject(app)).statusCode, 200);
  } finally {
    await app.close();
  }
});

test("renderer errors are generic and release the work slot", async () => {
  let first = true;
  const app = buildPdfService({
    key,
    executable: "fixture",
    limit: 1,
    render: async () => {
      if (first) {
        first = false;
        throw new Error("secret path and content");
      }
      return pdf;
    },
  });
  try {
    const failed = await inject(app);
    assert.equal(failed.statusCode, 503);
    assert.doesNotMatch(failed.body, /secret path/);
    assert.equal((await inject(app)).statusCode, 200);
  } finally {
    await app.close();
  }
});

test("renderer configuration cannot start without an independent key or bounded concurrency", () => {
  assert.throws(
    () => buildPdfService({ key: "", executable: "fixture" }),
    /configuration/,
  );
  assert.throws(
    () => buildPdfService({ key, executable: "fixture", limit: 5 }),
    /configuration/,
  );
});

test("query strings cannot bypass private renderer authentication or reservations", async () => {
  let runs = 0;
  const app = buildPdfService({
    key,
    executable: "fixture",
    render: async () => {
      runs++;
      return pdf;
    },
  });
  try {
    const forged = {
      ...pdfRequestHeaders(html, key),
      "x-orbyn-pdf-signature": "a".repeat(43),
    };
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/render?preview=1",
          headers: forged,
          payload: html,
        })
      ).statusCode,
      401,
    );
    assert.equal(runs, 0);
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/render?preview=1",
          headers: pdfRequestHeaders(html, key),
          payload: html,
        })
      ).statusCode,
      200,
    );
    assert.equal(runs, 1);
  } finally {
    await app.close();
  }
});

test("authentication precedes parsing and rejected bodies release reservations", async () => {
  const app = buildPdfService({
    key,
    executable: "fixture",
    limit: 1,
    render: async () => pdf,
  });
  try {
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/render",
          headers: { "content-type": "application/not-supported" },
          payload: "invalid",
        })
      ).statusCode,
      401,
    );
    const headers = {
      ...pdfRequestHeaders(html, key),
      "content-type": "application/not-supported",
    };
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/render",
          headers,
          payload: html,
        })
      ).statusCode,
      415,
    );
    assert.equal(
      (await inject(app, html + "tampered", pdfRequestHeaders(html, key)))
        .statusCode,
      401,
    );
    assert.equal((await inject(app)).statusCode, 200);
  } finally {
    await app.close();
  }
});

test("a future-dated signature remains replay-protected for its entire validity window", async (context) => {
  const origin = Date.now();
  let now = origin;
  context.mock.method(Date, "now", () => now);
  let runs = 0;
  const app = buildPdfService({
    key,
    executable: "fixture",
    render: async () => {
      runs++;
      return pdf;
    },
  });
  try {
    const headers = pdfRequestHeaders(html, key, origin + 45_000);
    assert.equal((await inject(app, html, headers)).statusCode, 200);
    now = origin + 65_000;
    assert.equal((await inject(app, html, headers)).statusCode, 409);
    now = origin + 105_001;
    assert.equal((await inject(app, html, headers)).statusCode, 401);
    assert.equal(runs, 1);
    assert.equal((await inject(app)).statusCode, 200);
    assert.equal(runs, 2);
  } finally {
    await app.close();
  }
});

test("HTML service binds signatures to output format and protects query-string routes", async () => {
  const portable =
    '<!doctype html><html><meta http-equiv="Content-Security-Policy" content="default-src none"><p>Rendered output</p></html>';
  let runs = 0;
  const app = buildPdfService({
    key,
    executable: "fixture",
    render: async () => pdf,
    renderHtml: async ({ html: value }) => {
      assert.equal(value, html);
      runs++;
      return portable;
    },
  });
  const send = (url: string, headers: ReturnType<typeof pdfRequestHeaders>) =>
    app.inject({ method: "POST", url, payload: html, headers });
  try {
    assert.equal(
      (await send("/render/html", {} as ReturnType<typeof pdfRequestHeaders>))
        .statusCode,
      401,
    );
    assert.equal(
      (await send("/render/html", pdfRequestHeaders(html, key))).statusCode,
      401,
    );
    const htmlSignature = pdfRequestHeaders(
      html,
      key,
      Date.now(),
      undefined,
      "html",
    );
    assert.equal((await send("/render", htmlSignature)).statusCode, 401);
    const good = await send("/render/html?extra=ignored", htmlSignature);
    assert.equal(good.statusCode, 200, good.body);
    assert.match(String(good.headers["content-type"]), /text\/html/);
    assert.equal(good.body, portable);
    assert.equal((await send("/render/html", htmlSignature)).statusCode, 409);
    assert.equal(runs, 1);
  } finally {
    await app.close();
  }
});

test("PDF and HTML share one bounded service concurrency pool", async () => {
  let finish: (value: Buffer) => void = () => {};
  let began: () => void = () => {};
  const started = new Promise<void>((resolve) => {
    began = resolve;
  });
  let htmlRuns = 0;
  const app = buildPdfService({
    key,
    executable: "fixture",
    limit: 1,
    render: async () => {
      began();
      return new Promise<Buffer>((resolve) => {
        finish = resolve;
      });
    },
    renderHtml: async () => {
      htmlRuns++;
      return html;
    },
  });
  const pending = inject(app).then((value) => value);
  try {
    await started;
    const busy = await app.inject({
      method: "POST",
      url: "/render/html",
      payload: html,
      headers: pdfRequestHeaders(html, key, Date.now(), undefined, "html"),
    });
    assert.equal(busy.statusCode, 503);
    assert.equal(busy.headers["retry-after"], "5");
    assert.equal(htmlRuns, 0);
    finish(pdf);
    assert.equal((await pending).statusCode, 200);
  } finally {
    finish(pdf);
    await pending;
    await app.close();
  }
});
