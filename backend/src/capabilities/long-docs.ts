import { z } from "zod";
import {
  linkMarkdown,
  parseDocInline,
  serializeDoc,
  type DocBlock,
  type ReviewChangeInput,
} from "@orbyn/core";
import { createDoc } from "../modules/docs/service.js";
import { syncSavedPages } from "../modules/study/service.js";
import { readMarkdown } from "./doc-markdown.js";
import { projectId, teamFilter } from "./common.js";
import { cleanTitle } from "./format.js";
import { policy } from "./policy.js";
import { assertAssistantReplaySources } from "./assistant-replay.js";
import { assertAssistantReplayTargets } from "./assistant-replay-targets.js";
import { refUrl } from "./refs.js";
import {
  CapabilityError,
  defineCapability,
  type CapabilityContext,
} from "./registry.js";
import { MAX_DOC_BYTES, withIds } from "./write-docs.js";
import {
  ADDS,
  actorOf,
  clientRefInput,
  dbOf,
  destination,
  finishWrite,
  idField,
  refuseSecrets,
  writeOutput,
  type DoneEntry,
  type WriteAnswer,
} from "./write.js";
import type { UndoOp } from "./undo.js";

/**
 * Long pages in parts (H2): a lecture transcript or a long brief is more
 * than one call can carry, so append_doc keeps it as a draft, part by
 * part (each checked as Orbyn Markdown when it arrives), and makes the
 * page when the agent says finish: every part joined in number order, all
 * or nothing. A page over what the apps can save (about 60 KB) becomes
 * several pages, each ending with a link to the next. Drafts belong to the
 * connection that started them and go a day after their last part.
 */

/** Everything a draft may hold, in bytes of Markdown. */
export const MAX_DRAFT_BYTES = 2 * 1024 * 1024;
/** One part. */
export const MAX_PART_BYTES = 512 * 1024;
/** Parts in one draft. */
export const MAX_PARTS = 200;
/** Unfinished drafts one person may have at once. */
const MAX_OPEN_DRAFTS = 10;

/** Room left on each page for the line linking to the next one. */
const PAGE_BUDGET = MAX_DOC_BYTES - 2_000;

const DRAFT =
  /^(?:draft:)?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

type Draft = {
  id: string;
  title: string;
  target: {
    kind: "doc" | "note" | "meeting";
    team_id: string | null;
    folder_id: string | null;
    project_id: string | null;
  };
  done: WriteAnswer | null;
};

const draftEntry = (d: { id: string; title: string }, change: string) => ({
  id: `draft:${d.id}`,
  title: cleanTitle(d.title) || "Untitled",
  url: "",
  version: null,
  change,
});

const kb = (n: number) => `${Math.ceil(n / 1024)} KB`;

/**
 * Checks a part on its own: sizes, credentials, and that it doesn't stop
 * inside a code block or maths (a part must end between lines).
 */
async function checkPart(ctx: CapabilityContext, n: number, markdown: string) {
  refuseSecrets(markdown);
  const fences = markdown
    .split("\n")
    .filter((l) => /^\s{0,3}(```|~~~)/.test(l)).length;
  // `$$` on its own line (with an optional check mark) opens or closes maths.
  const maths = markdown
    .split("\n")
    .filter((l) => /^\s*\$\$(\s*%\s*check)?\s*$/.test(l)).length;
  if (fences % 2 || maths % 2)
    throw new CapabilityError(
      "INVALID",
      `Part ${n} ends inside a code block or maths.`,
      "End every part between lines: close the block in the same part.",
    );
  try {
    await readMarkdown(ctx, markdown, null);
  } catch (e) {
    if (e instanceof CapabilityError)
      throw new CapabilityError("INVALID", `Part ${n}: ${e.message}`, e.fix);
    throw e;
  }
}

/** Lines, split into pages the apps can save, preferring to break at headings. */
export function splitPages(blocks: DocBlock[]): DocBlock[][] {
  const size = (b: DocBlock) => Buffer.byteLength(JSON.stringify(b)) + 1;
  const notes = blocks.filter((b) => b.type === "footnote");
  const flow = blocks.filter((b) => b.type !== "footnote");
  const pages: DocBlock[][] = [];
  let page: DocBlock[] = [];
  let used = 0;
  for (const b of flow) {
    const n = size(b);
    if (page.length && used + n > PAGE_BUDGET) {
      // Break before the last heading in the page's second half, if any.
      let cut = page.length;
      for (let i = page.length - 1; i > page.length / 2; i--)
        if (page[i].type === "heading") {
          cut = i;
          break;
        }
      pages.push(page.slice(0, cut));
      page = page.slice(cut);
      used = page.reduce((t, x) => t + size(x), 0);
    }
    page.push(b);
    used += n;
  }
  if (page.length || !pages.length) pages.push(page);
  // Each footnote goes with the first page that shows its marker.
  for (const note of notes) {
    const label = (note as { label: string }).label;
    const home =
      pages.find((p) =>
        p.some(
          (b) =>
            "text" in b &&
            b.type !== "footnote" &&
            parseDocInline(b.text).some((r) => r.footnote === label),
        ),
      ) ?? pages[pages.length - 1];
    home.push(note);
  }
  return pages;
}

/** Anchors the agent named twice (in two parts) keep only their first line. */
function uniqueIds(blocks: DocBlock[]): DocBlock[] {
  const seen = new Set<string>();
  return withIds(
    blocks.map((b) => {
      if (!b.id) return b;
      if (seen.has(b.id)) {
        const { id: _id, ...rest } = b;
        return rest as DocBlock;
      }
      seen.add(b.id);
      return b;
    }),
  );
}

async function startDraft(ctx: CapabilityContext, a: Input): Promise<Draft> {
  if (!a.title)
    throw new CapabilityError(
      "INVALID",
      "Give the page's title to start a draft.",
      "Send title with the first part; later parts send draft instead.",
    );
  const team = teamFilter(a.team);
  const teamId = team && "team" in team ? team.team : null;
  const level = policy.levelIn(ctx.principal, teamId);
  if (level === null)
    throw new CapabilityError(
      "NOT_FOUND",
      "Nothing with that id is reachable from this connection.",
      "Use a team id from get_context.",
    );
  if (level === "read")
    throw new CapabilityError(
      "READ_ONLY",
      "This connection can only read there.",
      "Ask the person to allow changes, or make the page in Orbyn.",
    );
  const open = (
    await ctx.db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM agent_doc_drafts
        WHERE user_id = $1 AND done IS NULL AND expires_at > now()`,
      [ctx.principal.user.id],
    )
  ).rows[0].n;
  if (open >= MAX_OPEN_DRAFTS)
    throw new CapabilityError(
      "INVALID",
      `There are already ${open} unfinished long pages.`,
      "Finish one (finish: true) or let it go: drafts go a day after their last part.",
    );
  const target: Draft["target"] = {
    kind: a.kind,
    team_id: teamId,
    folder_id: a.folder_id ?? null,
    project_id: a.project ? (projectId(a.project) ?? null) : null,
  };
  const row = (
    await ctx.db.query<{ id: string }>(
      `INSERT INTO agent_doc_drafts (user_id, grant_id, title, target)
       VALUES ($1, $2, $3, $4::jsonb) RETURNING id`,
      [
        ctx.principal.user.id,
        ctx.principal.grant_id,
        a.title,
        JSON.stringify(target),
      ],
    )
  ).rows[0];
  return { id: row.id, title: a.title, target, done: null };
}

async function openDraft(ctx: CapabilityContext, ref: string): Promise<Draft> {
  const m = DRAFT.exec(ref.trim());
  const row = m
    ? (
        await ctx.db.query<Draft>(
          `SELECT id, title, target, done FROM agent_doc_drafts
            WHERE id = $1 AND user_id = $2
              AND grant_id IS NOT DISTINCT FROM $3::uuid
              AND expires_at > now()
            FOR UPDATE`,
          [m[1].toLowerCase(), ctx.principal.user.id, ctx.principal.grant_id],
        )
      ).rows[0]
    : undefined;
  if (!row)
    throw new CapabilityError(
      "NOT_FOUND",
      "There is no unfinished draft with that id for this connection.",
      "Drafts go a day after their last part; start again without draft.",
    );
  return row;
}

async function finish(ctx: CapabilityContext, d: Draft) {
  const parts = (
    await ctx.db.query<{ n: number; markdown: string }>(
      "SELECT n, markdown FROM agent_doc_draft_parts WHERE draft_id = $1 ORDER BY n",
      [d.id],
    )
  ).rows;
  if (!parts.length)
    throw new CapabilityError(
      "INVALID",
      "This draft has no parts yet.",
      "Send markdown (part 1, 2, …) before finish.",
    );
  const last = parts[parts.length - 1].n;
  const have = new Set(parts.map((p) => p.n));
  const missing = [];
  for (let n = 1; n <= last; n++) if (!have.has(n)) missing.push(n);
  if (missing.length)
    throw new CapabilityError(
      "INVALID",
      `Part${missing.length === 1 ? "" : "s"} ${missing.slice(0, 20).join(", ")} ${missing.length === 1 ? "is" : "are"} missing, so nothing was made.`,
      "Send the missing parts, then finish again.",
    );
  const blocks = uniqueIds(
    await readMarkdown(ctx, parts.map((p) => p.markdown).join("\n\n"), null),
  );
  const pages = splitPages(blocks);
  const t = d.target;
  const titleOf = (i: number) =>
    i === 0
      ? d.title
      : `${d.title.slice(0, 170)} (part ${i + 1} of ${pages.length})`;
  const where = destination(ctx, t.team_id, t.team_id ? "W2" : "W1", [], {
    count: pages.length,
  });
  if (where === "review") {
    const review: ReviewChangeInput[] = pages.map((p, i) => ({
      type: "doc.create",
      title: titleOf(i),
      team_id: t.team_id,
      kind: t.kind,
      markdown: serializeDoc(p.map(({ id: _id, ...b }) => b as DocBlock)),
      folder_id: t.folder_id,
      project_id: t.project_id,
    }));
    return finishWrite(ctx, "Writing a long page", {
      done: [],
      review,
      reviewSummary: `Write the page “${cleanTitle(d.title)}”${pages.length > 1 ? ` in ${pages.length} parts` : ""}`,
      teamId: t.team_id,
    });
  }
  // Last page first, so each page can link to the one after it.
  const made: { id: string; title: string; version: number }[] = [];
  let next: { id: string; title: string } | null = null;
  for (let i = pages.length - 1; i >= 0; i--) {
    const content = next
      ? [
          ...pages[i],
          {
            type: "paragraph" as const,
            text: `Continued in ${linkMarkdown({ kind: "doc", id: next.id }, cleanTitle(next.title))}`,
          },
        ]
      : pages[i];
    const doc = await createDoc(dbOf(ctx), actorOf(ctx.principal), {
      title: titleOf(i),
      kind: t.kind,
      team_id: t.team_id,
      item_id: null,
      content: withIds(content),
      folder_id: t.folder_id,
      project_id: t.project_id,
      tags: [],
    });
    made.unshift(doc);
    next = doc;
  }
  const done: DoneEntry[] = made.map((doc, i) => ({
    id: `doc:${doc.id}`,
    title: cleanTitle(doc.title) || "Untitled",
    url: refUrl({ type: "doc", id: doc.id }),
    version: doc.version,
    change:
      made.length === 1
        ? `Written from ${parts.length} part${parts.length === 1 ? "" : "s"}`
        : `Written (page ${i + 1} of ${made.length})`,
  }));
  const undo: UndoOp[] = made.map((doc) => ({
    op: "doc.trash",
    doc_id: doc.id,
    version: doc.version,
  }));
  const answer = await finishWrite(ctx, "Writing a long page", {
    done,
    undo,
    after: made.map((doc) => () => syncSavedPages(doc.id)),
    teamId: t.team_id,
  });
  await ctx.db.query(
    `UPDATE agent_doc_drafts SET done = $2::jsonb WHERE id = $1`,
    [d.id, JSON.stringify(answer.structured)],
  );
  await ctx.db.query("DELETE FROM agent_doc_draft_parts WHERE draft_id = $1", [
    d.id,
  ]);
  return answer;
}

const input = z
  .object({
    draft: z
      .string()
      .trim()
      .max(60)
      .optional()
      .describe("draft:<id> from the first call; leave out to start one."),
    title: z.string().trim().min(1).max(200).optional(),
    part: z
      .number()
      .int()
      .min(1)
      .max(MAX_PARTS)
      .optional()
      .describe(
        "This part's number; parts join in number order (default: the next). Sending a number again replaces that part.",
      ),
    markdown: z.string().max(MAX_PART_BYTES).optional(),
    finish: z
      .boolean()
      .default(false)
      .describe("Make the page from every part, all or nothing."),
    kind: z.enum(["doc", "note", "meeting"]).default("doc"),
    team: z.string().trim().max(100).optional(),
    folder_id: idField.optional(),
    project: z.string().trim().max(300).optional(),
    client_ref: clientRefInput,
  })
  .strict();
type Input = z.output<typeof input>;

export const appendDoc = defineCapability({
  name: "append_doc",
  title: "Write a long page in parts",
  description:
    "For pages longer than create_doc takes (a lecture transcript, a long brief): send Orbyn Markdown in parts of up to 512 KB and 2,000 lines, 2 MB in all. The first call gives title (and team, folder_id, project) and returns a draft id; later calls send draft with the next part; finish: true makes the page from every part in number order, all or nothing. Over about 60 KB it becomes linked pages. Unfinished drafts go a day after their last part.",
  input,
  output: writeOutput,
  annotations: ADDS,
  access: "suggest",
  toolset: "workspace",
  mode: "write",
  tier: "W1",
  async run(ctx, a) {
    refuseSecrets(a.title);
    const d = a.draft
      ? await openDraft(ctx, a.draft)
      : await startDraft(ctx, a);
    if (d.done) {
      // A new client_ref can still reach a persisted result. Its current
      // destination and producing evidence must remain available before any
      // saved title, identity or link is returned.
      await assertAssistantReplaySources(ctx.db, ctx.principal);
      await assertAssistantReplayTargets(ctx.db, ctx.principal, {
        structured: d.done,
        markdown: "",
        targets: d.done.done.map((x) => x.id),
        outcome: "ok",
      });
      if (a.markdown !== undefined || !a.finish)
        throw new CapabilityError(
          "INVALID",
          "This draft is already a page.",
          `Add to it with edit_doc: ${d.done.done[0]?.id ?? "the page"}.`,
        );
      return {
        structured: d.done,
        markdown: `Already written: ${d.done.done.map((x) => `${x.title} (${x.id})`).join(", ")}.`,
        targets: d.done.done.map((x) => x.id),
      };
    }
    if (a.draft && a.title && a.title !== d.title) {
      await ctx.db.query(
        "UPDATE agent_doc_drafts SET title = $2 WHERE id = $1",
        [d.id, a.title],
      );
      d.title = a.title;
    }
    let note = "";
    if (a.markdown !== undefined) {
      const n =
        a.part ??
        (
          await ctx.db.query<{ n: number }>(
            "SELECT coalesce(max(n), 0) + 1 AS n FROM agent_doc_draft_parts WHERE draft_id = $1",
            [d.id],
          )
        ).rows[0].n;
      if (n > MAX_PARTS)
        throw new CapabilityError(
          "INVALID",
          `A draft holds at most ${MAX_PARTS} parts.`,
          "Send bigger parts (up to 512 KB each).",
        );
      const bytes = Buffer.byteLength(a.markdown);
      const others = Number(
        (
          await ctx.db.query<{ b: string | null }>(
            "SELECT sum(bytes) AS b FROM agent_doc_draft_parts WHERE draft_id = $1 AND n <> $2",
            [d.id, n],
          )
        ).rows[0].b ?? 0,
      );
      if (others + bytes > MAX_DRAFT_BYTES)
        throw new CapabilityError(
          "INVALID",
          `That would make the page ${kb(others + bytes)}, over the 2 MB a long page may hold.`,
          "Split the text into two long pages.",
        );
      await checkPart(ctx, n, a.markdown);
      await ctx.db.query(
        `INSERT INTO agent_doc_draft_parts (draft_id, n, markdown, bytes)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (draft_id, n) DO UPDATE
           SET markdown = EXCLUDED.markdown, bytes = EXCLUDED.bytes`,
        [d.id, n, a.markdown, bytes],
      );
      await ctx.db.query(
        "UPDATE agent_doc_drafts SET expires_at = now() + interval '24 hours' WHERE id = $1",
        [d.id],
      );
      note = `Part ${n} kept (${kb(others + bytes)} of 2 MB)`;
    }
    if (a.finish) return finish(ctx, d);
    if (!note)
      throw new CapabilityError(
        "INVALID",
        "Send markdown (a part), finish: true, or both.",
      );
    return finishWrite(ctx, "Writing a long page", {
      done: [
        draftEntry(
          d,
          `${note}; send the next part with this draft, then finish: true`,
        ),
      ],
      teamId: d.target.team_id,
    });
  },
});
