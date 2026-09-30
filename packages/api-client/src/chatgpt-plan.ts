import {
  chatgptModel,
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
  input: { role: "user" | "assistant"; content: string }[];
};

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
    if (!response.ok)
      throw new Error(
        response.status === 401 || response.status === 403
          ? "ChatGPT access expired or was declined. Reconnect before continuing."
          : response.status === 429
            ? "ChatGPT usage is limited. Try again later."
            : "ChatGPT could not complete the request.",
      );
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
    } = {},
  ): Promise<string> {
    const signal = options.signal ?? AbortSignal.timeout(120_000);
    const model = chatgptModel.shape.slug.parse(request.model);
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
        }),
      },
      signal,
    );
    if (
      !response.headers.get("content-type")?.includes("text/event-stream") ||
      !response.body
    )
      throw new Error("ChatGPT did not return a response stream.");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let pending = "",
      text = "",
      bytes = 0,
      completed = false;
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
        completed = true;
      } else if (
        ["response.failed", "response.incomplete", "error"].includes(event.type)
      ) {
        throw new Error("ChatGPT did not complete the response.");
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
