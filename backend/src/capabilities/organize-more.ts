import {
  aliasesInput,
  customFieldInput,
  customFieldUpdate,
  type FieldTarget,
  type FieldType,
  type ReviewChangeInput,
  type TeamRole,
} from "@orbyn/core";
import type { z } from "zod";
import { pool } from "../db/pool.js";
import { announceDocChange } from "../modules/docs/live.js";
import {
  extractLines,
  mergePages,
  setAliases,
  setFolds,
} from "../modules/docs/structure.js";
import { linkMentionIn } from "../modules/links/more.js";
import { removePageSource } from "../modules/sources/service.js";
import {
  createField,
  requireField,
  setFieldValue,
  updateField,
} from "../modules/views/fields.js";
import { runTeamAdmin, type TeamAdmin } from "../modules/teams/admin.js";
import { setInstructions } from "../modules/agent-context/service.js";
import { teamFilter } from "./common.js";
import { cleanTitle } from "./format.js";
import { appUrl, parseRef } from "./refs.js";
import { CapabilityError, type CapabilityContext } from "./registry.js";
import { actionChange, entryOf, quoted, seeDoc, seeProject } from "./shared.js";
import type { UndoOp } from "./undo.js";
import { afterSave } from "./write-docs.js";
import {
  actorOf,
  cantWait,
  dbOf,
  destination,
  refuseSecrets,
  type DoneEntry,
} from "./write.js";

/**
 * organize's H6b changes: a page's other names, folds, linking a mention,
 * moving lines to a new page and merging pages, taking a source off a
 * page, your own fields (making, changing and filling them in), and
 * running a team (always asked about first: team admin is on the
 * ask-first list, and inviting or removing people too). Every change goes
 * through the app's own service, with its undo; a new team is the one
 * change undo can't take back (deleting a team is the person's).
 */

export const ORGANIZE_MORE = [
  "aliases",
  "fold",
  "link_mention",
  "extract",
  "merge",
  "remove_source",
  "create_field",
  "change_field",
  "set_field",
  "create_team",
  "rename_team",
  "invite",
  "remove_member",
  "set_role",
  "meeting_budget",
  "instructions",
] as const;
export type OrganizeMore = (typeof ORGANIZE_MORE)[number];

/** One organize change, as far as these need it. */
export type MoreChange = {
  do: OrganizeMore;
  id?: string;
  name?: string;
  space?: string;
  add?: string[];
  lines?: string[];
  to?: string;
  words?: string;
  version?: number;
  type?: FieldType;
  for?: FieldTarget;
  value?: string | number | boolean | null;
  calendar?: boolean;
  email?: string;
  person?: string;
  role?: TeamRole;
  minutes?: number | null;
};

/** What the changes add to organize's answer. */
export type MoreState = {
  done: DoneEntry[];
  undo: UndoOp[];
  after: (() => Promise<void>)[];
  review: ReviewChangeInput[];
};

const invalid = (message: string, fix?: string) =>
  new CapabilityError("INVALID", message, fix);

function need<T>(v: T | undefined, what: string): T {
  if (v === undefined) throw invalid(`This change needs ${what}.`);
  return v;
}

/** A zod parse whose first problem reads as the agent's to fix. */
function parsed<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  const r = schema.safeParse(value);
  if (r.success) return r.data;
  const issue = r.error.issues[0];
  throw invalid(
    `${issue.path.length ? `${issue.path.join(".")}: ` : ""}${issue.message}`,
  );
}

const by = (ctx: CapabilityContext) =>
  `agent:${ctx.principal.grant_id ?? "session"}`;

/** A page change: the connection's trust in its space decides. */
async function pageFor(ctx: CapabilityContext, id: string | undefined) {
  const doc = await seeDoc(ctx, need(id, "id: the page"));
  if (destination(ctx, doc.team_id, "W2", [], { owner: doc }) === "review")
    throw cantWait(ctx, doc.team_id);
  return doc;
}

/** A field this connection reaches (its space is one it works in). */
async function fieldFor(ctx: CapabilityContext, id: string | undefined) {
  const ref = parseRef(need(id, "id: the field").replace(/^field:/i, ""));
  if (ref.type === "title") throw invalid("Name the field by its id.");
  const f = await requireField(
    dbOf(ctx),
    ref.id,
    actorOf(ctx.principal),
    false,
  ).catch(() => null);
  const reach = f
    ? f.team_id
      ? ctx.principal.teams.some((t) => t.id === f.team_id)
      : ctx.principal.personal
    : false;
  if (!f || !reach)
    throw new CapabilityError(
      "NOT_FOUND",
      "No field with that id is reachable from this connection.",
      "fetch a page or project: its Fields line lists field ids.",
    );
  return f;
}

const fieldEntry = (id: string, name: string, change: string): DoneEntry => ({
  id: `field:${id}`,
  title: cleanTitle(name) || "Field",
  url: `${appUrl()}/app/views`,
  version: null,
  change,
});

/** Run one of organize's H6b changes. */
export async function organizeMore(
  ctx: CapabilityContext,
  c: MoreChange,
  st: MoreState,
): Promise<void> {
  const db = dbOf(ctx);
  const actor = actorOf(ctx.principal);
  switch (c.do) {
    case "aliases": {
      const doc = await pageFor(ctx, c.id);
      refuseSecrets(...(c.add ?? []));
      const names = parsed(aliasesInput, c.add ?? []);
      const r = await setAliases(db, actor, doc.id, names);
      st.undo.push({ op: "aliases.set", doc_id: doc.id, aliases: r.before });
      st.after.push(() =>
        announceDocChange(pool, doc.id, r.version, by(ctx), { tags: true }),
      );
      st.done.push(
        entryOf(
          "doc",
          doc.id,
          doc.title,
          r.version,
          names.length
            ? `Also called ${names.join(", ")}`
            : "Other names cleared",
        ),
      );
      return;
    }
    case "fold": {
      const doc = await seeDoc(ctx, need(c.id, "id: the page"));
      // Folds are the person's own view of the page.
      if (destination(ctx, doc.team_id, "W1") === "review")
        throw cantWait(ctx, doc.team_id);
      const r = await setFolds(
        db,
        ctx.principal.user.id,
        doc.id,
        c.lines ?? [],
      );
      st.undo.push({ op: "folds.set", doc_id: doc.id, block_ids: r.before });
      st.done.push(
        entryOf(
          "doc",
          doc.id,
          doc.title,
          null,
          r.after.length
            ? `Folded ${r.after.length} heading${r.after.length === 1 ? "" : "s"}`
            : "Unfolded every heading",
        ),
      );
      return;
    }
    case "link_mention": {
      const doc = await pageFor(ctx, c.id);
      const line = need(c.lines?.[0], "lines: [the line's anchor]");
      const to = parseRef(need(c.to, "to: the page or project it names"));
      const target =
        to.type === "project"
          ? { kind: "project" as const, id: (await seeProject(ctx, c.to!)).id }
          : { kind: "doc" as const, id: (await seeDoc(ctx, c.to!)).id };
      const r = await linkMentionIn(
        db,
        actor,
        {
          doc_id: doc.id,
          block_id: line.replace(/^\^/, ""),
          matched: need(c.words, "words: the name as the line says it"),
          target,
        },
        true,
      );
      st.undo.push({
        op: "doc.restore",
        doc_id: doc.id,
        version: r.version,
        to_version: r.before,
      });
      st.after.push(...afterSave(doc.id, r.version, ctx.principal.grant_id));
      st.done.push(
        entryOf("doc", doc.id, doc.title, r.version, "Linked a mention"),
      );
      return;
    }
    case "extract": {
      const doc = await pageFor(ctx, c.id);
      refuseSecrets(c.name);
      const lines = need(c.lines, "lines: the anchors to move");
      const out = await extractLines(
        db,
        actor,
        doc.id,
        {
          block_ids: lines.map((l) => l.replace(/^\^/, "")),
          title: c.name,
          version: need(c.version, "version: the page's version"),
        },
        true,
      );
      // Undo brings the lines back and sends the new page to Trash (their
      // comments stay with it there).
      st.undo.push(
        {
          op: "doc.restore",
          doc_id: doc.id,
          version: out.source.version,
          to_version: doc.version,
        },
        { op: "doc.trash", doc_id: out.doc.id, version: out.doc.version },
      );
      st.after.push(
        ...afterSave(doc.id, out.source.version, ctx.principal.grant_id),
        ...afterSave(out.doc.id, out.doc.version, ctx.principal.grant_id),
      );
      st.done.push(
        entryOf(
          "doc",
          out.doc.id,
          out.doc.title,
          out.doc.version,
          `Moved ${lines.length} line${lines.length === 1 ? "" : "s"} here from ${quoted(doc.title)}, linked there`,
        ),
        entryOf(
          "doc",
          doc.id,
          doc.title,
          out.source.version,
          "Lines moved out",
        ),
      );
      return;
    }
    case "merge": {
      const doc = await seeDoc(ctx, need(c.id, "id: the page to merge"));
      const into = await seeDoc(ctx, need(c.to, "to: the page to merge into"));
      // The merged page goes to Trash: a delete, so W3.
      for (const d of [doc, into])
        if (destination(ctx, d.team_id, "W3", [], { owner: d }) === "review")
          throw cantWait(ctx, d.team_id);
      const out = await mergePages(
        db,
        actor,
        doc.id,
        {
          into: into.id,
          version: need(c.version, "version: the merged page's version"),
        },
        true,
      );
      st.undo.push(
        {
          op: "doc.restore",
          doc_id: into.id,
          version: out.version,
          to_version: into.version,
        },
        { op: "doc.untrash", doc_id: doc.id },
      );
      st.after.push(
        () =>
          announceDocChange(pool, doc.id, c.version!, by(ctx), {
            trashed: true,
          }),
        ...afterSave(into.id, out.version, ctx.principal.grant_id),
      );
      st.done.push(
        entryOf(
          "doc",
          into.id,
          into.title,
          out.version,
          `Merged ${quoted(doc.title)} in (it's in Trash; ${out.rewritten.length} page${out.rewritten.length === 1 ? "" : "s"} relinked here, which undo leaves)`,
        ),
      );
      return;
    }
    case "remove_source": {
      const doc = await pageFor(ctx, c.id);
      const src = parseRef(need(c.to, "to: source:<id>"));
      if (src.type === "title") throw invalid("Name the source by its id.");
      const lines = await removePageSource(db, doc.id, src.id);
      if (!lines.length)
        throw invalid(
          "That source isn't on this page.",
          "fetch the page: its Sources line lists them.",
        );
      st.undo.push({ op: "source.relink", id: src.id, doc_id: doc.id, lines });
      st.after.push(() =>
        announceDocChange(pool, doc.id, doc.version, by(ctx), {
          fields: true,
        }),
      );
      st.done.push(
        entryOf("doc", doc.id, doc.title, doc.version, "Took a source off"),
      );
      return;
    }
    case "create_field": {
      const space = teamFilter(c.space ?? "personal");
      const teamId = space && "team" in space ? space.team : null;
      if (destination(ctx, teamId, teamId ? "W2" : "W1") === "review")
        throw cantWait(ctx, teamId);
      refuseSecrets(c.name, ...(c.add ?? []));
      const data = parsed(customFieldInput, {
        name: need(c.name, "a name"),
        type: need(c.type, "type"),
        applies_to: c.for ?? "page",
        team_id: teamId,
        options: c.add ?? [],
        on_calendar: c.calendar ?? false,
      });
      const f = await createField(db, actor, data);
      st.undo.push({ op: "field.delete", id: f.id });
      st.done.push(fieldEntry(f.id, f.name, `Made a ${f.type} field`));
      return;
    }
    case "change_field": {
      const f = await fieldFor(ctx, c.id);
      if (
        destination(ctx, f.team_id, "W2", [], {
          owner: { user_id: f.user_id },
        }) === "review"
      )
        throw cantWait(ctx, f.team_id);
      refuseSecrets(c.name, ...(c.add ?? []));
      const body = parsed(customFieldUpdate, {
        ...(c.name !== undefined ? { name: c.name } : {}),
        ...(c.add !== undefined ? { options: c.add } : {}),
        ...(c.calendar !== undefined ? { on_calendar: c.calendar } : {}),
      });
      if (!Object.keys(body).length)
        throw invalid("change_field needs name, add or calendar.");
      const saved = await updateField(db, actor, f.id, body);
      st.undo.push({
        op: "field.restore",
        id: f.id,
        fields: {
          name: f.name,
          options: f.options,
          on_calendar: f.on_calendar,
        },
      });
      st.done.push(
        fieldEntry(
          f.id,
          saved.name,
          body.options
            ? "Changed (values no longer among the choices were cleared)"
            : "Changed",
        ),
      );
      return;
    }
    case "set_field": {
      const f = await fieldFor(ctx, c.id);
      const to = parseRef(need(c.to, "to: the page or project"));
      const target =
        to.type === "project"
          ? await seeProject(ctx, c.to!).then((p) => ({
              kind: "project" as const,
              id: p.id,
              team_id: p.team_id,
              owner: p,
            }))
          : await seeDoc(ctx, c.to!).then((d) => ({
              kind: "page" as const,
              id: d.id,
              team_id: d.team_id,
              owner: d,
            }));
      if (
        destination(ctx, target.team_id, "W2", [], { owner: target.owner }) ===
        "review"
      )
        throw cantWait(ctx, target.team_id);
      if (typeof c.value === "string") {
        if (c.value.length > 500)
          throw invalid("A field's value is 500 characters at most.");
        refuseSecrets(c.value);
      }
      const r = await setFieldValue(db, actor, f.id, {
        target: target.kind,
        target_id: target.id,
        value: need(c.value, "value (null clears it)"),
      });
      st.undo.push({
        op: "field.value",
        field_id: f.id,
        target: target.kind,
        target_id: target.id,
        value: r.before,
      });
      if (target.kind === "page")
        st.after.push(() =>
          announceDocChange(pool, target.id, r.version, by(ctx), {
            fields: true,
          }),
        );
      st.done.push(
        entryOf(
          target.kind === "page" ? "doc" : "project",
          target.id,
          r.title,
          null,
          r.value === null ? `Cleared ${f.name}` : `Set ${f.name}`,
        ),
      );
      return;
    }
    case "instructions": {
      if (typeof c.value !== "string" && c.value !== null)
        throw invalid(
          'instructions needs value: the words (up to 2000 characters; "" or null clears them).',
        );
      const text = (c.value ?? "").trim();
      if (text.length > 2000)
        throw invalid("Instructions are 2000 characters at most.");
      refuseSecrets(text);
      const space = (c.id ?? "personal").trim().toLowerCase();
      // A team's instructions steer every member's agents: asked first.
      if (space !== "personal")
        return teamChange(ctx, { ...c, value: text }, st);
      if (!ctx.principal.personal)
        throw new CapabilityError(
          "FORBIDDEN",
          "Personal's instructions need a connection with Personal.",
        );
      if (destination(ctx, null, "W1") === "review") throw cantWait(ctx, null);
      const r = await setInstructions(db, actor, null, { text });
      st.undo.push({ op: "instructions.set", text: r.was });
      st.done.push({
        id: "instructions:personal",
        title: "Instructions for Personal",
        url: `${appUrl()}/app/settings`,
        version: null,
        change: text ? "Changed" : "Cleared",
      });
      return;
    }
    default:
      return teamChange(ctx, c, st);
  }
}

/** A team this connection works in, by id. */
function teamOf(ctx: CapabilityContext, id: string | undefined) {
  const ref = need(id, "id: the team").replace(/^team:/, "");
  const team = ctx.principal.teams.find((t) => t.id === ref.toLowerCase());
  if (!team)
    throw new CapabilityError(
      "NOT_FOUND",
      "No team with that id is reachable from this connection.",
      "get_context lists the connection's teams.",
    );
  return team;
}

async function personName(ctx: CapabilityContext, id: string) {
  return (
    (
      await ctx.db.query<{ name: string }>(
        "SELECT name FROM users WHERE id = $1",
        [id],
      )
    ).rows[0]?.name ?? "someone"
  );
}

/**
 * Running a team: asked about first (team admin, and inviting or removing
 * people, are on the ask-first list), made through the app's own team
 * functions once the person says yes (in the chat, or in the Review inbox).
 */
async function teamChange(
  ctx: CapabilityContext,
  c: MoreChange,
  st: MoreState,
): Promise<void> {
  let input: TeamAdmin;
  let headline: string;
  let title: string;
  let teamId: string | null = null;
  let people = false;
  switch (c.do) {
    case "create_team": {
      refuseSecrets(c.name);
      const name = need(c.name, "a name");
      input = { op: "create", name };
      headline = `Make a team ${quoted(name)}`;
      title = name;
      break;
    }
    case "rename_team": {
      const t = teamOf(ctx, c.id);
      refuseSecrets(c.name);
      const name = need(c.name, "a name");
      input = { op: "rename", team_id: t.id, name };
      headline = `Rename the team ${quoted(t.name)} to ${quoted(name)}`;
      title = t.name;
      teamId = t.id;
      break;
    }
    case "invite": {
      const t = teamOf(ctx, c.id);
      const email = need(c.email, "email").toLowerCase();
      const role = c.role ?? "member";
      input = { op: "invite", team_id: t.id, email, role };
      headline = `Add ${email} to ${quoted(t.name)} as ${role}`;
      title = t.name;
      teamId = t.id;
      people = true;
      break;
    }
    case "remove_member": {
      const t = teamOf(ctx, c.id);
      const person = need(c.person, "person: their id");
      input = { op: "remove", team_id: t.id, user_id: person };
      headline = `Remove ${await personName(ctx, person)} from ${quoted(t.name)}`;
      title = t.name;
      teamId = t.id;
      people = true;
      break;
    }
    case "set_role": {
      const t = teamOf(ctx, c.id);
      const person = need(c.person, "person: their id");
      const role = need(c.role, "role");
      input = { op: "role", team_id: t.id, user_id: person, role };
      headline = `Make ${await personName(ctx, person)} ${role} in ${quoted(t.name)}`;
      title = t.name;
      teamId = t.id;
      break;
    }
    case "meeting_budget": {
      const t = teamOf(ctx, c.id);
      const minutes = need(c.minutes, "minutes (null for no budget)");
      input = { op: "budget", team_id: t.id, minutes };
      headline =
        minutes === null
          ? `Clear ${quoted(t.name)}'s meeting budget`
          : `Set ${quoted(t.name)}'s meeting budget to ${minutes} minutes a week each`;
      title = t.name;
      teamId = t.id;
      break;
    }
    case "instructions": {
      const t = teamOf(ctx, c.id);
      const text = String(c.value ?? "");
      input = { op: "instructions", team_id: t.id, text };
      headline = text
        ? `Set ${quoted(t.name)}'s instructions for agents: “${text.length > 120 ? `${text.slice(0, 117)}…` : text}”`
        : `Clear ${quoted(t.name)}'s instructions for agents`;
      title = t.name;
      teamId = t.id;
      break;
    }
    default:
      throw invalid("That change isn't one organize makes.");
  }
  const admin = destination(ctx, teamId, "W2", [], { asks: "team_admin" });
  const invites = people
    ? destination(ctx, teamId, "W2", [], { asks: "people" })
    : "direct";
  if (admin === "review" || invites === "review") {
    st.review.push(
      actionChange({
        action: "team.admin",
        target_id: teamId,
        title,
        team_id: teamId,
        headline,
        input,
      }),
    );
    return;
  }
  const r = await runTeamAdmin(dbOf(ctx), actorOf(ctx.principal), input);
  if (r.undo) st.undo.push(r.undo);
  st.done.push({
    id: `team:${r.team_id}`,
    title: cleanTitle(title) || "Team",
    url: `${appUrl()}/app/teams`,
    version: null,
    change: r.undo
      ? headline
      : `${headline} (undo can't remove a team: deleting one is the person's, in Orbyn)`,
  });
}
