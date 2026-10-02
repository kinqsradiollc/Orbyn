import { ZodError, type z } from "zod";
import { HttpError, type AgentOutcome } from "@orbyn/core";
import { readTransaction, type Queryable } from "../db/pool.js";
import { validationMessage } from "../lib/validation-message.js";
import { loadPrefs } from "../modules/planner/calendar.js";
import { cap as capText } from "./format.js";
import { policy, type Principal } from "./policy.js";
import { currentAssistantPrincipal } from "./assistant-principal.js";
import {
  assistantReplayAuthority,
  assertAssistantReplaySources,
} from "./assistant-replay.js";
import { assertAssistantReplayTargets } from "./assistant-replay-targets.js";
import {
  keepAnswer,
  priorAnswer,
  recordChange,
  type Recorded,
} from "./write.js";
import {
  CapabilityError,
  argsDigest,
  type AskReason,
  type Asking,
  type ChatAnswer,
  type ChatQuestion,
  cursorCodec,
  cursorKey,
  type Capability,
  type CapabilityContext,
  type Progress,
  type CapabilityResult,
  type Registry,
  type ResultLink,
} from "./registry.js";

/**
 * Running one capability for one principal: validating the arguments,
 * checking the principal may use it, running reads inside a read-only
 * transaction, and shaping the answer as an MCP tool result. Invalid
 * arguments and every refusal come back as an isError result the model can
 * read and correct (SEP-1303), never as a protocol error.
 */

export type TextBlock = {
  type: "text";
  text: string;
  annotations?: { audience?: ("user" | "assistant")[] };
};
export type LinkBlock = {
  type: "resource_link";
  uri: string;
  name: string;
  title?: string;
  description?: string;
  mimeType?: string;
};

export type ToolResult = {
  content: (TextBlock | LinkBlock)[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
  _meta?: Record<string, unknown>;
};

export type Execution = {
  result: ToolResult;
  outcome: AgentOutcome;
  targets: string[];
  /**
   * The change's activity row was written in its own transaction (with
   * its undo and proposal), so the batched recorder only counts it.
   */
  recorded?: boolean;
  /** The same client_ref was sent before: this is that call's answer. */
  replayed?: boolean;
  /**
   * The call needs the person's yes first and the app can ask in the chat:
   * nothing was changed (the call was rolled back); this says what it
   * would do and why it asks.
   */
  ask?: { what: string[]; why: string[]; question?: ChatQuestion };
};

/** Rolls a collecting call back once it knows what it would do. */
class AskFirst extends Error {
  constructor(
    readonly answer: CapabilityResult<unknown>,
    readonly reasons: AskReason[],
    readonly question?: ChatQuestion,
  ) {
    super("ask first");
  }
}

/** What a call would do, in lines for the person (at most 12). */
export function wouldDo(answer: CapabilityResult<unknown>): string[] {
  const s = answer.structured as {
    done?: { change?: string; title?: string }[];
    steps?: { done?: { change?: string; title?: string }[] }[];
    pending?: { changes?: number } | null;
  } | null;
  // A plan (apply_plan) lists what each of its steps did.
  const done = s?.done ?? (s?.steps ?? []).flatMap((x) => x.done ?? []);
  const lines = done.map((d) =>
    `${d.change ?? "Change"}: “${d.title ?? ""}”`.slice(0, 200),
  );
  if (s?.pending?.changes)
    lines.push(
      `${s.pending.changes} more change${s.pending.changes === 1 ? "" : "s"} for your Review inbox`,
    );
  if (!lines.length)
    lines.push(
      ...answer.markdown
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .slice(0, 6),
    );
  return lines.length > 12
    ? [...lines.slice(0, 11), `…and ${lines.length - 11} more`]
    : lines;
}

/** What's wrong with the arguments, in words that name the field. */
function issuesText(error: ZodError): string {
  const where = [
    ...new Set(
      error.issues
        .map((i) =>
          i.path
            .map((p) => (typeof p === "number" ? `[${p}]` : String(p)))
            .join(".")
            .replace(/\.\[/g, "["),
        )
        .filter(Boolean),
    ),
  ].slice(0, 3);
  return (
    validationMessage(error.issues) +
    (where.length ? ` (${where.join(", ")})` : "")
  );
}

/** An isError tool result for a failure the agent can act on. */
export function errorResult(e: CapabilityError): ToolResult {
  const text = `${e.code}: ${e.message}${e.fix ? ` Fix: ${e.fix}` : ""}`;
  return {
    content: [{ type: "text", text }],
    isError: true,
    _meta: {
      "orbyn/error": { code: e.code, ...(e.fix ? { fix: e.fix } : {}) },
      ...(e.data ? { "orbyn/data": e.data } : {}),
    },
  };
}

const outcomeOf = (e: CapabilityError): AgentOutcome =>
  e.code === "FORBIDDEN" || e.code === "NOT_FOUND" || e.code === "READ_ONLY"
    ? "denied"
    : "error";

/** Any failure as a CapabilityError, never leaking database text. */
export function asCapabilityError(
  e: unknown,
  log?: (err: unknown) => void,
): CapabilityError {
  if (e instanceof CapabilityError) return e;
  if (e instanceof ZodError)
    return new CapabilityError(
      "INVALID",
      issuesText(e),
      "Correct the arguments and call again.",
    );
  if (e instanceof HttpError && e.statusCode === 409)
    return new CapabilityError(
      "VERSION_CONFLICT",
      e.message,
      "Read the item again for its current version, then retry with that version.",
    );
  // Not set up here, or busy (too many imports at once): say so plainly.
  if (e instanceof HttpError && (e.statusCode === 503 || e.statusCode === 429))
    return new CapabilityError(
      "UNAVAILABLE",
      e.message,
      "Try again later, or do it in Orbyn.",
    );
  if (e instanceof HttpError && e.statusCode < 500)
    return new CapabilityError(
      e.statusCode === 404
        ? "NOT_FOUND"
        : e.statusCode === 403
          ? "FORBIDDEN"
          : "INVALID",
      e.message,
    );
  // A write attempted inside a read-only transaction: a bug, reported plainly.
  log?.(e);
  return new CapabilityError(
    "INTERNAL",
    "Something went wrong on Orbyn's side.",
    "Try again in a moment.",
  );
}

/** The MCP result for a capability's answer. */
function toResult(
  cap: Capability,
  structured: unknown,
  markdown: string,
  links: ResultLink[] = [],
): ToolResult {
  const data = structured as Record<string, unknown>;
  if (cap.jsonText)
    return {
      content: [{ type: "text", text: JSON.stringify(data) }],
      structuredContent: data,
    };
  return {
    content: [
      { type: "text", text: capText(markdown).text },
      ...links
        .slice(0, 20)
        .map((l): LinkBlock => ({ type: "resource_link", ...l })),
    ],
    structuredContent: data,
  };
}

/** A capability context for `p`, inside a read-only transaction. */
export async function withReadContext<T>(
  p: Principal,
  name: string,
  args: Record<string, unknown>,
  fn: (ctx: CapabilityContext) => Promise<T>,
  options: { primary?: boolean; now?: Date } = {},
): Promise<T> {
  await cursorKey();
  return readTransaction(
    async (db) => {
      const current = await currentAssistantPrincipal(db, p);
      const prefs = await loadPrefs(db, p.user.id);
      return fn({
        principal: current,
        db,
        now: options.now ?? new Date(),
        timezone: prefs.timezone,
        spaces: policy.spaces(current),
        cursor: cursorCodec(current, name, args),
      });
    },
    {
      primary: p.via === "assistant" || options.primary,
      timeoutMs: READ_TIMEOUT_MS,
    },
  );
}

/** No read an agent makes may run longer than this. */
export const READ_TIMEOUT_MS = 20_000;

export type ExecuteOptions = {
  /** Read from the primary (the connection wrote a moment ago). */
  primary?: boolean;
  log?: (err: unknown) => void;
  now?: Date;
  /** Runs a non-read capability; reads never need it. */
  write?: (fn: (db: Queryable) => Promise<unknown>) => Promise<unknown>;
  /** The request, for the activity row of a change. */
  requestId?: string;
  /** Hears how far a long call has got (see CapabilityContext.progress). */
  progress?: Progress;
  /**
   * Asking in the chat: "collect" when the app can ask (a change that
   * needs asking rolls the call back and answers with `ask`), "approved"
   * once the person said yes there.
   */
  asking?: Asking["mode"];
  /** A yes in the app's review card, so ask-first and suggest rules are satisfied. */
  reviewed?: boolean;
  /** The person's answer to a question asked in the chat (ask_person). */
  chatAnswer?: ChatAnswer;
};

/** Calls `name` for `p` with `args`, as an MCP tool result. */
export async function execute(
  registry: Registry,
  p: Principal,
  name: string,
  args: unknown,
  options: ExecuteOptions = {},
): Promise<Execution> {
  const cap = registry.get(name);
  const fail = (e: CapabilityError): Execution => ({
    result: errorResult(e),
    outcome: outcomeOf(e),
    targets: [],
  });
  if (!cap || !policy.allows(p, cap))
    return fail(
      new CapabilityError(
        "FORBIDDEN",
        cap
          ? `This connection can't use ${name}.`
          : `There is no tool called ${name}.`,
        "List the tools again: this connection's tools may have changed.",
      ),
    );
  const parsed = cap.input.safeParse(args ?? {});
  if (!parsed.success)
    return fail(
      new CapabilityError(
        "INVALID",
        issuesText(parsed.error),
        "Correct the arguments and call again.",
      ),
    );
  const input = parsed.data as Record<string, unknown>;
  const now = options.now ?? new Date();
  // A change made for a connection is recorded with it; one sent again
  // with the same client_ref gets the first answer back.
  const grantId = cap.mode !== "read" ? p.grant_id : null;
  const clientRef =
    grantId && typeof input.client_ref === "string" ? input.client_ref : null;
  let replayed: Recorded | null = null;
  const asking: Asking | undefined =
    options.asking && cap.mode !== "read"
      ? {
          mode: options.asking,
          reasons: [],
          ...(options.reviewed ? { reviewed: true } : {}),
          ...(options.chatAnswer ? { answer: options.chatAnswer } : {}),
        }
      : undefined;
  const run = async (db: Queryable) => {
    const currentPrincipal = await currentAssistantPrincipal(
      db,
      p,
      cap.mode !== "read",
    );
    if (!policy.allows(currentPrincipal, cap))
      throw new CapabilityError(
        "FORBIDDEN",
        `This connection can't use ${name}.`,
      );
    if (grantId && clientRef) {
      replayed = await priorAnswer(db, grantId, name, clientRef);
      if (replayed) {
        if (
          currentPrincipal.via === "assistant" &&
          replayed.assistant_authority !==
            assistantReplayAuthority(currentPrincipal)
        )
          throw new CapabilityError(
            "FORBIDDEN",
            "Assistant authority changed. The cached result was held.",
            "Read the current work or ask the person to review it. Do not repeat the change with a new client_ref.",
          );
        await assertAssistantReplaySources(db, currentPrincipal);
        await assertAssistantReplayTargets(db, currentPrincipal, replayed);
        return {
          structured: replayed.structured,
          markdown: replayed.markdown,
          links: replayed.links as ResultLink[] | undefined,
          targets: replayed.targets,
        } as CapabilityResult<unknown>;
      }
    }
    const prefs = await loadPrefs(db, p.user.id);
    const ctx: CapabilityContext = {
      ...(currentPrincipal.via === "assistant"
        ? { assistant_rule_checks: [] }
        : {}),
      principal: currentPrincipal,
      db,
      now,
      timezone: prefs.timezone,
      spaces: policy.spaces(currentPrincipal),
      cursor: cursorCodec(currentPrincipal, name, input),
      ...(options.progress ? { progress: options.progress } : {}),
      ...(asking ? { asking } : {}),
    };
    const answer = await cap.run(ctx, input as z.output<typeof cap.input>);
    // Something in it needs the person first: undo it all and ask.
    if (asking?.mode === "collect" && asking.reasons.length)
      throw new AskFirst(answer, asking.reasons, asking.question);
    if (grantId) {
      const outcome = answer.write?.outcome ?? "ok";
      const targets = answer.targets ?? [];
      await recordChange(db, p, {
        tool: cap.name,
        tier: cap.tier,
        outcome,
        targets,
        argsDigest: argsDigest(args),
        summary: `${cap.title}${targets.length ? ` · ${targets.length} item${targets.length === 1 ? "" : "s"}` : ""}`,
        meta: answer.write ?? {},
        requestId: options.requestId,
      });
      if (clientRef)
        await keepAnswer(db, grantId, name, clientRef, {
          ...(currentPrincipal.via === "assistant"
            ? {
                assistant_authority: assistantReplayAuthority(currentPrincipal),
              }
            : {}),
          structured: answer.structured,
          markdown: answer.markdown,
          links: answer.links,
          targets,
          outcome,
        });
    }
    return answer;
  };
  try {
    await cursorKey();
    const answer =
      cap.mode === "read"
        ? await readTransaction(run, {
            primary: p.via === "assistant" || options.primary,
            timeoutMs: READ_TIMEOUT_MS,
          })
        : options.write
          ? ((await options.write(run)) as Awaited<ReturnType<typeof run>>)
          : (() => {
              throw new CapabilityError(
                "UNAVAILABLE",
                "Changes aren't available here.",
              );
            })();
    // Once committed: live news, Study, open editors.
    for (const after of answer.write?.after ?? [])
      await after().catch((err) => options.log?.(err));
    const again = replayed as Recorded | null;
    const checked = cap.output.safeParse(answer.structured);
    if (!checked.success) {
      // The answer doesn't match the declared shape: Orbyn's fault, not the caller's.
      options.log?.(checked.error);
      return fail(
        new CapabilityError(
          "INTERNAL",
          "Something went wrong on Orbyn's side.",
          "Try again in a moment.",
        ),
      );
    }
    const structured = checked.data;
    const result = toResult(cap, structured, answer.markdown, answer.links);
    if (again) result._meta = { ...result._meta, "orbyn/replayed": true };
    return {
      result,
      outcome: again?.outcome ?? answer.write?.outcome ?? "ok",
      targets: answer.targets ?? [],
      recorded: !!grantId && !again,
      replayed: !!again,
    };
  } catch (e) {
    if (e instanceof AskFirst)
      return {
        result: { content: [{ type: "text", text: "Asking the person." }] },
        outcome: "proposed",
        targets: [],
        ask: {
          what: e.question ? [] : wouldDo(e.answer),
          why: e.reasons.map((r) => r.text),
          ...(e.question ? { question: e.question } : {}),
        },
      };
    return fail(asCapabilityError(e, options.log));
  }
}
