/**
 * AI providers an admin can connect from the admin console. The backend uses
 * `format` to pick the request shape; clients use the rest to build forms.
 */
export const AI_PROVIDER_KINDS = [
  "openai",
  "anthropic",
  "gemini",
  "azure",
  "openrouter",
  "groq",
  "mistral",
  "deepseek",
  "maincode",
  "together",
  "fireworks",
  "xai",
  "perplexity",
  "deepinfra",
  "lmstudio",
  "ollama",
  "openai-compatible",
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
  listsModels: true,
  options: [],
  suggestedModels: [],
  ...extra,
});

export const AI_PROVIDERS: Record<AiProviderKind, AiProviderDefinition> = {
  openai: cloud(
    "openai",
    "OpenAI",
    "GPT models from OpenAI.",
    "https://api.openai.com/v1",
  ),
  anthropic: cloud(
    "anthropic",
    "Anthropic",
    "Claude models, using Anthropic's native Messages API.",
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
    "Gemini models through Google's OpenAI-compatible endpoint.",
    "https://generativelanguage.googleapis.com/v1beta/openai",
  ),
  azure: cloud(
    "azure",
    "Azure OpenAI",
    "Your Azure OpenAI resource. Use the deployment name as the model.",
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
  openrouter: cloud(
    "openrouter",
    "OpenRouter",
    "Hundreds of models behind one key.",
    "https://openrouter.ai/api/v1",
  ),
  groq: cloud(
    "groq",
    "Groq",
    "Fast inference for open models.",
    "https://api.groq.com/openai/v1",
  ),
  mistral: cloud(
    "mistral",
    "Mistral",
    "Mistral's hosted models.",
    "https://api.mistral.ai/v1",
  ),
  deepseek: cloud(
    "deepseek",
    "DeepSeek",
    "DeepSeek's hosted models.",
    "https://api.deepseek.com/v1",
  ),
  // Maincode's Matilda: Australian sovereign models hosted in Melbourne. Its
  // OpenAI-compatible endpoint takes a Bearer `mc_live_` key, lists models at
  // /models, rejects unknown request fields, and caps each request at 64 KiB
  // and each message at 16,000 characters.
  maincode: cloud(
    "maincode",
    "Maincode (Matilda)",
    "Matilda, Australian sovereign models hosted in Melbourne.",
    "https://matilda.maincode.com/api/v1",
    {
      suggestedModels: ["matilda"],
      limits: { maxBodyBytes: 65_536, maxMessageChars: 16_000 },
    },
  ),
  together: cloud(
    "together",
    "Together AI",
    "Open models hosted by Together.",
    "https://api.together.xyz/v1",
  ),
  fireworks: cloud(
    "fireworks",
    "Fireworks AI",
    "Open models hosted by Fireworks.",
    "https://api.fireworks.ai/inference/v1",
  ),
  xai: cloud("xai", "xAI", "Grok models from xAI.", "https://api.x.ai/v1"),
  perplexity: cloud(
    "perplexity",
    "Perplexity",
    "Perplexity's models.",
    "https://api.perplexity.ai",
  ),
  deepinfra: cloud(
    "deepinfra",
    "DeepInfra",
    "Open models hosted by DeepInfra.",
    "https://api.deepinfra.com/v1/openai",
  ),
  lmstudio: cloud(
    "lmstudio",
    "LM Studio",
    "Models running in LM Studio. From Docker, use http://host.docker.internal:1234/v1.",
    "http://localhost:1234/v1",
    { requiresKey: false, local: true },
  ),
  ollama: cloud(
    "ollama",
    "Ollama",
    "Models running in Ollama. From Docker, use http://host.docker.internal:11434/v1.",
    "http://localhost:11434/v1",
    { requiresKey: false, local: true },
  ),
  "openai-compatible": cloud(
    "openai-compatible",
    "Other OpenAI-compatible",
    "Any service that speaks the OpenAI chat API, such as vLLM or LiteLLM.",
    "",
    { requiresKey: false },
  ),
};
