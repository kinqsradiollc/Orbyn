import { test } from "node:test";
import assert from "node:assert/strict";
import { createContext, runInContext } from "node:vm";
import { APP_CARDS } from "../src/modules/mcp-server/apps.js";

// Exercise the shipped card state machine. This is deterministic contract
// evidence, not browser/host rendering or layout evidence.
function fixture() {
  class Node {
    value = "";
    textContent = "";
    hidden = false;
    disabled = false;
    readOnly = false;
    dataset: Record<string, string> = {};
    children: Node[] = [];
    get childNodes() {
      return this.children;
    }
    constructor(public tag = "") {}
    append(...nodes: Node[]) {
      this.children.push(...nodes);
      if (this.tag === "select" && !this.value)
        this.value = nodes[0]?.value || "";
    }
    replaceChildren(...nodes: Node[]) {
      this.children = [];
      this.value = "";
      this.append(...nodes);
    }
    querySelectorAll() {
      return [];
    }
  }
  const nodes = new Map<string, Node>();
  const calls: {
    params: any;
    resolve: (value: any) => void;
    reject: (reason: any) => void;
  }[] = [];
  let ids = 0;
  const context = createContext({
    document: {
      getElementById: (id: string) => {
        if (!nodes.has(id))
          nodes.set(id, new Node(id === "document-line" ? "select" : ""));
        return nodes.get(id);
      },
    },
    DOMParser: class {
      parseFromString() {
        return { body: new Node() };
      }
    },
    crypto: { randomUUID: () => "operation-" + ++ids },
    URL,
    Object,
    Date,
    el: (tag: string, _cls?: string, text?: string) => {
      const node = new Node(tag);
      node.textContent = text || "";
      return node;
    },
    resize: () => {},
    openLink: () => {},
    request: (_method: string, params: any) =>
      new Promise((resolve, reject) => calls.push({ params, resolve, reject })),
  });
  const card = APP_CARDS.find((card) => card.uri === "ui://orbyn/result.html")!;
  runInContext(card.script, context);
  return {
    nodes,
    calls,
    run: (source: string) => runInContext(source, context),
    render: (result: any) => {
      context.input = result;
      runInContext("render(input)", context);
    },
  };
}
const result = (id = "doc:A", version = 1, editable = true) => ({
  structuredContent: { id, title: id },
  _meta: {
    "orbyn/document-preview": {
      id,
      version,
      editable,
      html: "",
      lines: [{ anchor: "bline", markdown: "Old ^bline" }],
    },
  },
});
const settle = () => new Promise((resolve) => setImmediate(resolve));

test("replacement keeps dirty editor visibly on A; explicit discard switches to B and read-only results clear controls", () => {
  const f = fixture();
  f.render(result());
  f.run('draft.value="New ^bline";draft.oninput()');
  f.render(result("doc:B"));
  assert.equal(f.nodes.get("result-title")!.textContent, "doc:A");
  assert.equal(f.run("doc.id"), "doc:A");
  f.run("discardDoc.onclick()");
  assert.equal(f.run("doc.id"), "doc:B");
  f.render(result("doc:B", 2, false));
  assert.equal(f.run("doc"), null);
  assert.equal(f.nodes.get("document-edit")!.hidden, true);
  f.render({ isError: true, content: [] });
  assert.equal(f.run("doc"), null);
});

test("lost response retries identical immutable payload and prevents review/reset/switch", async () => {
  const f = fixture();
  f.render(result());
  f.run(
    'draft.value="New ^bline";draft.oninput();review.onclick();saveDoc.onclick()',
  );
  assert.equal(f.nodes.get("document-source")!.readOnly, true);
  const first = f.calls[0];
  first.reject(new Error("lost response"));
  await settle();
  f.run("review.onclick();discardDoc.onclick();refreshDoc.onclick()");
  assert.equal(f.calls.length, 1);
  f.render(result("doc:B"));
  assert.equal(f.run("doc.id"), "doc:A");
  f.run("saveDoc.onclick()");
  assert.deepEqual(f.calls[1].params, first.params);
  f.calls[1].resolve({
    structuredContent: { pending: { review_url: "https://orbyn.test/review" } },
  });
  await settle();
  assert.equal(f.run("saveState"), "completed");
  assert.equal(f.nodes.get("document-save")!.hidden, true);
  f.run("discardDoc.onclick()");
  assert.equal(f.run("doc.id"), "doc:B");
});

test("conflict refresh preserves draft and reviews current version with a new explicit request", async () => {
  const f = fixture();
  f.render(result());
  f.run(
    'draft.value="Kept ^bline";draft.oninput();review.onclick();saveDoc.onclick()',
  );
  f.calls[0].resolve({
    isError: true,
    _meta: { "orbyn/error": { code: "CONFLICT" } },
  });
  await settle();
  f.run("refreshDoc.onclick()");
  f.calls[1].resolve(result("doc:A", 2));
  await settle();
  assert.equal(f.nodes.get("document-source")!.value, "Kept ^bline");
  assert.equal(f.run("doc.version"), 2);
  f.run("review.onclick();saveDoc.onclick()");
  assert.equal(f.calls[2].params.arguments.version, 2);
  assert.notEqual(
    f.calls[2].params.arguments.client_ref,
    f.calls[0].params.arguments.client_ref,
  );
  f.calls[2].resolve({ structuredContent: { done: [] } });
  await settle();
});

test("delayed save retains the displayed target and refresh cannot replace a switched document", async () => {
  const f = fixture();
  f.render(result());
  f.run(
    'draft.value="Kept ^bline";draft.oninput();review.onclick();saveDoc.onclick()',
  );
  f.render(result("doc:B"));
  assert.equal(f.nodes.get("result-title")!.textContent, "doc:A");
  f.calls[0].resolve({ structuredContent: { done: [] } });
  await settle();
  f.run("discardDoc.onclick();refreshDoc.onclick()");
  f.render(result("doc:C"));
  f.calls[1].resolve(result("doc:B", 2));
  await settle();
  assert.equal(f.run("doc.id"), "doc:C");
});
