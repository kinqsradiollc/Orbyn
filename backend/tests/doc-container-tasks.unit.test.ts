import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseDocContainers,
  docContainerBlocks,
  docContainerTaskBlocks,
  applyDocContainerTaskBlocks,
  serializeDocContainers,
  type DocContainerNode,
} from "@orbyn/core";
const fixture = () =>
  parseDocContainers(
    "> [!NOTE]\n> - [ ] Parent ^parent\n>\n>   Continuation ^extra\n>\n>   - [x] Nested ^nested\n>   - Plain ^plain\n>\n> ```mermaid\n> graph TD; A-->B\n> ```\n^outer",
    { anchors: true },
  );
test("task view maps checkbox metadata onto first leaves without mutating stored paragraphs", () => {
  const nodes = fixture(),
    before = structuredClone(nodes);
  const projected = docContainerTaskBlocks(nodes);
  const tasks = projected.filter((block) => block.type === "todo");
  assert.deepEqual(
    tasks.map((b: any) => [b.id, b.done]),
    [
      ["parent", false],
      ["nested", true],
    ],
  );
  assert.equal(projected.find((b) => b.id === "extra")?.type, "paragraph");
  assert.equal(projected.find((b) => b.id === "plain")?.type, "paragraph");
  assert.deepEqual(nodes, before);
  assert.ok(docContainerBlocks(nodes).every((block) => block.type !== "todo"));
});
test("task completion maps back to exact owners and retains text/continuation/code/identity", () => {
  const nodes = fixture(),
    before = structuredClone(nodes);
  const view = docContainerTaskBlocks(nodes).map((block) =>
    block.type === "todo" ? { ...block, done: !block.done } : block,
  );
  const restored = applyDocContainerTaskBlocks(nodes, view);
  assert.match(
    serializeDocContainers(restored, { anchors: true }),
    /\[x\] Parent/,
  );
  assert.match(
    serializeDocContainers(restored, { anchors: true }),
    /\[ \] Nested/,
  );
  assert.deepEqual(docContainerBlocks(restored), docContainerBlocks(before));
  assert.deepEqual(nodes, before);
  assert.equal((restored[0] as any).id, "outer");
  assert.equal(
    docContainerTaskBlocks(restored).filter((b) => b.type === "todo").length,
    2,
  );
});
test("new task identity is assigned only to the owning first paragraph", () => {
  const nodes = parseDocContainers("- [ ] First\n\n  More words");
  const view = docContainerTaskBlocks(nodes).map((block, index) =>
    index === 0 ? { ...block, id: "assigned" } : block,
  );
  const restored = applyDocContainerTaskBlocks(nodes, view);
  assert.equal(docContainerBlocks(restored)[0].id, "assigned");
  assert.equal(docContainerBlocks(restored)[1].id, undefined);
  assert.equal(docContainerBlocks(nodes)[0].id, undefined);
});
test("existing todo leaves retain type and nested checklist ownership when supported", () => {
  const nodes: DocContainerNode[] = [
    {
      kind: "list",
      ordered: false,
      start: 1,
      delimiter: "-",
      loose: false,
      items: [
        {
          checked: false,
          children: [
            {
              kind: "block",
              block: {
                type: "todo",
                id: "legacy",
                text: "Task",
                done: false,
                depth: 1,
              },
            },
          ],
        },
      ],
    },
  ];
  const view = docContainerTaskBlocks(nodes).map((block) =>
    block.type === "todo" ? { ...block, done: true } : block,
  );
  const restored = applyDocContainerTaskBlocks(nodes, view);
  assert.equal((restored[0] as any).items[0].checked, true);
  assert.deepEqual(docContainerBlocks(restored)[0], {
    type: "todo",
    id: "legacy",
    text: "Task",
    done: true,
    depth: 1,
  });
});
test("task projection cannot reorder identities, flatten leaves, drop checkbox state or collide", () => {
  const nodes = fixture(),
    view = docContainerTaskBlocks(nodes),
    before = structuredClone(nodes);
  assert.throws(() => applyDocContainerTaskBlocks(nodes, view.slice(1)));
  assert.throws(() => applyDocContainerTaskBlocks(nodes, [...view].reverse()));
  assert.throws(() =>
    applyDocContainerTaskBlocks(
      nodes,
      view.map((block) =>
        block.type === "todo"
          ? { type: "paragraph", text: block.text, id: block.id }
          : block,
      ),
    ),
  );
  assert.throws(() =>
    applyDocContainerTaskBlocks(
      nodes,
      view.map((block) =>
        block.id === "parent" ? { ...block, id: "other" } : block,
      ),
    ),
  );
  assert.deepEqual(nodes, before);
});

test("task view cannot assign a task identity to unrelated unowned paragraphs", () => {
  const nodes = parseDocContainers("Plain paragraph");
  assert.throws(() =>
    applyDocContainerTaskBlocks(
      nodes,
      docContainerTaskBlocks(nodes).map((block) => ({
        ...block,
        id: "not-a-task",
      })),
    ),
  );
});

test("anonymous shared caller objects retain separate checkbox owners and returned views are detached", () => {
  const leaf: DocContainerNode = {
    kind: "block",
    block: { type: "paragraph", text: "Words" },
  };
  const nodes: DocContainerNode[] = [
    {
      kind: "list",
      ordered: false,
      start: 1,
      delimiter: "-",
      loose: false,
      items: [
        { checked: false, children: [leaf] },
        { checked: true, children: [leaf] },
      ],
    },
  ];
  const view = docContainerTaskBlocks(nodes);
  assert.deepEqual(
    view.map((block: any) => block.done),
    [false, true],
  );
  (view[0] as any).text = "Changed view";
  assert.equal(leaf.block.text, "Words");
});
