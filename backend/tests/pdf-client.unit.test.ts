import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { env } from "../src/config/env.js";
import {
  exportRenderedPdf,
  exportRenderedHtml,
} from "../src/modules/docs/pdf-client.js";
import { buildPdfService } from "../src/modules/docs/pdf-service.js";

const key = "client-test-private-renderer-key-at-least-32-characters";
const html = "<!doctype html><html><p>Authorized content</p></html>";
const bytes = Buffer.from("%PDF-1.7\nfixture");
function scope() {
  const request = { raw: new EventEmitter() };
  const reply = { raw: new EventEmitter() };
  return {
    request,
    reply,
    run: () =>
      exportRenderedPdf(
        html,
        request as Parameters<typeof exportRenderedPdf>[1],
        reply as Parameters<typeof exportRenderedPdf>[2],
      ),
  };
}
async function service(
  render: Parameters<typeof buildPdfService>[0]["render"],
  work: (url: string) => Promise<void>,
) {
  const app = buildPdfService({ key, executable: "fixture", render });
  const previous = [env.DOC_PDF_URL, env.DOC_PDF_KEY];
  env.DOC_PDF_URL = await app.listen({ host: "127.0.0.1", port: 0 });
  env.DOC_PDF_KEY = key;
  try {
    await work(env.DOC_PDF_URL);
  } finally {
    [env.DOC_PDF_URL, env.DOC_PDF_KEY] = previous;
    await app.close();
  }
}

test("API PDF client sends the exact signed snapshot and removes lifecycle listeners", async () => {
  await service(
    async ({ html: value }) => {
      assert.equal(value, html);
      return bytes;
    },
    async () => {
      const view = scope();
      assert.deepEqual(await view.run(), bytes);
      assert.equal(view.request.raw.listenerCount("aborted"), 0);
      assert.equal(view.reply.raw.listenerCount("close"), 0);
    },
  );
});

test("API cancellation aborts rendering on the private service and clears the slot", async () => {
  let start!: () => void;
  const ready = new Promise<void>((done) => (start = done));
  let cancelled!: () => void;
  const stopped = new Promise<void>((done) => (cancelled = done));
  await service(
    async ({ signal }) =>
      new Promise<Buffer>((done) => {
        start();
        signal!.addEventListener(
          "abort",
          () => {
            cancelled();
            done(bytes);
          },
          { once: true },
        );
      }),
    async () => {
      const view = scope();
      const running = view.run();
      await ready;
      view.request.raw.emit("aborted");
      await assert.rejects(running, /unavailable/);
      await stopped;
      assert.equal(view.request.raw.listenerCount("aborted"), 0);
      assert.equal(view.reply.raw.listenerCount("close"), 0);
    },
  );
});

test("API PDF client maps renderer errors to a generic failure with no partial file", async () => {
  await service(
    async () => {
      throw new Error("private source and browser path");
    },
    async () => {
      await assert.rejects(scope().run(), (error) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /unavailable/);
        assert.doesNotMatch(error.message, /private source|browser path/);
        return true;
      });
    },
  );
});

test("HTML client uses format-bound signing, validates portable output and removes listeners", async () => {
  const portable =
    '<!doctype html><html><meta http-equiv="Content-Security-Policy" content="default-src none"><p>Portable output</p></html>';
  const app = buildPdfService({
    key,
    executable: "fixture",
    renderHtml: async ({ html: value }) => {
      assert.equal(value, html);
      return portable;
    },
  });
  const previous = [env.DOC_PDF_URL, env.DOC_PDF_KEY];
  env.DOC_PDF_URL = await app.listen({ host: "127.0.0.1", port: 0 });
  env.DOC_PDF_KEY = key;
  const view = scope();
  try {
    assert.equal(
      await exportRenderedHtml(
        html,
        view.request as Parameters<typeof exportRenderedHtml>[1],
        view.reply as Parameters<typeof exportRenderedHtml>[2],
      ),
      portable,
    );
    assert.equal(view.request.raw.listenerCount("aborted"), 0);
    assert.equal(view.reply.raw.listenerCount("close"), 0);
  } finally {
    [env.DOC_PDF_URL, env.DOC_PDF_KEY] = previous;
    await app.close();
  }
});
