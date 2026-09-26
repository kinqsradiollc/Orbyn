import { z } from "zod";
import {
  CapabilityError,
  Registry,
  defineCapability,
  type Capability,
} from "./registry.js";
import { READ } from "./common.js";

/**
 * The built-in assistant's tools, on the capability registry. Each is
 * declared once as a capability (name, arguments schema, access, tier and
 * mode), so the assistant and outside agents share one catalogue and one
 * set of rules; the assistant keeps the descriptions and JSON schemas it
 * was tuned with (they are addressed to its own model), carried here
 * unchanged in `assistant.spec` and handed to its provider as before.
 *
 * These capabilities live in their own registry, never the MCP one: they
 * run with the assistant's turn context (what it has proposed so far, the
 * chat's scope) and only propose; nothing an outside agent holds can call
 * them. Parity tests (tests/assistant-registry.test.ts) hold the specs the
 * assistant sends to exactly what they were before the move.
 */

/** A tool as the assistant's provider sees it. */
export type AssistantSpec = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

/** One of the assistant's tools, with its own turn context `C`. */
export type AssistantTool<C> = {
  spec: AssistantSpec;
  args: z.ZodType;
  run: (ctx: C, args: never) => Promise<unknown>;
};

export type AssistantCapability<C = unknown> = Capability & {
  assistant: AssistantTool<C>;
};

/** Its tools that only read (the rest propose changes for review). */
const PROPOSES = /^propose_|^ask_clarification$|^plan_schedule$/;

/** The assistant's tool as a capability. */
export function assistantCapability<C>(
  t: AssistantTool<C>,
): AssistantCapability<C> {
  const proposes = PROPOSES.test(t.spec.name);
  const cap = defineCapability({
    name: t.spec.name,
    title: t.spec.name.replace(/_/g, " "),
    description: t.spec.description,
    input: t.args as z.ZodType,
    output: z.object({ result: z.unknown() }),
    annotations: proposes
      ? {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: false,
        }
      : READ,
    access: proposes ? "suggest" : "read",
    toolset: "core",
    mode: proposes ? "propose" : "read",
    tier: proposes ? "W3" : "R",
    async run() {
      // Only the assistant's own loop runs these (runAssistantTool).
      throw new CapabilityError(
        "UNAVAILABLE",
        "The assistant's tools run only inside the assistant.",
      );
    },
  });
  return Object.assign(cap, { assistant: t });
}

/** A registry of the assistant's tools, in its order. */
export function assistantRegistry<C>(tools: AssistantTool<C>[]) {
  return new Registry(tools.map((t) => assistantCapability(t)));
}

/** What the assistant sends its provider for a registry of its tools. */
export const assistantSpecs = (registry: Registry): AssistantSpec[] =>
  registry.all.map((c) => (c as AssistantCapability).assistant.spec);

/**
 * Run one of the assistant's tools through the registry: found by name,
 * its arguments checked by the capability's schema. `null` for a name the
 * registry doesn't have.
 */
export async function runAssistantTool<C>(
  registry: Registry,
  name: string,
  ctx: C,
  raw: unknown,
): Promise<
  { ok: true; value: unknown } | { ok: false; error: z.ZodError } | null
> {
  const cap = registry.get(name) as AssistantCapability<C> | undefined;
  if (!cap) return null;
  const parsed = cap.input.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error };
  return {
    ok: true,
    value: await cap.assistant.run(ctx, parsed.data as never),
  };
}
