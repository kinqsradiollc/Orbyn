import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
// Connects only to a verified test database (see setup.ts).
import "./setup.js";

/**
 * H9 guards: no built-in AI on the agent path.
 *
 * 1. The import graph of every capability and of the MCP server, followed
 *    through relative imports (static, re-exports and dynamic import()),
 *    never reaches Orbyn's AI providers, search by meaning (which measures
 *    text with a provider), the hosted assistant, or any AI provider's
 *    client package. Type-only imports are left out: they are erased.
 * 2. Every hosted-AI route (EXCLUDED as hosted_ai) has an agent-path twin
 *    in capabilities/ai-twins.ts naming tools (and prompts) that exist.
 */

const { EXCLUDED } = await import("../src/capabilities/exclusions.js");
const { AI_TWINS, AI_FEATURE_TWINS } =
  await import("../src/capabilities/ai-twins.js");
const { registry } = await import("../src/capabilities/index.js");
const { PROMPTS } = await import("../src/capabilities/prompts.js");

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "../src");

/** Where the graph starts: every file of the agent path. */
const STARTS = ["capabilities", "modules/mcp-server"];

/** Modules of Orbyn's own AI: never reachable from the agent path. */
const FORBIDDEN_FILES = [/^modules\/ai\//, /^modules\/search\/semantic\.ts$/];

/**
 * Files under modules/ai that the agent path may reach, each provably
 * unrelated to running a model: they apply a change a person approved in
 * the Review inbox, and (checked below, transitively) import nothing that
 * calls a provider.
 */
const ALLOWED_AI_FILES: Record<string, string> = {
  "modules/ai/session-change.ts":
    "Applies an approved session change (Review inbox); no model.",
  "modules/ai/project-proposal.ts":
    "Applies an approved project draft (Review inbox); no model.",
  "modules/ai/project-draft.ts":
    "The shape of a project draft and its checks; no model.",
  "modules/ai/project-schedule.ts":
    "Places an approved project's sessions with the planner; no model.",
};

/** AI providers' client packages (and anything under them). */
const FORBIDDEN_PACKAGES =
  /^(openai|@anthropic-ai\/|@google\/(generative-ai|genai)|@google-cloud\/aiplatform|ollama|cohere-ai|@mistralai\/|groq-sdk|@aws-sdk\/client-bedrock|@huggingface\/|replicate|together-ai|@xenova\/|@langchain\/|langchain|ai$|@ai-sdk\/)/;

function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return tsFiles(path);
    return path.endsWith(".ts") ? [path] : [];
  });
}

/** Runtime imports of one file: specifiers, type-only ones left out. */
function importsOf(file: string): string[] {
  const text = readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
  const found: string[] = [];
  const statics =
    /(?:^|[;\s])(import|export)\s+(type\s+)?([^;"'`]*?)\s*from\s*["']([^"']+)["']/g;
  for (const m of text.matchAll(statics)) if (!m[2]) found.push(m[4]);
  for (const m of text.matchAll(/(?:^|[;\s])import\s+["']([^"']+)["']/g))
    found.push(m[1]);
  for (const m of text.matchAll(/import\(\s*["']([^"']+)["']\s*\)/g))
    found.push(m[1]);
  return found;
}

/** A relative specifier's file (.js written for .ts, or a folder's index). */
function resolveFile(from: string, spec: string): string | null {
  const base = resolve(dirname(from), spec);
  for (const f of [
    base.replace(/\.js$/, ".ts"),
    `${base}.ts`,
    join(base, "index.ts"),
  ])
    if (existsSync(f) && statSync(f).isFile()) return f;
  return null;
}

test("no capability or MCP server module reaches Orbyn's AI, search by meaning or a provider's client", () => {
  const starts = STARTS.flatMap((d) => tsFiles(join(SRC, d)));
  assert.ok(starts.length > 50, "the agent path was found");
  const via = new Map<string, string | null>(starts.map((f) => [f, null]));
  const queue = [...starts];
  const packages = new Map<string, string>();
  while (queue.length) {
    const file = queue.shift()!;
    for (const spec of importsOf(file)) {
      if (!spec.startsWith(".")) {
        if (!packages.has(spec)) packages.set(spec, file);
        continue;
      }
      const target = resolveFile(file, spec);
      if (!target || via.has(target)) continue;
      via.set(target, file);
      queue.push(target);
    }
  }
  const chain = (file: string) => {
    const out: string[] = [];
    for (let f: string | null = file; f; f = via.get(f) ?? null)
      out.unshift(relative(SRC, f));
    return out.join(" → ");
  };
  const reached = [...via.keys()].map((f) => relative(SRC, f));
  const bad = reached.filter(
    (f) => FORBIDDEN_FILES.some((r) => r.test(f)) && !(f in ALLOWED_AI_FILES),
  );
  assert.deepEqual(
    bad.map((f) => chain(join(SRC, f))),
    [],
    "the agent path reaches Orbyn's own AI",
  );
  const clients = [...packages].filter(([p]) => FORBIDDEN_PACKAGES.test(p));
  assert.deepEqual(
    clients.map(([p, f]) => `${chain(f)} → ${p}`),
    [],
    "the agent path imports an AI provider's client",
  );
  // The allow-list only names files that are really reached, so it can't
  // grow stale and hide a new one.
  for (const f of Object.keys(ALLOWED_AI_FILES))
    assert.ok(reached.includes(f), `${f} is allowed but no longer reached`);
  // The check itself sees what it must: the hosted assistant does reach
  // the providers (through agenda-brief and semantic, say).
  const hosted = importsOf(join(SRC, "modules/ai/agenda-brief.ts"));
  assert.ok(hosted.some((s) => s.includes("providers/")));
  assert.ok(
    importsOf(join(SRC, "modules/search/semantic.ts")).some((s) =>
      s.includes("ai/providers/"),
    ),
  );
});

test("every hosted-AI route has an agent-path twin, naming tools and prompts that exist", () => {
  const hosted = Object.entries(EXCLUDED)
    .filter(([, why]) => why === "hosted_ai")
    .map(([route]) => route)
    .sort();
  assert.ok(hosted.length >= 10, "the hosted routes were found");
  const missing = hosted.filter((r) => !AI_TWINS[r]);
  assert.deepEqual(missing, [], "hosted_ai routes with no agent-path twin");
  const stale = Object.keys(AI_TWINS).filter(
    (r) => EXCLUDED[r] !== "hosted_ai",
  );
  assert.deepEqual(stale, [], "twins for routes that aren't hosted_ai");
  const tools = new Set(
    registry.all.filter((c) => !c.legacyOnly).map((c) => c.name),
  );
  const prompts = new Set(PROMPTS.map((p) => p.name));
  const wrong: string[] = [];
  for (const [what, twin] of [
    ...Object.entries(AI_TWINS),
    ...Object.entries(AI_FEATURE_TWINS),
  ]) {
    assert.ok(twin.how.length > 10, `${what}: say how`);
    if (twin.tools !== "every") {
      assert.ok(twin.tools.length, `${what}: name its tools`);
      for (const t of twin.tools)
        if (!tools.has(t)) wrong.push(`${what}: no tool ${t}`);
    }
    for (const p of twin.prompts ?? [])
      if (!prompts.has(p)) wrong.push(`${what}: no prompt ${p}`);
  }
  assert.deepEqual(wrong, []);
  // Hosted AI never becomes an agent tool: none is named like one.
  for (const t of tools)
    assert.doesNotMatch(t, /^(generate|summari[sz]e|ai_|ask_ai|embed)/);
});
