import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
const { createChatgptIpcGuard } = createRequire(import.meta.url)(
  "../../desktop/chatgpt-ipc.cjs",
);
const entryFile = "/fixture/Orbyn App/dist/index.html";
function fixture() {
  const url = pathToFileURL(entryFile).href;
  const contents = {
    mainFrame: { url },
    isDestroyed: () => false,
    getURL: () => url,
  };
  const window = { webContents: contents, isDestroyed: () => false };
  const guard = createChatgptIpcGuard({ getWindow: () => window, entryFile });
  return {
    contents,
    window,
    guard,
    event: { sender: contents, senderFrame: contents.mainFrame },
  };
}
const denied = (error: any) =>
  error.code === "AUTH_IPC" && !error.message.includes("fixture");

test("ChatGPT IPC accepts only the packaged main page's top-level frame", () => {
  const f = fixture();
  assert.equal(f.guard(f.event), f.contents);
  f.contents.mainFrame.url += "?open=orbyn%3A%2F%2Fdoc#app";
  assert.equal(f.guard(f.event), f.contents);
  assert.throws(
    () => f.guard({ ...f.event, senderFrame: { ...f.contents.mainFrame } }),
    denied,
  );
  assert.throws(
    () => f.guard({ ...f.event, sender: { ...f.contents } }),
    denied,
  );
  assert.throws(() => f.guard({ sender: f.contents }), denied);
  assert.throws(() => f.guard(null), denied);
});

test("remote, sibling, network-file and navigated windows cannot inherit ChatGPT IPC trust", () => {
  for (const url of [
    "https://orbyn.dev/app",
    "http://localhost:5174",
    "file://remote/fixture/Orbyn%20App/dist/index.html",
    "file:///fixture/Orbyn%20App/dist/index.html.evil",
    "file:///fixture/other/index.html",
    "data:text/html,fixture",
    "about:blank",
    "not-a-url",
  ]) {
    const f = fixture();
    f.contents.mainFrame.url = url;
    assert.throws(() => f.guard(f.event), denied);
  }
  const f = fixture();
  f.contents.getURL = () => "https://orbyn.dev/app";
  assert.throws(() => f.guard(f.event), denied);
});

test("destroyed windows and content are rejected with generic errors", () => {
  const f = fixture();
  f.window.isDestroyed = () => true;
  assert.throws(() => f.guard(f.event), denied);
  f.window.isDestroyed = () => false;
  f.contents.isDestroyed = () => true;
  assert.throws(() => f.guard(f.event), denied);
  const guard = createChatgptIpcGuard({ getWindow: () => null, entryFile });
  assert.throws(() => guard(f.event), denied);
});
