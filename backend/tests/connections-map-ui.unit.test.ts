import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import React, { act } from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import * as core from "@orbyn/core";
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const deferred = <T>() => {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
function map(title: string, count = 12): core.ConnectionMap {
  return {
    nodes: [
      { key: `project:${id(1)}`, kind: "project", id: id(1), title, depth: 0 },
      ...Array.from({ length: count }, (_, i) => ({
        key: `task:${id(i + 10)}`,
        kind: "task" as const,
        id: id(i + 10),
        title: `${title} linked task ${i + 1}`,
        depth: 1 as const,
        closed: i === 0,
      })),
      {
        key: `person:${id(90)}`,
        kind: "person",
        id: id(90),
        title: "Named collaborator",
        depth: 1,
      },
      {
        key: "date:2026-10-30",
        kind: "date",
        id: "2026-10-30",
        title: "30 October",
        depth: 1,
      },
    ],
    edges: [],
    truncated: false,
  };
}
async function fixture() {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', {
    url: "https://fixture.invalid",
  });
  const prior = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    prior.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value,
    });
  }
  Object.assign(dom.window.HTMLDialogElement.prototype, {
    showModal() {
      this.setAttribute("open", "");
    },
    close() {
      this.removeAttribute("open");
    },
  });
  let token = "first",
    generation = 1;
  const changes = new Set<() => void>(),
    calls: {
      kind: string;
      id: string;
      depth: number;
      response: ReturnType<typeof deferred<core.ConnectionMap>>;
    }[] = [],
    opened: unknown[] = [],
    reported: unknown[] = [];
  const exports: any = {};
  const source = ts.transpileModule(
    readFileSync(
      new URL(
        "../../desktop/src/features/connections/ConnectionsMap.tsx",
        import.meta.url,
      ),
      "utf8",
    ),
    {
      compilerOptions: {
        jsx: ts.JsxEmit.ReactJSX,
        module: ts.ModuleKind.CommonJS,
        esModuleInterop: true,
      },
    },
  ).outputText;
  runInNewContext(source, {
    exports,
    require(name: string) {
      if (name === "react") return React;
      if (name === "react/jsx-runtime") return jsxRuntime;
      if (name === "react-dom")
        return { createPortal: (node: React.ReactNode) => node };
      if (name === "@orbyn/core") return core;
      if (name === "lucide-react")
        return new Proxy({}, { get: () => () => React.createElement("svg") });
      if (name.endsWith("/api"))
        return {
          client: {
            connectionMap: (kind: string, value: string, depth: number) => {
              const response = deferred<core.ConnectionMap>();
              calls.push({ kind, id: value, depth, response });
              return response.promise;
            },
          },
        };
      if (name.endsWith("/session"))
        return {
          session: { binding: () => ({ token, generation }) },
          onSessionChange: (fn: () => void) => {
            changes.add(fn);
            return () => changes.delete(fn);
          },
        };
      if (name.endsWith("/DocLinks"))
        return {
          openObject: (ref: unknown) => opened.push(structuredClone(ref)),
          peekObject: (ref: unknown) => opened.push(structuredClone(ref)),
        };
      if (name.endsWith("/useElementWidth"))
        return {
          useElementWidth: () => ({ ref: React.useRef(null), width: 640 }),
        };
      if (name.endsWith("/useModalFocus"))
        return {
          useModalFocus: () => ({
            ref: React.useRef(null),
            id: "fixture-dialog",
          }),
        };
      if (name.endsWith(".css")) return {};
      throw new Error(`Unexpected import ${name}`);
    },
  });
  const root = createRoot(dom.window.document.getElementById("root")!);
  let props = {
    kind: "project" as const,
    id: id(1),
    revision: 1,
    report: (error: unknown) => reported.push(error),
  };
  const render = async (patch: Partial<typeof props> = {}) => {
    props = { ...props, ...patch };
    await act(async () => {
      root.render(React.createElement(exports.ConnectionsMap, props));
    });
  };
  const click = async (selector: string) => {
    const node = dom.window.document.querySelector<HTMLElement>(selector);
    assert.ok(node, selector);
    await act(async () => node.click());
  };
  const settle = async (index: number, value: core.ConnectionMap) => {
    await act(async () => {
      calls[index].response.resolve(value);
    });
  };
  await render();
  return {
    dom,
    calls,
    opened,
    reported,
    render,
    click,
    settle,
    async account() {
      await act(async () => {
        token = "second";
        generation++;
        changes.forEach((fn) => fn());
      });
    },
    async close() {
      await act(async () => root.unmount());
      dom.window.close();
      for (const [key, descriptor] of prior) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
      }
    },
  };
}
test("linked work is usable before opening the optional map, bounded to eight with no dead person/date actions", async () => {
  const f = await fixture();
  try {
    await f.settle(0, { ...map("Project source"), truncated: true });
    assert.match(
      f.dom.window.document.body.textContent!,
      /Loaded the closest 14 connections/,
    );
    assert.equal(
      f.dom.window.document.querySelectorAll(".connection-list-row").length,
      8,
    );
    assert.equal(
      f.dom.window.document.querySelector(".connections-space"),
      null,
    );
    assert.match(f.dom.window.document.body.textContent!, /Task · Closed/);
    await f.click(".connection-list-row");
    assert.deepEqual(f.opened, [{ kind: "task", id: id(10) }]);
    await f.click(".connections-list > .text-button");
    assert.equal(
      f.dom.window.document.querySelectorAll(".connection-list-row").length,
      14,
    );
    const people = [
      ...f.dom.window.document.querySelectorAll(".is-informational"),
    ];
    assert.equal(people.length, 2);
    assert.ok(people.every((node) => node.tagName === "DIV"));
    await f.click(".connections-list > .text-button");
    assert.equal(
      f.dom.window.document.querySelectorAll(".connection-list-row").length,
      8,
    );
    await act(async () => {
      const details = f.dom.window.document.querySelector<HTMLDetailsElement>(
        ".connections-map-disclosure",
      )!;
      details.open = true;
      details.dispatchEvent(new f.dom.window.Event("toggle"));
    });
    assert.ok(f.dom.window.document.querySelector(".connections-space"));
  } finally {
    await f.close();
  }
});
test("changing source or revision clears old work immediately and ignores late replies", async () => {
  const f = await fixture();
  try {
    await f.settle(0, map("Original"));
    await f.render({ revision: 2 });
    assert.doesNotMatch(f.dom.window.document.body.textContent!, /Original/);
    await f.render({ id: id(2) });
    await f.settle(1, map("Late prior source"));
    assert.doesNotMatch(
      f.dom.window.document.body.textContent!,
      /Original|Late prior source/,
    );
    await f.settle(2, map("Current source"));
    assert.match(
      f.dom.window.document.body.textContent!,
      /Current source linked task/,
    );
  } finally {
    await f.close();
  }
});
test("read failures erase actionable rows and Retry renders only the recovered snapshot", async () => {
  const f = await fixture();
  try {
    await f.settle(0, map("Prior"));
    await f.render({ revision: 2 });
    await act(async () => f.calls[1].response.reject(new Error("offline")));
    assert.equal(
      f.dom.window.document.querySelectorAll(".connection-list-row").length,
      0,
    );
    assert.match(
      f.dom.window.document.querySelector("[role=alert]")!.textContent!,
      /Could not load connections/,
    );
    await f.click(".connections-note button");
    assert.equal(f.calls.length, 3);
    await f.settle(2, map("Recovered"));
    assert.match(
      f.dom.window.document.body.textContent!,
      /Recovered linked task/,
    );
    assert.doesNotMatch(
      f.dom.window.document.body.textContent!,
      /Prior linked task/,
    );
  } finally {
    await f.close();
  }
});
test("account change clears current rows and fences the old account's pending response", async () => {
  const f = await fixture();
  try {
    await f.settle(0, map("Private first account"));
    await f.render({ revision: 2 });
    await f.account();
    assert.doesNotMatch(
      f.dom.window.document.body.textContent!,
      /Private first account/,
    );
    await f.settle(1, map("Late private result"));
    assert.doesNotMatch(
      f.dom.window.document.body.textContent!,
      /Late private result/,
    );
    await f.settle(2, map("Second account"));
    assert.match(
      f.dom.window.document.body.textContent!,
      /Second account linked task/,
    );
  } finally {
    await f.close();
  }
});
