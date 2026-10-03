import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { ChildProcess } from "node:child_process";
import { pdfBrowserPipe } from "../src/modules/docs/pdf-browser.js";

function fixture(timeout = 1000) {
  const child = new EventEmitter() as EventEmitter & {
    stdio: unknown[];
    kill: () => void;
  };
  const input = new PassThrough(),
    output = new PassThrough();
  const commands: Record<string, unknown>[] = [];
  let kills = 0;
  input.on("data", (value) =>
    commands.push(JSON.parse(value.toString().slice(0, -1))),
  );
  child.stdio = [null, null, null, input, output];
  child.kill = () => {
    kills++;
    child.emit("exit", 0);
  };
  const pipe = pdfBrowserPipe(child as unknown as ChildProcess, timeout);
  return { pipe, commands, output, kills: () => kills };
}

test("PDF pipe correlates out-of-order results and preserves split UTF8 messages", async () => {
  const view = fixture();
  const one = view.pipe.command("One"),
    two = view.pipe.command("Two", {}, "private-session");
  assert.equal(view.commands[1].sessionId, "private-session");
  const data = Buffer.from(
    JSON.stringify({ id: 2, result: { text: "Unicode λ 😀" } }) + "\0",
  );
  for (const byte of data) view.output.write(Buffer.from([byte]));
  view.output.write(JSON.stringify({ id: 1, result: { ok: true } }) + "\0");
  assert.deepEqual(await two, { text: "Unicode λ 😀" });
  assert.deepEqual(await one, { ok: true });
  await view.pipe.close();
  assert.equal(view.kills(), 1);
});

test("PDF protocol errors are generic and never expose source content", async () => {
  const view = fixture();
  const request = view.pipe.command("Print");
  view.output.write(
    JSON.stringify({
      id: 1,
      error: { message: "private source and credentials" },
    }) + "\0",
  );
  await assert.rejects(
    request,
    /^Error: The document PDF renderer is unavailable\.$/,
  );
  await view.pipe.close();
});

test("malformed browser output closes the process and rejects every pending action", async () => {
  const view = fixture();
  const one = view.pipe.command("One"),
    two = view.pipe.command("Two");
  view.output.write("malformed\0");
  await Promise.all([assert.rejects(one), assert.rejects(two)]);
  assert.equal(view.kills(), 1);
  await assert.rejects(view.pipe.command("After close"));
});

test("PDF pipe timeout terminates its owned process and clears pending work", async () => {
  const view = fixture(5);
  await assert.rejects(view.pipe.command("Never answers"), /timed out/);
  assert.equal(view.kills(), 1);
  await view.pipe.close();
  assert.equal(view.kills(), 1);
});

test("PDF pipe bounds pending requests and drops unknown response IDs", async () => {
  const view = fixture();
  const requests = Array.from({ length: 16 }, (_, i) =>
    view.pipe.command(`Call${i}`),
  );
  const rejected = requests.map((request) => assert.rejects(request));
  await assert.rejects(view.pipe.command("Seventeenth"));
  view.output.write(JSON.stringify({ id: 99, result: "unowned" }) + "\0");
  await view.pipe.close();
  await Promise.all(rejected);
  assert.equal(view.kills(), 1);
});
