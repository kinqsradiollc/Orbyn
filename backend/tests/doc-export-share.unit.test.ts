import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as React from "react";
import * as core from "@orbyn/core";

function fixture(share?: () => Promise<void>) {
  const source = readFileSync(
    new URL("../../desktop/src/components/ShareButton.tsx", import.meta.url),
    "utf8",
  );
  const requests: { version?: number }[] = [],
    downloads: string[] = [];
  let complete: (() => void) | undefined;
  let wait = false;
  const modules: Record<string, unknown> = {
    react: { useState: () => [{}, () => {}] },
    "lucide-react": new Proxy({}, { get: () => () => null }),
    "@orbyn/core": core,
    "../lib/api": {
      client: {
        async exportDoc(
          _id: string,
          _format: string,
          options: { version?: number },
        ) {
          requests.push(options);
          if (wait)
            await new Promise<void>((resolve) => {
              complete = resolve;
            });
          return { blob: new Blob(["Saved"]), name: "Page.md" };
        },
      },
    },
    "./Popover": { Popover: "popover" },
  };
  const exports: Record<string, any> = {};
  runInNewContext(
    ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.React,
      },
    }).outputText,
    {
      exports,
      React,
      Error,
      File,
      Blob,
      navigator: { canShare: () => true, share: share ?? (async () => {}) },
      URL: { createObjectURL: () => "blob:fixture", revokeObjectURL() {} },
      document: {
        createElement: () => ({
          click: () => downloads.push("clicked"),
          href: "",
          download: "",
        }),
      },
      setTimeout: (callback: () => void) => callback(),
      require(name: string) {
        assert.ok(name in modules, name);
        return modules[name];
      },
    },
  );
  return {
    exports,
    requests,
    downloads,
    wait: () => {
      wait = true;
    },
    complete: () => complete!(),
  };
}

test("web file sharing carries the expected revision and aborts before handoff after a scope change", async () => {
  let shares = 0;
  const f = fixture(async () => {
    shares++;
  });
  const controller = new AbortController();
  f.wait();
  const pending = f.exports.sharePageFile("page", "md", "Page", {
    version: 7,
    signal: controller.signal,
  });
  assert.equal(f.requests[0].version, 7);
  controller.abort();
  f.complete();
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(shares, 0);
  assert.equal(f.downloads.length, 0);
});

test("a browser share failure cannot download a closed editor's file as fallback", async () => {
  const controller = new AbortController();
  const f = fixture(async () => {
    controller.abort();
    throw Object.assign(new Error("Tap expired"), { name: "NotAllowedError" });
  });
  await assert.rejects(
    f.exports.sharePageFile("page", "pdf", "Page", {
      version: 7,
      signal: controller.signal,
    }),
    { name: "AbortError" },
  );
  assert.equal(f.downloads.length, 0);
});

function action(
  node: React.ReactNode,
  title: string,
): (() => void) | undefined {
  if (!React.isValidElement(node)) return;
  const props = node.props as {
    onClick?: () => void;
    children?: React.ReactNode;
  };
  const children = React.Children.toArray(props.children);
  if (
    children.some(
      (child) => typeof child === "string" && child.trim() === title,
    )
  )
    return props.onClick;
  return children.map((child) => action(child, title)).find(Boolean);
}

test("both web share menu file actions invoke the editor guard callback", async () => {
  const f = fixture();
  const formats: string[] = [];
  const tree = f.exports.SharePageButton({
    docId: "page",
    title: "Page",
    onError: (error: unknown) => {
      throw error;
    },
    onShareFile: async (format: string) => {
      formats.push(format);
    },
  });
  action(tree, "Markdown file")!();
  action(tree, "PDF file")!();
  await Promise.resolve();
  assert.deepEqual(formats, ["md", "pdf"]);
  assert.equal(
    f.requests.length,
    0,
    "The menu must not bypass the editor callback to fetch a saved file directly.",
  );
});
