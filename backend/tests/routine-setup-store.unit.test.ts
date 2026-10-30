import { test } from "node:test";
import assert from "node:assert/strict";
import {
  HttpError,
  type AgentRoutine,
  type RoutineSetupInput,
} from "@orbyn/core";
import { RoutineSetupStore } from "@orbyn/api-client";
const id = "00000000-0000-4000-8000-000000000001",
  snapshot = "a".repeat(64);
const input = {
  instruction: "Review source notes",
  rrule: "FREQ=DAILY",
  timezone: "UTC",
  next_run_at: "2026-12-01T09:00:00.000Z",
};
const context = {
  approval_scopes: {},
  snapshot,
  max_run_tokens: 200000,
  can_preauthorize: true,
};
const routine = {
  ...input,
  id,
  user_id: id,
  paused: false,
  last_result: null,
  created_at: input.next_run_at,
  updated_at: input.next_run_at,
} satisfies AgentRoutine;
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
};
test("one reviewed command coalesces clicks and replays exact input after an unknown save", async () => {
  let calls: RoutineSetupInput[] = [],
    first = true;
  const pending = deferred<AgentRoutine>();
  const store = new RoutineSetupStore(
    {
      routineSetupContext: async () => context,
      setupAgentRoutine: async (command) => {
        calls.push(structuredClone(command));
        if (first) {
          first = false;
          throw new TypeError("lost response");
        }
        return pending.promise;
      },
    },
    input,
    () => id,
  );
  await store.load();
  store.select("pages", true);
  await store.save();
  assert.equal(store.getSnapshot().uncertain, true);
  store.select("tasks", true);
  assert.deepEqual(store.getSnapshot().selected, ["pages"]);
  const retry = store.save();
  assert.equal(store.save(), retry);
  pending.resolve(routine);
  assert.equal(await retry, routine);
  assert.deepEqual(calls[0], calls[1]);
  assert.equal(calls.length, 2);
  assert.equal(store.getSnapshot().uncertain, false);
  assert.equal(await store.save(), routine);
  assert.equal(calls.length, 2);
});
test("rejected stale permissions require fresh review while the immutable schedule is preserved", async () => {
  let reads = 0,
    ids = 0;
  const commands: RoutineSetupInput[] = [];
  const store = new RoutineSetupStore(
    {
      routineSetupContext: async () => ({
        ...context,
        snapshot: (++reads === 1 ? "a" : "b").repeat(64),
      }),
      setupAgentRoutine: async (command) => {
        commands.push(command);
        if (commands.length === 1) throw new HttpError(409, "changed");
        return routine;
      },
    },
    input,
    () => `00000000-0000-4000-8000-${String(++ids).padStart(12, "0")}`,
  );
  await store.load();
  store.select("pages", true);
  await store.save();
  assert.equal(store.getSnapshot().context, null);
  assert.equal(await store.save(), null);
  await store.load();
  assert.deepEqual(store.getSnapshot().selected, []);
  store.select("tasks", true);
  await store.save();
  assert.deepEqual(commands[0].routine, commands[1].routine);
  assert.notEqual(commands[0].request_id, commands[1].request_id);
  assert.equal(commands[1].expected_snapshot, "b".repeat(64));
});
test("failed permission reads erase prior evidence and cannot dispatch a save", async () => {
  let fail = false,
    calls = 0;
  const store = new RoutineSetupStore(
    {
      routineSetupContext: async () => {
        if (fail) throw new Error();
        return context;
      },
      setupAgentRoutine: async () => {
        calls++;
        return routine;
      },
    },
    input,
    () => id,
  );
  await store.load();
  fail = true;
  await store.load();
  assert.equal(store.getSnapshot().context, null);
  assert.equal(await store.save(), null);
  assert.equal(calls, 0);
});
test("an unavailable grant cannot be selected and unchanged permission settings are preserved", async () => {
  let sent: RoutineSetupInput | undefined;
  const store = new RoutineSetupStore(
    {
      routineSetupContext: async () => ({
        ...context,
        can_preauthorize: false,
      }),
      setupAgentRoutine: async (command) => {
        sent = command;
        return routine;
      },
    },
    input,
    () => id,
  );
  await store.load();
  store.select("tasks", true);
  await store.save();
  assert.deepEqual(sent?.allow_changes, []);
});
test("closing or changing account fences delayed reads and command results", async () => {
  let owner = "first";
  const read = deferred<typeof context>();
  let calls = 0;
  const store = new RoutineSetupStore(
    {
      routineSetupContext: () => read.promise,
      setupAgentRoutine: async () => {
        calls++;
        return routine;
      },
    },
    input,
    () => id,
    () => owner,
  );
  const loading = store.load();
  owner = "second";
  read.resolve(context);
  await loading;
  assert.equal(store.getSnapshot().context, null);
  assert.equal(await store.save(), null);
  assert.equal(calls, 0);
  owner = "first";
  const write = deferred<AgentRoutine>();
  const other = new RoutineSetupStore(
    {
      routineSetupContext: async () => context,
      setupAgentRoutine: () => write.promise,
    },
    input,
    () => id,
    () => owner,
  );
  await other.load();
  const saving = other.save();
  other.dispose();
  write.resolve(routine);
  assert.equal(await saving, null);
  assert.equal(other.getSnapshot().result, null);
});
test("validation snapshots cannot mutate the caller's draft, and transient rate limits keep replay identity", async () => {
  const draft = { ...input };
  const commands: RoutineSetupInput[] = [];
  let request = 0;
  const store = new RoutineSetupStore(
    {
      routineSetupContext: async () => context,
      setupAgentRoutine: async (command) => {
        commands.push(structuredClone(command));
        if (++request === 1) throw new HttpError(429, "later");
        return routine;
      },
    },
    draft,
    () => id,
  );
  draft.instruction = "Changed after review";
  await store.load();
  await store.save();
  assert.equal(store.getSnapshot().uncertain, true);
  await store.save();
  assert.deepEqual(commands[0], commands[1]);
  assert.equal(commands[0].routine.instruction, input.instruction);
});

test("a later denial cannot erase the identity of an earlier unknown save", async () => {
  let count = 0;
  const commands: RoutineSetupInput[] = [];
  const store = new RoutineSetupStore(
    {
      routineSetupContext: async () => context,
      setupAgentRoutine: async (command) => {
        commands.push(structuredClone(command));
        count++;
        if (count === 1) throw new TypeError("lost ACK");
        if (count === 2) throw new HttpError(403, "permission changed");
        return routine;
      },
    },
    input,
    () => id,
  );
  await store.load();
  await store.save();
  await store.save();
  assert.equal(store.getSnapshot().uncertain, true);
  assert.notEqual(store.getSnapshot().context, null);
  await store.load();
  store.select("tasks", true);
  await store.save();
  assert.equal(commands.length, 3);
  assert.deepEqual(commands[0], commands[1]);
  assert.deepEqual(commands[1], commands[2]);
  assert.equal(store.getSnapshot().result, routine);
});
