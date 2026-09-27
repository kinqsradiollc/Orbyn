import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { AgentAccess, AgentToolset } from "@orbyn/core";
import type { Queryable } from "../db/pool.js";
import { derivedKey } from "../lib/secrets.js";
import type { Spaces } from "../lib/visibility.js";
import { policy, type Principal } from "./policy.js";
import type { WriteMeta } from "./write.js";

/**
 * The capability registry: every tool an outside agent can call, declared
 * once with its input and output schemas, its MCP annotations, the access
 * level and toolset it needs, and whether it reads, proposes or writes.
 * The mcp service serves tools/list and tools/call from it; the catalog
 * snapshot (mcp-catalog.json) and docs/mcp.md are generated from it.
 *
 * Nothing here knows about HTTP or Fastify, so the mcp and ai services can
 * both load it. Capabilities get a Principal and a database handle, never a
 * request.
 */

/** Whether a capability reads, turns into a proposal, or changes things. */
export type Mode = "read" | "propose" | "write";
/**
 * Risk tier: R reads; W1 only adds, privately; W2 edits or is visible to
 * teammates; W3 always goes to review.
 */
export type Tier = "R" | "W1" | "W2" | "W3";
/** What a call can reach beyond Orbyn. */
export type Effect =
  "email_outside" | "notify_member" | "fetch_outside" | "publish";

export type Annotations = {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
};

/** Error codes an agent can act on, each with a fix. */
export type ErrorCode =
  | "NOT_FOUND"
  | "INVALID"
  | "AMBIGUOUS"
  | "FORBIDDEN"
  | "READ_ONLY"
  | "VERSION_CONFLICT"
  | "STALE"
  | "MAINTENANCE"
  | "UNAVAILABLE"
  | "INTERNAL";

/** A failure the agent can read and correct (an isError tool result). */
export class CapabilityError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly fix?: string,
    readonly data?: Record<string, unknown>,
  ) {
    super(message);
  }
}

/** Handing out and reading back page cursors bound to one caller and call. */
export type CursorCodec = {
  seal(offset: number): Promise<string>;
  open(cursor: string | undefined): Promise<number>;
};

export type CapabilityContext = {
  principal: Principal;
  /** A read-only transaction for reads. */
  db: Queryable;
  now: Date;
  /** The person's time zone. */
  timezone: string;
  /** The spaces reads may reach (for lib/visibility.ts). */
  spaces: Spaces;
  cursor: CursorCodec;
  /**
   * Reports how far a long call has got (MCP progress notifications, or a
   * long job's status), when the caller asked to hear it. Never required.
   */
  progress?: Progress;
};

/** How far a call has got: steps done, of how many, and what it's doing. */
export type Progress = (done: number, total: number, message: string) => void;

export type ResultLink = {
  uri: string;
  name: string;
  title?: string;
  description?: string;
};

export type CapabilityResult<T> = {
  structured: T;
  /** Short Markdown for people and models (not used by JSON-text tools). */
  markdown: string;
  /** Objects the result is about, as MCP resource links. */
  links?: ResultLink[];
  /** Typed ids it touched, for the activity log (never content). */
  targets?: string[];
  /** For changes: the outcome, proposal, undo steps and after-commit work. */
  write?: WriteMeta;
};

export type Capability<
  I extends z.ZodType = z.ZodType,
  O extends z.ZodType = z.ZodType,
> = {
  name: string;
  title: string;
  /** What it does and returns, for the model. Never instructions to it. */
  description: string;
  input: I;
  output: O;
  annotations: Annotations;
  access: AgentAccess;
  toolset: AgentToolset;
  mode: Mode;
  tier: Tier;
  effects?: Effect[];
  /**
   * The text content is exactly JSON.stringify(structuredContent): OpenAI's
   * search and fetch contract (deep research, company knowledge).
   */
  jsonText?: boolean;
  /** Only for old personal API keys on the legacy address (aliases). */
  legacyOnly?: boolean;
  /** Extra `_meta` on the tool as tools/list gives it (e.g. openai/profile). */
  meta?: Record<string, unknown>;
  /** Counted against the lower search limit, or the CPU-heavy one. */
  limitGroup?: "search" | "heavy";
  run(
    ctx: CapabilityContext,
    input: z.output<I>,
  ): Promise<CapabilityResult<z.output<O>>>;
};

/** Declares a capability with its types checked. */
export const defineCapability = <I extends z.ZodType, O extends z.ZodType>(
  c: Capability<I, O>,
): Capability => c as unknown as Capability;

/** A JSON Schema for an object, as MCP requires for tool schemas. */
export type ObjectSchema = { type: "object"; [key: string]: unknown };

/** A tool as tools/list describes it. */
export type ToolDescription = {
  name: string;
  title: string;
  description: string;
  inputSchema: ObjectSchema;
  outputSchema: ObjectSchema;
  annotations: Annotations & { title: string };
};

const schemaCache = new WeakMap<Capability, ToolDescription>();

/** The JSON Schema form of a zod schema, without the $schema line. */
function jsonSchema(schema: z.ZodType, io: "input" | "output"): ObjectSchema {
  const out = z.toJSONSchema(schema, { io, unrepresentable: "any" }) as Record<
    string,
    unknown
  >;
  delete out.$schema;
  if (out.type !== "object")
    throw new Error("Tool schemas must describe an object.");
  return out as ObjectSchema;
}

/** tools/list's entry for a capability (computed once). */
export function describe(cap: Capability): ToolDescription {
  const hit = schemaCache.get(cap);
  if (hit) return hit;
  const described: ToolDescription = {
    name: cap.name,
    title: cap.title,
    description: cap.description,
    inputSchema: jsonSchema(cap.input, "input"),
    outputSchema: jsonSchema(cap.output, "output"),
    annotations: { title: cap.title, ...cap.annotations },
  };
  schemaCache.set(cap, described);
  return described;
}

/** A registry: capabilities in a fixed order, found by name. */
export class Registry {
  private readonly byName = new Map<string, Capability>();
  constructor(readonly all: Capability[]) {
    for (const c of all) {
      if (this.byName.has(c.name))
        throw new Error(`Two capabilities are called ${c.name}`);
      this.byName.set(c.name, c);
    }
  }
  get(name: string) {
    return this.byName.get(name);
  }
  /** What `p` may call, in the registry's order (stable for caches). */
  for(p: Principal): Capability[] {
    return this.all.filter((c) => policy.allows(p, c));
  }
  /**
   * Adds capabilities for a while (tests of tools a later phase brings):
   * returns a function that takes them away again.
   */
  extend(caps: Capability[]): () => void {
    for (const c of caps) {
      if (this.byName.has(c.name))
        throw new Error(`Two capabilities are called ${c.name}`);
      this.byName.set(c.name, c);
      this.all.push(c);
    }
    return () => {
      for (const c of caps) {
        this.byName.delete(c.name);
        const at = this.all.indexOf(c);
        if (at >= 0) this.all.splice(at, 1);
      }
    };
  }
}

/** A short, stable digest of arguments, for idempotency and activity. */
export function argsDigest(args: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(args ?? {}))
    .digest("base64url")
    .slice(0, 22);
}

let cursorKeyLoad: Promise<Buffer> | null = null;

/**
 * The key cursors are sealed with, loaded once per process. Loading it the
 * first time can write the server's key, so callers load it before opening
 * a read-only transaction (execute() does), never from inside one.
 */
export function cursorKey(): Promise<Buffer> {
  cursorKeyLoad ??= derivedKey("mcp-cursor").catch((error) => {
    cursorKeyLoad = null;
    throw error;
  });
  return cursorKeyLoad;
}

/**
 * Cursors that page one call's results. Each is signed with a key derived
 * from Orbyn's secrets and bound to the connection, the tool and the other
 * arguments, so a cursor from another person, connection or query is
 * refused rather than read.
 */
export function cursorCodec(
  p: Principal,
  tool: string,
  args: Record<string, unknown>,
): CursorCodec {
  const { cursor: _ignored, ...rest } = args;
  const bound = `${p.user.id}|${p.grant_id ?? "-"}|${tool}|${argsDigest(rest)}`;
  const mac = async (offset: number) =>
    createHmac("sha256", await cursorKey())
      .update(`${bound}|${offset}`)
      .digest("base64url")
      .slice(0, 22);
  return {
    async seal(offset) {
      return `c1.${offset}.${await mac(offset)}`;
    },
    async open(cursor) {
      if (!cursor) return 0;
      const m = /^c1\.(\d{1,6})\.([\w-]{22})$/.exec(cursor);
      if (m) {
        const offset = Number(m[1]);
        const want = Buffer.from(await mac(offset));
        const got = Buffer.from(m[2]);
        if (want.length === got.length && timingSafeEqual(want, got))
          return offset;
      }
      throw new CapabilityError(
        "INVALID",
        "That cursor isn't valid for this call.",
        "Use the next_cursor from the previous page of this same call, or start again without a cursor.",
      );
    },
  };
}
