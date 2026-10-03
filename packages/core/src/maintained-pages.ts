import { z } from "zod";
import { docContent } from "./schemas.js";
import type { DocBlock } from "./docs.js";
import { agentRoutineInput } from "./assistant-workspace.js";

export const MAX_MAINTAINED_BLOCKS = 100;
const blockId = z.string().min(1).max(64);
const uniqueIds = (ids: string[]) => new Set(ids).size === ids.length;
export const maintainedBlockIds = z
  .array(blockId)
  .min(1)
  .max(MAX_MAINTAINED_BLOCKS)
  .refine(uniqueIds);

/** Persist identities and placement, never copies of private block text. */
export const maintainedPageSnapshot = z
  .object({
    doc_version: z.number().int().positive(),
    blocks: z
      .array(
        z
          .object({
            block_id: blockId,
            position: z.number().int().min(0).max(1999),
          })
          .strict(),
      )
      .min(1)
      .max(MAX_MAINTAINED_BLOCKS),
  })
  .strict()
  .refine(
    (snapshot) =>
      uniqueIds(snapshot.blocks.map((block) => block.block_id)) &&
      new Set(snapshot.blocks.map((block) => block.position)).size ===
        snapshot.blocks.length,
  );
export type MaintainedPageSnapshot = z.output<typeof maintainedPageSnapshot>;
/** A page-owned schedule starts paused until its scoped runtime is explicitly enabled. */
export const maintainedPageBindingInput = agentRoutineInput
  .extend({
    block_ids: maintainedBlockIds,
    expected_doc_version: z.number().int().positive(),
    paused: z.boolean().default(true),
  })
  .strict();
/** Editing or rebinding requires both current page and binding revisions. */
export const maintainedPageBindingUpdate = maintainedPageBindingInput
  .extend({
    expected_revision: z.number().int().positive(),
  })
  .strict();
export const maintainedPageBindingDelete = z
  .object({
    expected_revision: z.number().int().positive(),
  })
  .strict();
export type MaintainedPageBindingInput = z.input<
  typeof maintainedPageBindingInput
>;
export type MaintainedPageBindingUpdate = z.input<
  typeof maintainedPageBindingUpdate
>;

/** Server-side job/approval receipt must match the saved binding revision. */
export const maintainedPagePatchInput = z
  .object({
    expected_revision: z.number().int().positive(),
    replacements: docContent.min(1).max(MAX_MAINTAINED_BLOCKS),
  })
  .strict();

export type MaintainedPageBinding = {
  id: string;
  doc_id: string;
  user_id: string;
  agent_grant_id: string;
  revision: number;
  snapshot: MaintainedPageSnapshot;
  instruction: string;
  rrule: string;
  timezone: string;
  next_run_at: string;
  paused: boolean;
  schedule_exhausted: boolean;
  created_at: string;
  updated_at: string;
};
export type MaintainedPageConflict =
  "version" | "missing" | "moved" | "ambiguous" | "outside_binding";
type Result<T> =
  { ok: true; value: T } | { ok: false; reason: MaintainedPageConflict };

/** Capture only existing, unambiguous block identities in their page order. */
export function captureMaintainedPage(
  content: DocBlock[],
  version: number,
  ids: string[],
): Result<MaintainedPageSnapshot> {
  const selected = new Set(maintainedBlockIds.parse(ids));
  const blocks = docContent.parse(content);
  const named = blocks.flatMap((block) => (block.id ? [block.id] : []));
  if (!uniqueIds(named)) return { ok: false, reason: "ambiguous" };
  const found = new Set<string>();
  const targets: MaintainedPageSnapshot["blocks"] = [];
  for (const [position, block] of blocks.entries()) {
    if (!block.id || !selected.has(block.id)) continue;
    found.add(block.id);
    targets.push({ block_id: block.id, position });
  }
  if (found.size !== selected.size) return { ok: false, reason: "missing" };
  return {
    ok: true,
    value: maintainedPageSnapshot.parse({
      doc_version: version,
      blocks: targets,
    }),
  };
}

/** Validate a persisted binding against the authoritative current page revision. */
export function checkMaintainedPage(
  content: DocBlock[],
  version: number,
  snapshot: MaintainedPageSnapshot,
): Result<MaintainedPageSnapshot> {
  const expected = maintainedPageSnapshot.parse(snapshot);
  if (version !== expected.doc_version) return { ok: false, reason: "version" };
  const current = captureMaintainedPage(
    content,
    version,
    expected.blocks.map((block) => block.block_id),
  );
  if (!current.ok) return current;
  if (
    current.value.blocks.some(
      (block, index) =>
        block.block_id !== expected.blocks[index].block_id ||
        block.position !== expected.blocks[index].position,
    )
  )
    return { ok: false, reason: "moved" };
  return current;
}

/** Replace selected blocks only; callers must also enforce current actor/grant authority. */
export function applyMaintainedPagePatch(
  content: DocBlock[],
  version: number,
  snapshot: MaintainedPageSnapshot,
  replacements: DocBlock[],
): Result<DocBlock[]> {
  const checked = checkMaintainedPage(content, version, snapshot);
  if (!checked.ok) return checked;
  const updates = docContent.max(MAX_MAINTAINED_BLOCKS).parse(replacements);
  const allowed = new Set(checked.value.blocks.map((block) => block.block_id));
  const byId = new Map<string, DocBlock>();
  for (const block of updates) {
    if (!block.id || !allowed.has(block.id))
      return { ok: false, reason: "outside_binding" };
    if (byId.has(block.id)) return { ok: false, reason: "ambiguous" };
    byId.set(block.id, block);
  }
  // Preserve untouched objects and order: no removal, insertion or ownership expansion.
  return {
    ok: true,
    value: content.map((block) =>
      block.id ? (byId.get(block.id) ?? block) : block,
    ),
  };
}

/** Credential-free provenance captured before a scoped job is queued. */
export const maintainedPageModelOrigin = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("hosted") }).strict(),
  z
    .object({
      kind: z.literal("chatgpt"),
      connection_id: z.uuid(),
      model: z.string().min(1).max(200),
      preference_version: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    })
    .strict(),
  z.object({ kind: z.literal("chatgpt_selection_required") }).strict(),
  z.object({ kind: z.literal("legacy_unverified") }).strict(),
]);
export type MaintainedPageModelOrigin = z.output<
  typeof maintainedPageModelOrigin
>;

/** App-session review card; worker leases and private authentication metadata are omitted. */
export const maintainedPageRunSummary = z
  .object({
    id: z.uuid(),
    binding_id: z.uuid(),
    state: z.enum([
      "queued",
      "running",
      "waiting",
      "done",
      "failed",
      "cancelled",
    ]),
    lane: z.enum(["background", "overnight"]),
    scheduled_for: z.iso.datetime(),
    updated_at: z.iso.datetime(),
    estimated_tokens: z.number().int().nonnegative(),
    error: z.string().max(300).nullable(),
    waiting_id: z.uuid().nullable(),
    replacements: docContent.max(MAX_MAINTAINED_BLOCKS).nullable(),
    can_review: z.boolean(),
  })
  .strict();
export type MaintainedPageRunSummary = z.output<
  typeof maintainedPageRunSummary
>;
export const maintainedPageRunDecision = z
  .object({ waiting_id: z.uuid(), approved: z.boolean() })
  .strict();
