import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { chatgptDesktopState, chatgptDesktopCommand } from "@orbyn/core";
const require = createRequire(import.meta.url);
const {
  installChatgptBridge: install,
} = require("../../desktop/chatgpt-bridge.cjs");
const { createChatgptIpcGuard } = require("../../desktop/chatgpt-ipc.cjs");
const empty = {
  status: "signed-out",
  busy: false,
  user_id: null,
  connections: [],
  selection: null,
  catalog: null,
  error: null,
};

async function fixture() {
  const handlers = new Map<
    string,
    (event: unknown, value: unknown) => Promise<any>
  >();
  let sent = 0,
    disposed = false;
  const contents: any = {
    isDestroyed: () => false,
    getURL: () => "file:///fixture/index.html",
    mainFrame: { url: "file:///fixture/index.html" },
    send: (channel: string, ...args: any[]) => {
      assert.equal(channel, "orbyn:chatgpt-changed");
      assert.equal(args.length, 0);
      sent++;
    },
  };
  const window = { isDestroyed: () => false, webContents: contents };
  const event = { sender: contents, senderFrame: contents.mainFrame };
  const calls: string[] = [];
  let notify!: () => void;
  const manager: any = {
    subscribe: (listener: () => void) => {
      notify = listener;
      return () => {
        disposed = true;
      };
    },
    snapshot: async () => empty,
    setSession: async (token: string) => {
      calls.push("session");
      assert.equal(token, "first-party-fixture-session");
      return empty;
    },
    connect: async () => {
      calls.push("connect");
      return empty;
    },
    setDefault: async (model: string, version: number) => {
      calls.push("default");
      assert.equal(model, "fixture-model");
      assert.equal(version, 3);
      return empty;
    },
  };
  const dispose = await install({
    ipcMain: {
      handle: (name: string, fn: any) => {
        handlers.set(name, fn);
      },
      removeHandler: (name: string) => {
        handlers.delete(name);
      },
    },
    manager,
    getWindow: () => window,
    guard: createChatgptIpcGuard({
      getWindow: () => window,
      entryFile: "/fixture/index.html",
    }),
  });
  return {
    handlers,
    event,
    contents,
    manager,
    calls,
    notify: () => notify(),
    dispose,
    sent: () => sent,
    disposed: () => disposed,
  };
}

test("bridge permits typed metadata commands and only its first-party session channel", async () => {
  const f = await fixture();
  try {
    assert.deepEqual(
      await f.handlers.get("orbyn:chatgpt-session")!(f.event, {
        token: "first-party-fixture-session",
      }),
      empty,
    );
    assert.deepEqual(
      await f.handlers.get("orbyn:chatgpt")!(f.event, { action: "connect" }),
      empty,
    );
    await f.handlers.get("orbyn:chatgpt")!(f.event, {
      action: "set-default",
      model: "fixture-model",
      version: 3,
    });
    assert.deepEqual(f.calls, ["session", "connect", "default"]);
    f.notify();
    assert.equal(f.sent(), 1);
    f.contents.getURL = () => "https://other.invalid/";
    f.notify();
    assert.equal(f.sent(), 1);
  } finally {
    f.dispose();
  }
  assert.equal(f.handlers.size, 0);
  assert.equal(f.disposed(), true);
});

test("foreign windows, child frames and credential-shaped commands never reach the manager", async () => {
  const f = await fixture();
  try {
    for (const event of [
      { sender: {}, senderFrame: f.contents.mainFrame },
      {
        sender: f.contents,
        senderFrame: { url: "file:///fixture/index.html" },
      },
    ]) {
      await assert.rejects(
        f.handlers.get("orbyn:chatgpt")!(event, { action: "connect" }),
        /cannot access ChatGPT/,
      );
      await assert.rejects(
        f.handlers.get("orbyn:chatgpt-session")!(event, {
          token: "first-party-fixture-session",
        }),
        /cannot access ChatGPT/,
      );
    }
    for (const body of [
      { action: "connect", accessToken: "private-fixture-token" },
      { action: "connect", endpoint: "https://other.invalid" },
      {
        action: "select",
        registrationId: randomUUID(),
        selectionRevision: null,
        binding: {},
      },
      { action: "set-default", model: "fixture-model", version: -1 },
    ])
      await assert.rejects(
        f.handlers.get("orbyn:chatgpt")!(f.event, body),
        /could not complete/,
      );
    await assert.rejects(
      f.handlers.get("orbyn:chatgpt-session")!(f.event, {
        token: "first-party-fixture-session",
        accessToken: "private-plan-token",
      }),
      /session could not be connected/,
    );
    assert.deepEqual(f.calls, []);
  } finally {
    f.dispose();
  }
});

test("bridge rejects unexpected response fields and never exposes raw provider errors", async () => {
  const f = await fixture();
  try {
    f.manager.snapshot = async () => ({
      ...empty,
      accessToken: "private-fixture-token",
    });
    await assert.rejects(
      f.handlers.get("orbyn:chatgpt")!(f.event, { action: "state" }),
      (e: Error) =>
        e.message ===
        "ChatGPT could not complete this action. Retry or reconnect this account.",
    );
    f.manager.connect = async () => {
      throw new Error("private-provider-token");
    };
    await assert.rejects(
      f.handlers.get("orbyn:chatgpt")!(f.event, { action: "connect" }),
      (e: Error) => !e.message.includes("private-provider-token"),
    );
  } finally {
    f.dispose();
  }
});

test("desktop state enforces current account, selection and empty signed-out state", () => {
  const userId = randomUUID(),
    registrationId = randomUUID();
  const binding = {
    user_id: userId,
    connection_id: randomUUID(),
    issuer: "https://auth.openai.com",
    subject: "fixture",
    client_id: "oaiapp_fixture",
  };
  const state = {
    ...empty,
    status: "ready",
    user_id: userId,
    connections: [
      {
        registration_id: registrationId,
        binding,
        selected: true,
        sharing_granted: true,
      },
    ],
    selection: { registrationId, revision: randomUUID() },
  };
  assert.equal(chatgptDesktopState.safeParse(state).success, true);
  for (const changed of [
    { ...empty, busy: true },
    { ...state, user_id: randomUUID() },
    { ...state, selection: { registrationId: null, revision: null } },
    { ...state, connections: [...state.connections, ...state.connections] },
    {
      ...state,
      catalog: {
        status: "ready",
        models: [],
        saving: false,
        error: null,
        preference: {
          binding: { ...binding, connection_id: randomUUID() },
          model: null,
          version: 0,
        },
      },
    },
  ])
    assert.equal(chatgptDesktopState.safeParse(changed).success, false);
  assert.equal(
    chatgptDesktopCommand.safeParse({
      action: "connect",
      refreshToken: "private-token",
    }).success,
    false,
  );
});
