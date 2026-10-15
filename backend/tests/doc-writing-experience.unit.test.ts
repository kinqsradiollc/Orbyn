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
          "../../desktop/src/features/docs/DocBlockActions.tsx",
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
        name === "../../components/Popover"
          ? { Popover: () => null }
          : require(name),
    },
  );
  const module = { exports: {} as any };
  runInNewContext(
    transformSync(
      readFileSync(
        new URL(
          "../../desktop/src/features/docs/DocWritingBlock.tsx",
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
    "desktop/src/features/docs/StructuredDocEditor.tsx",
    "mobile/src/screens/docs/StructuredDocEditor.tsx",
  ]) {
    const source = readFileSync(
      new URL(`../../${path}`, import.meta.url),
      "utf8",
    );
    assert.match(source, /const index = document\.nodes\.length/);
    assert.match(source, /kind: "insert",\s*owner: \[\],\s*index/);
    assert.match(source, /type: "paragraph",\s*text: "",\s*id: newBlockId\(\)/);
    assert.match(source, /Add text/);
    assert.match(source, /keepRendered=\{block\.type === "code"\}/);
  }
});

for (const native of [false, true])
  test(`${native ? "mobile" : "web"} writing wrapper keeps a visible code result through edit, source change and Done`, async () => {
    const { JSDOM } = mobileRequire("jsdom");
    const dom = new JSDOM('<div id="root"></div>');
    const names = [
      "window",
      "document",
      "HTMLElement",
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
    dom.window.HTMLElement.prototype.attachEvent = () => {};
    dom.window.HTMLElement.prototype.detachEvent = () => {};
    const React = require("react");
    const root = require("react-dom/client").createRoot(
      dom.window.document.querySelector("#root"),
    );
    const module = { exports: {} as any };
    const path = native
      ? "../../mobile/src/screens/docs/DocWritingBody.tsx"
      : "../../desktop/src/features/docs/DocWritingBlock.tsx";
    const mocks: Record<string, unknown> = {
      "./DocBlockActions": { DocBlockActions: () => null },
      "react-native": {
        View: ({
          children,
          style,
          pointerEvents,
          accessibilityElementsHidden,
        }: any) =>
          React.createElement(
            "div",
            {
              style: { ...style, pointerEvents },
              "aria-hidden": accessibilityElementsHidden,
            },
            children,
          ),
        TextInput: ({ value, onChangeText, accessibilityLabel }: any) =>
          React.createElement("textarea", {
            value,
            onChange: (event: any) => onChangeText(event.currentTarget.value),
            "aria-label": accessibilityLabel,
          }),
        StyleSheet: { create: (styles: unknown) => styles },
      },
      "../../theme": {
        colors: { text: "currentColor" },
        inputFontSize: 16,
        themed: (make: () => unknown) => make(),
      },
    };
    runInNewContext(
      transformSync(readFileSync(new URL(path, import.meta.url), "utf8"), {
        loader: "tsx",
        format: "cjs",
        jsx: "automatic",
      }).code,
      {
        module,
        exports: module.exports,
        window: dom.window,
        require: (name: string) =>
          name in mocks ? mocks[name] : require(name),
      },
    );
    let editing = false,
      text = "Original TeX",
      mounts = 0,
      doneCalls = 0;
    const Viewer = () => {
      React.useEffect(() => {
        mounts++;
      }, []);
      return React.createElement("iframe", { title: "Canonical code viewer" });
    };
    const render = () =>
      root.render(
        React.createElement(
          native
            ? module.exports.DocWritingBody
            : module.exports.DocWritingBlock,
          {
            index: 0,
            path: [0],
            text,
            canWrite: true,
            editing,
            keepRendered: true,
            sourceOpen: false,
            onChange: (next: string) => {
              text = next;
              render();
            },
            onEdit: () => {},
            onDone: () => {
              doneCalls++;
            },
            onComment: () => {},
            onAssist: () => {},
            onSourceFocus: () => {},
            assistDisabled: true,
          },
          React.createElement(Viewer),
        ),
      );
    try {
      await React.act(render);
      const document = dom.window.document;
      const viewer = document.querySelector("iframe");
      assert.ok(viewer);
      editing = true;
      await React.act(render);
      assert.equal(document.querySelector("iframe"), viewer);
      if (!native) {
        await React.act(() => {
          document.querySelector("textarea")!.dispatchEvent(
            new dom.window.FocusEvent("focusout", {
              bubbles: true,
              relatedTarget: null,
            }),
          );
        });
        assert.equal(
          doneCalls,
          0,
          "preview iframe focus must not finish code editing",
        );
      }
      const hidden = viewer.parentElement!;
      if (native) {
        assert.notEqual(hidden.style.display, "none");
        assert.equal(hidden.style.pointerEvents, "auto");
        assert.equal(hidden.getAttribute("aria-hidden"), "false");
      } else {
        assert.equal(hidden.hidden, false);
        assert.equal(hidden.hasAttribute("inert"), false);
      }
      const field = document.querySelector("textarea")!;
      await React.act(() => {
        Object.getOwnPropertyDescriptor(
          dom.window.HTMLTextAreaElement.prototype,
          "value",
        )!.set!.call(field, "Changed TeX");
        field.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
      });
      assert.equal(text, "Changed TeX");
      editing = false;
      await React.act(render);
      assert.equal(document.querySelector("iframe"), viewer);
      assert.equal(document.querySelector("textarea"), null);
      assert.equal(mounts, 1, "editing must never remount the code viewer");
      if (native) assert.equal(viewer.parentElement!.style.display, "");
      else assert.equal(viewer.parentElement!.hidden, false);
    } finally {
      await React.act(() => root.unmount());
      for (const [name, descriptor] of saved) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else delete (globalThis as any)[name];
      }
      dom.window.close();
    }
  });

test("narrow writing corrections retain full titles and Viewing page information", () => {
  const mobile = readFileSync(
    new URL(
      "../../mobile/src/screens/docs/StructuredDocEditor.tsx",
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
    new URL("../../desktop/src/features/docs/DocEditor.tsx", import.meta.url),
    "utf8",
  );
  assert.match(
    legacy,
    /<PageInfo\s+hidden=\{!showInfo \|\| showHistory \|\| chat\}/,
  );
});

test("source precedes the common Note in wide structured split editing", () => {
  const css = readFileSync(
    new URL(
      "../../desktop/src/features/docs/structured-doc-editor.css",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(
    css,
    /data-active-pane="split"\] > \.structured-doc-source\s*\{\s*grid-column: 1;/,
  );
  assert.match(
    css,
    /data-active-pane="split"\] > \.structured-doc-preview\s*\{\s*grid-column: 2;/,
  );
  assert.match(
    css,
    /structured-doc-leaf\[data-code-editing\]\s*\{[\s\S]*?grid-template-columns: minmax\(0, 1fr\) minmax\(0, 1fr\)/,
  );
});
