import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
function fixture(app: "desktop" | "mobile", state: any) {
  const calls: string[] = [];
  const store = {
    subscribe: () => () => {},
    getSnapshot: () => state,
    refresh: () => {
      calls.push("refresh");
    },
    start: () => Promise.resolve(),
    confirm: () => {
      calls.push("confirm");
    },
    permission: (enabled: boolean) => {
      calls.push(`permission:${enabled}`);
    },
    disconnect: () => {
      calls.push("disconnect");
    },
    renewLink: () => {
      calls.push("renew");
    },
    cancel: () => {},
    expireChallenge: () => {},
    dispose: () => {},
    restore: () => Promise.resolve(),
  };
  const exports: any = {};
  const source = readFileSync(
    new URL(
      app === "desktop"
        ? "../../desktop/src/features/settings/TeamsChannel.tsx"
        : "../../mobile/src/screens/TeamsChannel.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  const primitive = ({ children, ...props }: any) =>
    React.createElement("div", props, children);
  const control = (props: any) =>
    React.createElement(
      "button",
      {
        "aria-label": props.accessibilityLabel,
        onClick: props.onPress ?? props.onValueChange,
        disabled: props.disabled,
      },
      props.label,
    );
  runInNewContext(
    ts.transpileModule(source, {
      compilerOptions: {
        jsx: ts.JsxEmit.React,
        module: ts.ModuleKind.CommonJS,
        esModuleInterop: true,
      },
    }).outputText,
    {
      exports,
      React,
      Date,
      setTimeout,
      clearTimeout,
      sessionStorage: { getItem: () => null },
      window: { open: () => null },
      require(name: string) {
        if (name === "react")
          return {
            ...React,
            useEffect: () => {},
            useMemo: (fn: () => unknown) => fn(),
            useState: () => ["owner", () => {}],
            useSyncExternalStore: () => state,
          };
        if (name === "@orbyn/api-client")
          return {
            TeamsChannelStore: class {
              constructor() {
                return store;
              }
            },
          };
        if (name.endsWith("/session"))
          return {
            session: { get: () => "owner", token: "owner" },
            onSessionChange: () => () => {},
            loadTeamsInstallation: () => Promise.resolve(null),
            saveTeamsInstallation: () => {},
          };
        if (name.endsWith("/api")) return { client: {} };
        if (name === "react-native")
          return {
            Text: primitive,
            View: primitive,
            Linking: { openURL: () => Promise.resolve() },
            StyleSheet: { create: (x: unknown) => x },
          };
        if (name.endsWith("/theme"))
          return {
            colors: { border: "token", accent: "token" },
            radii: { card: 12 },
            themed: (fn: () => unknown) => fn(),
          };
        if (name.endsWith("/styles")) return { shared: {} };
        if (name === "lucide-react")
          return { Unplug: () => React.createElement("svg") };
        if (name.endsWith("/SmallAction")) return { SmallAction: control };
        if (name.endsWith("/Switch")) return { Switch: control };
        if (name.endsWith("/MoreMenu"))
          return {
            MoreMenu: () => React.createElement("button", null, "Options"),
          };
        throw Error(name);
      },
    },
  );
  const tree = exports.TeamsChannelSettings();
  const nodes = (node: any): any[] =>
    Array.isArray(node)
      ? node.flatMap(nodes)
      : React.isValidElement<any>(node)
        ? [node, ...nodes(node.props.children)]
        : [];
  return { html: renderToStaticMarkup(tree), nodes: nodes(tree), calls };
}
const connection = {
  id: "owned",
  display_name: "Owner",
  tenant_id: "tenant",
  object_id: "object",
  version: 4,
  dm_enabled: false,
  state: "linked",
};
const state = {
  status: { configured: true, delivery_available: true, connection },
  installation: null,
  authorizationUrl: null,
  challenge: null,
  busy: false,
  error: "",
};
for (const app of ["desktop", "mobile"] as const) {
  test(`${app}: Teams personal-chat proof alone does not enable DMs`, () => {
    const f = fixture(app, state);
    assert.match(f.html, /Personal chat linked/);
    assert.match(f.html, /Send agent DMs to me/);
    assert.doesNotMatch(f.html, /Connect Teams|Get linking command/);
    const control = f.nodes.find((n) =>
      app === "desktop"
        ? n.type === "input"
        : n.props.accessibilityLabel === "Send Teams agent DMs to me",
    )!;
    assert.equal(
      app === "desktop" ? control.props.checked : control.props.value,
      false,
    );
    assert.equal(control.props.disabled, false);
    if (app === "desktop")
      control.props.onChange({ target: { checked: true } });
    else control.props.onValueChange(true);
    assert.deepEqual(f.calls, ["permission:true"]);
  });
  test(`${app}: Teams missing transport disables enable but preserves disabling an existing permission`, () => {
    const off = fixture(app, {
      ...state,
      status: { ...state.status, delivery_available: false },
    });
    const toggle = off.nodes.find((n) =>
      app === "desktop"
        ? n.type === "input"
        : n.props.accessibilityLabel === "Send Teams agent DMs to me",
    )!;
    assert.equal(toggle.props.disabled, true);
    const on = fixture(app, {
      ...state,
      status: {
        ...state.status,
        delivery_available: false,
        connection: { ...connection, dm_enabled: true },
      },
    });
    const enabled = on.nodes.find((n) =>
      app === "desktop"
        ? n.type === "input"
        : n.props.accessibilityLabel === "Send Teams agent DMs to me",
    )!;
    assert.equal(enabled.props.disabled, false);
  });
  test(`${app}: Teams review shows verified identity and a single confirmation without a DM switch`, () => {
    const f = fixture(app, {
      ...state,
      status: { ...state.status, connection: null },
      installation: {
        id: "pending",
        state: "ready",
        expires_at: new Date(Date.now() + 600000).toISOString(),
        identity: {
          displayName: "Verified Owner",
          tenantId: "tenant-proof",
          objectId: "object-proof",
        },
      },
    });
    assert.match(f.html, /Verified Owner|tenant-proof|object-proof/);
    assert.match(f.html, /Use this account/);
    assert.doesNotMatch(f.html, /Send agent DMs to me/);
    const confirm = f.nodes.find(
      (n) =>
        n.props.label === "Use this account" ||
        (n.type === "button" && n.props.children === "Use this account"),
    )!;
    (confirm.props.onClick ?? confirm.props.onPress)();
    assert.deepEqual(f.calls, ["confirm"]);
  });
  test(`${app}: Teams lost linking command has a recovery action and no OAuth replay button`, () => {
    const f = fixture(app, {
      ...state,
      status: {
        ...state.status,
        connection: { ...connection, state: "awaiting_conversation" },
      },
    });
    assert.match(f.html, /Get linking command/);
    assert.doesNotMatch(f.html, /Connect Teams|Send agent DMs to me/);
    const button = f.nodes.find(
      (n) =>
        n.props.label === "Get linking command" ||
        (n.type === "button" && n.props.children === "Get linking command"),
    )!;
    (button.props.onClick ?? button.props.onPress)();
    assert.deepEqual(f.calls, ["renew"]);
  });
}
