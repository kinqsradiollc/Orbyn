import { z } from "zod";
import { addDays, dayTime, fail, itemData, localDateKey } from "@orbyn/core";
import type { Db } from "../db/pool.js";
import { Params, inSpaces, scopeFor, visibleItems } from "../lib/visibility.js";
import { mutate } from "../modules/items/service.js";
import { calendarEntries } from "../modules/planner/calendar.js";
import { externalEntries } from "../modules/planner/subscriptions.js";
import { READ } from "./common.js";
import { cleanTitle, localTime } from "./format.js";
import { policy } from "./policy.js";
import { refUrl } from "./refs.js";
import { defineCapability } from "./registry.js";

/**
 * The three tools the first MCP endpoint offered, kept for old personal API
 * keys (ok_) on the legacy address for their 90 days: search_items, add_task
 * and get_agenda, answering as they always did (plain lines with each id and
 * link), now on the capability layer and its visibility rule. New
 * connections use search, get_today and get_calendar instead.
 */

const LEGACY = "Kept for older connections; ";

/** "Thu 25 Sep 09:00 (2026-09-24T23:00:00.000Z)": local first, exact after. */
const when = (at: Date, tz: string, allDay = false) =>
  allDay
    ? `${localTime(at, tz, true)}, all day`
    : `${localTime(at, tz)} (${at.toISOString()})`;

/** A LIKE pattern that matches `word` literally (its % and _ included). */
const likeWord = (word: string) => word.replace(/[\\%_]/g, "\\$&");

const text = z.object({ text: z.string() });

export const searchItems = defineCapability({
  name: "search_items",
  title: "Search open tasks (older tool)",
  description: `${LEGACY}search is the newer tool. Open tasks and events whose title or notes contain every word, with each id and a link that opens it in Orbyn.`,
  input: z
    .object({
      query: z.string().max(500).describe("Words to look for."),
      limit: z
        .number()
        .min(1)
        .max(50)
        .optional()
        .describe("Most results (default 20)."),
    })
    .strict(),
  output: text,
  annotations: READ,
  access: "read",
  toolset: "core",
  mode: "read",
  tier: "R",
  legacyOnly: true,
  async run(ctx, a) {
    const words = a.query
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 6)
      .map(likeWord);
    if (!words.length) {
      const t = "Give some words to search for.";
      return { structured: { text: t }, markdown: t };
    }
    const p = new Params();
    const scope = scopeFor(ctx.spaces, p);
    const rows = (
      await ctx.db.query<{
        id: string;
        title: string;
        kind: string;
        status: string;
        due_at: Date | null;
      }>(
        `SELECT i.id, i.title, i.kind, i.status, i.due_at FROM items i
          WHERE ${visibleItems("i", scope)} AND i.status NOT IN ('done','cancelled')
            AND NOT EXISTS (SELECT 1 FROM unnest(${p.add(words)}::text[]) w
                            WHERE (i.title || ' ' || i.notes) NOT ILIKE '%' || w || '%')
          ORDER BY i.due_at NULLS LAST, i.created_at DESC LIMIT ${p.add(Math.round(a.limit ?? 20))}`,
        p.values,
      )
    ).rows;
    const t = rows.length
      ? rows
          .map(
            (r) =>
              `- ${cleanTitle(r.title)} (${r.kind}, ${r.status}${r.due_at ? `, due ${when(r.due_at, ctx.timezone)}` : ""})\n` +
              `  id: ${r.id} · open: ${refUrl({ type: "task", id: r.id })}`,
          )
          .join("\n")
      : "No matching items.";
    return {
      structured: { text: t },
      markdown: t,
      targets: rows.map((r) => `task:${r.id}`),
    };
  },
});

export const addTask = defineCapability({
  name: "add_task",
  title: "Add a task (older tool)",
  description: `${LEGACY}adds a task to the person's own planner. The answer has the new task's id and a link that opens it in Orbyn.`,
  input: z
    .object({
      title: z.string().max(200),
      notes: z.string().max(20_000).optional(),
      due_at: z
        .string()
        .optional()
        .describe("ISO 8601 with offset, e.g. 2026-03-02T09:00:00+11:00."),
      priority: z.enum(["low", "medium", "high"]).optional(),
    })
    .strict(),
  output: text.extend({ id: z.string(), url: z.string() }),
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  access: "write",
  toolset: "core",
  mode: "write",
  tier: "W1",
  legacyOnly: true,
  async run(ctx, a) {
    if (policy.levelIn(ctx.principal, null) !== "write")
      fail(403, "This connection can't add to the Personal space.");
    const data = itemData.parse({
      title: a.title,
      notes: a.notes ?? "",
      kind: "task",
      priority: a.priority ?? "medium",
      due_at: a.due_at ? a.due_at : null,
    });
    const item = await mutate(ctx.db as Db, policy.actor(ctx.principal), {
      operation: "create",
      data,
    });
    if (!item) fail(500, "The task wasn't saved.");
    const url = refUrl({ type: "task", id: item.id });
    const t = `Added "${item.title}".\nid: ${item.id} · open: ${url}`;
    return {
      structured: { text: t, id: `task:${item.id}`, url },
      markdown: t,
      targets: [`task:${item.id}`],
    };
  },
});

export const getAgenda = defineCapability({
  name: "get_agenda",
  title: "Agenda (older tool)",
  description: `${LEGACY}get_today and get_calendar are the newer tools. Open tasks due and events from the start of today through the next few days (default 7, at most 31), in the person's time zone, repeating events once per occurrence, subscribed calendars included.`,
  input: z.object({ days: z.number().min(1).max(31).optional() }).strict(),
  output: text,
  annotations: READ,
  access: "read",
  toolset: "core",
  mode: "read",
  tier: "R",
  legacyOnly: true,
  async run(ctx, a) {
    const tz = ctx.timezone;
    const days = Math.min(31, Math.max(1, Math.round(a.days ?? 7)));
    const today = localDateKey(ctx.now, tz);
    const from = dayTime(today, 0, tz);
    const to = dayTime(addDays(today, days), 0, tz);
    const p = new Params();
    const scope = scopeFor(ctx.spaces, p);
    const [entries, subscribed, tasks] = await Promise.all([
      calendarEntries(ctx.db, ctx.principal.user.id, from, to),
      ctx.spaces.personal
        ? externalEntries(ctx.db, ctx.principal.user.id, from, to, {
            visible: true,
          })
        : Promise.resolve([]),
      ctx.db.query<{ id: string; title: string; due_at: Date }>(
        `SELECT i.id, i.title, i.due_at FROM items i
          WHERE ${visibleItems("i", scope)} AND i.kind <> 'event'
            AND i.status NOT IN ('done','cancelled')
            AND i.due_at >= ${p.add(from)} AND i.due_at < ${p.add(to)}
          ORDER BY i.due_at LIMIT 100`,
        p.values,
      ),
    ]);
    const lines = [
      ...entries
        .filter(
          (e) =>
            e.kind === "event" &&
            inSpaces(ctx.spaces, e.team_id) &&
            e.status !== "done" &&
            e.status !== "cancelled",
        )
        .map((e) => ({
          at: e.start_at,
          text:
            `${when(new Date(e.start_at), tz, !!e.all_day)} · ${cleanTitle(e.title)} (event)\n` +
            `  id: ${e.item_id} · open: ${refUrl({ type: "task", id: e.item_id })}`,
        })),
      ...subscribed.map((e) => ({
        at: e.start_at,
        text: `${when(new Date(e.start_at), tz, e.all_day)} · ${cleanTitle(e.title)} (from "${cleanTitle(e.name) || "a subscribed calendar"}")`,
      })),
      ...tasks.rows.map((t) => ({
        at: t.due_at.toISOString(),
        text:
          `${when(t.due_at, tz)} · ${cleanTitle(t.title)} (task, due)\n` +
          `  id: ${t.id} · open: ${refUrl({ type: "task", id: t.id })}`,
      })),
    ]
      .sort((x, y) => x.at.localeCompare(y.at))
      .slice(0, 200);
    const last = addDays(today, days - 1);
    const t = lines.length
      ? [
          `Today (${today}) through ${last}, in ${tz}:`,
          ...lines.map((l) => `- ${l.text}`),
        ].join("\n")
      : `Nothing on the calendar or due from today through ${last} (${tz}).`;
    return { structured: { text: t }, markdown: t };
  },
});
