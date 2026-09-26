import { ZodError, type z } from "zod";
import { HttpError, type AgentOutcome } from "@orbyn/core";
import { readTransaction, type Queryable } from "../db/pool.js";
import { validationMessage } from "../lib/validation-message.js";
import { loadPrefs } from "../modules/planner/calendar.js";
import { cap as capText } from "./format.js";
import { policy, type Principal } from "./policy.js";
import {
  CapabilityError,
  cursorCodec,
  cursorKey,
  type Capability,
  type CapabilityContext,
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
};

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
      const prefs = await loadPrefs(db, p.user.id);
      return fn({
        principal: p,
        db,
        now: options.now ?? new Date(),
        timezone: prefs.timezone,
        spaces: policy.spaces(p),
        cursor: cursorCodec(p, name, args),
      });
    },
    { primary: options.primary, timeoutMs: READ_TIMEOUT_MS },
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
  const run = async (db: Queryable) => {
    const prefs = await loadPrefs(db, p.user.id);
    const ctx: CapabilityContext = {
      principal: p,
      db,
      now,
      timezone: prefs.timezone,
      spaces: policy.spaces(p),
      cursor: cursorCodec(p, name, input),
    };
    return cap.run(ctx, input as z.output<typeof cap.input>);
  };
  try {
    await cursorKey();
    const answer =
      cap.mode === "read"
        ? await readTransaction(run, {
            primary: options.primary,
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
    return {
      result: toResult(cap, structured, answer.markdown, answer.links),
      outcome: "ok",
      targets: answer.targets ?? [],
    };
  } catch (e) {
    return fail(asCapabilityError(e, options.log));
  }
}
