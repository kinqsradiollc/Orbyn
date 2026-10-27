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

test("writing replaces prose in place and yields to links, selections, source and read-only state", async () => {
  const { JSDOM } = mobileRequire("jsdom");
  const dom = new JSDOM('<div id="root"></div>', { url: "http://localhost/" });
  const names = [
    "window",
    "document",
    "HTMLElement",
    "Node",
    "IS_REACT_ACT_ENVIRONMENT",
  ];
  const saved = names.map(
    (name) =>
      [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const,
  );
  for (const name of names)
    Object.defineProperty(globalThis, name, {
      configurable: true,
      writable: true,
      value: name === "IS_REACT_ACT_ENVIRONMENT" ? true : dom.window[name],
    });
  // React's legacy-input fallback is irrelevant to the tested pointer/key flow.
  dom.window.HTMLElement.prototype.attachEvent = () => {};
  dom.window.HTMLElement.prototype.detachEvent = () => {};
  const React = require("react");
  const root = require("react-dom/client").createRoot(
    dom.window.document.querySelector("#root"),
  );
  const actions = { exports: {} as any };
  runInNewContext(
    transformSync(
      readFileSync(
        new URL(
          "../../desktop/src/features/documents/editor/DocBlockActions.tsx",
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
      module: actions,
      exports: actions.exports,
      require: (name: string) =>
        name === "../../../components/Popover"
          ? { Popover: () => null }
          : require(name),
    },
  );
  const module = { exports: {} as any };
  runInNewContext(
    transformSync(
      readFileSync(
        new URL(
          "../../desktop/src/features/documents/editor/DocWritingBlock.tsx",
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
      window: dom.window,
      require: (name: string) =>
        name === "./DocBlockActions" ? actions.exports : require(name),
    },
  );
  let editing = false,
    canWrite = true,
    sourceOpen = false,
    sourceFocus = 0,
    edits = 0;
  let text = "Saved prose.";
  const render = () =>
    root.render(
      React.createElement(
        module.exports.DocWritingBlock,
        {
          index: 0,
          path: [0],
          blockId: "owned",
          text,
          canWrite,
          editing,
          sourceOpen,
          onEdit: () => {
            edits++;
            editing = true;
            render();
          },
          onDone: () => {
            editing = false;
            render();
          },
          onSourceFocus: () => {
            sourceFocus++;
          },
          onChange: (next: string) => {
            text = next;
            render();
          },
          onComment: () => {},
          onAssist: () => {},
          assistDisabled: false,
        },
        React.createElement(
          "p",
          null,
          text,
          React.createElement(
            "a",
            {
              href: "#source",
              onClick: (event: Event) => event.preventDefault(),
            },
            "Link",
          ),
        ),
      ),
    );
  try {
    await React.act(render);
    const document = dom.window.document;
    assert.equal(document.querySelectorAll("textarea").length, 0);
    await React.act(() => document.querySelector("a")!.click());
    assert.equal(edits, 0, "link navigation must not start editing");
    const range = document.createRange();
    range.selectNodeContents(document.querySelector("p")!.firstChild!);
    dom.window.getSelection().addRange(range);
    await React.act(() => document.querySelector("p")!.click());
    assert.equal(edits, 0, "selecting text must not destroy the selection");
    dom.window.getSelection().removeAllRanges();
    await React.act(() => document.querySelector("p")!.click());
    assert.equal(edits, 1);
    assert.equal(
      document.querySelector("p"),
      null,
      "do not duplicate rendered prose below its editor",
    );
    assert.equal(document.querySelector("textarea")!.value, text);
    const field = document.querySelector("textarea")!;
    await React.act(() => {
      Object.getOwnPropertyDescriptor(
        dom.window.HTMLTextAreaElement.prototype,
        "value",
      )!.set!.call(field, "Changed prose.");
      field.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    });
    assert.equal(text, "Changed prose.");
    await React.act(() =>
      field.dispatchEvent(
        new dom.window.KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    assert.equal(document.querySelector("textarea"), null);
    assert.match(document.querySelector("p")!.textContent!, /Changed prose/);
    assert.equal(
      document.activeElement?.getAttribute("data-block-id"),
      "owned",
    );
    await React.act(() => document.querySelector("p")!.click());
    const finish = document.querySelector<HTMLButtonElement>(
      '[aria-label="Finish editing block 1"]',
    )!;
    finish.focus();
    await React.act(() => finish.click());
    assert.equal(document.querySelector("textarea"), null);
    assert.equal(
      document.activeElement?.getAttribute("data-block-id"),
      "owned",
      "Finish must return focus to the stable block when the button disappears",
    );
    sourceOpen = true;
    await React.act(render);
    await React.act(() => document.querySelector("p")!.click());
    assert.equal(sourceFocus, 1);
    assert.equal(edits, 2, "a source pane owns source clicks");
    sourceOpen = false;
    canWrite = false;
    await React.act(render);
    await React.act(() => document.querySelector("p")!.click());
    assert.equal(edits, 2);
    assert.equal(
      document.querySelector('[aria-label="Block 1 actions"]'),
      null,
    );
  } finally {
    await React.act(() => root.unmount());
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete (globalThis as any)[name];
    }
    dom.window.close();
  }
});

test("both structured parents offer direct Note insertion without flattening containers", () => {
  for (const path of [
    "desktop/src/features/documents/editor/StructuredDocEditor.tsx",
    "mobile/src/features/documents/editor/StructuredDocEditor.tsx",
  ]) {
    const source = readFileSync(
      new URL(`../../${path}`, import.meta.url),
      "utf8",
    );
    assert.match(source, /const index = document\.nodes\.length/);
    assert.match(source, /kind: "insert",\s*owner: \[\],\s*index/);
    assert.match(source, /type: "paragraph",\s*text: "",\s*id: newBlockId\(\)/);
    assert.match(source, /Add text/);
    assert.match(source, /chooseFormat/);
  }
});

test("narrow writing corrections retain full titles and Viewing page information", () => {
  const mobile = readFileSync(
    new URL(
      "../../mobile/src/features/documents/editor/StructuredDocEditor.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(mobile, /styles.titleEditor/);
  assert.match(
    mobile,
    /styles.title, StyleSheet.absoluteFill[\s\S]*?multiline[\s\S]*?scrollEnabled=\{false\}/,
  );
  assert.match(mobile, /session.title \|\| "Untitled"/);
  const legacy = readFileSync(
    new URL(
      "../../desktop/src/features/documents/editor/LegacyDocEditor.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(
    legacy,
    /<PageInfo\s+hidden=\{!showInfo \|\| showHistory \|\| chat\}/,
  );
});

test("format transitions finish inline editing only after draft save guards", () => {
  for (const client of [
    "desktop/src/features/documents/editor",
    "mobile/src/features/documents/editor",
  ]) {
    const source = readFileSync(
      new URL(`../../${client}/StructuredDocEditor.tsx`, import.meta.url),
      "utf8",
    );
    const choose = source.slice(
      source.indexOf("const chooseFormat = async"),
      source.indexOf("const chooseFormat = async") + 1900,
    );
    assert.match(choose, /await save\(\)/);
    assert.match(choose, /docEditorSessionDirty\(next.session\)/);
    assert.match(
      choose,
      /setEditing\(null\);[\s\S]*setLatexOpen\(format === "latex"\)/,
    );
    assert.ok(
      choose.indexOf("docEditorSessionDirty(next.session)") <
        choose.indexOf("setEditing(null)"),
    );
  }
});
