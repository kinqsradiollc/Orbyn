import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createDiagramExportBridge,
  renderHtmlDiagrams,
  docToHtml,
  parseDoc,
  MERMAID_MAX_SOURCE,
  MERMAID_MAX_SVG,
} from "@orbyn/core";
const tick = () => new Promise((resolve) => setImmediate(resolve));
const svg = '<svg xmlns="http://www.w3.org/2000/svg"><text>Result</text></svg>';
const response = (id: string, value = svg) =>
  JSON.stringify({ type: "orbyn-diagram-result", id, svg: value });

test("authorized export source alone is enriched with inert embedded images and retained Markdown", async () => {
  const source = 'flowchart LR\nA["<script>alert(1)</script> &amp;"] --> B';
  const blocks = parseDoc(
    `Introduction\n\n\`\`\`mermaid\n${source}\n\`\`\`\n\n\`\`\`js\nconst safe = true\n\`\`\``,
  );
  const snapshot = docToHtml("Export", blocks, { diagramSources: true });
  const inputs: string[] = [];
  const result = await renderHtmlDiagrams(snapshot, async (text) => {
    inputs.push(text);
    return svg;
  });
  assert.deepEqual(inputs, [source]);
  assert.match(
    result,
    /<img alt="Mermaid diagram" src="data:image\/svg\+xml;charset=utf-8,%3Csvg/,
  );
  assert.match(result, /<summary>Diagram source<\/summary>/);
  assert.match(result, /&lt;script&gt;alert\(1\)&lt;\/script&gt; &amp;amp;/);
  assert.match(result, /const safe = true/);
  assert.doesNotMatch(result, /<svg|<script>/);
});

test("unmarked HTML is untouched and diagrams never trigger a raw document fetch", async () => {
  const html = docToHtml(
    "Plain",
    parseDoc("```mermaid\nflowchart LR\nA --> B\n```"),
  );
  let calls = 0;
  assert.equal(
    await renderHtmlDiagrams(html, async () => {
      calls++;
      return svg;
    }),
    html,
  );
  assert.equal(calls, 0);
});

test("one failed or oversized diagram preserves source without breaking other diagrams", async () => {
  const snapshot = docToHtml(
    "Export",
    parseDoc(
      "```mermaid\ninvalid diagram\n```\n\n```mermaid\nflowchart LR\nA --> B\n```",
    ),
    { diagramSources: true },
  );
  let calls = 0;
  const result = await renderHtmlDiagrams(snapshot, async () => {
    if (++calls === 1) throw new Error("private engine diagnostic");
    return svg;
  });
  assert.match(result, /Diagram rendering unavailable; source retained/);
  assert.match(result, /invalid diagram/);
  assert.match(result, /data:image\/svg\+xml/);
  assert.doesNotMatch(result, /private engine diagnostic/);
  const huge = await renderHtmlDiagrams(
    snapshot,
    async () => "<svg>" + "x".repeat(MERMAID_MAX_SVG),
  );
  assert.doesNotMatch(huge, /<img/);
});

test("configuration directives and oversized source are rejected before export rendering", async () => {
  const snapshot = docToHtml(
    "Export",
    [
      {
        type: "code",
        lang: "mermaid",
        text: "%%{init: {securityLevel: 'loose'}}%%\nflowchart LR\nA --> B",
      },
      {
        type: "code",
        lang: "mermaid",
        text: "x".repeat(MERMAID_MAX_SOURCE + 1),
      },
    ],
    { diagramSources: true },
  );
  let calls = 0;
  const result = await renderHtmlDiagrams(snapshot, async () => {
    calls++;
    return svg;
  });
  assert.equal(calls, 0);
  assert.match(result, /source retained/);
});

test("export bridge queues work, rejects stale replies and releases the isolated surface", async () => {
  const sent: (string | undefined)[] = [];
  const bridge = createDiagramExportBridge((request) => sent.push(request));
  const first = bridge.render("flowchart LR\nA --> B"),
    second = bridge.render("sequenceDiagram\nA->>B: hello");
  await tick();
  assert.equal(sent.filter(Boolean).length, 1);
  const request = JSON.parse(sent[0]!);
  assert.equal(request.palette.background, "#ffffff");
  assert.equal(request.actualSize, true);
  bridge.receive(response("stale-id"));
  bridge.receive("not json");
  assert.equal(sent.length, 1);
  bridge.receive(response(request.id));
  assert.equal(await first, svg);
  await tick();
  assert.equal(sent.filter(Boolean).length, 2);
  assert.equal(sent[1], undefined);
  bridge.receive(response(JSON.parse(sent[2]!).id));
  assert.equal(await second, svg);
  bridge.dispose();
});

test("closing an editor cancels active and queued renders instead of returning a fallback file", async () => {
  const sent: (string | undefined)[] = [];
  const bridge = createDiagramExportBridge((request) => sent.push(request));
  const results = Promise.allSettled([
    bridge.render("flowchart LR\nA --> B"),
    bridge.render("flowchart LR\nC --> D"),
  ]);
  await tick();
  bridge.dispose();
  for (const result of await results) {
    assert.equal(result.status, "rejected");
    if (result.status === "rejected")
      assert.equal(result.reason.name, "AbortError");
  }
  assert.equal(sent.filter(Boolean).length, 1);
  assert.equal(bridge.signal.aborted, true);
  const snapshot = docToHtml(
    "Export",
    parseDoc("```mermaid\nflowchart LR\nA --> B\n```"),
    { diagramSources: true },
  );
  await assert.rejects(
    renderHtmlDiagrams(snapshot, bridge.render, bridge.signal),
    { name: "AbortError" },
  );
});

test("bridge timeouts and malformed results fail and allow the next queued render", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const sent: (string | undefined)[] = [];
  const bridge = createDiagramExportBridge((request) => sent.push(request), 10);
  const timeout = assert.rejects(
    bridge.render("flowchart LR\nA --> B"),
    /timed out/,
  );
  await tick();
  t.mock.timers.tick(10);
  await timeout;
  const next = bridge.render("flowchart LR\nA --> B");
  await tick();
  const request = JSON.parse(sent.filter(Boolean).at(-1)!);
  bridge.receive(response(request.id, "<script>unsafe</script>"));
  await assert.rejects(next, /Invalid diagram/);
  bridge.dispose();
});

test("new editor scopes cannot accept a previous bridge's matching sequence number", async () => {
  let firstRequest = "",
    secondRequest = "";
  const first = createDiagramExportBridge((request) => {
    if (request) firstRequest = request;
  });
  const old = first.render("flowchart LR\nA --> B");
  const cancelled = assert.rejects(old, { name: "AbortError" });
  await tick();
  first.dispose();
  await cancelled;
  const second = createDiagramExportBridge((request) => {
    if (request) secondRequest = request;
  });
  const current = second.render("flowchart LR\nC --> D");
  await tick();
  const oldId = JSON.parse(firstRequest).id,
    newId = JSON.parse(secondRequest).id;
  assert.notEqual(oldId, newId);
  second.receive(response(oldId));
  second.receive(response(newId));
  assert.equal(await current, svg);
  second.dispose();
});

test("standalone and clipboard HTML preserve all six authored heading levels", async () => {
  const { blocksToClipboard, docToHtml } = await import("@orbyn/core");
  const blocks = ([1, 2, 3, 4, 5, 6] as const).map((level) => ({
    type: "heading" as const,
    level,
    text: `Level ${level}`,
  }));
  for (const html of [
    docToHtml("Page", blocks),
    blocksToClipboard(blocks).html,
  ]) {
    for (const level of [1, 2, 3, 4, 5, 6])
      assert.match(
        html,
        new RegExp(`<h${level}(?: [^>]*)?>Level ${level}</h${level}>`),
      );
    assert.doesNotMatch(html, /<h7>/);
  }
});
