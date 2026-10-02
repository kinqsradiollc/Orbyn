import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import {
  EXPORT_FORMATS,
  EXPORT_LABELS,
  docToHtml,
  type ExportFormat,
} from "@orbyn/core";
import { createMathHtml } from "../src/lib/math-html.js";

const compiled = ts.transpileModule(
  readFileSync(
    new URL("../../mobile/src/lib/download.ts", import.meta.url),
    "utf8",
  ),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  },
).outputText;

function mount(
  platform: string,
  options: {
    available?: boolean;
    blob?: Blob;
    exportError?: Error;
    clickError?: Error;
    writeError?: Error;
    shareError?: Error;
  } = {},
) {
  const exports: {
    formatsHere(): ExportFormat[];
    downloadDoc(id: string, format: ExportFormat): Promise<void>;
    saveFile(name: string, data: Blob | string, type: string): Promise<void>;
    downloadLabel(format: ExportFormat): string;
    takeAwayLabel(): string;
  } = {} as never;
  const requests: { id: string; format: ExportFormat }[] = [];
  const files: {
    name: string;
    bytes?: Uint8Array | string;
    overwrite?: boolean;
  }[] = [];
  const shared: { uri: string; mimeType: string; dialogTitle: string }[] = [];
  const texts: { title: string; message: string }[] = [];
  const links: { href: string; download: string }[] = [];
  const revoked: string[] = [];
  const urls: Blob[] = [];
  const File = class {
    uri: string;
    entry: (typeof files)[number];
    constructor(_path: unknown, name: string) {
      this.uri = `cache:///${name}`;
      this.entry = { name };
      files.push(this.entry);
    }
    create({ overwrite }: { overwrite: boolean }) {
      this.entry.overwrite = overwrite;
    }
    write(bytes: Uint8Array | string) {
      if (options.writeError) throw options.writeError;
      this.entry.bytes = bytes;
    }
  };
  runInNewContext(compiled, {
    exports,
    Blob,
    Uint8Array,
    document: {
      createElement(kind: string) {
        assert.equal(kind, "a");
        const a = {
          href: "",
          download: "",
          click() {
            if (options.clickError) throw options.clickError;
            links.push({ href: a.href, download: a.download });
          },
        };
        return a;
      },
    },
    URL: {
      createObjectURL(blob: Blob) {
        urls.push(blob);
        return "blob:export";
      },
      revokeObjectURL(url: string) {
        revoked.push(url);
      },
    },
    require(id: string) {
      if (id === "react-native")
        return {
          Platform: { OS: platform },
          Share: {
            async share(data: (typeof texts)[number]) {
              texts.push(data);
            },
          },
        };
      if (id === "@orbyn/core") return { EXPORT_FORMATS, EXPORT_LABELS };
      if (id === "./api")
        return {
          client: {
            async exportDoc(id: string, format: ExportFormat) {
              requests.push({ id, format });
              if (options.exportError) throw options.exportError;
              return {
                name: `Page.${format}`,
                blob:
                  options.blob ??
                  new Blob([`body:${format}`], {
                    type: EXPORT_LABELS[format].type,
                  }),
              };
            },
          },
        };
      if (id === "expo-file-system") return { File, Paths: { cache: "cache" } };
      if (id === "expo-sharing")
        return {
          async isAvailableAsync() {
            return options.available ?? true;
          },
          async shareAsync(
            uri: string,
            data: Omit<(typeof shared)[number], "uri">,
          ) {
            if (options.shareError) throw options.shareError;
            shared.push({ uri, ...data });
          },
        };
      throw new Error(`Unexpected module ${id}`);
    },
  });
  return { api: exports, requests, files, shared, texts, links, revoked, urls };
}

for (const platform of ["web", "ios", "android"]) {
  test(`${platform} exposes the shared export catalog and preserves every file`, async () => {
    const f = mount(platform);
    assert.deepEqual([...f.api.formatsHere()], [...EXPORT_FORMATS]);
    f.api.formatsHere().pop();
    assert.deepEqual([...f.api.formatsHere()], [...EXPORT_FORMATS]);
    for (const format of EXPORT_FORMATS)
      await f.api.downloadDoc("page-id", format);
    assert.deepEqual(
      f.requests.map((r) => r.format),
      [...EXPORT_FORMATS],
    );
    assert.ok(f.requests.every((r) => r.id === "page-id"));
    for (const [i, format] of EXPORT_FORMATS.entries()) {
      assert.equal(
        f.api.downloadLabel(format),
        platform === "web"
          ? EXPORT_LABELS[format].name
          : `Share as ${EXPORT_LABELS[format].name}`,
      );
      if (platform === "web") {
        assert.equal(await f.urls[i].text(), `body:${format}`);
        assert.equal(f.links[i].download, `Page.${format}`);
        assert.equal(f.revoked[i], "blob:export");
      } else {
        assert.equal(
          new TextDecoder().decode(f.files[i].bytes as Uint8Array),
          `body:${format}`,
        );
        assert.equal(f.files[i].overwrite, true);
        assert.equal(f.shared[i].mimeType, EXPORT_LABELS[format].type);
        assert.equal(f.shared[i].uri, `cache:///Page.${format}`);
      }
    }
    assert.equal(
      f.api.takeAwayLabel(),
      platform === "web" ? "Download…" : "Share…",
    );
  });

  test(`${platform} preserves real HTML MathML through the download/share utility`, async () => {
    const html = docToHtml(
      "Equation",
      [{ id: "m", type: "math", text: "\\frac{a}{b}" }],
      { math: createMathHtml() },
    );
    assert.match(html, /<mfrac>/);
    const f = mount(platform, {
      blob: new Blob([html], { type: "text/html" }),
    });
    await f.api.downloadDoc("page-id", "html");
    const saved =
      platform === "web"
        ? await f.urls[0].text()
        : new TextDecoder().decode(f.files[0].bytes as Uint8Array);
    assert.equal(saved, html);
    assert.match(saved, /application\/x-tex/);
  });
}

test("missing blob MIME uses the selected export format on native sharing", async () => {
  const f = mount("ios", { blob: new Blob(["<html>page</html>"]) });
  await f.api.downloadDoc("page-id", "html");
  assert.equal(f.shared[0].mimeType, "text/html");
});

test("native cache file names cannot contain path separators", async () => {
  const f = mount("android");
  await f.api.saveFile("../A/B\\C:*.html", "page", "text/html");
  assert.equal(f.files[0].name, "..-A-B-C-.html");
  assert.equal(f.shared[0].dialogTitle, "../A/B\\C:*.html");
});

test("API authorization and rate-limit errors reach the caller without saving a file", async () => {
  for (const status of [400, 401, 403, 404, 429]) {
    const error = Object.assign(new Error("Export failed"), { status });
    const f = mount("ios", { exportError: error });
    await assert.rejects(
      f.api.downloadDoc("page-id", "html"),
      (actual) => actual === error,
    );
    assert.equal(f.files.length, 0);
    assert.equal(f.shared.length, 0);
  }
});

test("web download failures revoke the allocated blob URL", async () => {
  const error = new Error("Download blocked");
  const f = mount("web", { clickError: error });
  await assert.rejects(
    f.api.downloadDoc("page-id", "html"),
    (actual) => actual === error,
  );
  assert.deepEqual(f.revoked, ["blob:export"]);
});

test("native write and share failures reach the caller", async () => {
  for (const stage of ["writeError", "shareError"] as const) {
    const error = new Error(`${stage} failed`);
    const f = mount("android", { [stage]: error });
    await assert.rejects(
      f.api.downloadDoc("page-id", "html"),
      (actual) => actual === error,
    );
    assert.equal(f.shared.length, 0);
  }
});

test("unavailable native binary sharing reports a failure instead of success", async () => {
  const f = mount("ios", { available: false });
  await assert.rejects(
    f.api.downloadDoc("page-id", "html"),
    /File sharing is unavailable/,
  );
  assert.equal(f.shared.length, 0);
  assert.equal(f.texts.length, 0);
});

test("native string exports keep the text-share fallback when file sharing is unavailable", async () => {
  const f = mount("android", { available: false });
  await f.api.saveFile("Page.md", "# A page", "text/markdown");
  assert.equal(f.texts[0].message, "# A page");
  assert.equal(f.texts[0].title, "Page.md");
});
