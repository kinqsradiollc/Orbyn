import { AI_DOCUMENTED_OPENAI_MODELS } from "./ai-model-controls.js";
/**
 * AI providers an admin can connect from the admin console. The backend uses
 * `format` to pick the request shape; clients use the rest to build forms.
 */
export const AI_PROVIDER_KINDS = [
  "openai",
  "anthropic",
  "gemini",
  "openrouter",
  "zenmux",
  "matilda",
  "groq",
  "azure",
  "openai-compatible",
  "opencode",
  "lmstudio",
  "ollama",
  "deepseek",
  "together",
  "fireworks",
  "mistral",
  "xai",
  "perplexity",
  "deepinfra",
  "nebius",
] as const;
export type AiProviderKind = (typeof AI_PROVIDER_KINDS)[number];

/**
 * - `openai`: POST {base}/chat/completions with `Authorization: Bearer`.
 * - `anthropic`: POST {base}/messages with `x-api-key` and `anthropic-version`.
 * - `azure`: POST {base}/openai/deployments/{model}/chat/completions?api-version=… with `api-key`.
 */
export type AiRequestFormat = "openai" | "anthropic" | "azure";

export type AiProviderOption = {
  key: "apiVersion";
  label: string;
  placeholder: string;
  required: boolean;
};

export type AiProviderDefinition = {
  kind: AiProviderKind;
  label: string;
  hint: string;
  format: AiRequestFormat;
  /** Empty when the admin must supply their own address. */
  defaultBaseUrl: string;
  /** Local servers usually run without a key. */
  requiresKey: boolean;
  local: boolean;
  /** Offered in the admin's "Add provider" list (BrainRouter's pickerVisible). */
  pickerVisible: boolean;
  /** Whether the provider can list its models for the picker. */
  listsModels: boolean;
  options: AiProviderOption[];
  /** Shown before the model list loads; the admin can always type a model. */
  suggestedModels: string[];
  /**
   * Hard request limits some providers enforce. The assistant trims what it
   * sends (older history, then the planner snapshot) to fit.
   */
  limits?: { maxBodyBytes: number; maxMessageChars: number };
  /**
   * Send the assistant's reply schema as `response_format` json_schema.
   * For models that ignore "reply in JSON" instructions but honour a schema.
   */
  structuredOutput?: "json_schema";
  /**
   * BrainRouter's requestFormat: "responses" uses OpenAI's Responses API for
   * GPT and o-series models on OpenAI's own endpoint; chat completions otherwise.
   */
  requestFormat?: "responses";
  /** Sent when the admin leaves the key blank (opencode's public key). */
  defaultApiKey?: string;
  /** Known key prefixes, used to hint and sanity-check pasted keys. */
  keyPrefixes?: string[];
};

const cloud = (
  kind: AiProviderKind,
  label: string,
  hint: string,
  defaultBaseUrl: string,
  extra: Partial<AiProviderDefinition> = {},
): AiProviderDefinition => ({
  kind,
  label,
  hint,
  format: "openai",
  defaultBaseUrl,
  requiresKey: true,
  local: false,
  pickerVisible: true,
  listsModels: true,
  options: [],
  suggestedModels: [],
  ...extra,
});

export const AI_PROVIDERS: Record<AiProviderKind, AiProviderDefinition> = {
  // Built-in providers, in BrainRouter's picker order: named clouds first…
  openai: cloud(
    "openai",
    "OpenAI",
    "cloud · api.openai.com · or any compatible /v1 endpoint",
    "https://api.openai.com/v1",
    {
      requestFormat: "responses",
      keyPrefixes: ["sk-proj-", "sk-"],
      suggestedModels: [...AI_DOCUMENTED_OPENAI_MODELS],
    },
  ),
  anthropic: cloud(
    "anthropic",
    "Anthropic (Claude)",
    "cloud · api.anthropic.com/v1",
    "https://api.anthropic.com/v1",
    {
      format: "anthropic",
      suggestedModels: [
        "claude-sonnet-5",
        "claude-opus-5",
        "claude-haiku-4-5-20251001",
      ],
    },
  ),
  gemini: cloud(
    "gemini",
    "Google Gemini",
    "cloud · generativelanguage.googleapis.com · OpenAI-compatible",
    "https://generativelanguage.googleapis.com/v1beta/openai",
  ),
  openrouter: cloud(
    "openrouter",
    "OpenRouter",
    "cloud · openrouter.ai/api/v1 · gateway to many models",
    "https://openrouter.ai/api/v1",
    { keyPrefixes: ["sk-or-v1-"] },
  ),
  zenmux: cloud(
    "zenmux",
    "ZenMux",
    "cloud · zenmux.ai/api/v1 · gateway to many models",
    "https://zenmux.ai/api/v1",
  ),
  // Maincode's Matilda: Australian sovereign models hosted in Melbourne. Its
  // OpenAI-compatible endpoint takes a Bearer `mc_live_` key, lists models at
  // /models, rejects unknown request fields, and caps each request at 64 KiB
  // and each message at 16,000 characters.
  matilda: cloud(
    "matilda",
    "Matilda (Maincode)",
    "cloud · matilda.maincode.com/api/v1 · Australian sovereign models",
    "https://matilda.maincode.com/api/v1",
    {
      suggestedModels: ["matilda"],
      keyPrefixes: ["mc_live_"],
      limits: { maxBodyBytes: 65_536, maxMessageChars: 16_000 },
      // Matilda answers in prose unless given a schema, which it enforces.
      structuredOutput: "json_schema",
    },
  ),
  groq: cloud(
    "groq",
    "Groq",
    "cloud · api.groq.com/openai/v1 · fast inference",
    "https://api.groq.com/openai/v1",
  ),
  azure: cloud(
    "azure",
    "Azure OpenAI",
    "cloud · your-resource.openai.azure.com · you provide the base URL; the model is your deployment name",
    "",
    {
      format: "azure",
      listsModels: false,
      options: [
        {
          key: "apiVersion",
          label: "API version",
          placeholder: "2024-10-21",
          required: true,
        },
      ],
    },
  ),
  // …then the generic OpenAI-compatible option and the hosted gateway…
  "openai-compatible": cloud(
    "openai-compatible",
    "OpenAI-compatible (custom)",
    "any /v1 endpoint · you provide the base URL + key",
    "",
    { requiresKey: false },
  ),
  opencode: cloud(
    "opencode",
    "opencode (Zen gateway)",
    "cloud · opencode.ai gateway · blank key uses the public tier",
    "https://opencode.ai/zen/v1",
    { requiresKey: false, defaultApiKey: "public" },
  ),
  // …then local servers, then entries hidden from the picker.
  lmstudio: cloud(
    "lmstudio",
    "LM Studio (local)",
    "local · http://localhost:1234 · blank API key OK. From Docker, use http://host.docker.internal:1234/v1.",
    "http://localhost:1234/v1",
    { requiresKey: false, local: true },
  ),
  ollama: cloud(
    "ollama",
    "Ollama (local)",
    "local · http://localhost:11434 · blank API key OK. From Docker, use http://host.docker.internal:11434/v1.",
    "http://localhost:11434/v1",
    { requiresKey: false, local: true },
  ),
  deepseek: cloud(
    "deepseek",
    "DeepSeek",
    "cloud · api.deepseek.com/v1 (via OpenAI-compatible)",
    "https://api.deepseek.com/v1",
    { pickerVisible: false, keyPrefixes: ["dsk-"] },
  ),
  // BrainRouter's starter set: OpenAI-compatible vendors with no quirks.
  together: cloud(
    "together",
    "Together AI",
    "cloud · api.together.xyz/v1 (OpenAI-compatible)",
    "https://api.together.xyz/v1",
  ),
  fireworks: cloud(
    "fireworks",
    "Fireworks AI",
    "cloud · api.fireworks.ai/inference/v1 (OpenAI-compatible)",
    "https://api.fireworks.ai/inference/v1",
  ),
  mistral: cloud(
    "mistral",
    "Mistral",
    "cloud · api.mistral.ai/v1 (OpenAI-compatible)",
    "https://api.mistral.ai/v1",
  ),
  xai: cloud(
    "xai",
    "xAI (Grok)",
    "cloud · api.x.ai/v1 (OpenAI-compatible)",
    "https://api.x.ai/v1",
  ),
  perplexity: cloud(
    "perplexity",
    "Perplexity",
    "cloud · api.perplexity.ai (OpenAI-compatible)",
    "https://api.perplexity.ai",
  ),
  deepinfra: cloud(
    "deepinfra",
    "DeepInfra",
    "cloud · api.deepinfra.com/v1/openai (OpenAI-compatible)",
    "https://api.deepinfra.com/v1/openai",
  ),
  nebius: cloud(
    "nebius",
    "Nebius AI Studio",
    "cloud · api.studio.nebius.ai/v1 (OpenAI-compatible)",
    "https://api.studio.nebius.ai/v1",
  ),
};
