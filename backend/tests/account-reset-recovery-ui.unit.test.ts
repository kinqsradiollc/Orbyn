import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { transformSync } from "esbuild";

const require = createRequire(import.meta.url);
const mobileRequire = createRequire(
  new URL("../../mobile/package.json", import.meta.url),
);

/** Actual React/DOM rendering with inert account transport, no service or DB. */
async function fixture(
  reset: (token: string, password: string) => Promise<unknown>,
) {
  const { JSDOM } = mobileRequire("jsdom");
  const dom = new JSDOM('<div id="root"></div>', {
    url: "http://fixture.invalid/reset-password",
  });
  const globals = [
    "window",
    "document",
    "HTMLElement",
    "IS_REACT_ACT_ENVIRONMENT",
    "fetch",
  ];
  const saved = globals.map(
    (name) =>
      [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const,
  );
  let networkCalls = 0,
    mailCalls = 0;
  for (const name of globals)
    Object.defineProperty(globalThis, name, {
      configurable: true,
      writable: true,
      value:
        name === "IS_REACT_ACT_ENVIRONMENT"
          ? true
          : name === "fetch"
            ? () => {
                networkCalls++;
                throw new Error(
                  "Account UI fixture must never use the network.",
                );
              }
            : dom.window[name],
    });
  const React = require("react");
  const root = require("react-dom/client").createRoot(
    dom.window.document.querySelector("#root"),
  );
  const module = { exports: {} as any };
  runInNewContext(
    transformSync(
      readFileSync(
        new URL(
          "../../desktop/src/features/auth/AccountFlows.tsx",
          import.meta.url,
        ),
        "utf8",
      ),
      {
        loader: "tsx",
        format: "cjs",
        jsx: "automatic",
      },
    ).code,
    {
      module,
      exports: module.exports,
      FormData: dom.window.FormData,
      require: (name: string) => {
        if (name === "../../lib/api")
          return {
            client: {
              resetPassword: reset,
              forgotPassword: async () => {
                mailCalls++;
                throw new Error("Navigation must not send mail.");
              },
            },
          };
        if (name === "../../lib/session")
          return { session: { get: () => "synthetic-session" } };
        if (name === "../planner/planning")
          return { errorText: (error: Error) => error.message };
        if (
          name === "react" ||
          name === "react/jsx-runtime" ||
          name === "lucide-react"
        )
          return require(name);
        throw new Error(`Unexpected account UI dependency: ${name}`);
      },
    },
  );
  const paths: string[] = [],
    authed: unknown[] = [];
  const render = (token: string) =>
    React.act(async () =>
      root.render(
        React.createElement(module.exports.ResetPasswordPage, {
          token,
          onNavigate: (path: string) => paths.push(path),
          onAuthed: (result: unknown) => authed.push(result),
          // Deliberately no onHome: this is also the native-desktop contract.
        }),
      ),
    );
  const submit = () => {
    const form = dom.window.document.querySelector("form");
    assert.ok(form);
    form.querySelector("input").value = "synthetic-only-password";
    form.dispatchEvent(
      new dom.window.Event("submit", { bubbles: true, cancelable: true }),
    );
  };
  const newLink = () =>
    [...dom.window.document.querySelectorAll("button")].find(
      (button: any) => button.textContent === "Send a new link",
    ) as HTMLButtonElement | undefined;
  return {
    React,
    dom,
    paths,
    authed,
    render,
    submit,
    newLink,
    close: async () => {
      await React.act(async () => root.unmount());
      dom.window.close();
      for (const [name, descriptor] of saved) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else Reflect.deleteProperty(globalThis, name);
      }
      assert.equal(networkCalls, 0);
      assert.equal(mailCalls, 0);
    },
  };
}

test("expired or used reset links offer a rendered new-link route without a public-home fallback or another reset", async () => {
  const calls: string[] = [];
  const f = await fixture(async (token) => {
    calls.push(token);
    throw new Error(
      "This link has expired or was already used. Ask for a new one.",
    );
  });
  try {
    await f.render("synthetic-expired-token");
    assert.equal(f.newLink(), undefined);
    await f.React.act(async () => f.submit());
    assert.match(
      f.dom.window.document.querySelector('[role="alert"]').textContent,
      /expired or was already used/,
    );
    const recovery = f.newLink();
    assert.ok(
      recovery,
      "A rejected reset link must provide a way to request its replacement",
    );
    assert.equal(recovery.type, "button");
    assert.equal(recovery.disabled, false);
    await f.React.act(async () => recovery.click());
    assert.deepEqual(f.paths, ["/forgot-password"]);
    assert.deepEqual(calls, ["synthetic-expired-token"]);
    assert.deepEqual(f.authed, []);
  } finally {
    await f.close();
  }
});

test("incomplete reset links keep the existing new-link recovery without any credential call", async () => {
  const f = await fixture(async () => {
    assert.fail("Incomplete links cannot reset credentials");
  });
  try {
    await f.render("");
    assert.equal(f.dom.window.document.querySelector("form"), null);
    assert.ok(f.newLink());
    await f.React.act(async () => f.newLink()!.click());
    assert.deepEqual(f.paths, ["/forgot-password"]);
  } finally {
    await f.close();
  }
});

test("a valid reset response still signs in once and does not display failed-link recovery", async () => {
  let resolve!: (value: unknown) => void,
    calls = 0;
  const pending = new Promise<unknown>((done) => {
    resolve = done;
  });
  const response = {
    token: "synthetic-result",
    user: { id: "synthetic-person" },
  };
  const f = await fixture(async () => {
    calls++;
    return pending;
  });
  try {
    await f.render("synthetic-valid-token");
    await f.React.act(async () => {
      f.submit();
      f.submit();
    });
    assert.equal(calls, 1, "An in-flight submission remains serialized");
    assert.equal(f.newLink(), undefined);
    await f.React.act(async () => resolve(response));
    assert.deepEqual(f.authed, [response]);
    assert.deepEqual(f.paths, []);
    assert.equal(f.newLink(), undefined);
  } finally {
    await f.close();
  }
});
