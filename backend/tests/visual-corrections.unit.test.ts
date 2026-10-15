import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { transformSync } from "esbuild";
import * as core from "@orbyn/core";
const require = createRequire(import.meta.url),
  mobileRequire = createRequire(
    new URL("../../mobile/package.json", import.meta.url),
  );
test("new booking pages use the shared accent and explicit saved branding remains unchanged", () => {
  const input = { slug: "preview-test", title: "Planning", durations: [30] };
  assert.equal(core.bookingPageInput.parse(input).color, core.colors.accent);
  assert.equal(
    core.bookingPageInput.parse({ ...input, color: "#376c51" }).color,
    "#376c51",
  );
});
test("collection headings use view identities and title fitting observes available width", () => {
  const app = readFileSync(
    new URL("../../desktop/src/app/App.tsx", import.meta.url),
    "utf8",
  );
  assert.match(app, /\["AI assistant", "Docs", "Memory", "Agent"\]/);
  const editor = readFileSync(
    new URL("../../desktop/src/features/docs/DocEditor.tsx", import.meta.url),
    "utf8",
  );
  assert.match(editor, /titleField.current/);
  assert.match(editor, /new ResizeObserver/);
  assert.match(editor, /width = next;\s*fitTitle\(node\)/);
});
test("mounted Focus dialog portals outside its scrolled containing pane and preserves that pane", async () => {
  const React = require("react"),
    { JSDOM } = mobileRequire("jsdom"),
    dom = new JSDOM('<div id="pane"><div id="root"></div></div>');
  const saved = [
    "window",
    "document",
    "HTMLElement",
    "IS_REACT_ACT_ENVIRONMENT",
  ].map(
    (name) =>
      [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const,
  );
  for (const [name] of saved)
    Object.defineProperty(globalThis, name, {
      configurable: true,
      writable: true,
      value:
        name === "IS_REACT_ACT_ENVIRONMENT" ? true : (dom.window as any)[name],
    });
  const root = require("react-dom/client").createRoot(
    dom.window.document.querySelector("#root"),
  );
  const pane = dom.window.document.querySelector("#pane")!;
  pane.scrollTop = 350;
  const item = {
    id: "focus-test",
    kind: "task",
    title: "Plan the week",
    status: "todo",
    due_at: null,
    estimate_minutes: 30,
  };
  let closed = 0;
  const deps: any = {
    react: React,
    "react/jsx-runtime": require("react/jsx-runtime"),
    "react-dom": require("react-dom"),
    "lucide-react": require("lucide-react"),
    "@orbyn/core": core,
    "../../lib/api": { client: { getItem: async () => ({ item, steps: [] }) } },
    "../../lib/planning": {
      errorText: (e: any) => String(e),
      minutesLabel: () => "0 min",
      nextUp: () => [],
    },
    "./useFocusSession": {
      useFocusSession: () => ({
        rhythm: { id: "open", work: 0 },
        intervals: false,
        today: 0,
        state: { ran_ms: 0 },
        refreshToday: async () => {},
        finish: async () => {},
      }),
    },
    "./focus.css": {},
    "../../hooks/useModalFocus": {
      useModalFocus: () => ({ id: "focus-dialog", ref: React.useRef(null) }),
    },
    "../../lib/session": { session: { get: () => "qa" } },
  };
  const module = { exports: {} as any };
  runInNewContext(
    transformSync(
      readFileSync(
        new URL(
          "../../desktop/src/features/focus/FocusMode.tsx",
          import.meta.url,
        ),
        "utf8",
      ),
      { loader: "tsx", format: "cjs", jsx: "automatic" },
    ).code,
    {
      module,
      exports: module.exports,
      require: (name: string) => {
        assert.ok(name in deps, name);
        return deps[name];
      },
      document: dom.window.document,
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
      window: dom.window,
    },
  );
  try {
    await React.act(async () =>
      root.render(
        React.createElement(module.exports.FocusMode, {
          item,
          items: [item],
          canWrite: false,
          onClose: () => closed++,
          onSwitch: () => {},
          onChanged: async () => {},
          onError: () => {},
        }),
      ),
    );
    const dialog = dom.window.document.querySelector('[role="dialog"]')!;
    assert.equal(dialog.parentElement, dom.window.document.body);
    assert.equal(dialog.scrollTop, 0);
    assert.equal(pane.scrollTop, 350);
    await React.act(async () => {
      (
        dialog.querySelector('[aria-label="Leave focus mode"]') as HTMLElement
      ).click();
      await new Promise((r) => setImmediate(r));
    });
    assert.equal(closed, 1);
    assert.equal(pane.scrollTop, 350);
  } finally {
    await React.act(async () => root.unmount());
    dom.window.close();
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete (globalThis as any)[name];
    }
  }
});

test("Docs owns the available editor width and uses shared source mode controls", () => {
  const sheet = readFileSync(
    new URL("../../mobile/src/screens/docs/DocsSheet.tsx", import.meta.url),
    "utf8",
  );
  assert.match(sheet, /open && !navigationOpen \? styles.editorColumn : null/);
  assert.match(sheet, /editorColumn: \{ maxWidth: "100%" \}/);
  assert.match(sheet, /sideList: \{\s*flexGrow: 0,\s*flexShrink: 0,/);
  const source = readFileSync(
    new URL(
      "../../mobile/src/screens/docs/DocSourcePreview.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(source, /<DocEditorModes/);
  assert.doesNotMatch(source, /secondary=\{mode !==/);
});

test("LaTeX source replacement preserves anchored or positional ownership, and insertion creates an ID", () => {
  for (const id of [undefined, "stable-tex"]) {
    const before: core.DocBlock[] = [
      { type: "paragraph", text: "Keep surrounding prose" },
      {
        type: "code",
        lang: core.DOC_LATEX_LANGUAGE,
        text: "Old",
        ...(id ? { id } : {}),
      },
    ];
    const after = core.withDocLatexSource(before, "New");
    assert.equal(after[1].id, id);
    assert.equal(after[0], before[0]);
    const doc: core.VersionedDocContent = {
      format: 2,
      nodes: [
        {
          kind: "quote",
          children: before.map((block) => ({ kind: "block" as const, block })),
        },
      ],
    };
    const operation = core.docLatexOperation(doc, "New");
    assert.equal(operation.kind, "replace-leaf");
    if (operation.kind !== "replace-leaf")
      throw new Error("Expected replacement");
    assert.deepEqual(operation.path, [0, 1]);
    assert.equal(operation.block.id, id);
  }
  assert.ok(core.withDocLatexSource([], "New")[0].id);
  const insertion = core.docLatexOperation({ format: 2, nodes: [] }, "New");
  assert.equal(insertion.kind, "insert");
  if (insertion.kind === "insert" && insertion.node.kind === "block")
    assert.ok(insertion.node.block.id);
});
