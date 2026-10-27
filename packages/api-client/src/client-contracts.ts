import {
  type ChatTraceEntry,
  type EditScope,
  type Proposal,
} from "@orbyn/core";

/** News from `GET /events`: re-read what it names. */
export type LiveNews = {
  kind: "changed" | "focus" | "presence" | "doc_presence";
  /**
   * What a "changed" is about: pages, projects, lists and folders
   * (organize), templates, work records, the Review inbox, or items.
   * Absent on older news, which means anything may have changed.
   */
  area?:
    | "assistant"
    | "items"
    | "docs"
    | "projects"
    | "organize"
    | "templates"
    | "records"
    | "review";
  user?: string;
  team?: string;
  doc?: string;
  by?: string;
};

/**
 * What a document's stream says beyond its version: `trashed` when someone
 * moved it to Trash, so an editor that has it open can let it go.
 */
export type DocNews = {
  trashed: boolean;
  /** Permanently forgotten from private Memory. */
  forgotten?: boolean;
  /** Only the page's tags changed; its words and version are as they were. */
  tags: boolean;
  /** Only a field value changed (the Info panel reads it afresh). */
  fields?: boolean;
  /** Who made the change, so an editor can skip its own saves ("" when unknown). */
  by: string;
};

export /** "?scope=this&occurrence=…" for edits to part of a repeating item. */
const scopeQuery = (o: { scope?: EditScope; occurrence?: string }) => {
  if (!o.scope || o.scope === "all") return "";
  const q = new URLSearchParams({ scope: o.scope });
  if (o.occurrence) q.set("occurrence", o.occurrence);
  return `?${q}`;
};

export /** After a write, reads ask for the primary database for this long. */
const READ_YOUR_WRITES_MS = 5000;

export /** Pause before retrying a read that failed while a server copy restarted. */
const RETRY_DELAY_MS = 300;

export /** How many unchanged-response bodies to remember for conditional GETs. */
const MAX_CACHED = 100;

export /** Polling an assistant turn: first check, longest gap, and how long to wait in all. */
const CHAT_POLL_MS = 1200;

export const CHAT_POLL_MAX_MS = 4000;

export const CHAT_WAIT_MS = 15 * 60_000;

export /** The longest a run may wait for a person's answer or approval while polled. */
const CHAT_WAITING_MAX_MS = 2 * 60 * 60_000;

/** An error named "AbortError", thrown when a caller's AbortSignal stops a poll. */
export function abortError(): Error {
  const error = new Error("The request was stopped.");
  error.name = "AbortError";
  return error;
}

/** Whether `error` came from an AbortSignal stopping the request. */
export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

export /** Wait `ms`, rejecting early with an AbortError when `signal` aborts. */
function pause(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export type AssistantWaiting =
  | { kind: "person"; id: string; question: string; choices: string[] }
  | {
      kind: "approval";
      id: string;
      question: string;
      detail: string;
      steps: unknown[];
      summary: string;
      change_kinds?: string[];
      automation_kind?: "goal" | "routine";
      automation_id?: string;
    };

export type AssistantRunProgress = {
  job_id: string;
  state: "running" | "waiting" | "done";
  label?: string;
  step?: number;
  waiting?: AssistantWaiting | null;
};

export type ChatJob =
  | { state: "running"; progress?: { label?: string; step?: number } }
  | {
      state: "waiting";
      progress?: { label?: string; step?: number };
      waiting: AssistantWaiting | null;
    }
  | {
      state: "done";
      proposal?: Proposal;
      answer?: string;
      assistant_run?: Record<string, unknown>;
      chat_id?: string;
      turn_id?: string;
      trace?: ChatTraceEntry[];
    }
  | { state: "failed"; status?: number; message: string };

export type ChatResult = {
  proposal: Proposal;
  chat_id: string;
  turn_id: string;
  trace: ChatTraceEntry[];
  answer?: string;
  assistant_run?: Record<string, unknown>;
};

export /** What to say when a proxy answered instead of Orbyn (no JSON body). */
function proxyMessage(status: number): string {
  if (status === 504 || status === 524)
    return "That took too long to answer. Try again, or ask for less at once.";
  // The status goes to the console with the rest (errorDetail), not here.
  if (status >= 500)
    return "Orbyn is briefly unavailable. Try again in a moment.";
  return "Orbyn sent a reply it couldn't read. Try again.";
}

export type TokenSource = () =>
  string | null | undefined | Promise<string | null | undefined>;

export type OrbynClientOptions = {
  /** API origin, for example `http://localhost:8008` or `/api`. */
  baseUrl: string;
  /** Returns the current session token, or nothing when signed out. */
  getToken?: TokenSource;
  /** Per-request timeout. Defaults to 120s to outlast the assistant's 85s deadline. */
  timeoutMs?: number;
  /** Override fetch (tests, custom agents). Defaults to the global fetch. */
  fetch?: typeof fetch;
  /**
   * Fetch used for streaming reads, which need a readable `response.body`.
   * React Native's built-in fetch has no body stream, so the phone passes
   * `expo/fetch` here; everywhere else the ordinary fetch already does.
   */
  streamFetch?: typeof fetch;
};

export type RequestOptions = {
  signal?: AbortSignal;
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  /** Send without the Authorization header even if a token exists. */
  anonymous?: boolean;
  /** Resolve with the body text instead of parsing JSON (CSV exports). */
  raw?: boolean;
  /** Send once: a retry with the same key gets the first answer back. */
  idempotencyKey?: string;
  /** Extra request headers. */
  headers?: Record<string, string>;
  /** Fetch live state without conditional or platform response caching. */
  fresh?: boolean;
};
