import { test } from "node:test";
import assert from "node:assert/strict";
import { AI_PROVIDER_KINDS, AI_PROVIDERS } from "@orbyn/core";

/**
 * Orbyn's provider catalog mirrors BrainRouter's: its built-in chat providers
 * (packages/core/src/provider/providers/index.ts, BUILTIN_PROVIDERS) in the
 * same order, then its declarative starter set (declarative-starter.ts). Ids,
 * labels, endpoints and picker visibility match; only BrainRouter's agent
 * engine and embedding/reranker vendors are left out (Orbyn is chat-only).
 */
const BRAINROUTER: [string, string, string, boolean][] = [
  ["openai", "OpenAI", "https://api.openai.com/v1", true],
  ["anthropic", "Anthropic (Claude)", "https://api.anthropic.com/v1", true],
  [
    "gemini",
    "Google Gemini",
    "https://generativelanguage.googleapis.com/v1beta/openai",
    true,
  ],
  ["openrouter", "OpenRouter", "https://openrouter.ai/api/v1", true],
  ["zenmux", "ZenMux", "https://zenmux.ai/api/v1", true],
  [
    "matilda",
    "Matilda (Maincode)",
    "https://matilda.maincode.com/api/v1",
    true,
  ],
  ["groq", "Groq", "https://api.groq.com/openai/v1", true],
  ["azure", "Azure OpenAI", "", true],
  ["openai-compatible", "OpenAI-compatible (custom)", "", true],
  ["opencode", "opencode (Zen gateway)", "https://opencode.ai/zen/v1", true],
  ["lmstudio", "LM Studio (local)", "http://localhost:1234/v1", true],
  ["ollama", "Ollama (local)", "http://localhost:11434/v1", true],
  ["deepseek", "DeepSeek", "https://api.deepseek.com/v1", false],
  ["together", "Together AI", "https://api.together.xyz/v1", true],
  ["fireworks", "Fireworks AI", "https://api.fireworks.ai/inference/v1", true],
  ["mistral", "Mistral", "https://api.mistral.ai/v1", true],
  ["xai", "xAI (Grok)", "https://api.x.ai/v1", true],
  ["perplexity", "Perplexity", "https://api.perplexity.ai", true],
  ["deepinfra", "DeepInfra", "https://api.deepinfra.com/v1/openai", true],
  ["nebius", "Nebius AI Studio", "https://api.studio.nebius.ai/v1", true],
];

test("the provider catalog matches BrainRouter's, in order", () => {
  assert.deepEqual(
    [...AI_PROVIDER_KINDS],
    BRAINROUTER.map(([id]) => id),
  );
  for (const [id, label, endpoint, visible] of BRAINROUTER) {
    const p = AI_PROVIDERS[id as keyof typeof AI_PROVIDERS];
    assert.equal(p.kind, id);
    assert.equal(p.label, label, `${id} label`);
    assert.equal(p.defaultBaseUrl, endpoint, `${id} endpoint`);
    assert.equal(p.pickerVisible, visible, `${id} picker visibility`);
  }
});

test("local servers need no key; cloud providers do, unless custom or with a default key", () => {
  for (const p of Object.values(AI_PROVIDERS)) {
    if (p.local) assert.equal(p.requiresKey, false, p.kind);
    else if (p.kind !== "openai-compatible" && !p.defaultApiKey)
      assert.equal(p.requiresKey, true, p.kind);
  }
  // opencode falls back to its public key, as in BrainRouter.
  assert.equal(AI_PROVIDERS.opencode.defaultApiKey, "public");
  assert.equal(AI_PROVIDERS.opencode.requiresKey, false);
  for (const [kind, prefix] of [
    ["openai", "sk-"],
    ["openrouter", "sk-or-v1-"],
    ["deepseek", "dsk-"],
    ["matilda", "mc_live_"],
  ] as const) {
    assert.ok(AI_PROVIDERS[kind].keyPrefixes?.includes(prefix), kind);
  }
});
