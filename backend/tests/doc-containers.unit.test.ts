import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseDocContainers,
  docContainersHtml,
  serializeDocContainers,
  docContainerBlocks,
  mapDocContainerBlocks,
  projectDocContainers,
  validateDocContainers,
  visitDocContainers,
  DocContainerError,
  DOC_CONTAINER_LIMITS,
  redactValue,
  type DocContainerNode,
} from "@orbyn/core";

const roundTrip = (source: string, anchors = false) => {
  const nodes = parseDocContainers(source, { anchors });
  assert.deepEqual(
    parseDocContainers(serializeDocContainers(nodes, { anchors }), { anchors }),
    nodes,
  );
  return nodes;
};
test("quote owns headings, paragraphs, fenced code and nested quotes", () => {
  const nodes = roundTrip(
    '> # Heading\n>\n> Words\n>\n> ```ts\n> const x = "> literal";\n> ```\n>\n> > Nested',
  );
  assert.equal(nodes[0].kind, "quote");
  assert.deepEqual(
    docContainerBlocks(nodes).map((b) => b.type),
    ["heading", "paragraph", "code", "paragraph"],
  );
  assert.equal(nodes[0].kind === "quote" && nodes[0].children[3].kind, "quote");
  assert.equal(docContainerBlocks(nodes)[2].text, 'const x = "> literal";');
});
test("list owns paragraphs, code, math, tables, nested lists and task state", () => {
  const nodes = roundTrip(
    "- [x] First\n\n  Second paragraph\n\n  ```js\n  run();\n  ```\n\n  $$\n  x^2\n  $$\n\n  | A | B |\n  | --- | --- |\n  | 1 | 2 |\n\n  - child\n- [ ] Next",
  );
  assert.equal(nodes.length, 1);
  const list = nodes[0];
  assert.equal(list.kind, "list");
  if (list.kind !== "list") return;
  assert.equal(list.items.length, 2);
  assert.equal(list.items[0].checked, true);
  assert.equal(list.items[1].checked, false);
  assert.deepEqual(
    list.items[0].children.map((node) => node.kind),
    ["block", "block", "block", "block", "block", "list"],
  );
  assert.deepEqual(
    docContainerBlocks(nodes).map((b) => b.type),
    [
      "paragraph",
      "paragraph",
      "code",
      "math",
      "table",
      "paragraph",
      "paragraph",
    ],
  );
});
test("ordered markers and bullet delimiter changes keep distinct lists", () => {
  const nodes = roundTrip("10) Ten\n11) Eleven\n\n+ Plus\n- Minus\n\n***");
  assert.equal(nodes.length, 4);
  assert.equal(nodes[0].kind === "list" && nodes[0].start, 10);
  assert.equal(nodes[0].kind === "list" && nodes[0].delimiter, ")");
  assert.equal(nodes[3].kind === "block" && nodes[3].block.type, "divider");
});
test("list indentation follows marker width and keeps outdented blocks outside", () => {
  const nodes = roundTrip(
    "10) Ten\n    child continuation\n\n    > Quote\n\nOutside\n\n- One\n  - Nested\n- Two",
  );
  assert.equal(nodes.length, 3);
  assert.equal(nodes[1].kind === "block" && nodes[1].block.text, "Outside");
  assert.equal(nodes[2].kind === "list" && nodes[2].items.length, 2);
});
test("paragraph laziness retains continuation in its container without stealing block starts", () => {
  const nodes = roundTrip(
    "> First\ncontinuation\n\nOutside\n\n- List\ncontinued\n# Heading",
  );
  assert.equal(docContainerBlocks(nodes)[0].text, "First\ncontinuation");
  assert.equal(docContainerBlocks(nodes)[2].text, "List\ncontinued");
  assert.equal(
    nodes.at(-1)?.kind === "block" && docContainerBlocks(nodes).at(-1)?.type,
    "heading",
  );
});
test("fenced code protects apparent quote/list/anchor syntax", () => {
  const nodes = roundTrip(
    "```md\n> quoted\n- listed\n^literal\n```\n\n> ```md\n> - literal\n> ```",
    true,
  );
  assert.equal(nodes[0].kind === "block" && nodes[0].block.type, "code");
  assert.equal(
    docContainerBlocks(nodes)[0].text,
    "> quoted\n- listed\n^literal",
  );
});
test("indented code stays owned by the quote/list instead of becoming a list", () => {
  const nodes = roundTrip(
    ">     code\n>     - literal\n\n- item\n\n      code\n      > literal",
  );
  assert.deepEqual(
    docContainerBlocks(nodes).map((b) => b.type),
    ["code", "paragraph", "code"],
  );
  assert.equal(docContainerBlocks(nodes)[2].text, "code\n> literal");
});
test("callout metadata owns structured children and round-trips folded state", () => {
  const nodes = roundTrip(
    "> [!tip]- Title\n>\n> - First\n> - Second\n>\n> ```js\n> run();\n> ```",
  );
  assert.equal(nodes[0].kind === "quote" && nodes[0].callout?.tone, "tip");
  assert.equal(nodes[0].kind === "quote" && nodes[0].callout?.folded, true);
  assert.deepEqual(
    docContainerBlocks(nodes).map((b) => b.type),
    ["paragraph", "paragraph", "paragraph", "code"],
  );
});
test("parent and child anchors stay unique and source ranges use physical lines", () => {
  const ranges: Array<[number[], number, number]> = [];
  const nodes = parseDocContainers(
    "> First ^leaf\n>\n> - Child ^child\n> ^list\n^quote",
    { anchors: true, onSourceRange: (...range) => ranges.push(range) },
  );
  assert.deepEqual(
    parseDocContainers(serializeDocContainers(nodes, { anchors: true }), {
      anchors: true,
    }),
    nodes,
  );
  assert.equal(nodes[0].kind === "quote" && nodes[0].id, "quote");
  assert.deepEqual(
    docContainerBlocks(nodes).map((b) => b.id),
    ["leaf", "child"],
  );
  assert.deepEqual(ranges[0], [[0], 1, 5]);
  assert.ok(
    ranges.some(
      ([path, start, end]) =>
        path.join(".") === "0.1" && start === 3 && end === 4,
    ),
  );
});
test("reference projection sees the whole page and reaches every nested leaf", () => {
  const id = "00000000-0000-4000-8000-000000000001";
  const nodes = roundTrip(
    `> [Secret][ref]\n>\n> - [Secret](orbyn://doc/${id} "Private hint")\n\n[ref]: orbyn://doc/${id} "Private hint"`,
  );
  const projected = projectDocContainers(nodes, (blocks) =>
    redactValue(blocks, () => true),
  );
  const markdown = serializeDocContainers(projected);
  assert.ok(!markdown.includes("Secret"));
  assert.ok(!markdown.includes("Private hint"));
  assert.ok(markdown.includes("Private page"));
  assert.equal(projected[0].kind, "quote");
  assert.equal(docContainerBlocks(nodes)[0].text, "[Secret][ref]");
  assert.throws(() => projectDocContainers(nodes, () => []), DocContainerError);
});
test("walker/map keeps document order and does not mutate container identity", () => {
  const nodes = roundTrip("> A\n>\n> - B\n> - C\n\nD");
  const paths: string[] = [];
  visitDocContainers(nodes, (_node, path) => paths.push(path.join(".")));
  assert.deepEqual(paths, ["0", "0.0", "0.1", "0.1.0.0", "0.1.1.0", "1"]);
  const mapped = mapDocContainerBlocks(
    nodes,
    (block, index) =>
      ({
        ...block,
        text: `${index}: ${"text" in block ? block.text : ""}`,
      }) as typeof block,
  );
  assert.deepEqual(
    docContainerBlocks(mapped).map((b) => b.text),
    ["0: A", "1: B", "2: C", "3: D"],
  );
  assert.equal(docContainerBlocks(nodes)[0].text, "A");
});
test("depth/source/node budgets and cycles reject explicitly", () => {
  assert.throws(
    () =>
      parseDocContainers(
        "> ".repeat(DOC_CONTAINER_LIMITS.depth + 1) + "Too deep",
      ),
    DocContainerError,
  );
  assert.throws(
    () => parseDocContainers("x".repeat(DOC_CONTAINER_LIMITS.source + 1)),
    DocContainerError,
  );
  assert.throws(
    () =>
      parseDocContainers(
        Array.from({ length: 1100 }, () => "- item").join("\n"),
      ),
    DocContainerError,
  );
  const cycle: DocContainerNode = { kind: "quote", children: [] };
  cycle.children.push(cycle);
  assert.throws(() => validateDocContainers([cycle]), DocContainerError);
});
test("duplicate anchors, invalid leaf limits and malformed markers cannot be serialized", () => {
  assert.throws(
    () => parseDocContainers("> A ^same\n\nB ^same", { anchors: true }),
    DocContainerError,
  );
  assert.throws(
    () => parseDocContainers("> " + "x".repeat(10001)),
    DocContainerError,
  );
  assert.throws(
    () =>
      serializeDocContainers([
        {
          kind: "list",
          ordered: true,
          start: -1,
          delimiter: ".",
          loose: false,
          items: [],
        },
      ]),
    DocContainerError,
  );
});

test("tabs use marker-relative columns and keep nested ownership", () => {
  const nodes = roundTrip(
    "10)\tFirst\n\tchild\n\n-\tNested\n\t> Quote\n\n>\twords",
  );
  assert.equal(nodes.length, 3);
  assert.equal(docContainerBlocks(nodes)[0].text, "First\nchild");
  assert.equal(docContainerBlocks(nodes)[2].text, "Quote");
  assert.equal(docContainerBlocks(nodes)[3].text, "words");
});
test("ordered tasks and empty items retain checked state and numbering", () => {
  const nodes = roundTrip("3. [x] Done\n4. [ ] Next\n\n-\n-\n- Present");
  assert.equal(nodes[0].kind === "list" && nodes[0].items[0].checked, true);
  assert.equal(nodes[0].kind === "list" && nodes[0].start, 3);
  assert.equal(nodes[1].kind === "list" && nodes[1].items.length, 3);
});
test("CRLF source ranges remain physical lines through nested containers", () => {
  const ranges: Array<[number[], number, number]> = [];
  const nodes = parseDocContainers("> First\r\n>\r\n> - Child\r\n>   next", {
    onSourceRange: (...range) => ranges.push(range),
  });
  assert.deepEqual(ranges[0], [[0], 1, 4]);
  assert.equal(docContainerBlocks(nodes)[1].text, "Child\nnext");
});

test("HTML preserves nested code/list/quote ownership and task numbering", () => {
  const nodes = parseDocContainers(
    "> # Heading\n>\n> 3. [x] First\n>\n>    ```js\n>    run();\n>    ```\n> 4. [ ] Next",
  );
  const html = docContainersHtml(nodes);
  assert.match(html, /^<blockquote><h1>Heading<\/h1><ol start="3">/);
  assert.match(
    html,
    /<li class="t"><input type="checkbox" disabled checked> <p>First<\/p><pre><code>run\(\);<\/code><\/pre><\/li>/,
  );
  assert.ok(html.endsWith("</ol></blockquote>"));
  assert.equal((html.match(/<ol/g) ?? []).length, 1);
});
test("HTML uses global reference and footnote context across containers", () => {
  const nodes = parseDocContainers(
    '> Read [guide][ref][^source].\n\n- Other [guide][ref]\n\n[ref]: https://example.test/guide "Hint"\n\n[^source]: Source',
  );
  const html = docContainersHtml(nodes);
  assert.equal(
    (html.match(/href="https:\/\/example.test\/guide" title="Hint"/g) ?? [])
      .length,
    2,
  );
  assert.equal((html.match(/class="fn"/g) ?? []).length, 1);
  assert.match(html, /href="#fn-1"/);
  assert.ok(!html.includes("[ref]:"));
});
test("HTML fragment anchors use page-wide heading positions inside containers", () => {
  const nodes = parseDocContainers(
    "Intro\n\n> # Nested title\n>\n> [Jump](#nested-title)\n\n# Root title\n\n[Root](#root-title)",
  );
  const html = docContainersHtml(nodes, { anchors: true });
  assert.match(html, /<h1 id="h-1">Nested title<\/h1>/);
  assert.match(html, /<h1 id="h-3">Root title<\/h1>/);
  assert.match(html, /href="#h-1"/);
  assert.match(html, /href="#h-3"/);
  assert.ok(!html.includes('id="h-0"'));
});
test("HTML shares safe links and typed math/diagram policy without executing raw HTML", () => {
  const nodes = parseDocContainers(
    "> <script>bad()</script> [bad](javascript:alert(1))\n>\n> $$\n> x^2\n> $$\n>\n> ```mermaid\n> graph TD; A-->B\n> ```",
  );
  const html = docContainersHtml(nodes, {
    diagramSources: true,
    math: (text, display) =>
      display ? '<span class="math">' + text + "</span>" : text,
  });
  assert.ok(!html.includes("<script>"));
  assert.ok(!html.includes('href="javascript:'));
  assert.match(html, /class="math">x\^2/);
  assert.match(html, /data-orbyn-diagram="mermaid"/);
});
test("HTML renders only the projected nested reference labels and hints", () => {
  const id = "00000000-0000-4000-8000-000000000001";
  const nodes = parseDocContainers(
    "> [Secret][ref]\n>\n> - [Secret][ref]\n\n[ref]: orbyn://doc/" +
      id +
      ' "Secret hint"',
  );
  const projected = projectDocContainers(nodes, (blocks) =>
    redactValue(blocks, () => true),
  );
  const html = docContainersHtml(projected, { linkUrl: () => null });
  assert.ok(!html.includes("Secret"));
  assert.ok(!html.includes("Secret hint"));
  assert.ok(!html.includes(id));
  assert.match(html, /Private page/);
});

test("literal callout and task prefixes preserve leaf text and identity", () => {
  for (const slash of ["", "\\", "\\\\"]) {
    const nodes: DocContainerNode[] = [
      {
        kind: "quote",
        id: "quote",
        children: [
          {
            kind: "block",
            block: {
              type: "paragraph",
              id: "quote-text",
              text: slash + "[!tip] literal",
            },
          },
        ],
      },
      {
        kind: "list",
        id: "list",
        ordered: false,
        start: 1,
        delimiter: "-",
        loose: false,
        items: [
          {
            children: [
              {
                kind: "block",
                block: {
                  type: "paragraph",
                  id: "list-text",
                  text: slash + "[x] literal",
                },
              },
            ],
          },
        ],
      },
    ];
    for (const anchors of [false, true]) {
      const expected = anchors
        ? nodes
        : mapDocContainerBlocks(
            nodes.map((node) => {
              const { id, ...rest } = node;
              return rest;
            }),
            (block) => {
              const { id, ...rest } = block;
              return rest;
            },
          );
      assert.deepEqual(
        parseDocContainers(serializeDocContainers(expected, { anchors }), {
          anchors,
        }),
        expected,
      );
    }
  }
});

test("authorized nested references retain labels and hints", () => {
  const nodes = parseDocContainers(
    '> [Visible][ref]\n\n[ref]: orbyn://doc/00000000-0000-4000-8000-000000000001 "Visible hint"',
  );
  const html = docContainersHtml(
    projectDocContainers(nodes, (blocks) => redactValue(blocks, () => false)),
    { linkUrl: (href) => href },
  );
  assert.match(
    html,
    /href="orbyn:\/\/doc\/00000000-0000-4000-8000-000000000001" title="Visible hint"/,
  );
  assert.match(html, />Visible<\/a>/);
});
