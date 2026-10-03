import { freshRateLimitSession } from "./rate-limit-session.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { pdfTextLines } from "./helpers/pdf-text.js";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// Connects only to a verified test database (see setup.ts).
import "./setup.js";

const { startTestPdfService } = await import("./helpers/pdf-service.js");
const { renderPdfSnapshot } =
  await import("../src/modules/docs/pdf-renderer.js");
let beforePdfPrint: (() => Promise<void>) | undefined;
const pdfService = await startTestPdfService(async (options) => {
  const before = beforePdfPrint;
  beforePdfPrint = undefined;
  if (before) await before();
  return renderPdfSnapshot(options);
});
const { readPdf } = await import("../src/modules/imports/pdf.js");
const { buildApp } = await import("../src/app.js");
const { pool } = await import("../src/db/pool.js");
const { migrate } = await import("../src/db/migrate.js");
const { exportName } = await import("@orbyn/core");

const app = await buildApp();
let token = "";
let strangerToken = "";
let docId = "";

const get = (url: string, as = () => token) =>
  app.inject({
    method: "GET",
    url,
    headers: { authorization: `Bearer ${as()}` },
  });

const register = async () =>
  (
    await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: {
        email: `export-${randomUUID()}@example.com`,
        password: "a-long-test-password",
        name: "Exporter",
      },
    })
  ).json().token as string;

before(async () => {
  await migrate();
  token = await register();
  strangerToken = await register();
  docId = (
    await app.inject({
      method: "POST",
      url: "/docs",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        title: "Launch brief",
        content: [
          { type: "heading", level: 1, text: "Decisions", id: "h1" },
          {
            type: "paragraph",
            text: "Pricing stays **unchanged** until the *October* review.",
            id: "p1",
          },
          { type: "bullet", text: "Beta on 8 September", id: "b1" },
          { type: "numbered", text: "Then general release", id: "n1" },
          { type: "todo", text: "Tell the team", done: true, id: "t1" },
          { type: "quote", text: "Nothing ships in December.", id: "q1" },
          {
            type: "code",
            text: "npm test\nnpm run build",
            lang: "sh",
            id: "c1",
          },
          { type: "math", text: "x^2 + y^2", id: "m1" },
          {
            type: "paragraph",
            text: "Inline $\\frac{a}{b}$ equation.",
            id: "pm1",
          },
          { type: "divider", id: "d1" },
          {
            type: "paragraph",
            text: "See [the plan](https://x.test).",
            id: "p2",
          },
        ],
      },
    })
  ).json().id;
});

after(async () => {
  const { closeLive } = await import("../src/modules/docs/live.js");
  await closeLive();
  await app.close();
  await pdfService.close();
  await pool.end();
});

test("Markdown comes back as the page's own source", async () => {
  const res = await get(`/docs/${docId}/export?format=md`);
  assert.equal(res.statusCode, 200);
  assert.match(res.headers["content-type"] as string, /text\/markdown/);
  assert.match(
    res.headers["content-disposition"] as string,
    /filename="Launch brief\.md"/,
  );
  assert.match(res.body, /^# Launch brief/);
  assert.match(res.body, /\*\*unchanged\*\*/, "markers are the point here");
});

test("plain text has the words and none of the markers", async () => {
  const res = await get(`/docs/${docId}/export?format=txt`);
  assert.equal(res.statusCode, 200);
  assert.doesNotMatch(res.body, /\*\*/);
  assert.match(res.body, /Pricing stays unchanged until the October review\./);
  assert.match(res.body, /• Beta on 8 September/);
  assert.match(res.body, /\[x\] Tell the team/);
  assert.match(res.body, /See the plan\./, "a link reads as its words");
});

test("the web page stands on its own and escapes what it should", async () => {
  const res = await get(`/docs/${docId}/export?format=html`);
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /^<!doctype html>/);
  assert.match(res.body, /<title>Launch brief<\/title>/);
  assert.match(res.body, /<strong>unchanged<\/strong>/);
  assert.match(res.body, /<em>October<\/em>/);
  assert.match(res.body, /<a href="https:\/\/x\.test">the plan<\/a>/);
  assert.match(
    res.body,
    /<blockquote>Nothing ships in December\.<\/blockquote>/,
  );
  assert.match(res.body, /<pre><code>npm test\nnpm run build<\/code><\/pre>/);
  assert.match(res.body, /<ul>[\s\S]*<li>Beta on 8 September<\/li>/);
  assert.match(res.body, /<ol>[\s\S]*<li>Then general release<\/li>/);
  assert.doesNotMatch(res.body, /<script/i);
  assert.doesNotMatch(
    res.body,
    /(?:src|href)=["']https?:\/\/(?!x\.test)/,
    "no external assets",
  );
  assert.match(res.body, /<math[ >]/, "equations retain mathematical markup");
  assert.match(res.body, /<mfrac>/, "inline fractions are typeset");
  assert.match(
    res.body,
    /display="block"/,
    "display equations retain their mode",
  );
});

test("HTML export keeps malformed math readable and refuses external commands", async () => {
  const created = await app.inject({
    method: "POST",
    url: "/docs",
    headers: { authorization: `Bearer ${token}` },
    payload: {
      title: "Math export safety",
      content: [
        { type: "math", text: "\\frac{<script>bad</script>", id: "bad" },
        {
          type: "math",
          text: "\\includegraphics{https://outside.test/private}",
          id: "remote",
        },
        { type: "math", text: "\\href{javascript:run}{click}", id: "link" },
      ],
    },
  });
  assert.equal(created.statusCode, 201);
  const result = await get(`/docs/${created.json().id}/export?format=html`);
  assert.equal(result.statusCode, 200);
  assert.match(result.body, /katex-error/);
  assert.match(result.body, /&lt;script&gt;/);
  assert.doesNotMatch(result.body, /<(?:script|img|iframe|a)\b/i);
});

test("export keeps authentication, account disabling and malformed-path guards", async () => {
  assert.equal(
    (
      await app.inject({
        method: "GET",
        url: `/docs/${docId}/export?format=html`,
      })
    ).statusCode,
    401,
  );
  assert.equal((await get("/docs/%ZZ/export?format=html")).statusCode, 400);
  const user = (await get("/me", () => strangerToken)).json();
  await pool.query("UPDATE users SET disabled=true WHERE id=$1", [user.id]);
  try {
    assert.equal(
      (await get(`/docs/${docId}/export?format=html`, () => strangerToken))
        .statusCode,
      403,
    );
  } finally {
    await pool.query("UPDATE users SET disabled=false WHERE id=$1", [user.id]);
  }
});

test("HTML export applies the live rate limit and Retry-After", async () => {
  const { settings, cachedSettings } = await import("../src/lib/settings.js");
  await settings();
  const live = cachedSettings(),
    previous = live.rate_limit_per_minute;
  const limitedToken = await freshRateLimitSession(token);
  live.rate_limit_per_minute = 2;
  const request = () =>
    app.inject({
      method: "GET",
      url: `/docs/${docId}/export?format=html`,
      headers: { authorization: `Bearer ${limitedToken}` },
      remoteAddress: "10.74.1.97",
    });
  try {
    assert.equal((await request()).statusCode, 200);
    assert.equal((await request()).statusCode, 200);
    const limited = await request();
    assert.equal(limited.statusCode, 429);
    assert.ok(Number(limited.headers["retry-after"]) > 0);
  } finally {
    live.rate_limit_per_minute = previous;
  }
});

test("a title that would break a file name is made safe", () => {
  assert.equal(exportName("Q4: plans/ideas?", "pdf"), "Q4 plans ideas.pdf");
  assert.equal(exportName("   ", "md"), "document.md");
});

test("a page whose title holds an emoji or accents still exports", async () => {
  const id = (
    await app.inject({
      method: "POST",
      url: "/docs",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        title: "Lançamento 🚀 رؤية",
        content: [{ type: "paragraph", text: "Hello", id: "p1" }],
      },
    })
  ).json().id;
  const res = await get(`/docs/${id}/export?format=pdf`);
  assert.equal(res.statusCode, 200);
  const given = res.headers["content-disposition"] as string;
  // The plain filename is flattened to ASCII, so the header itself is legal.
  assert.match(given, /^attachment; filename="[\x20-\x7e]+\.pdf"/);
  // And the true name rides along, percent-encoded for browsers to decode.
  assert.match(given, /filename\*=UTF-8''/);
  assert.ok(
    given.includes(encodeURIComponent("Lançamento 🚀 رؤية.pdf")),
    `the real name is encoded: ${given}`,
  );
});

test("the Word file is a real zip that unzips to real parts", async () => {
  const res = await get(`/docs/${docId}/export?format=docx`);
  assert.equal(res.statusCode, 200);
  assert.match(res.headers["content-type"] as string, /wordprocessingml/);
  const body = res.rawPayload;
  assert.equal(body.subarray(0, 2).toString(), "PK", "it starts like a zip");

  const dir = mkdtempSync(join(tmpdir(), "orbyn-docx-"));
  try {
    const file = join(dir, "out.docx");
    writeFileSync(file, body);
    // The system's own unzip is the honest test: if it cannot read this,
    // neither can Word.
    const listing = execFileSync("unzip", ["-l", file], { encoding: "utf8" });
    for (const part of [
      "[Content_Types].xml",
      "_rels/.rels",
      "word/document.xml",
      "word/styles.xml",
      "word/numbering.xml",
    ])
      assert.ok(listing.includes(part), `${part} is in the package`);
    execFileSync("unzip", ["-t", file], { encoding: "utf8" });

    execFileSync("unzip", ["-o", "-q", file, "word/document.xml", "-d", dir]);
    const xml = readFileSync(join(dir, "word/document.xml"), "utf8");
    assert.match(xml, /<w:t xml:space="preserve">Launch brief<\/w:t>/);
    assert.match(xml, /<w:pStyle w:val="Heading1"\/>/);
    assert.match(xml, /<w:b\/>[\s\S]*?unchanged/, "bold survives");
    assert.match(xml, /<w:i\/>[\s\S]*?October/, "so does italic");
    assert.match(xml, /w:numId w:val="1"/, "bullets are a real list");
    assert.match(xml, /w:numId w:val="2"/, "and so are numbers");
    assert.doesNotMatch(xml, /\*\*/, "no Markdown leaks into Word");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the PDF is well formed and holds the page's words", async () => {
  const res = await get(`/docs/${docId}/export?format=pdf`);
  assert.equal(res.statusCode, 200);
  assert.match(res.headers["content-type"] as string, /application\/pdf/);
  const body = res.rawPayload.toString("latin1");
  assert.match(body, /^%PDF-1\.4/);
  assert.match(body, /%%EOF\s*$/);
  assert.match(body, /\/Type \/Catalog/);
  const pages = await readPdf(res.rawPayload, 20);
  assert.ok(pages.length > 0);
  const text = pages
    .flatMap((page) => page.text.spans.map((span) => span.text))
    .join(" ");
  assert.match(text, /Launch brief/);
  assert.match(text, /unchanged/);
  assert.match(text, /Pricing stays/);
  assert.doesNotMatch(text, /\*\*/, "no Markdown leaks into the PDF");
});

test("a long page runs onto more than one PDF page", async () => {
  const long = (
    await app.inject({
      method: "POST",
      url: "/docs",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        title: "Long one",
        content: Array.from({ length: 120 }, (_, i) => ({
          type: "paragraph",
          text: `Paragraph ${i} with a sentence long enough to take a line.`,
        })),
      },
    })
  ).json().id;
  const response = await get(`/docs/${long}/export?format=pdf`);
  assert.equal(response.statusCode, 200);
  const pages = await readPdf(response.rawPayload, 30);
  assert.ok(pages.length > 1, `it paginated (${pages.length} pages)`);
});

test("an unknown format is refused, and someone else's page is not found", async () => {
  assert.equal((await get(`/docs/${docId}/export?format=exe`)).statusCode, 422);
  assert.equal(
    (await get(`/docs/${docId}/export?format=pdf`, () => strangerToken))
      .statusCode,
    404,
  );
});

test("asking for nothing in particular gives Markdown", async () => {
  const res = await get(`/docs/${docId}/export`);
  assert.equal(res.statusCode, 200);
  assert.match(res.headers["content-type"] as string, /text\/markdown/);
});

test("text after a bold run starts where the bold run ends", async () => {
  // Bold letters are wider than regular ones. Measuring them with the
  // regular table left the next run overlapping backwards, which ate the
  // space: "stays unchanged until" came out as "unchangeduntil".
  const { docToPdf } = await import("../src/modules/docs/pdf.js");
  const body = docToPdf("T", [
    { type: "paragraph", text: "stays **unchanged** until", id: "p" },
  ]).toString("latin1");
  const places = [
    ...body.matchAll(/1 0 0 1 ([\d.]+) [\d.]+ Tm \((.*?)\) Tj/g),
  ].map((m) => ({ x: Number(m[1]), text: m[2] }));
  const bold = places.find((p) => p.text === "unchanged")!;
  const after = places.find((p) => p.text.startsWith(" until"))!;
  assert.ok(bold && after, "the runs are drawn separately");
  // Helvetica-Bold "unchanged" is 54.7pt at 11pt; the regular table would
  // have said 52.2 and started the next run inside the previous word.
  assert.ok(
    after.x - bold.x > 54,
    `the next run clears the bold one (moved ${(after.x - bold.x).toFixed(1)}pt)`,
  );
});

test("punctuation a document actually uses survives into the PDF", async () => {
  const { docToPdf } = await import("../src/modules/docs/pdf.js");
  const body = docToPdf("T", [
    { type: "bullet", text: "first", id: "b" },
    { type: "paragraph", text: "an — em dash … and “curly quotes”", id: "p" },
  ]).toString("latin1");
  // WinAnsi keeps these, but at its own code points: a bullet is 0x95, not
  // U+2022. Before this they were all drawn as question marks.
  assert.match(body, /\\225/, "the bullet is a bullet");
  assert.match(body, /\\227/, "em dash");
  assert.match(body, /\\205/, "ellipsis");
  assert.match(body, /\\223/, "opening curly quote");
  assert.match(body, /\\224/, "closing curly quote");
  assert.doesNotMatch(body, /\(\?/, "nothing fell back to a question mark");
});

test("bold, italic and code are drawn in the fonts they claim", async () => {
  const { docToPdf } = await import("../src/modules/docs/pdf.js");
  const body = docToPdf("T", [
    { type: "paragraph", text: "a **b** and *i* and `c`", id: "p" },
  ]).toString("latin1");
  assert.match(body, /\/F2 11 Tf[^(]*\(b\) Tj/, "bold uses Helvetica-Bold");
  assert.match(
    body,
    /\/F3 11 Tf[^(]*\(i\) Tj/,
    "italic uses Helvetica-Oblique",
  );
  assert.match(body, /\/F4 11 Tf[^(]*\(c\) Tj/, "code uses Courier");
  assert.match(body, /\/BaseFont \/Helvetica-Oblique/);
  assert.match(body, /\/BaseFont \/Courier/);
});

test("HTML export renders authorized Mermaid source and preserves inert standalone math", async () => {
  const created = await app.inject({
    method: "POST",
    url: "/docs",
    headers: { authorization: `Bearer ${token}` },
    payload: {
      title: "Rendered export",
      content: [
        {
          type: "code",
          lang: "mermaid",
          text: 'flowchart LR\nA["<script>bad</script>"] --> B',
          id: "diagram",
        },
        {
          type: "code",
          lang: "js",
          text: "const ordinary = true",
          id: "ordinary",
        },
        { type: "math", text: "\\frac{a}{b}", id: "math" },
      ],
    },
  });
  assert.equal(created.statusCode, 201);
  const result = await get(`/docs/${created.json().id}/export?format=html`);
  assert.equal(result.statusCode, 200);
  assert.equal(
    (result.body.match(/<figure class="export-diagram">/g) ?? []).length,
    1,
  );
  assert.match(result.body, /&lt;script&gt;bad&lt;\/script&gt;/);
  assert.match(result.body, /Content-Security-Policy/);
  assert.match(result.body, /script-src 'none'/);
  const image = /src="data:image\/svg\+xml;charset=utf-8,([^"]+)"/.exec(
    result.body,
  );
  assert.ok(image, "The authorized diagram must render as an inert SVG image");
  assert.doesNotMatch(decodeURIComponent(image[1]), /<script|<iframe/i);
  assert.match(result.body, /<pre><code>const ordinary = true<\/code><\/pre>/);
  assert.match(result.body, /<math[ >]/);
  assert.doesNotMatch(result.body, /<script|<iframe/i);
  assert.equal(
    (
      await get(
        `/docs/${created.json().id}/export?format=html`,
        () => strangerToken,
      )
    ).statusCode,
    404,
  );
  const markdown = await get(`/docs/${created.json().id}/export?format=md`);
  assert.match(markdown.body, /```mermaid/);
  assert.match(markdown.body, /<script>bad<\/script>/);
});

test("export revision checks reject changed pages without disclosing inaccessible versions", async () => {
  const original = (await get(`/docs/${docId}`)).json();
  assert.equal(
    (await get(`/docs/${docId}/export?format=html&version=${original.version}`))
      .statusCode,
    200,
  );
  const changed = await app.inject({
    method: "PUT",
    url: `/docs/${docId}`,
    headers: { authorization: `Bearer ${token}` },
    payload: {
      title: "Updated export revision",
      content: original.content,
      version: original.version,
    },
  });
  assert.equal(changed.statusCode, 200, changed.body);
  const stale = await get(
    `/docs/${docId}/export?format=html&version=${original.version}`,
  );
  assert.equal(stale.statusCode, 409, stale.body);
  for (const format of ["md", "txt", "pdf", "docx"])
    assert.equal(
      (
        await get(
          `/docs/${docId}/export?format=${format}&version=${original.version}`,
        )
      ).statusCode,
      409,
    );
  assert.equal(
    (
      await get(
        `/docs/${docId}/export?format=html&version=${changed.json().version}`,
      )
    ).statusCode,
    200,
  );
  assert.equal(
    (
      await get(
        `/docs/${docId}/export?format=html&version=${original.version}`,
        () => strangerToken,
      )
    ).statusCode,
    404,
  );
  for (const invalid of ["0", "-1", "1.5", "abc", "9007199254740992"])
    assert.equal(
      (await get(`/docs/${docId}/export?format=html&version=${invalid}`))
        .statusCode,
      422,
    );
});

test("rendered PDF contains all Mermaid families and mathematical content through the authorized API", async () => {
  const { mermaidFixtures } = await import("./helpers/mermaid-fixtures.js");
  const id = (
    await app.inject({
      method: "POST",
      url: "/docs",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        title: "Rendered diagrams",
        content: [
          { type: "paragraph", text: "Inline $\\frac{a}{b}$" },
          { type: "math", text: "\\sum_{i=1}^{n}i" },
          ...mermaidFixtures.flatMap((f) => [
            { type: "heading", level: 2, text: f.kind },
            { type: "code", lang: "mermaid", text: f.source },
          ]),
        ],
      },
    })
  ).json().id;
  const result = await get(`/docs/${id}/export?format=pdf&version=1`);
  assert.equal(result.statusCode, 200);
  const pages = await readPdf(result.rawPayload, 30);
  const lines = pdfTextLines(pages);
  const text = lines.join(" ");
  for (const f of mermaidFixtures)
    assert.ok(
      lines.includes(f.kind),
      `Missing ${f.kind} heading: ${JSON.stringify(lines)}`,
    );
  for (const label of [
    "Start",
    "Finish",
    "Review tasks",
    "Plan work",
    "Task status",
    "Release history",
  ])
    assert.ok(text.includes(label), label);
  assert.doesNotMatch(text, /Diagram rendering unavailable|graph TD|\\frac/);
});

test("PDF delivery rejects revisions changed during rendering and pages deleted during rendering", async () => {
  for (const deleted of [false, true]) {
    const id = (
      await app.inject({
        method: "POST",
        url: "/docs",
        headers: { authorization: `Bearer ${token}` },
        payload: {
          title: "Concurrent export",
          content: [{ type: "paragraph", text: "Original authorized content" }],
        },
      })
    ).json().id;
    beforePdfPrint = async () => {
      const changed = await app.inject({
        method: deleted ? "DELETE" : "PUT",
        url: `/docs/${id}`,
        headers: { authorization: `Bearer ${token}` },
        ...(deleted
          ? {}
          : {
              payload: {
                title: "New revision",
                version: 1,
                content: [{ type: "paragraph", text: "Changed content" }],
              },
            }),
      });
      assert.ok(changed.statusCode < 300, changed.body);
    };
    const result = await get(`/docs/${id}/export?format=pdf&version=1`);
    assert.equal(result.statusCode, deleted ? 404 : 409);
    assert.doesNotMatch(result.body, /^%PDF|Original authorized content/);
  }
});

test("standalone HTML renders all ten families with inert SVG, math and retained source", async () => {
  const { mermaidFixtures } = await import("./helpers/mermaid-fixtures.js");
  const created = await app.inject({
    method: "POST",
    url: "/docs",
    headers: { authorization: `Bearer ${token}` },
    payload: {
      title: "Portable HTML renderer QA",
      content: [
        { type: "math", text: "\\frac{a}{b}" },
        ...mermaidFixtures.flatMap((item) => [
          { type: "heading", level: 2, text: item.kind },
          { type: "code", lang: "mermaid", text: item.source },
        ]),
      ],
    },
  });
  assert.equal(created.statusCode, 201, created.body);
  const result = await get(`/docs/${created.json().id}/export?format=html`);
  assert.equal(result.statusCode, 200, result.body.slice(0, 200));
  const svgs = [
    ...result.body.matchAll(
      /src="data:image\/svg\+xml;charset=utf-8,([^"]+)"/g,
    ),
  ].map((match) => decodeURIComponent(match[1]));
  assert.equal(svgs.length, 10);
  assert.match(result.body, /name="viewport" content="width=device-width/);
  assert.equal(
    (result.body.match(/<details><summary>Diagram source/g) ?? []).length,
    10,
  );
  assert.match(result.body, /<math[ >]/);
  assert.match(result.body, /script-src 'none'/);
  assert.doesNotMatch(
    result.body,
    /<script|<iframe|Diagram rendering unavailable/i,
  );
  for (const label of [
    "Start",
    "Finish",
    "Review tasks",
    "Plan work",
    "Task status",
    "Release history",
  ])
    assert.ok(svgs.join(" ").includes(label), label);
  for (const svg of svgs) assert.doesNotMatch(svg, /<script|<iframe/i);
  if (process.env.HTML_TEST_OUTPUT)
    writeFileSync(process.env.HTML_TEST_OUTPUT, result.body);
});
