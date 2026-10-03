import { existsSync } from "node:fs";
import { buildPdfService } from "../../src/modules/docs/pdf-service.js";
import {
  renderPdfSnapshot,
  renderHtmlSnapshot,
} from "../../src/modules/docs/pdf-renderer.js";

/** Each integration test process owns an actual private renderer and independent test key. */
export async function startTestPdfService(
  render = renderPdfSnapshot,
  renderHtml = renderHtmlSnapshot,
) {
  const executable =
    process.env.PDF_TEST_CHROME ??
    [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/usr/bin/google-chrome",
      "/usr/bin/chromium",
    ].find(existsSync);
  if (!executable)
    throw new Error(
      "Set PDF_TEST_CHROME to a sandboxed Chromium executable for actual export integration checks.",
    );
  const key = "export-test-private-renderer-key-at-least-32-characters";
  const service = buildPdfService({ key, executable, render, renderHtml });
  process.env.DOC_PDF_URL = await service.listen({
    host: "127.0.0.1",
    port: 0,
  });
  process.env.DOC_PDF_KEY = key;
  return service;
}
