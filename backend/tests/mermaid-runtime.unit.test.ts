import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { prepareMermaidSource, MERMAID_MAX_SVG, colors } from "@orbyn/core";

/** Exercise the real message handler with controlled engine and DOM boundaries. */
function runtime(
  render: (id: string, source: string) => Promise<{ svg: string }>,
  style = "",
) {
  const messages: Record<string, unknown>[] = [];
  const handlers: Record<string, (event: unknown) => Promise<void>> = {};
  const removed: string[] = [];
  const configurations: Record<string, unknown>[] = [];
  const parent = {};
  const drawing = {
    style: {},
    viewBox: { baseVal: { width: 300, height: 160 } },
  };
  const host = {
    replaceChildren() {},
    innerHTML: "",
    querySelector() {
      return drawing;
    },
  };
  const parsed = {
    documentElement: {},
    querySelectorAll(selector: string) {
      if (selector !== "*") {
        removed.push(selector);
        return [];
      }
      return [{ tagName: "style", textContent: style, attributes: [] }];
    },
  };
  const source = readFileSync(
    new URL("../../mobile/scripts/mermaid-runtime.mjs", import.meta.url),
    "utf8",
  ).replace(/^import[^;]+;\s*/gm, "");
  runInNewContext(source, {
    mermaid: {
      initialize: (config: Record<string, unknown>) =>
        configurations.push(config),
      render,
    },
    prepareMermaidSource,
    MERMAID_MAX_SVG,
    window: {
      parent,
      addEventListener: (name: string, fn: (event: unknown) => Promise<void>) =>
        (handlers[name] = fn),
      ReactNativeWebView: undefined,
    },
    document: { getElementById: () => host, addEventListener() {} },
    DOMParser: class {
      parseFromString() {
        return parsed;
      }
    },
    XMLSerializer: class {
      serializeToString() {
        return '<svg xmlns="http://www.w3.org/2000/svg"><text>Fixture</text></svg>';
      }
    },
  });
  // Browser postMessage stays scoped to the controlled parent.
  Object.assign(parent, {
    postMessage: (data: string) => messages.push(JSON.parse(data)),
  });
  const palette = {
    background: colors.surface,
    primaryColor: colors.surface,
    primaryBorderColor: colors.accent,
    primaryTextColor: colors.text,
    secondaryColor: colors.soft,
    tertiaryColor: colors.surfaceMuted,
    lineColor: colors.muted,
    textColor: colors.text,
    noteBkgColor: colors.highBg,
    noteTextColor: colors.text,
  };
  const send = (
    id: string,
    patch: Record<string, unknown> = {},
    trusted = true,
  ) =>
    handlers.message({
      source: trusted ? parent : {},
      data: JSON.stringify({
        type: "orbyn-diagram",
        id,
        source: "flowchart TD\n A --> B",
        palette,
        ...patch,
      }),
    });
  return { send, messages, configurations, removed, palette };
}

test("isolated renderer accepts only host messages and pins every configuration key", async () => {
  let calls = 0;
  const fixture = runtime(async () => {
    calls++;
    return { svg: "<svg/>" };
  });
  await fixture.send("foreign", {}, false);
  assert.equal(calls, 0);
  await fixture.send("host");
  assert.equal(calls, 1);
  assert.equal(fixture.messages[0].id, "host");
  const config = fixture.configurations[0];
  assert.equal(config.securityLevel, "strict");
  assert.deepEqual(
    Array.from(config.secure as string[]).sort(),
    Object.keys(config).sort(),
  );
  assert.ok(fixture.removed[0].includes("animate"));
});

test("directives, invalid themes and oversized output cannot produce an exported image", async () => {
  const fixture = runtime(async () => ({
    svg: "a".repeat(MERMAID_MAX_SVG + 1),
  }));
  await fixture.send("directive", {
    source: '%%{init:{"securityLevel":"loose"}}%%\nflowchart TD\n A --> B',
  });
  await fixture.send("theme", {
    palette: { ...fixture.palette, background: "#12345" },
  });
  await fixture.send("large");
  assert.equal(fixture.messages.length, 3);
  for (const message of fixture.messages) {
    assert.equal(typeof message.error, "string");
    assert.equal(message.svg, undefined);
  }
});

test("CSS escapes, imports and external image functions are rejected for SVG export", async () => {
  for (const style of [
    '@import "https://fixture.invalid/x.css";',
    ".node{fill:u\\72l(https://fixture.invalid/x)}",
    '.node{background:image-set("https://fixture.invalid/x" 1x)}',
    ".node{fill:url(https://fixture.invalid/x)}",
  ]) {
    const fixture = runtime(async () => ({ svg: "<svg/>" }), style);
    await fixture.send("unsafe");
    assert.equal(typeof fixture.messages[0].error, "string");
    assert.equal(fixture.messages[0].svg, undefined);
  }
});

test("a newer render fences an older in-flight result and duplicate messages", async () => {
  let finish!: (value: { svg: string }) => void;
  let calls = 0;
  const fixture = runtime(async () => {
    calls++;
    if (calls === 1)
      return new Promise((resolve) => {
        finish = resolve;
      });
    return { svg: "<svg/>" };
  });
  const old = fixture.send("old");
  await fixture.send("new");
  await fixture.send("new");
  finish({ svg: "<svg/>" });
  await old;
  assert.equal(calls, 2);
  assert.equal(fixture.messages.length, 1);
  assert.equal(fixture.messages[0].id, "new");
});
