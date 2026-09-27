import { z } from "zod";
import {
  blockText,
  isDateKey,
  localDateKey,
  carryBlockIds,
  moveSection,
  newBlockId,
  plainText,
  sectionRange,
  serializeDoc,
  type DocBlock,
  type ReviewChangeInput,
} from "@orbyn/core";
import { pool } from "../db/pool.js";
import { Params, scopeFor, visibleDocs } from "../lib/visibility.js";
import {
  createDoc,
  proposeChanges,
  saveDoc,
  type ProposedChange,
} from "../modules/docs/service.js";
import { announceDocChange } from "../modules/docs/live.js";
import { usePageTemplateById } from "../modules/templates/pages.js";
import { syncSavedPages } from "../modules/study/service.js";
import {
  rewriteAgenda,
  todaysAgendaIfWritten,
  writeAgendaOn,
} from "../modules/docs/agenda.js";
import { cleanTitle } from "./format.js";
import { readMarkdown } from "./doc-markdown.js";
import { docId, projectId, teamFilter } from "./common.js";
import { visibleItem } from "./write-tasks.js";
import { refUrl } from "./refs.js";
import {
  CapabilityError,
  defineCapability,
  type CapabilityContext,
} from "./registry.js";
import {
  ADDS,
  EDITS,
  actorOf,
  cantWait,
  clientRefInput,
  dbOf,
  destination,
  finishWrite,
  refuseSecrets,
  idField,
  writeOutput,
  type DoneEntry,
} from "./write.js";

/**
 * Pages: making one from Markdown (create_doc) and targeted, version-checked
 * edits (edit_doc). Personal pages change directly, always keeping the
 * state before the edit in history, labelled with the agent; team pages
 * get Take/Leave suggestions beside their words (or, for edits suggestions
 * can't hold, a proposal in the Review inbox). Nothing ever rewrites a
 * whole page from scratch.
 */

/**
 * The most a page an agent writes may hold, serialized: what the apps can
 * still save back (the API takes 64 KB a request).
 */
export const MAX_DOC_BYTES = 60_000;

const DOC_BYTES_HINT =
  "Keep a page under about 60 KB; split a long one into several pages.";

/** Every line gets an id, so the page can be cited and edited line by line. */
export const withIds = (blocks: DocBlock[]): DocBlock[] =>
  blocks.map((b) => (b.id ? b : { ...b, id: newBlockId() }));

function checkSize(content: DocBlock[]) {
  if (Buffer.byteLength(JSON.stringify(content)) > MAX_DOC_BYTES)
    throw new CapabilityError(
      "INVALID",
      "That page would be too long for the apps to save.",
      DOC_BYTES_HINT,
    );
}

const docEntry = (
  d: { id: string; title: string; version: number },
  change: string,
): DoneEntry => ({
  id: `doc:${d.id}`,
  title: cleanTitle(d.title) || "Untitled",
  url: refUrl({ type: "doc", id: d.id }),
  version: d.version,
  change,
});

/** Opens editors and Study once the change is committed. */
export const afterSave = (
  id: string,
  version: number,
  grant: string | null,
) => [
  () => announceDocChange(pool, id, version, `agent:${grant ?? "session"}`),
  () => syncSavedPages(id),
];

// --- create_doc --------------------------------------------------------

/**
 * A day's agenda page, written from the calendar alone (never the hosted
 * assistant's brief): today's is written again when it's there (Notes and
 * what follows are kept); another day's is written once. H6a.
 */
async function agendaPage(ctx: CapabilityContext, title: string) {
  if (!ctx.principal.personal)
    throw new CapabilityError(
      "FORBIDDEN",
      "The agenda is the person's own: the connection needs Personal.",
    );
  if (destination(ctx, null, "W1") === "review") throw cantWait(ctx, null);
  const me = ctx.principal.user.id;
  const today = localDateKey(ctx.now, ctx.timezone);
  const date = title.toLowerCase() === "today" ? today : title;
  if (!isDateKey(date))
    throw new CapabilityError(
      "INVALID",
      'An agenda\'s title is "today" or a date like 2026-09-24.',
    );
  let made: {
    doc: { id: string; title: string; version: number };
    created: boolean;
  } | null;
  if (date === today && (await todaysAgendaIfWritten(me, ctx.now)))
    made = {
      doc: await rewriteAgenda(me, { withBrief: false, now: ctx.now }),
      created: false,
    };
  else made = await writeAgendaOn(me, date, ctx.now);
  if (!made)
    throw new CapabilityError(
      "INVALID",
      "The agenda goes back a year and ahead two months.",
    );
  const doc = made.doc;
  return finishWrite(ctx, "Agenda", {
    done: [
      {
        id: `doc:${doc.id}`,
        title: cleanTitle(doc.title) || "Agenda",
        url: refUrl({ type: "doc", id: doc.id }),
        version: doc.version,
        change: made.created ? "Written" : "Written again from the calendar",
      },
    ],
    undo: made.created
      ? [{ op: "doc.trash", doc_id: doc.id, version: doc.version }]
      : [],
    after: made.created ? [() => syncSavedPages(doc.id)] : [],
  });
}

export const createDocCapability = defineCapability({
  name: "create_doc",
  title: "Write a new page",
  description:
    'Makes a page, note or meeting note from Orbyn Markdown (orbyn://spec/markdown: callouts, tables, footnotes, diagrams, embeds, [[Page#Heading]] links; at most about 60 KB), in Personal or a team, optionally in a folder or project or as an event\'s notes. Every line gets an anchor. Where it may only suggest, it waits for review. Longer text: append_doc. kind "agenda" with title "today" or a date writes that day\'s agenda page from the calendar (today\'s again, keeping Notes).',
  input: z
    .object({
      title: z.string().trim().min(1).max(200),
      markdown: z
        .string()
        .max(MAX_DOC_BYTES)
        .optional()
        .describe("The page's lines (or template instead)."),
      template: z
        .string()
        .trim()
        .max(300)
        .optional()
        .describe(
          "A page template's id, or a starter's (search types: template).",
        ),
      kind: z.enum(["doc", "note", "meeting", "agenda"]).default("doc"),
      team: z
        .string()
        .trim()
        .max(100)
        .optional()
        .describe('"personal" (the default), or a team id.'),
      folder_id: idField.optional(),
      project: z.string().trim().max(300).optional(),
      event: z
        .string()
        .trim()
        .max(300)
        .optional()
        .describe("An event this page is the notes of (event:<id>)."),
      client_ref: clientRefInput,
    })
    .strict(),
  output: writeOutput,
  annotations: ADDS,
  access: "suggest",
  toolset: "core",
  mode: "write",
  tier: "W1",
  async run(ctx, a) {
    refuseSecrets(a.title, a.markdown);
    const team = teamFilter(a.team);
    const teamId = team && "team" in team ? team.team : null;
    if (a.kind === "agenda") return agendaPage(ctx, a.title);
    if (a.template) return fromTemplate(ctx, a, teamId);
    if (a.markdown === undefined)
      throw new CapabilityError(
        "INVALID",
        "Give the page's markdown, or a template.",
      );
    const content = withIds(await readMarkdown(ctx, a.markdown, null));
    checkSize(content);
    // Proposals keep Markdown: links resolved, without the anchors.
    const markdown = serializeDoc(
      content.map(({ id: _id, ...b }) => b as DocBlock),
    );
    const project = a.project ? (projectId(a.project) ?? null) : null;
    const where = destination(ctx, teamId, teamId ? "W2" : "W1");
    if (where === "review")
      return finishWrite(ctx, "Writing a page", {
        done: [],
        review: [
          {
            type: "doc.create",
            title: a.title,
            team_id: teamId,
            kind: a.kind,
            markdown,
            folder_id: a.folder_id ?? null,
            project_id: project,
          },
        ],
        reviewSummary: `Write the page “${cleanTitle(a.title)}”`,
        teamId,
      });
    const doc = await createDoc(dbOf(ctx), actorOf(ctx.principal), {
      title: a.title,
      kind: a.kind,
      team_id: teamId,
      item_id: a.event ? (await visibleItem(ctx, a.event)).id : null,
      content,
      folder_id: a.folder_id ?? null,
      project_id: project,
      tags: [],
    });
    return finishWrite(ctx, "Writing a page", {
      done: [docEntry(doc, "Written")],
      undo: [{ op: "doc.trash", doc_id: doc.id, version: doc.version }],
      after: [() => syncSavedPages(doc.id)],
      teamId,
    });
  },
});

/** A page made from a page template (the app's "New page from template"). */
async function fromTemplate(
  ctx: CapabilityContext,
  a: {
    title: string;
    template?: string;
    folder_id?: string;
    project?: string;
    event?: string;
  },
  teamId: string | null,
) {
  const where = destination(ctx, teamId, teamId ? "W2" : "W1");
  if (where === "review")
    throw new CapabilityError(
      "FORBIDDEN",
      "This connection can only suggest changes there; give markdown to propose a page instead.",
    );
  const raw = a.template!.replace(/^(template|page_template):/, "");
  const event = a.event ? await visibleItem(ctx, a.event) : null;
  const made = await usePageTemplateById(
    dbOf(ctx),
    actorOf(ctx.principal),
    raw,
    {
      title: a.title,
      team_id: teamId,
      ...(a.folder_id ? { folder_id: a.folder_id } : {}),
      project_id: a.project ? (projectId(a.project) ?? null) : null,
      event_id: event?.id ?? null,
    },
  );
  const doc = made.doc;
  return finishWrite(ctx, "Writing a page", {
    done: [
      docEntry(
        doc,
        made.existing
          ? "Already the event's notes"
          : "Written from the template",
      ),
    ],
    undo: made.existing
      ? []
      : [{ op: "doc.trash", doc_id: doc.id, version: doc.version }],
    after: made.existing ? [] : [() => syncSavedPages(doc.id)],
    teamId,
  });
}

// --- edit_doc ----------------------------------------------------------

export const EDIT_OPS = [
  "append",
  "prepend",
  "insert_after",
  "replace",
  "delete",
  "find_replace",
  "replace_section",
  "append_to_section",
  "delete_section",
  "move_section",
] as const;
type EditOp = (typeof EDIT_OPS)[number];

/** What each kind of edit needs besides its op. */
const NEEDS: Record<EditOp, ("block" | "heading" | "markdown" | "find")[]> = {
  append: ["markdown"],
  prepend: ["markdown"],
  insert_after: ["block", "markdown"],
  replace: ["block", "markdown"],
  delete: ["block"],
  find_replace: ["find"],
  replace_section: ["heading", "markdown"],
  append_to_section: ["heading", "markdown"],
  delete_section: ["heading"],
  move_section: ["heading"],
};

// One flat shape for every op (it lists far smaller than a union of ten).
const edit = z
  .object({
    op: z.enum(EDIT_OPS),
    block: z
      .string()
      .max(64)
      .optional()
      .describe(
        "A line's ^b… anchor. move_section: the line to put the section before (else the end).",
      ),
    heading: z
      .string()
      .max(300)
      .optional()
      .describe(
        "*_section: a heading's words or anchor. Its section runs to the next heading as big or bigger.",
      ),
    markdown: z.string().max(MAX_DOC_BYTES).optional(),
    find: z.string().min(1).max(2000).optional(),
    replace: z.string().max(2000).optional(),
  })
  .superRefine((e, c) => {
    for (const k of NEEDS[e.op])
      if (e[k] === undefined)
        c.addIssue({
          code: "custom",
          path: [k],
          message: `${e.op} needs ${k}`,
        });
    if (e.op === "find_replace" && e.replace === undefined)
      c.addIssue({
        code: "custom",
        path: ["replace"],
        message: "find_replace needs replace",
      });
  });
export type Edit = z.output<typeof edit>;

/** Each edit's Markdown read as blocks (null for edits without Markdown). */
export type ReadEdits = (DocBlock[] | null)[];

const noLine = (block: string) =>
  new CapabilityError(
    "INVALID",
    `There is no line ${block} on this page.`,
    "Fetch the page again and use a line's ^b… anchor.",
  );

const words = (s: string) =>
  plainText(s.replace(/^#{1,3}\s+/, ""))
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

/**
 * Where a heading is: by its anchor, or by its words when exactly one
 * heading reads that way.
 */
function headingIndex(blocks: DocBlock[], heading: string): number {
  const anchor = heading.trim().replace(/^\^/, "");
  const byId = blocks.findIndex((b) => b.id === anchor);
  if (byId >= 0) {
    if (blocks[byId].type !== "heading")
      throw new CapabilityError(
        "INVALID",
        `The line ${heading} isn't a heading.`,
        "Give a heading's words or anchor; replace a single line with op replace.",
      );
    return byId;
  }
  const want = words(heading);
  const hits = blocks.flatMap((b, i) =>
    b.type === "heading" && words(b.text) === want ? [i] : [],
  );
  const listed = () =>
    blocks
      .filter((b) => b.type === "heading")
      .slice(0, 15)
      .map(
        (b) => `“${plainText((b as { text: string }).text).trim()}” ^${b.id}`,
      )
      .join(", ");
  if (hits.length > 1)
    throw new CapabilityError(
      "INVALID",
      `${hits.length} headings read “${heading.trim()}”.`,
      `Give the one you mean by its anchor: ${hits.map((i) => `^${blocks[i].id}`).join(", ")}.`,
    );
  if (!hits.length)
    throw new CapabilityError(
      "INVALID",
      `There is no heading “${heading.trim()}” on this page.`,
      listed()
        ? `Its headings: ${listed()}.`
        : "This page has no headings; use append or insert_after.",
    );
  return hits[0];
}

/**
 * New lines' ids: an anchor the Markdown gave is kept unless another line
 * (outside what is being replaced, `keep`) already has it; every line
 * without one gets a fresh id.
 */
function claim(
  out: DocBlock[],
  fresh: DocBlock[],
  keep: Set<string> = new Set(),
): DocBlock[] {
  const taken = new Set(
    out.flatMap((b) => (b.id && !keep.has(b.id) ? [b.id] : [])),
  );
  const seen = new Set<string>();
  return withIds(
    fresh.map((b) => {
      if (!b.id) return b;
      if (taken.has(b.id) || seen.has(b.id)) {
        const { id: _id, ...rest } = b;
        return rest as DocBlock;
      }
      seen.add(b.id);
      return b;
    }),
  );
}

/**
 * The page after `edits`, all or nothing; INVALID naming what failed.
 * `read` holds each edit's Markdown already read (readMarkdown).
 */
export function applyEdits(
  content: DocBlock[],
  edits: Edit[],
  read: ReadEdits,
): DocBlock[] {
  let out = [...content];
  const at = (block: string) => {
    const i = out.findIndex((b) => b.id === block.replace(/^\^/, ""));
    if (i < 0) throw noLine(block);
    return i;
  };
  const idsIn = (from: number, to: number) =>
    new Set(out.slice(from, to).flatMap((b) => (b.id ? [b.id] : [])));
  edits.forEach((e, n) => {
    const fresh = read[n] ?? [];
    switch (e.op) {
      case "append":
        out = [...out, ...claim(out, fresh)];
        break;
      case "prepend":
        out = [...claim(out, fresh), ...out];
        break;
      case "insert_after": {
        const i = at(e.block!);
        out.splice(i + 1, 0, ...claim(out, fresh));
        break;
      }
      case "replace": {
        const i = at(e.block!);
        const lines = claim(out, carryBlockIds(out[i], fresh), idsIn(i, i + 1));
        out.splice(i, 1, ...lines);
        break;
      }
      case "delete":
        out.splice(at(e.block!), 1);
        break;
      case "find_replace": {
        let hits = 0;
        out = out.map((b) => {
          if (!("text" in b) || !b.text.includes(e.find!)) return b;
          hits++;
          return { ...b, text: b.text.split(e.find!).join(e.replace!) };
        });
        if (!hits)
          throw new CapabilityError(
            "INVALID",
            "Those words aren't on the page.",
            "Quote the words exactly as fetch returned them.",
          );
        break;
      }
      case "replace_section": {
        const { start, end } = sectionRange(out, headingIndex(out, e.heading!));
        // Markdown that starts with a heading replaces the heading too
        // (keeping its anchor); otherwise only what is under it.
        const whole = fresh[0]?.type === "heading";
        const from = whole ? start : start + 1;
        const head = out[start];
        const named =
          whole &&
          !fresh[0].id &&
          head.id &&
          !fresh.some((b) => b.id === head.id)
            ? [{ ...fresh[0], id: head.id }, ...fresh.slice(1)]
            : fresh;
        out.splice(from, end - from, ...claim(out, named, idsIn(from, end)));
        break;
      }
      case "append_to_section": {
        const { end } = sectionRange(out, headingIndex(out, e.heading!));
        out.splice(end, 0, ...claim(out, fresh));
        break;
      }
      case "delete_section": {
        const { start, end } = sectionRange(out, headingIndex(out, e.heading!));
        out.splice(start, end - start);
        break;
      }
      case "move_section": {
        const i = headingIndex(out, e.heading!);
        const { start, end } = sectionRange(out, i);
        const before = e.block ? at(e.block) : out.length;
        if (before > start && before < end)
          throw new CapabilityError(
            "INVALID",
            "A section can't move inside itself.",
            "Put it before a line outside the section, or leave block out for the end.",
          );
        out = moveSection(out, i, before);
        break;
      }
    }
  });
  return out;
}

/**
 * The same edits as Take/Leave suggestions beside the page's words, or
 * null when one of them can't be a suggestion (new lines, a line replaced
 * by several, sections replaced or moved).
 */
export function asSuggestions(
  content: DocBlock[],
  edits: Edit[],
  read: ReadEdits,
): ProposedChange[] | null {
  const out: ProposedChange[] = [];
  const deleteLine = (b: DocBlock) => {
    const text = blockText(b);
    out.push({
      block_id: b.id!,
      kind: "delete",
      range_start: 0,
      range_end: text.length,
      text: "",
      quote: text,
    });
  };
  for (const [n, e] of edits.entries()) {
    if (e.op === "find_replace") {
      let found = false;
      for (const b of content) {
        if (!b.id || !("text" in b)) continue;
        const text = blockText(b);
        let from = text.indexOf(e.find!);
        while (from >= 0) {
          found = true;
          out.push({
            block_id: b.id,
            kind: e.replace ? "replace" : "delete",
            range_start: from,
            range_end: from + e.find!.length,
            text: e.replace!,
            quote: e.find!,
          });
          from = text.indexOf(e.find!, from + e.find!.length);
        }
      }
      if (!found)
        throw new CapabilityError(
          "INVALID",
          "Those words aren't on the page.",
          "Quote the words exactly as fetch returned them.",
        );
      continue;
    }
    if (e.op === "delete_section") {
      // Every line of the section struck through, for someone to take.
      const { start, end } = sectionRange(
        content,
        headingIndex(content, e.heading!),
      );
      const lines = content.slice(start, end);
      if (lines.some((b) => !b.id || !("text" in b))) return null;
      lines.forEach(deleteLine);
      continue;
    }
    if (e.op !== "replace" && e.op !== "delete") return null;
    const b = content.find((x) => x.id === e.block!.replace(/^\^/, ""));
    if (!b) throw noLine(e.block!);
    if (!("text" in b)) return null;
    if (e.op === "delete") {
      deleteLine(b);
      continue;
    }
    const fresh = read[n] ?? [];
    if (fresh.length !== 1 || !("text" in fresh[0])) return null;
    const text = blockText(b);
    out.push({
      block_id: b.id!,
      kind: "replace",
      range_start: 0,
      range_end: text.length,
      text: blockText(fresh[0]),
      quote: text,
    });
  }
  return out;
}

/** The lines that differ, before and after, for the inbox's diff. */
function changedLines(before: DocBlock[], after: DocBlock[]) {
  const was = new Map(before.map((b) => [b.id, serializeDoc([b])]));
  const now = new Map(after.map((b) => [b.id, serializeDoc([b])]));
  const lines: { before: string | null; after: string | null }[] = [];
  for (const b of after) {
    const old = b.id ? was.get(b.id) : undefined;
    const text = now.get(b.id)!;
    if (old !== text) lines.push({ before: old ?? null, after: text });
  }
  for (const b of before)
    if (!b.id || !now.has(b.id))
      lines.push({ before: was.get(b.id)!, after: null });
  return lines.slice(0, 200).map((l) => ({
    before: l.before?.slice(0, 5000) ?? null,
    after: l.after?.slice(0, 5000) ?? null,
  }));
}

export const editDoc = defineCapability({
  name: "edit_doc",
  title: "Edit a page",
  description:
    "Version-checked edits to one page, all or none, in Orbyn Markdown (orbyn://spec/markdown): append, prepend, insert_after, replace or delete a line (by anchor), find_replace, a title, and sections by heading: replace_section, append_to_section, delete_section, move_section. Personal pages change directly (history keeps the old state; undo works); team pages get Take/Leave suggestions (or go to review).",
  input: z
    .object({
      doc: z.string().trim().min(1).max(300),
      version: z.number().int().positive(),
      edits: z.array(edit).max(50).default([]),
      title: z.string().trim().min(1).max(200).optional(),
      client_ref: clientRefInput,
    })
    .strict()
    .refine((a) => a.edits.length || a.title, {
      message: "Give at least one edit or a new title.",
    }),
  output: writeOutput,
  annotations: EDITS,
  access: "suggest",
  toolset: "core",
  mode: "write",
  tier: "W2",
  async run(ctx, a) {
    refuseSecrets(a.title, ...a.edits.flatMap((e) => [e.markdown, e.replace]));
    return editPage(ctx, a);
  },
});

/**
 * Edits to one page, all or none (edit_doc, and cards added by
 * update_study): personal pages change directly with a version kept for
 * undo; team pages get suggestions, or a proposal when suggestions can't
 * hold the edits. `version` null edits the page as it is now.
 */
export async function editPage(
  ctx: CapabilityContext,
  a: { doc: string; version: number | null; edits: Edit[]; title?: string },
  change = "Edited",
) {
  const id = docId(a.doc)!;
  const params = new Params();
  const scope = scopeFor(ctx.spaces, params);
  const doc = (
    await ctx.db.query<{
      id: string;
      title: string;
      team_id: string | null;
      version: number;
      content: DocBlock[];
    }>(
      `SELECT d.id, d.title, d.team_id, d.version, d.content FROM docs d
          WHERE d.id = ${params.add(id)} AND ${visibleDocs("d", scope)}
          FOR UPDATE`,
      params.values,
    )
  ).rows[0];
  if (!doc)
    throw new CapabilityError(
      "NOT_FOUND",
      "Nothing with that id is reachable from this connection.",
      "Search for it and use an id from the results.",
    );
  if (a.version !== null && doc.version !== a.version)
    throw new CapabilityError(
      "VERSION_CONFLICT",
      `The page changed since version ${a.version}.`,
      "Fetch it again, then make the edits against the current version.",
      { id: `doc:${doc.id}`, version: doc.version },
    );
  const content = doc.content ?? [];
  const home = { id: doc.id, blocks: content };
  const read: ReadEdits = [];
  for (const e of a.edits)
    read.push(
      e.markdown === undefined
        ? null
        : await readMarkdown(ctx, e.markdown, home),
    );
  const after = applyEdits(content, a.edits, read);
  checkSize(after);
  const where = destination(ctx, doc.team_id, "W2");
  const direct = where === "direct" && !doc.team_id;
  const actor = actorOf(ctx.principal);
  const db = dbOf(ctx);
  if (direct) {
    const saved = await saveDoc(
      db,
      actor,
      doc.id,
      {
        version: doc.version,
        content: after as never,
        ...(a.title ? { title: a.title } : {}),
      },
      { always: true },
    );
    return finishWrite(ctx, "Editing the page", {
      done: [docEntry(saved, change)],
      undo: [
        {
          op: "doc.restore",
          doc_id: doc.id,
          version: saved.version,
          to_version: doc.version,
        },
      ],
      after: afterSave(doc.id, saved.version, ctx.principal.grant_id),
      teamId: doc.team_id,
    });
  }
  // Team pages, and pages this connection may only suggest on.
  const suggestions = a.title ? null : asSuggestions(content, a.edits, read);
  if (suggestions?.length) {
    const made = await proposeChanges(
      ctx.db,
      doc.id,
      ctx.principal.user.id,
      suggestions,
      `Suggested by ${cleanTitle(ctx.principal.client.name) || "an outside agent"}`,
    );
    return finishWrite(ctx, "Suggesting edits", {
      done: [
        docEntry(
          doc,
          `${made.length} suggestion${made.length === 1 ? "" : "s"} beside the words, for someone to take or leave`,
        ),
      ],
      undo: [
        {
          op: "suggestions.delete",
          doc_id: doc.id,
          ids: made.map((m) => m.id),
        },
      ],
      teamId: doc.team_id,
      outcome: "suggested",
    });
  }
  const review: ReviewChangeInput[] = [
    {
      type: "doc.edit",
      doc_id: doc.id,
      version: doc.version,
      title: doc.title,
      team_id: doc.team_id,
      content: after as never,
      lines: changedLines(content, after),
      ...(a.title ? { new_title: a.title } : {}),
    },
  ];
  return finishWrite(ctx, "Editing the page", {
    done: [],
    review,
    reviewSummary: `Edit the page “${cleanTitle(doc.title)}”`,
    teamId: doc.team_id,
  });
}
