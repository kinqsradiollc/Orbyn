import { test } from "node:test";
import assert from "node:assert/strict";
import { createChatgptForegroundRuntime } from "@orbyn/api-client";
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
function fixture() {
  const scheduled = new Map<
    object,
    { delay: number; run: () => Promise<void> }
  >();
  const events: string[] = [];
  const signals: AbortSignal[] = [];
  let exists = true,
    fail = false;
  let factory: () => Promise<any> = async () => ({
    start: async (signal: AbortSignal) => {
      signals.push(signal);
      events.push("start");
      return {
        selection: { connection_id: "connection", executor_id: "executor" },
      };
    },
    heartbeat: async () => {
      events.push("heartbeat");
      if (fail) throw new Error("failure");
    },
    executeNext: async () => {
      events.push("inference");
    },
    close: () => events.push("close"),
  });
  const runtime = createChatgptForegroundRuntime({
    available: async () => exists,
    create: async () => factory(),
    schedule: ((run: any, delay: number) => {
      const timer = {};
      scheduled.set(timer, { delay, run });
      return timer;
    }) as any,
    cancel: ((timer: object) => {
      scheduled.delete(timer);
    }) as any,
  });
  const owner = { userId: "owned", token: "private-session", foreground: true };
  return {
    runtime,
    scheduled,
    events,
    signals,
    owner,
    setExists: (value: boolean) => {
      exists = value;
    },
    setFail: () => {
      fail = true;
    },
    setFactory: (value: typeof factory) => {
      factory = value;
    },
    tick: async (delay: number) => {
      const entry = [...scheduled].find(([, task]) => task.delay === delay)!;
      scheduled.delete(entry[0]);
      await entry[1].run();
    },
  };
}
test("foreground lifecycle starts once and runs independent lease and claim timers", async () => {
  const f = fixture();
  f.runtime.update(f.owner);
  await flush();
  assert.equal(f.runtime.snapshot().status, "ready");
  f.runtime.update(f.owner);
  await flush();
  assert.deepEqual(f.events, ["start"]);
  await f.tick(25000);
  await f.tick(10000);
  assert.deepEqual(f.events, ["start", "heartbeat", "inference"]);
  assert.equal(f.scheduled.size, 2);
  assert.ok(!JSON.stringify(f.runtime.snapshot()).includes("private-session"));
  f.runtime.close();
});
test("suspension and sign-out cancel timers, abort work and close the owned executor", async () => {
  const f = fixture();
  f.runtime.update(f.owner);
  await flush();
  f.runtime.update({ ...f.owner, foreground: false });
  assert.equal(f.scheduled.size, 0);
  assert.equal(f.signals[0].aborted, true);
  assert.equal(f.runtime.snapshot().status, "paused");
  f.runtime.update(f.owner);
  await flush();
  assert.equal(f.runtime.snapshot().status, "ready");
  f.runtime.update({ userId: "", token: "", foreground: true });
  assert.equal(f.scheduled.size, 0);
  assert.equal(f.runtime.snapshot().status, "idle");
  assert.equal(f.events.filter((v) => v === "close").length, 2);
  f.runtime.close();
});
test("late factory completion cannot activate an executor for a replaced session", async () => {
  const f = fixture();
  let resolve!: (value: any) => void;
  f.setFactory(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  f.runtime.update(f.owner);
  await flush();
  f.runtime.update({ ...f.owner, token: "replacement", foreground: false });
  let closed = 0,
    started = 0;
  resolve({
    close: () => closed++,
    start: async () => {
      started++;
    },
  });
  await flush();
  assert.equal(closed, 1);
  assert.equal(started, 0);
  assert.equal(f.scheduled.size, 0);
  f.runtime.close();
});
test("terminal runtime errors stop all work and require explicit restart", async () => {
  const f = fixture();
  f.runtime.update(f.owner);
  await flush();
  f.setFail();
  await f.tick(25000);
  assert.equal(f.runtime.snapshot().status, "error");
  assert.equal(f.scheduled.size, 0);
  assert.equal(f.signals[0].aborted, true);
  f.runtime.restart();
  await flush();
  assert.equal(f.runtime.snapshot().status, "ready");
  f.runtime.close();
});
test("no protected registration starts no runtime and emits no private error", async () => {
  const f = fixture();
  f.setExists(false);
  f.runtime.update(f.owner);
  await flush();
  assert.deepEqual(f.events, []);
  assert.equal(f.scheduled.size, 0);
  assert.equal(f.runtime.snapshot().status, "idle");
  f.runtime.close();
});
