import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as core from "@orbyn/core";

function fixture(mobile: boolean) {
  const path = mobile
    ? "../../mobile/src/components/HomeCompanions.tsx"
    : "../../desktop/src/features/overview/HomeCompanions.tsx";
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  const states: unknown[] = [];
  let index = 0;
  let mounted = false;
  let effect: (() => () => void) | undefined;
  let listener: ((value: unknown) => void) | undefined;
  let resolve: ((value: unknown) => void) | undefined;
  let reads = 0;
  const hooks = {
    ...React,
    useState(initial: unknown) {
      const slot = index++;
      if (!(slot in states)) states[slot] = initial;
      return [
        states[slot],
        (value: unknown) => {
          states[slot] = value;
        },
      ];
    },
    useEffect(callback: () => () => void) {
      if (!mounted) effect = callback;
    },
  };
  const container = ({ children }: { children: React.ReactNode }) =>
    React.createElement("div", null, children);
  const modules: Record<string, unknown> = {
    react: hooks,
    "@orbyn/core": core,
    "react-native": { Text: container, View: container },
    "../../lib/api": {
      client: {
        agentSettings(options: unknown) {
          assert.deepEqual(JSON.parse(JSON.stringify(options)), {
            fresh: true,
          });
          reads++;
          return new Promise((done) => {
            resolve = done;
          });
        },
        onAgentSettings(callback: (value: unknown) => void) {
          listener = callback;
          return () => {
            listener = undefined;
          };
        },
      },
    },
    "../../components/Character": {
      Character: ({ name }: { name: string }) =>
        React.createElement("span", null, name),
    },
    "../styles": { shared: {} },
    "../theme": { controls: { tap: 44 }, colors: { border: "border" } },
    "../motion": { Pressable: container },
    "./Button": {
      Button: ({ title }: { title: string }) =>
        React.createElement("button", null, title),
    },
    "../assistant/AssistantAgents": {
      AssistantAgents: ({ visible = true }: { visible?: boolean }) =>
        visible ? React.createElement("div", null, "Profiles open") : null,
    },
  };
  modules["../screens/AssistantAgents"] =
    modules["../assistant/AssistantAgents"];
  modules["../lib/api"] = modules["../../lib/api"];
  modules["./Character"] = modules["../../components/Character"];
  const exports: Record<string, () => React.ReactElement> = {};
  runInNewContext(
    ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.React,
        esModuleInterop: true,
      },
    }).outputText,
    {
      exports,
      require: (name: string) => {
        if (!(name in modules))
          throw new Error(`Unexpected UI dependency ${name}`);
        return modules[name];
      },
      React,
    },
  );
  const render = () => {
    index = 0;
    const tree = exports.HomeCompanions();
    mounted = true;
    return tree;
  };
  const first = render();
  const cleanup = effect!();
  return {
    first,
    render,
    cleanup,
    reads: () => reads,
    update: (value: unknown) => listener!(value),
    resolve: async (value: unknown) => {
      resolve!(value);
      await Promise.resolve();
    },
  };
}
function action(node: React.ReactNode): (() => void) | undefined {
  if (!React.isValidElement(node)) return;
  const props = node.props as {
    onClick?: () => void;
    onPress?: () => void;
    children?: React.ReactNode;
  };
  return (
    props.onClick ??
    props.onPress ??
    React.Children.toArray(props.children).map(action).find(Boolean)
  );
}
function profileAction(node: React.ReactNode): (() => void) | undefined {
  if (!React.isValidElement(node)) return;
  const props = node.props as {
    title?: string;
    onClick?: () => void;
    onPress?: () => void;
    children?: React.ReactNode;
  };
  if (
    props.title === "View agent activity" ||
    props.children === "View agent activity"
  )
    return props.onClick ?? props.onPress;
  return React.Children.toArray(props.children)
    .map(profileAction)
    .find(Boolean);
}
function guideAction(node: React.ReactNode): (() => void) | undefined {
  if (!React.isValidElement(node)) return;
  const props = node.props as {
    onClick?: () => void;
    onPress?: () => void;
    children?: React.ReactNode;
  };
  if (props.children === "How agents work" || props.children === "Hide guide")
    return props.onClick ?? props.onPress;
  const labels = React.Children.toArray(props.children);
  if (
    (props.onClick || props.onPress) &&
    labels.some(
      (child) =>
        React.isValidElement(child) &&
        ["How agents work", "Hide guide"].includes(
          (child.props as { children: string }).children,
        ),
    )
  )
    return props.onClick ?? props.onPress;
  return labels.map(guideAction).find(Boolean);
}
for (const mobile of [false, true]) {
  const platform = mobile ? "native" : "web";
  test(`${platform} Home describes results and morning review without fabricated activity`, () => {
    const view = fixture(mobile);
    const compact = renderToStaticMarkup(view.first);
    assert.match(compact, /Background/);
    assert.match(compact, /Overnight/);
    assert.match(compact, /How agents work/);
    assert.doesNotMatch(compact, /Example request/);
    for (const agent of core.HOME_AGENT_GUIDE) {
      assert.ok(compact.includes(agent.result));
      assert.ok(compact.includes(agent.pause));
    }
    guideAction(view.first)!();
    const html = renderToStaticMarkup(view.render());
    assert.match(html, /Example request/);
    for (const agent of core.HOME_AGENT_GUIDE)
      for (const step of agent.steps) {
        assert.ok(html.includes(step.title));
        assert.ok(html.includes(step.body));
      }
    assert.match(html, /Hide guide/);
    assert.match(html, /Background/);
    assert.match(html, /When you delegate a task/);
    assert.match(html, /needs an answer or approval/);
    assert.match(html, /Give it the project notes/);
    assert.match(html, /sources in agent activity/);
    assert.match(html, /Overnight/);
    assert.match(html, /Inside your chosen night window/);
    assert.match(html, /work budget limit the run/);
    assert.match(html, /In the morning, see what finished/);
    assert.match(html, /unfinished tasks in Overnight/);
    assert.match(html, /idle until they have authorized work/);
    assert.doesNotMatch(html, /Working now|Active now|Reflection complete/);
    guideAction(view.render())!();
    assert.doesNotMatch(renderToStaticMarkup(view.render()), /Example request/);
    assert.equal(view.reads(), 1);
    view.cleanup();
  });
  test(`${platform} Home exposes the separate profiles on explicit request`, () => {
    const view = fixture(mobile);
    assert.doesNotMatch(renderToStaticMarkup(view.first), /Profiles open/);
    profileAction(view.first)!();
    assert.match(renderToStaticMarkup(view.render()), /Profiles open/);
    assert.equal(view.reads(), 1);
    view.cleanup();
  });
  test(`${platform} Home browses every preset without changing settings`, () => {
    const view = fixture(mobile);
    assert.doesNotMatch(renderToStaticMarkup(view.first), /Cozy bunny/);
    action(view.first)!();
    const html = renderToStaticMarkup(view.render());
    for (const preset of core.CHARACTER_PRESETS)
      assert.ok(html.includes(preset.name), preset.name);
    assert.equal(view.reads(), 1);
    view.cleanup();
  });
  test(`${platform} Home keeps a live character edit over a stale initial response`, async () => {
    const view = fixture(mobile);
    view.update({
      name: "Current companion",
      character: core.DEFAULT_CHARACTER,
    });
    await view.resolve({
      name: "Stale companion",
      character: core.DEFAULT_CHARACTER,
    });
    const html = renderToStaticMarkup(view.render());
    assert.match(html, /Current companion/);
    assert.doesNotMatch(html, /Stale companion/);
    view.cleanup();
  });
  test(`${platform} closing Home fences a late companion response`, async () => {
    const view = fixture(mobile);
    view.cleanup();
    await view.resolve({
      name: "Closed account",
      character: core.DEFAULT_CHARACTER,
    });
    assert.doesNotMatch(renderToStaticMarkup(view.render()), /Closed account/);
  });
}
