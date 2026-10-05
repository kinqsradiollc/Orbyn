import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  ChatgptDesktopStore,
  type ChatgptDesktopBridge,
} from "@orbyn/api-client";

function state(user = randomUUID()) {
  return {
    status: "ready",
    busy: false,
    user_id: user,
    connections: [],
    selection: null,
    catalog: null,
    error: null,
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function fixture() {
  let listener = () => {};
  let removed = false;
  let current = state();
  const bridge: ChatgptDesktopBridge = {
    syncSession: async () => current,
    command: async () => current,
    onChange: (value) => {
      listener = value;
      return () => {
        removed = true;
      };
    },
  };
  const store = new ChatgptDesktopStore(bridge);
  return {
    store,
    bridge,
    notify: () => listener(),
    current,
    removed: () => removed,
    set: (value: ReturnType<typeof state>) => {
      current = value;
    },
  };
}

test("unsupported runtime exposes no fake account connection", async () => {
  const store = new ChatgptDesktopStore();
  await store.syncSession("orbyn-session");
  assert.equal(store.snapshot().status, "unsupported");
  await assert.rejects(store.command({ action: "connect" }), /desktop runtime/);
});

test("a late session response cannot restore a previous account", async () => {
  const f = fixture(),
    slow = deferred<unknown>(),
    newer = state();
  f.bridge.syncSession = async (token) =>
    token === "old" ? slow.promise : newer;
  const pending = f.store.syncSession("old");
  await f.store.syncSession("new");
  slow.resolve(f.current);
  await pending;
  assert.equal(f.store.snapshot().connection?.user_id, newer.user_id);
  const copy = f.store.snapshot();
  copy.connection!.user_id = randomUUID();
  assert.equal(f.store.snapshot().connection?.user_id, newer.user_id);
  f.store.close();
  assert.equal(f.removed(), true);
});

test("out of order metadata reloads cannot replace the newest result", async () => {
  const f = fixture();
  await f.store.syncSession("orbyn-session");
  const slow = deferred<unknown>(),
    newer = state();
  let calls = 0;
  f.bridge.command = async () => (++calls === 1 ? slow.promise : newer);
  const pending = f.store.reload();
  await f.store.reload();
  slow.resolve(f.current);
  await pending;
  assert.equal(f.store.snapshot().connection?.user_id, newer.user_id);
});

test("strict metadata rejects credential fields and sanitizes errors", async () => {
  const f = fixture();
  await f.store.syncSession("orbyn-session");
  f.bridge.command = async () => ({ ...f.current, access_token: "PRIVATE" });
  await f.store.reload();
  assert.equal(f.store.snapshot().status, "unavailable");
  assert.equal(JSON.stringify(f.store.snapshot()).includes("PRIVATE"), false);
  f.bridge.command = async (command) => {
    if (command.action === "state") return f.current;
    throw new Error("PRIVATE");
  };
  await assert.rejects(
    f.store.command({ action: "connect" }),
    /could not complete/,
  );
  assert.equal(f.store.snapshot().connection?.busy, false);
  assert.equal(JSON.stringify(f.store.snapshot()).includes("PRIVATE"), false);
});

test("disconnect reports unconfirmed remote revocation and later commands clear the notice", async () => {
  const f = fixture();
  await f.store.syncSession("orbyn-session");
  f.bridge.command = async (command) =>
    command.action === "disconnect"
      ? { state: f.current, remote_revocation_confirmed: false }
      : f.current;
  await f.store.command({ action: "disconnect", registrationId: randomUUID() });
  assert.match(f.store.snapshot().notice!, /not confirmed/);
  await f.store.command({ action: "refresh" });
  assert.equal(f.store.snapshot().notice, null);
});

test("a command completing after logout cannot repopulate connection metadata", async () => {
  const f = fixture();
  await f.store.syncSession("orbyn-session");
  const slow = deferred<unknown>();
  f.bridge.command = async () => slow.promise;
  const pending = f.store.command({ action: "connect" });
  f.bridge.syncSession = async () => ({
    status: "signed-out",
    busy: false,
    user_id: null,
    connections: [],
    selection: null,
    catalog: null,
    error: null,
  });
  await f.store.syncSession(null);
  slow.resolve(f.current);
  await pending;
  assert.equal(f.store.snapshot().connection?.status, "signed-out");
});

test("subscriber failures do not interrupt account clearing or shutdown fencing", async () => {
  const f = fixture();
  f.store.subscribe(() => {
    throw new Error("subscriber");
  });
  await f.store.syncSession("orbyn-session");
  assert.equal(f.store.snapshot().status, "ready");
  const slow = deferred<unknown>();
  f.bridge.command = async () => slow.promise;
  const pending = f.store.reload();
  f.store.close();
  slow.resolve(state());
  await pending;
  assert.equal(f.store.snapshot().connection?.user_id, f.current.user_id);
});

test("safe plan failures survive routine metadata refresh but clear on the next successful action", async () => {
  const f = fixture();
  await f.store.syncSession("orbyn-session");
  const expected = "ChatGPT plan usage limit reached. Manage usage in ChatGPT.";
  f.bridge.command = async (command) => {
    if (command.action === "verify-plan")
      throw new Error(
        `Error invoking remote method 'orbyn:chatgpt': Error: ${expected}`,
      );
    return f.current;
  };
  await assert.rejects(
    f.store.command({ action: "verify-plan" }),
    (e) => e instanceof Error && e.message === expected,
  );
  await f.store.reload();
  assert.equal(f.store.snapshot().error, expected);
  await f.store.command({ action: "refresh" });
  assert.equal(f.store.snapshot().error, null);
  f.store.close();
});
