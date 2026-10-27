import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { transformSync } from "esbuild";
const code = transformSync(
  readFileSync(
    new URL("../src/modules/documents/latex-renderer.ts", import.meta.url),
    "utf8",
  ),
  { loader: "ts", format: "cjs" },
).code;
const source =
  "\\documentclass{article}\\begin{document}Fixture\\end{document}";
for (const mode of [
  "success",
  "unavailable",
  "failure",
  "timeout",
  "cancel",
  "invalid-pdf",
] as const) {
  test(`LaTeX job ${mode} cleans its workspace and bounds the child lifecycle`, async () => {
    const parent = await fs.mkdtemp(join(tmpdir(), "orbyn-renderer-test-"));
    let passes = 0,
      kills = 0,
      timer: (() => void) | undefined;
    const controller = new AbortController();
    const module = { exports: {} as any };
    const spawn = (command: string, args: string[], options: any) => {
      passes++;
      assert.equal(command, "/usr/bin/bwrap");
      assert.ok(args.includes("--unshare-all"));
      assert.ok(args.includes("-no-shell-escape"));
      assert.ok(args.includes("--clearenv"));
      assert.ok(args.includes("--cpu=10"));
      assert.ok(args.includes("--as=536870912"));
      assert.equal(options.detached, true);
      const child = new EventEmitter() as EventEmitter & { pid: number };
      child.pid = 12345;
      queueMicrotask(async () => {
        if (mode === "unavailable") {
          child.emit("error", Error("missing bwrap"));
          return;
        }
        if (mode === "failure") {
          child.emit("exit", 1);
          return;
        }
        if (mode === "timeout") {
          timer!();
          child.emit("exit", null);
          return;
        }
        if (mode === "cancel") {
          controller.abort();
          child.emit("exit", null);
          return;
        }
        await fs.writeFile(
          join(options.cwd, "document.pdf"),
          mode === "invalid-pdf" ? "not PDF" : "%PDF-1.7\nfixture",
        );
        child.emit("exit", 0);
      });
      return child;
    };
    runInNewContext(code, {
      module,
      exports: module.exports,
      Buffer,
      process: {
        kill: (pid: number, signal: string) => {
          assert.equal(pid, -12345);
          assert.equal(signal, "SIGKILL");
          kills++;
        },
      },
      setTimeout: (callback: () => void, ms: number) => {
        assert.equal(ms, 12500);
        timer = callback;
        return 1;
      },
      clearTimeout: () => {
        timer = undefined;
      },
      require: (name: string) => {
        if (name === "node:child_process") return { spawn };
        if (name === "node:fs/promises") return fs;
        if (name === "node:os") return { tmpdir: () => parent };
        if (name === "node:path") return { join };
        throw Error(name);
      },
    });
    try {
      const running = module.exports.renderLatexSnapshot({
        html: source,
        executable: "ignored",
        signal: controller.signal,
      });
      if (mode === "success") {
        assert.equal((await running).subarray(0, 5).toString(), "%PDF-");
        assert.equal(passes, 2);
      } else
        await assert.rejects(
          running,
          mode === "unavailable"
            ? /unavailable/
            : mode === "invalid-pdf"
              ? /Invalid LaTeX PDF/
              : /compilation failed/,
        );
      if (mode === "timeout" || mode === "cancel") assert.equal(kills, 1);
      assert.deepEqual(
        await fs.readdir(parent),
        [],
        "success and every failed lifecycle remove private job files",
      );
    } finally {
      await fs.rm(parent, { recursive: true, force: true });
    }
  });
}
test("LaTeX renderer rejects source byte limit and pre-cancellation before making a job", async () => {
  const { renderLatexSnapshot } =
    await import("../src/modules/documents/latex-renderer.js");
  await assert.rejects(
    renderLatexSnapshot({ html: "é".repeat(140000), executable: "ignored" }),
    /too large/,
  );
  await assert.rejects(
    renderLatexSnapshot({
      html: source,
      executable: "ignored",
      signal: AbortSignal.abort(),
    }),
    /cancelled/,
  );
});
