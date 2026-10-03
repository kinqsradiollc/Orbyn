import {
  captureMaintainedPage,
  applyMaintainedPagePatch,
  maintainedPagePatchInput,
  checkMaintainedPage,
  maintainedPageBindingInput,
  maintainedPageBindingUpdate,
  maintainedPageBindingDelete,
  maintainedPageSnapshot,
  objectRefsInValue,
  targetKey,
  fail,
  HttpError,
  type DocBlock,
  type MaintainedPageBinding,
} from "@orbyn/core";
import type { Db } from "../../db/pool.js";
import type { UserRow } from "../../lib/auth.js";
import { Params, scopeFor, visibleDocs } from "../../lib/visibility.js";
import { assistantMayRead } from "../../lib/doc-visibility.js";
import { currentAssistantPrincipal } from "../../capabilities/assistant-principal.js";
import { policy, type Principal } from "../../capabilities/policy.js";
import {
  CapabilityError,
  cursorCodec,
  type Asking,
  type CapabilityContext,
} from "../../capabilities/registry.js";
import { destination, refuseSecrets } from "../../capabilities/write.js";
import { readDoc, requireDoc, saveDoc } from "./service.js";
import { privacyFrom, readableLinks } from "../links/privacy.js";
import { assistantSourceVisible } from "../../lib/assistant-source-visibility.js";

type BindingRow = Omit<
  MaintainedPageBinding,
  "created_at" | "updated_at" | "next_run_at"
> & {
  created_at: Date;
  updated_at: Date;
  next_run_at: Date;
};
const publicBinding = (row: BindingRow): MaintainedPageBinding => ({
  ...row,
  snapshot: maintainedPageSnapshot.parse(row.snapshot),
  created_at: row.created_at.toISOString(),
  updated_at: row.updated_at.toISOString(),
  next_run_at: row.next_run_at.toISOString(),
});

/** The caller owns this assistant; current scope and page rights are intersected under locks. */
async function maintenancePage(
  db: Db,
  user: UserRow,
  principal: Principal,
  docId: string,
) {
  if (
    principal.via !== "assistant" ||
    !principal.grant_id ||
    principal.user.id !== user.id
  )
    fail(403, "Use your own assistant for page maintenance.");
  let current: Principal;
  try {
    current = await currentAssistantPrincipal(db, principal, true);
  } catch (error) {
    if (error instanceof CapabilityError)
      fail(
        403,
        "Your assistant changed or is unavailable. Reload page maintenance.",
      );
    throw error;
  }
  const actor = await db.query(
    "SELECT id FROM users WHERE id=$1 AND NOT disabled FOR SHARE",
    [user.id],
  );
  if (!actor.rowCount) fail(403, "This account is unavailable.");
  if (!policy.allows(current, { access: "suggest", toolset: "core" }))
    fail(403, "Your assistant cannot maintain pages with its current access.");
  const doc = await requireDoc(db, docId, user, "items:write");
  if (doc.kind === "memory" || doc.kind === "profile")
    fail(403, "Memory and profile pages need a separate reviewed request.");
  await db.query(
    "SELECT id FROM projects WHERE id=(SELECT project_id FROM docs WHERE id=$1) FOR SHARE",
    [docId],
  );
  await db.query("SELECT id FROM teams WHERE id=$1 FOR SHARE", [doc.team_id]);
  await db.query(
    "SELECT user_id FROM team_members WHERE user_id=$1 AND team_id=$2 FOR SHARE",
    [user.id, doc.team_id],
  );
  // Membership and workspace policy may have changed while acquiring their locks.
  await requireDoc(db, docId, user, "items:write");
  current = await currentAssistantPrincipal(db, current, true);
  const params = new Params(docId);
  const scope = scopeFor(policy.spaces(current), params);
  const row = (
    await db.query<{ content: DocBlock[] }>(
      `SELECT d.content FROM docs d WHERE d.id=$1 AND ${visibleDocs("d", scope)} AND ${assistantMayRead("d")}`,
      params.values,
    )
  ).rows[0];
  if (!row) fail(404, "This page is not available to your assistant.");
  const decision = policy.can(current, "suggest", doc);
  if (!decision.ok)
    fail(decision.code === "NOT_FOUND" ? 404 : 403, decision.message);
  return { current, doc, content: row.content ?? [] };
}

/** Internal storage only: no public route or scheduler consumes bindings before runtime wiring. */
export async function createMaintainedPageBinding(
  db: Db,
  user: UserRow,
  principal: Principal,
  docId: string,
  raw: unknown,
): Promise<MaintainedPageBinding> {
  const input = maintainedPageBindingInput.parse(raw);
  const { current, doc, content } = await maintenancePage(
    db,
    user,
    principal,
    docId,
  );
  if (doc.version !== input.expected_doc_version)
    fail(409, "This page changed. Select its blocks again.");
  try {
    new Intl.DateTimeFormat("en", { timeZone: input.timezone });
  } catch {
    fail(422, "Choose a supported time zone.");
  }
  const captured = captureMaintainedPage(content, doc.version, input.block_ids);
  if (!captured.ok)
    fail(409, "The selected blocks changed. Select them again.");
  await db.query(
    "SELECT pg_advisory_xact_lock(hashtext('page-bindings:'||$1))",
    [user.id],
  );
  const count = (
    await db.query<{ count: number }>(
      "SELECT count(*)::integer AS count FROM assistant_page_bindings WHERE user_id=$1",
      [user.id],
    )
  ).rows[0].count;
  if (count >= 100) fail(409, "This account already has 100 page bindings.");
  const overlaps = await db.query(
    `SELECT 1 FROM assistant_page_bindings b, jsonb_array_elements(b.snapshot->'blocks') target
     WHERE b.doc_id=$1 AND target->>'block_id'=ANY($2::text[]) LIMIT 1`,
    [docId, input.block_ids],
  );
  if (overlaps.rowCount)
    fail(409, "A selected block already has a maintenance binding.");
  const row = (
    await db.query<BindingRow>(
      `INSERT INTO assistant_page_bindings(doc_id,user_id,agent_grant_id,snapshot,instruction,rrule,timezone,next_run_at,paused)
     VALUES($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9) RETURNING *`,
      [
        docId,
        user.id,
        current.grant_id,
        JSON.stringify(captured.value),
        input.instruction,
        input.rrule,
        input.timezone,
        input.next_run_at,
        input.paused,
      ],
    )
  ).rows[0];
  return publicBinding(row);
}

/** Fresh scoped context includes selected blocks only, with private links projected for the owner. */
export async function maintainedPageContext(
  db: Db,
  user: UserRow,
  principal: Principal,
  bindingId: string,
) {
  const initial = (
    await db.query<BindingRow>(
      "SELECT * FROM assistant_page_bindings WHERE id=$1 AND user_id=$2",
      [bindingId, user.id],
    )
  ).rows[0];
  if (!initial || initial.agent_grant_id !== principal.grant_id)
    fail(404, "Page binding not found.");
  const { doc, content, current } = await maintenancePage(
    db,
    user,
    principal,
    initial.doc_id,
  );
  const row = (
    await db.query<BindingRow>(
      "SELECT * FROM assistant_page_bindings WHERE id=$1 AND user_id=$2 FOR UPDATE",
      [bindingId, user.id],
    )
  ).rows[0];
  if (!row || row.agent_grant_id !== current.grant_id)
    fail(404, "Page binding not found.");
  if (row.doc_id !== initial.doc_id)
    fail(409, "The page binding changed. Reload it.");
  const snapshot = maintainedPageSnapshot.parse(row.snapshot);
  const checked = checkMaintainedPage(content, doc.version, snapshot);
  if (!checked.ok)
    fail(409, "This page changed. Review its maintenance binding.");
  const shown = await readDoc(db, row.doc_id, user.id);
  const ids = new Set(snapshot.blocks.map((block) => block.block_id));
  let blocks = await readableLinks(
    db,
    policy.spaces(current),
    shown.content.filter((block) => block.id && ids.has(block.id)),
  );
  // Space projection alone does not cover targets kept out of AI. Check their
  // current source policy before retaining any derived link labels in context.
  const refs = objectRefsInValue(blocks).filter((ref) =>
    ["doc", "task", "event", "project"].includes(ref.kind),
  );
  if (refs.length) {
    const params = new Params(
      refs.map((ref) => (ref.kind === "event" ? "task" : ref.kind)),
      refs.map((ref) => ref.id),
    );
    const scope = scopeFor(policy.spaces(current), params);
    const hidden = new Set(
      (
        await db.query<{ kind: string; id: string }>(
          `SELECT target.kind,target.id::text AS id FROM unnest($1::text[],$2::uuid[]) target(kind,id)
       WHERE NOT ${assistantSourceVisible("target.kind", "target.id", scope.user, false, scope)}
         OR (target.kind='doc' AND EXISTS(SELECT 1 FROM docs linked_doc WHERE linked_doc.id=target.id AND NOT ${assistantMayRead("linked_doc")}))`,
          params.values,
        )
      ).rows.map((ref) => `${ref.kind}:${ref.id}`),
    );
    blocks = privacyFrom((ref) => hidden.has(targetKey(ref))).value(blocks);
  }
  return {
    binding: publicBinding(row),
    principal: current,
    blocks,
  };
}

/** Only the binding owner can see its instructions; page permission is checked anew. */
export async function listMaintainedPageBindings(
  db: Db,
  user: UserRow,
  docId: string,
) {
  await requireDoc(db, docId, user, "items:read");
  const rows = await db.query<BindingRow>(
    "SELECT * FROM assistant_page_bindings WHERE doc_id=$1 AND user_id=$2 ORDER BY created_at,id",
    [docId, user.id],
  );
  return rows.rows.map(publicBinding);
}

/** Rebinding is an explicit person action, never a runner's way to overwrite human edits. */
export async function updateMaintainedPageBinding(
  db: Db,
  user: UserRow,
  principal: Principal,
  docId: string,
  bindingId: string,
  raw: unknown,
): Promise<MaintainedPageBinding> {
  const input = maintainedPageBindingUpdate.parse(raw);
  const { current, doc, content } = await maintenancePage(
    db,
    user,
    principal,
    docId,
  );
  const existing = (
    await db.query<BindingRow>(
      "SELECT * FROM assistant_page_bindings WHERE id=$1 AND doc_id=$2 AND user_id=$3 FOR UPDATE",
      [bindingId, docId, user.id],
    )
  ).rows[0];
  if (!existing || existing.agent_grant_id !== current.grant_id)
    fail(404, "Page binding not found.");
  if (
    existing.revision !== input.expected_revision ||
    doc.version !== input.expected_doc_version
  )
    fail(409, "This page or binding changed. Review it again.");
  try {
    new Intl.DateTimeFormat("en", { timeZone: input.timezone });
  } catch {
    fail(422, "Choose a supported time zone.");
  }
  const captured = captureMaintainedPage(content, doc.version, input.block_ids);
  if (!captured.ok)
    fail(409, "The selected blocks changed. Select them again.");
  const overlaps = await db.query(
    `SELECT 1 FROM assistant_page_bindings b, jsonb_array_elements(b.snapshot->'blocks') target
     WHERE b.doc_id=$1 AND b.id<>$2 AND target->>'block_id'=ANY($3::text[]) LIMIT 1`,
    [docId, bindingId, input.block_ids],
  );
  if (overlaps.rowCount)
    fail(409, "A selected block already has a maintenance binding.");
  const row = (
    await db.query<BindingRow>(
      `UPDATE assistant_page_bindings SET snapshot=$4::jsonb,instruction=$5,rrule=$6,timezone=$7,
      next_run_at=$8,paused=$9,schedule_exhausted=false,revision=revision+1,updated_at=now()
     WHERE id=$1 AND doc_id=$2 AND user_id=$3 RETURNING *`,
      [
        bindingId,
        docId,
        user.id,
        JSON.stringify(captured.value),
        input.instruction,
        input.rrule,
        input.timezone,
        input.next_run_at,
        input.paused,
      ],
    )
  ).rows[0];
  await db.query(
    `UPDATE assistant_page_runs SET state='cancelled',lease_token=NULL,lease_expires_at=NULL,
      waiting_id=NULL,proposal=NULL,error_message='The page binding changed.',updated_at=now()
     WHERE binding_id=$1 AND state IN ('queued','running','waiting')`,
    [bindingId],
  );
  return publicBinding(row);
}

/** A person can stop maintenance even when their assistant has been suspended. */
export async function deleteMaintainedPageBinding(
  db: Db,
  user: UserRow,
  docId: string,
  bindingId: string,
  raw: unknown,
) {
  const input = maintainedPageBindingDelete.parse(raw);
  await requireDoc(db, docId, user, "items:write");
  const existing = (
    await db.query<BindingRow>(
      "SELECT * FROM assistant_page_bindings WHERE id=$1 AND doc_id=$2 AND user_id=$3 FOR UPDATE",
      [bindingId, docId, user.id],
    )
  ).rows[0];
  if (!existing) fail(404, "Page binding not found.");
  if (existing.revision !== input.expected_revision)
    fail(409, "This binding changed. Reload it.");
  await db.query("DELETE FROM assistant_page_bindings WHERE id=$1", [
    bindingId,
  ]);
  return { ok: true };
}

/** A scoped save uses the same current trust/action-rule policy as ordinary agent writes. */
export async function applyMaintainedPageUpdate(
  db: Db,
  user: UserRow,
  principal: Principal,
  bindingId: string,
  raw: unknown,
  options: { asking?: Asking } = {},
) {
  const input = maintainedPagePatchInput.parse(raw);
  const context = await maintainedPageContext(db, user, principal, bindingId);
  const binding = context.binding;
  if (binding.paused || binding.revision !== input.expected_revision)
    fail(
      409,
      "This maintenance binding changed or was paused. Review it again.",
    );
  const page = await requireDoc(db, binding.doc_id, user, "items:write");
  const content = (
    await db.query<{ content: DocBlock[] }>(
      "SELECT content FROM docs WHERE id=$1",
      [page.id],
    )
  ).rows[0].content;
  const patched = applyMaintainedPagePatch(
    content,
    page.version,
    binding.snapshot,
    input.replacements,
  );
  if (!patched.ok)
    fail(409, "The page or selected blocks changed. Review them again.");
  const current = await currentAssistantPrincipal(db, context.principal, true);
  const ctx: CapabilityContext = {
    principal: current,
    db,
    now: new Date(),
    timezone: binding.timezone,
    spaces: policy.spaces(current),
    cursor: cursorCodec(current, "maintained_page", { bindingId }),
    assistant_rule_checks: [],
    ...(options.asking ? { asking: options.asking } : {}),
  };
  if (
    destination(ctx, page.team_id, "W2", [], {
      owner: { user_id: page.user_id },
    }) === "review"
  )
    throw new MaintainedPageReviewRequired(
      "This page update needs your review.",
    );
  refuseSecrets(JSON.stringify(input.replacements));
  // Saving a checkbox can change its task. Lock and independently authorize each
  // selected linked task; unchanged human blocks never enter syncTicks.
  const ids = binding.snapshot.blocks.map((block) => block.block_id);
  const links = (
    await db.query<{
      block_id: string;
      id: string;
      user_id: string;
      team_id: string | null;
      project_id: string | null;
      assignee_id: string | null;
      status: string;
    }>(
      `SELECT l.block_id,i.id,i.user_id,i.team_id,i.project_id,i.assignee_id,i.status
       FROM doc_task_links l JOIN items i ON i.id=l.item_id
      WHERE l.doc_id=$1 AND l.block_id=ANY($2::text[]) ORDER BY i.id,l.block_id FOR UPDATE OF i`,
      [page.id, ids],
    )
  ).rows;
  const proposed = new Map(
    patched.value.flatMap((block) =>
      block.id ? [[block.id, block] as const] : [],
    ),
  );
  for (const task of links) {
    const block = proposed.get(task.block_id);
    if (block?.type !== "todo" || block.done === (task.status === "done"))
      continue;
    await db.query("SELECT id FROM projects WHERE id=$1 FOR SHARE", [
      task.project_id,
    ]);
    await db.query("SELECT id FROM teams WHERE id=$1 FOR SHARE", [
      task.team_id,
    ]);
    await db.query(
      "SELECT user_id FROM team_members WHERE team_id=$1 AND user_id=$2 FOR SHARE",
      [task.team_id, user.id],
    );
    ctx.principal = await currentAssistantPrincipal(db, ctx.principal, true);
    const params = new Params(task.id);
    const scope = scopeFor(policy.spaces(ctx.principal), params);
    const readable = await db.query(
      `SELECT i.id FROM items i WHERE i.id=$1 AND ${assistantSourceVisible("'task'", "i.id", scope.user, false, scope)}`,
      params.values,
    );
    if (!readable.rowCount || !policy.can(ctx.principal, "write", task).ok)
      fail(403, "A linked task is outside this assistant's current authority.");
    if (destination(ctx, task.team_id, "W2", [], { owner: task }) === "review")
      throw new MaintainedPageReviewRequired(
        "A linked task change needs your review.",
      );
  }
  if (ctx.asking?.mode === "collect" && ctx.asking.reasons.length)
    throw new MaintainedPageReviewRequired(
      "This page update needs your approval.",
    );
  const saved = await saveDoc(
    db,
    user,
    page.id,
    { version: page.version, content: patched.value },
    { always: true, ticksFrom: page.version, ownedBlockIds: ids },
  );
  const stored = (
    await db.query<{ content: DocBlock[] }>(
      "SELECT content FROM docs WHERE id=$1",
      [page.id],
    )
  ).rows[0].content;
  const snapshot = captureMaintainedPage(stored, saved.version, ids);
  if (!snapshot.ok)
    fail(409, "The selected block identities changed during the save.");
  const updated = (
    await db.query<BindingRow>(
      `UPDATE assistant_page_bindings SET snapshot=$2::jsonb,revision=revision+1,updated_at=now() WHERE id=$1 RETURNING *`,
      [binding.id, JSON.stringify(snapshot.value)],
    )
  ).rows[0];
  return { doc: saved, binding: publicBinding(updated) };
}

/** Internal review signal; stale source/binding conflicts never become approvals. */
export class MaintainedPageReviewRequired extends HttpError {
  constructor(message: string) {
    super(409, message);
  }
}
