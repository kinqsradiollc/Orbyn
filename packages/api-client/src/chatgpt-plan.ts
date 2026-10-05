import {
  chatgptModel,
  chatgptPlanUsage,
  type ChatgptPlanUsage,
  parseChatgptModels,
  type ChatgptModel,
} from "@orbyn/core";

export type ChatgptAccount = {
  accountId: string;
  workspaceId: string;
  /** Issued OAuth registration bound to the verified account and workspace. */
  clientId: string;
};
export type ChatgptCredential = ChatgptAccount & { accessToken: string };
export type ChatgptPlanRequest = {
  model: string;
  instructions?: string;
  max_output_tokens?: number;
  input: { role: "user" | "assistant"; content: string }[];
};

/** Sanitized provider failure with enough metadata to choose the correct recovery. */
export class ChatgptPlanError extends Error {
  constructor(
    public readonly status: number,
    public readonly providerCode: string | null,
    public readonly requestId: string | null,
  ) {
    super(
      providerCode === "subscription_sharing_usage_limit_exceeded"
        ? "ChatGPT plan usage limit reached. Manage usage in ChatGPT."
        : providerCode === "subscription_sharing_user_not_eligible"
          ? "ChatGPT plan usage is unavailable for this account or workspace."
          : providerCode === "subscription_sharing_usage_unavailable"
            ? "ChatGPT usage availability could not be checked. Try again later."
            : status === 401 || status === 403
              ? "ChatGPT access expired or was declined. Reconnect before continuing."
              : status === 429
                ? "ChatGPT usage is limited. Manage usage in ChatGPT."
                : "ChatGPT could not complete the request.",
    );
    this.name = "ChatgptPlanError";
  }
}
const CHATGPT_ACTION_FAILURE =
  "ChatGPT could not complete this action. Retry or reconnect this account.";
const SAFE_ACTION_MESSAGES = new Set([
  CHATGPT_ACTION_FAILURE,
  ...[
    [429, "subscription_sharing_usage_limit_exceeded"],
    [403, "subscription_sharing_user_not_eligible"],
    [503, "subscription_sharing_usage_unavailable"],
    [401, null],
    [429, null],
    [500, null],
  ].map(
    ([status, code]) =>
      new ChatgptPlanError(status as number, code as string | null, null)
        .message,
  ),
  "Choose a ChatGPT default model first.",
  "Choose an available ChatGPT default model before continuing.",
  "This model is unavailable for the selected ChatGPT account.",
  "ChatGPT plan verification did not complete.",
  "ChatGPT did not return a response stream.",
  "ChatGPT sent an invalid stream event.",
  "ChatGPT did not complete the response.",
  "ChatGPT disconnected before completing the response.",
]);
/** Only fixed recovery messages cross IPC; arbitrary provider text is never reflected. */
export function safeChatgptActionError(error: unknown): string {
  if (error instanceof ChatgptPlanError)
    return new ChatgptPlanError(error.status, error.providerCode, null).message;
  const prefix = "Error invoking remote method 'orbyn:chatgpt': Error: ";
  const raw = error instanceof Error ? error.message : "";
  const message = raw.startsWith(prefix) ? raw.slice(prefix.length) : raw;
  return SAFE_ACTION_MESSAGES.has(message) ? message : CHATGPT_ACTION_FAILURE;
}

const safeCode = (value: unknown) =>
  typeof value === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(value)
    ? value
    : null;

/** Fixed, credential-owning transport. Never pass this client to the shared backend. */
export class ChatgptPlanClient {
  private readonly account: ChatgptAccount;
  constructor(
    private readonly options: {
      account: ChatgptAccount;
      credential: () => Promise<ChatgptCredential>;
      fetch?: typeof fetch;
    },
  ) {
    if (
      !options.account.accountId.trim() ||
      !options.account.workspaceId.trim() ||
      !options.account.clientId.trim() ||
      options.account.clientId === "dynamic_agent_client"
    )
      throw new Error(
        "Choose a ChatGPT account and workspace before continuing.",
      );
    this.account = Object.freeze({ ...options.account });
  }

  private async request(
    path: "models" | "responses",
    init: RequestInit,
    signal?: AbortSignal,
  ) {
    const credential = await this.options.credential();
    if (
      credential.accountId !== this.account.accountId ||
      credential.workspaceId !== this.account.workspaceId ||
      credential.clientId !== this.account.clientId
    )
      throw new Error("ChatGPT account changed. Reconnect before continuing.");
    if (!credential.accessToken.trim())
      throw new Error("Sign in to ChatGPT before continuing.");
    signal?.throwIfAborted();
    const response = await (this.options.fetch ?? fetch)(
      `https://api.openai.com/v1/${path}`,
      {
        ...init,
        redirect: "error",
        credentials: "omit",
        signal,
        headers: {
          Authorization: `Bearer ${credential.accessToken}`,
          ...(path === "responses"
            ? { "Content-Type": "application/json" }
            : {}),
        },
      },
    );
    if (!response.ok) {
      let body: any = null;
      try {
        body = JSON.parse(await boundedText(response, 16_384));
      } catch {}
      throw new ChatgptPlanError(
        response.status,
        safeCode(body?.error?.code),
        safeCode(response.headers.get("x-request-id")),
      );
    }
    return response;
  }

  /** Query the selected account's live catalog; no managed or curated fallback. */
  async models(signal?: AbortSignal): Promise<ChatgptModel[]> {
    const response = await this.request(
      "models",
      { method: "GET" },
      signal ?? AbortSignal.timeout(30_000),
    );
    const text = await boundedText(response, 2 * 1024 * 1024);
    try {
      return parseChatgptModels(JSON.parse(text));
    } catch {
      throw new Error("ChatGPT sent an invalid model catalog.");
    }
  }

  /** Text inference foundation; only an observed completed event is success. */
  async complete(
    request: ChatgptPlanRequest,
    options: {
      signal?: AbortSignal;
      onText?: (text: string) => void;
      onUsage?: (usage: ChatgptPlanUsage | null) => void;
    } = {},
  ): Promise<string> {
    const signal = options.signal ?? AbortSignal.timeout(120_000);
    const model = chatgptModel.shape.slug.parse(request.model);
    const maxOutputTokens = request.max_output_tokens;
    if (
      maxOutputTokens !== undefined &&
      (!Number.isSafeInteger(maxOutputTokens) ||
        maxOutputTokens < 1 ||
        maxOutputTokens > 65536)
    )
      throw new Error("Use a supported output-token limit.");
    if (
      request.input.length > 1000 ||
      request.input.some(
        (m) =>
          !["user", "assistant"].includes(m.role) ||
          typeof m.content !== "string",
      )
    )
      throw new Error("Use supported conversation messages.");
    const input = request.input.map((m) => ({
      role: m.role,
      content: m.content,
    }));
    const instructions = request.instructions;
    if (JSON.stringify({ input, instructions }).length > 2 * 1024 * 1024)
      throw new Error("The conversation exceeded the supported size.");
    const models = await this.models(signal);
    if (!models.some((m) => m.slug === model))
      throw new Error(
        "This model is unavailable for the selected ChatGPT account.",
      );
    const response = await this.request(
      "responses",
      {
        method: "POST",
        // Pick only supported fields. Extra caller fields never enter the request.
        body: JSON.stringify({
          model,
          store: false,
          stream: true,
          ...(instructions ? { instructions } : {}),
          input,
          ...(maxOutputTokens === undefined
            ? {}
            : { max_output_tokens: maxOutputTokens }),
        }),
      },
      signal,
    );
    const mediaType = (response.headers.get("content-type") ?? "")
      .split(";", 1)[0]
      .trim()
      .toLowerCase();
    // Some plan responses omit Content-Type. The bounded event parser below
    // still requires valid SSE and response.completed; no JSON fallback exists.
    if ((mediaType && mediaType !== "text/event-stream") || !response.body)
      throw new Error("ChatGPT did not return a response stream.");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let pending = "",
      text = "",
      bytes = 0,
      completed = false;
    let usage: ChatgptPlanUsage | null = null;
    const consume = (frame: string) => {
      const data = frame
        .split(/\r?\n/)
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trimStart())
        .join("\n");
      if (!data || data === "[DONE]") return;
      let event: Record<string, any>;
      try {
        event = JSON.parse(data);
        if (
          !event ||
          typeof event !== "object" ||
          typeof event.type !== "string"
        )
          throw new Error();
      } catch {
        throw new Error("ChatGPT sent an invalid stream event.");
      }
      if (event.type === "response.output_text.delta") {
        if (typeof event.delta !== "string")
          throw new Error("ChatGPT sent an invalid text event.");
        text += event.delta;
        options.onText?.(event.delta);
      } else if (
        event.type === "response.refusal.delta" ||
        event.type === "response.refusal.done"
      ) {
        throw new Error("ChatGPT declined this request.");
      } else if (event.type === "response.completed") {
        if (event.response?.status !== "completed")
          throw new Error("ChatGPT did not complete the response.");
        const reported = chatgptPlanUsage.safeParse(
          event.response?.usage
            ? {
                input_tokens: event.response.usage.input_tokens,
                output_tokens: event.response.usage.output_tokens,
                total_tokens: event.response.usage.total_tokens,
              }
            : null,
        );
        usage = reported.success ? reported.data : null;
        completed = true;
      } else if (
        ["response.failed", "response.incomplete", "error"].includes(event.type)
      ) {
        throw new ChatgptPlanError(
          response.status,
          safeCode(
            event.response?.error?.code ?? event.error?.code ?? event.code,
          ),
          safeCode(response.headers.get("x-request-id")),
        );
      }
    };
    try {
      while (!completed) {
        signal.throwIfAborted();
        const part = await reader.read();
        if (part.done) break;
        bytes += part.value.byteLength;
        if (bytes > 4 * 1024 * 1024)
          throw new Error("ChatGPT response exceeded the supported size.");
        pending += decoder.decode(part.value, { stream: true });
        const frames = pending.split(/\r?\n\r?\n/);
        pending = frames.pop() ?? "";
        for (const frame of frames) {
          consume(frame);
          if (completed) break;
        }
      }
      if (!completed)
        throw new Error("ChatGPT disconnected before completing the response.");
      options.onUsage?.(usage);
      return text;
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }
}

async function boundedText(response: Response, limit: number): Promise<string> {
  if (!response.body) throw new Error("ChatGPT returned no model catalog.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "",
    bytes = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) return text + decoder.decode();
      bytes += part.value.byteLength;
      if (bytes > limit)
        throw new Error("ChatGPT model catalog exceeded the supported size.");
      text += decoder.decode(part.value, { stream: true });
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
