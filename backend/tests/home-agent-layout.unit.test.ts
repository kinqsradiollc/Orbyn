import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as core from "@orbyn/core";

/** Exercise the real page tree; this does not establish visual layout acceptance. */
function home(signedIn: boolean) {
  const source = readFileSync(
    new URL("../../desktop/src/features/home/HomePage.tsx", import.meta.url),
    "utf8",
  );
  const icon = () => React.createElement("svg", { "aria-hidden": true });
  const modules: Record<string, unknown> = {
    "lucide-react": new Proxy({}, { get: () => icon }),
    "@orbyn/core": core,
    "../../components/Character": {
      Character: ({ name }: { name: string }) =>
        React.createElement("span", null, name),
    },
    "../../hooks/useReveal": { useReveal: () => undefined },
    "../../lib/motion": { stagger: () => ({}) },
    "./HomeDemos": { LinkDemo: () => null, WeekDemo: () => null },
    "./faq": { FAQ: [] },
    "./home.css": {},
  };
  const exports: Record<string, React.ComponentType<any>> = {};
  runInNewContext(
    ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.React,
      },
    }).outputText,
    {
      exports,
      React,
      require(name: string) {
        assert.ok(name in modules, `Unexpected page dependency: ${name}`);
        return modules[name];
      },
    },
  );
  return renderToStaticMarkup(
    React.createElement(exports.HomePage, { signedIn, onNavigate: () => {} }),
  );
}

for (const signedIn of [false, true]) {
  test(`public Home prioritizes agent responsibilities and preserves characters (${signedIn})`, () => {
    const html = home(signedIn);
    assert.match(html, /href="#agents"/);
    const agents = html.indexOf('id="agents"');
    const characters = html.indexOf('id="companions"');
    assert.ok(agents > 0 && characters > agents);
    const work = html.slice(agents, html.indexOf('id="features"'));
    for (const guide of core.HOME_AGENT_GUIDE) {
      assert.ok(work.includes(guide.name));
      assert.ok(work.includes(guide.result));
      assert.ok(work.includes(guide.pause));
    }
    assert.match(work, /Example request/);
    assert.match(work, /idle until they have authorized work/);
    assert.doesNotMatch(work, /Working now|Active now|Reflection complete/);
    for (const character of core.CHARACTER_PRESETS)
      assert.ok(html.includes(character.name), character.name);
    assert.match(html, signedIn ? /Open your planner/ : /Get started/);
  });
}
