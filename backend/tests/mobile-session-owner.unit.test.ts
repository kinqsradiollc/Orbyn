import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { transformSync } from "esbuild";
import ts from "typescript";

const KEY = "orbyn-session";
const source = readFileSync(
  new URL("../../mobile/src/lib/session.ts", import.meta.url),
  "utf8",
);
const compiled = transformSync(source, {
  loader: "ts",
  format: "cjs",
  target: "es2022",
}).code;

type SessionApi = {
  session: { token: string; userId: string; generation: number };
  SessionStorageError: new (
    generation: number,
    operation: "save" | "clear",
  ) => Error;
  subscribeSession(listener: () => void): () => void;
  loadSession(): Promise<string>;
  saveSession(token: string, userId: string): Promise<void>;
  setSessionUser(userId: string, token: string): Promise<boolean>;
  clearSession(token?: string): Promise<boolean>;
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function fixture(platform = "ios", initial?: string, browserAvailable = true) {
  const values = new Map<string, string>();
  if (initial !== undefined) values.set(KEY, initial);
  let readGate: ReturnType<typeof deferred<string | null>> | undefined;
  let writeGate: ReturnType<typeof deferred<void>> | undefined;
  let removeGate: ReturnType<typeof deferred<void>> | undefined;
  const writes: string[] = [];
  let browserFailure = false;
  const module = { exports: {} as SessionApi };
  runInNewContext(compiled, {
    module,
    exports: module.exports,
    localStorage: !browserAvailable
      ? undefined
      : {
          getItem: (key: string) => {
            if (browserFailure) throw new Error("browser storage unavailable");
            return values.get(key) ?? null;
          },
          setItem: (key: string, value: string) => {
            if (browserFailure) throw new Error("browser storage unavailable");
            values.set(key, value);
          },
          removeItem: (key: string) => {
            if (browserFailure) throw new Error("browser storage unavailable");
            values.delete(key);
          },
        },
    require(name: string) {
      if (name === "react-native") return { Platform: { OS: platform } };
      if (name === "expo-secure-store")
        return {
          async getItemAsync(key: string) {
            if (key === KEY && readGate) return readGate.promise;
            return values.get(key) ?? null;
          },
          async setItemAsync(key: string, value: string) {
            writes.push(value);
            if (key === KEY && writeGate) {
              const gate = writeGate;
              writeGate = undefined;
              await gate.promise;
            }
            values.set(key, value);
          },
          async deleteItemAsync(key: string) {
            if (key === KEY && removeGate) {
              const gate = removeGate;
              removeGate = undefined;
              await gate.promise;
            }
            values.delete(key);
          },
        };
      throw new Error(`Unexpected module ${name}`);
    },
  });
  return {
    api: module.exports,
    failBrowserStorage(value: boolean) {
      browserFailure = value;
    },
    values,
    writes,
    blockRead() {
      return (readGate = deferred<string | null>());
    },
    blockWrite() {
      return (writeGate = deferred<void>());
    },
    blockRemove() {
      return (removeGate = deferred<void>());
    },
  };
}
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

for (const platform of ["ios", "android", "web"]) {
  test(`${platform}: confirmed identity persists atomically and restores offline`, async () => {
    const f = fixture(platform);
    const changes: string[] = [];
    const stop = f.api.subscribeSession(() =>
      changes.push(
        `${f.api.session.token}:${f.api.session.userId}:${f.api.session.generation}`,
      ),
    );
    const saving = f.api.saveSession("token-a", "account-a");
    assert.equal(f.api.session.userId, "account-a");
    assert.deepEqual(changes, ["token-a:account-a:1"]);
    await saving;
    const raw = f.values.get(KEY)!;
    assert.deepEqual(JSON.parse(raw), {
      version: 1,
      token: "token-a",
      userId: "account-a",
    });
    const restarted = fixture(platform, raw);
    assert.equal(await restarted.api.loadSession(), "token-a");
    assert.equal(restarted.api.session.userId, "account-a");
    stop();
    await f.api.clearSession("token-a");
    assert.equal(changes.length, 1);
  });
}

test("legacy raw token stays unidentified until its current authenticated profile binds it", async () => {
  const f = fixture("ios", "legacy-token");
  await f.api.loadSession();
  assert.equal(f.api.session.userId, "");
  assert.equal(await f.api.setSessionUser("account-b", "other-token"), false);
  assert.equal(await f.api.setSessionUser("account-a", "legacy-token"), true);
  assert.equal(f.api.session.userId, "account-a");
  assert.equal(JSON.parse(f.values.get(KEY)!).userId, "account-a");
  assert.equal(await f.api.setSessionUser("account-b", "legacy-token"), false);
  assert.equal(f.api.session.userId, "account-a");
});

test("late restore cannot overwrite a newer login or clear", async () => {
  for (const next of ["login", "clear"]) {
    const f = fixture();
    const read = f.blockRead();
    const loading = f.api.loadSession();
    await tick();
    if (next === "login") await f.api.saveSession("new-token", "new-account");
    else await f.api.clearSession();
    read.resolve("legacy-token");
    assert.equal(await loading, next === "login" ? "new-token" : "");
    assert.equal(f.api.session.userId, next === "login" ? "new-account" : "");
  }
});

test("started native writes are serialized behind newer synchronous identities", async () => {
  const f = fixture();
  const first = f.blockWrite();
  const oldSave = f.api.saveSession("old-token", "old-account");
  await tick();
  const newSave = f.api.saveSession("new-token", "new-account");
  assert.equal(f.api.session.userId, "new-account");
  first.resolve();
  await Promise.all([oldSave, newSave]);
  assert.equal(JSON.parse(f.values.get(KEY)!).userId, "new-account");
});

test("late 401 cannot invalidate a newer identity and clear notifies before storage", async () => {
  const f = fixture();
  await f.api.saveSession("old-token", "old-account");
  await f.api.saveSession("new-token", "new-account");
  const generation = f.api.session.generation;
  assert.equal(await f.api.clearSession("old-token"), false);
  assert.equal(f.api.session.generation, generation);
  const removed = f.blockRemove();
  const clearing = f.api.clearSession("new-token");
  assert.equal(f.api.session.token, "");
  assert.equal(f.api.session.userId, "");
  assert.equal(f.api.session.generation, generation + 1);
  await tick();
  const saving = f.api.saveSession("third-token", "third-account");
  removed.resolve();
  await Promise.all([clearing, saving]);
  assert.equal(f.api.session.userId, "third-account");
  assert.equal(JSON.parse(f.values.get(KEY)!).userId, "third-account");
});

test("failed storage does not poison later session persistence", async () => {
  const f = fixture();
  const first = f.blockWrite();
  const saving = f.api.saveSession("old-token", "old-account");
  await tick();
  const rejected = assert.rejects(saving, /save your sign-in/);
  first.reject(new Error("storage failed"));
  await rejected;
  await f.api.saveSession("new-token", "new-account");
  assert.equal(JSON.parse(f.values.get(KEY)!).userId, "new-account");
});

test("unsupported and corrupt identity envelopes fail closed", async () => {
  for (const raw of [
    '{"version":2,"token":"a","userId":"b"}',
    '{"version":1,"token":"a"}',
    '{"version":1,',
  ]) {
    const f = fixture("ios", raw);
    assert.equal(await f.api.loadSession(), "");
    assert.equal(f.api.session.userId, "");
  }
});

// Execute the actual planner callback with platform effects injected, without
// mounting a renderer or requiring Expo/native services in the Node test process.
const planner = ts.createSourceFile(
  "usePlanner.ts",
  readFileSync(
    new URL("../../mobile/src/hooks/usePlanner.ts", import.meta.url),
    "utf8",
  ),
  ts.ScriptTarget.Latest,
  true,
);
let background: ts.Expression | undefined;
function visit(node: ts.Node) {
  if (
    ts.isVariableDeclaration(node) &&
    node.name.getText(planner) === "background"
  )
    background = node.initializer;
  ts.forEachChild(node, visit);
}
visit(planner);
assert.ok(background);
function plannerBackground(
  f: ReturnType<typeof fixture>,
  me: Promise<{ id: string }>,
) {
  let flushes = 0,
    refreshes = 0,
    resets = 0;
  const token = f.api.session.token;
  const tokenRef = { current: token };
  const callback = runInNewContext(
    transformSync(`(${background!.getText(planner)})`, {
      loader: "ts",
      target: "es2022",
    }).code,
    {
      alive: true,
      token,
      tokenRef,
      session: f.api.session,
      setSessionUser: f.api.setSessionUser,
      clearSession: f.api.clearSession,
      SessionStorageError: f.api.SessionStorageError,
      setError() {},
      client: { me: () => me },
      checkMaintenance: () => Promise.resolve(),
      setUser() {},
      flush: async () => {
        flushes++;
      },
      refresh: async () => {
        refreshes++;
      },
      resetSession: () => {
        resets++;
      },
      noteOnline() {},
      noteOffline() {},
      isOfflineError: () => false,
      errorText() {},
    },
  );
  return {
    callback,
    tokenRef,
    flushes: () => flushes,
    refreshes: () => refreshes,
    resets: () => resets,
  };
}

test("planner confirms legacy identity before any queued dispatch", async () => {
  const f = fixture("ios", "legacy-token");
  await f.api.loadSession();
  const me = deferred<{ id: string }>();
  const p = plannerBackground(f, me.promise);
  const running = p.callback();
  assert.equal(p.flushes(), 0);
  me.resolve({ id: "account-a" });
  await running;
  assert.equal(f.api.session.userId, "account-a");
  assert.equal(p.flushes(), 1);
  assert.equal(p.refreshes(), 1);
});

test("planner discards a legacy profile or 401 arriving after another login", async () => {
  for (const failure of [false, true]) {
    const f = fixture("ios", "legacy-token");
    await f.api.loadSession();
    const me = deferred<{ id: string }>();
    const p = plannerBackground(f, me.promise);
    const running = p.callback();
    await f.api.saveSession("new-token", "new-account");
    p.tokenRef.current = "new-token";
    if (failure)
      me.reject(Object.assign(new Error("expired"), { status: 401 }));
    else me.resolve({ id: "old-account" });
    await running;
    assert.equal(f.api.session.userId, "new-account");
    assert.equal(p.flushes(), 0);
    assert.equal(p.resets(), 0);
  }
});

test("planner clears current legacy 401 synchronously without dispatching", async () => {
  const f = fixture("ios", "legacy-token");
  await f.api.loadSession();
  const me = deferred<{ id: string }>();
  const p = plannerBackground(f, me.promise);
  const running = p.callback();
  me.reject(Object.assign(new Error("expired"), { status: 401 }));
  await running;
  assert.equal(f.api.session.token, "");
  assert.equal(f.api.session.userId, "");
  assert.equal(p.flushes(), 0);
  assert.equal(p.resets(), 1);
});

test("planner leaves an unidentified legacy session paused when offline", async () => {
  const f = fixture("ios", "legacy-token");
  await f.api.loadSession();
  const me = deferred<{ id: string }>();
  const p = plannerBackground(f, me.promise);
  const running = p.callback();
  me.reject(new Error("network unavailable"));
  await running;
  assert.equal(f.api.session.token, "legacy-token");
  assert.equal(f.api.session.userId, "");
  assert.equal(p.flushes(), 0);
  assert.equal(p.resets(), 0);
});

function plannerActions(f: ReturnType<typeof fixture>) {
  const tokenRef = { current: f.api.session.token };
  let renderedToken = tokenRef.current;
  const errors: string[] = [];
  let resets = 0;
  const context: Record<string, unknown> = {
    tokenRef,
    session: f.api.session,
    SessionStorageError: f.api.SessionStorageError,
    saveSession: f.api.saveSession,
    itemStore: { reset() {} },
    clearSession: f.api.clearSession,
    setBusy() {},
    setTwoFactorRequired() {},
    setUser() {},
    setError: (error: string) => {
      if (error) errors.push(error);
    },
    setToken: (token: string) => {
      renderedToken = token;
    },
    resetSession: () => {
      resets++;
      tokenRef.current = "";
      renderedToken = "";
    },
    disablePush: async () => {},
    deviceId: () => "fixture-device",
    isOfflineError: () => false,
    errorText: (e: Error) => e.message,
    checkMaintenance: async () => {},
    client: {
      login: async () => ({
        token: "login-token",
        user: { id: "login-owner" },
      }),
      leavePresence: async () => {},
      logout: async () => {},
    },
  };
  const callbacks: Record<string, (...args: any[]) => Promise<any>> = {};
  for (const name of ["act", "signIn", "forgetSession", "signOut"]) {
    let expression: ts.Expression | undefined;
    const find = (node: ts.Node) => {
      if (ts.isVariableDeclaration(node) && node.name.getText(planner) === name)
        expression = node.initializer;
      ts.forEachChild(node, find);
    };
    find(planner);
    assert.ok(expression, `Exercise actual ${name} callback`);
    const callback = runInNewContext(
      transformSync(`(${expression.getText(planner)})`, {
        loader: "ts",
        target: "es2022",
      }).code,
      context,
    );
    context[name] = callback;
    callbacks[name] = callback;
  }
  return {
    ...callbacks,
    errors,
    resets: () => resets,
    renderedToken: () => renderedToken,
    renderNewSession: () => {
      tokenRef.current = f.api.session.token;
      renderedToken = tokenRef.current;
    },
  };
}
const credentials = {
  email: "owner@example.test",
  password: "fixture",
  name: "",
  register: false,
};

test("actual act + signIn surfaces rejected native persistence without publishing login success; retry persists", async () => {
  const f = fixture();
  const p = plannerActions(f);
  const write = f.blockWrite();
  const running = p.act(() => p.signIn(credentials));
  await tick();
  assert.equal(p.renderedToken(), "");
  write.reject(new Error("native storage unavailable"));
  await running;
  assert.match(p.errors[0], /save your sign-in.*Try signing in again/);
  assert.equal(p.renderedToken(), "");
  const restarted = fixture("ios", f.values.get(KEY));
  assert.equal(await restarted.api.loadSession(), "");
  await p.act(() => p.signIn(credentials));
  assert.equal(p.renderedToken(), "login-token");
  const afterRetry = fixture("ios", f.values.get(KEY));
  assert.equal(await afterRetry.api.loadSession(), "login-token");
  assert.equal(afterRetry.api.session.userId, "login-owner");
});

test("actual act + forgetSession preserves retry UI after native removal failure and clears on retry", async () => {
  const f = fixture();
  await f.api.saveSession("existing-token", "existing-owner");
  const p = plannerActions(f);
  const removal = f.blockRemove();
  const running = p.forgetSession();
  await tick();
  assert.equal(f.api.session.token, "");
  removal.reject(new Error("native keychain unavailable"));
  await running;
  assert.match(p.errors[0], /remove your sign-in.*Try signing out again/);
  assert.equal(p.renderedToken(), "existing-token");
  assert.equal(p.resets(), 0);
  const beforeRetry = fixture("ios", f.values.get(KEY));
  assert.equal(await beforeRetry.api.loadSession(), "existing-token");
  await p.forgetSession();
  assert.equal(p.resets(), 1);
  assert.equal(p.renderedToken(), "");
  const afterRetry = fixture("ios", f.values.get(KEY));
  assert.equal(await afterRetry.api.loadSession(), "");
});

test("failed old removal cannot report against or reset another completed login", async () => {
  const f = fixture();
  await f.api.saveSession("existing-token", "existing-owner");
  const p = plannerActions(f);
  const removal = f.blockRemove();
  const running = p.forgetSession();
  await tick();
  const newLogin = f.api.saveSession("new-token", "new-owner");
  p.renderNewSession();
  removal.reject(new Error("old removal failed"));
  await Promise.all([running, newLogin]);
  assert.equal(p.errors.length, 0);
  assert.equal(p.resets(), 0);
  assert.equal(p.renderedToken(), "new-token");
  const restarted = fixture("ios", f.values.get(KEY));
  await restarted.api.loadSession();
  assert.equal(restarted.api.session.userId, "new-owner");
});

test("failed old login persistence cannot report against another completed login", async () => {
  const f = fixture();
  const p = plannerActions(f);
  const write = f.blockWrite();
  const running = p.act(() => p.signIn(credentials));
  await tick();
  const newLogin = f.api.saveSession("new-token", "new-owner");
  p.renderNewSession();
  write.reject(new Error("old write failed"));
  await Promise.all([running, newLogin]);
  assert.equal(p.errors.length, 0);
  assert.equal(p.renderedToken(), "new-token");
  assert.equal(JSON.parse(f.values.get(KEY)!).userId, "new-owner");
});

test("browser login storage failure stays visible and retry durably persists the identity", async () => {
  const f = fixture("web");
  const p = plannerActions(f);
  f.failBrowserStorage(true);
  await p.act(() => p.signIn(credentials));
  assert.match(p.errors[0], /save your sign-in/);
  assert.equal(p.renderedToken(), "");
  assert.equal(await fixture("web", f.values.get(KEY)).api.loadSession(), "");
  f.failBrowserStorage(false);
  await p.act(() => p.signIn(credentials));
  assert.equal(p.renderedToken(), "login-token");
  const restarted = fixture("web", f.values.get(KEY));
  await restarted.api.loadSession();
  assert.equal(restarted.api.session.userId, "login-owner");
});

test("browser removal failure leaves live identity paused with explicit retry until durable cleanup succeeds", async () => {
  const f = fixture("web");
  await f.api.saveSession("existing-token", "existing-owner");
  const p = plannerActions(f);
  f.failBrowserStorage(true);
  await p.forgetSession();
  assert.match(p.errors[0], /remove your sign-in/);
  assert.equal(f.api.session.token, "");
  assert.equal(f.api.session.userId, "");
  assert.equal(p.renderedToken(), "existing-token");
  assert.equal(p.resets(), 0);
  assert.equal(
    await fixture("web", f.values.get(KEY)).api.loadSession(),
    "existing-token",
  );
  f.failBrowserStorage(false);
  await p.signOut();
  assert.equal(p.renderedToken(), "");
  assert.equal(await fixture("web", f.values.get(KEY)).api.loadSession(), "");
});

test("missing browser storage rejects credential write and removal; unavailable read establishes no identity", async () => {
  const raw = JSON.stringify({
    version: 1,
    token: "stored-token",
    userId: "stored-owner",
  });
  for (const missing of [false, true]) {
    const f = fixture("web", raw, !missing);
    if (!missing) f.failBrowserStorage(true);
    assert.equal(await f.api.loadSession(), "");
    assert.equal(f.api.session.userId, "");
    await assert.rejects(
      f.api.saveSession("new-token", "new-owner"),
      /save your sign-in/,
    );
    await assert.rejects(f.api.clearSession(), /remove your sign-in/);
    assert.equal(f.api.session.token, "");
    assert.equal(f.api.session.userId, "");
    assert.equal(f.values.get(KEY), raw);
  }
});
