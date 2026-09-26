import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { createHash } from "node:crypto";
import { pool, transaction } from "../../db/pool.js";
import { digest } from "../../lib/auth.js";
import { mutate } from "../items/service.js";
import { loadPrefs } from "../planner/calendar.js";
import { eventLines, FEED_COLUMNS, type FeedItem } from "../planner/ics.js";
import { itemData } from "@orbyn/core";
import { parseICalendar } from "./ical.js";
import { visibleItems } from "../../lib/visibility.js";

// A CalDAV server, so Apple Calendar, Thunderbird and DAVx5 can subscribe to
// a person's events natively (in addition to the ICS feed) and — for VEVENTs —
// create, edit and delete them back. The protocol responses and the write
// paths below are tested; real-client interop is verified by hand (see docs).

type DavUser = { id: string; name: string; role: "admin" | "member" };

/** CalDAV clients authenticate with HTTP Basic; the password is an API key. */
async function davAuth(r: FastifyRequest): Promise<DavUser | null> {
  const header = r.headers.authorization ?? "";
  const m = header.match(/^Basic (.+)$/);
  if (!m) return null;
  const decoded = Buffer.from(m[1], "base64").toString("utf8");
  const pass = decoded.slice(decoded.indexOf(":") + 1);
  if (!pass) return null;
  const u = (
    await pool.query<DavUser>(
      "SELECT u.id, u.name, u.role FROM users u JOIN api_keys k ON k.user_id = u.id WHERE k.key_hash = $1 AND NOT u.disabled",
      [digest(pass)],
    )
  ).rows[0];
  return u ?? null;
}

const unauthorized = (reply: FastifyReply) =>
  reply
    .code(401)
    .header("WWW-Authenticate", 'Basic realm="Orbyn", charset="UTF-8"')
    .send("Authentication required.");

const xmlHeader = '<?xml version="1.0" encoding="utf-8"?>\n';
const escapeXml = (s: string) =>
  s.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);
const multistatus = (body: string) =>
  `${xmlHeader}<multistatus xmlns="DAV:" xmlns:C="urn:ietf:params:xml:data:caldav" xmlns:CS="http://calendarserver.org/ns/">${body}</multistatus>`;

const isUuid = (s: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

/**
 * The events CalDAV shows: the same ones the app's calendar does, by the same
 * rule (visibleItems in lib/visibility.ts): your personal events, and your teams' events for as
 * long as you're on the team. Not every event you ever created: one made in
 * a team you've since left stays with that team.
 */
const DAV_EVENTS = `${visibleItems()} AND i.kind='event' AND i.due_at IS NOT NULL`;

/** The calendar's change tag: changes when any event the user can see changes. */
async function ctag(userId: string): Promise<string> {
  const row = (
    await pool.query<{ max: Date | null; n: number }>(
      `SELECT max(i.updated_at) AS max, count(*)::int AS n FROM items i WHERE ${DAV_EVENTS}`,
      [userId],
    )
  ).rows[0];
  return createHash("sha256")
    .update(`${row.max?.toISOString() ?? "0"}:${row.n}`)
    .digest("hex")
    .slice(0, 16);
}

/** The user's events as CalDAV resources (href + VEVENT text + etag). */
async function events(userId: string) {
  const rows = (
    await pool.query<FeedItem>(
      `SELECT ${FEED_COLUMNS} FROM items i
         WHERE ${DAV_EVENTS}
           AND (i.rrule IS NOT NULL OR i.due_at > now() - interval '90 days')
         ORDER BY i.due_at LIMIT 2000`,
      [userId],
    )
  ).rows;
  // A CalDAV-created event keeps the UID (and so the href) the client chose.
  const uids = new Map(
    (
      await pool.query<{ item_id: string; uid: string }>(
        "SELECT item_id, uid FROM caldav_objects WHERE user_id=$1",
        [userId],
      )
    ).rows.map((m) => [m.item_id, m.uid]),
  );
  return rows.map((r) => {
    const vevent = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Orbyn//CalDAV//EN",
      ...eventLines(r),
      "END:VCALENDAR",
    ].join("\r\n");
    const name = uids.get(r.id) ?? r.id;
    return {
      href: `/dav/cal/default/${name}.ics`,
      etag: `"${createHash("sha256").update(`${r.id}${r.updated_at.toISOString()}`).digest("hex").slice(0, 16)}"`,
      data: vevent,
    };
  });
}

const CAL = "/dav/cal/default/";

/** An event a `.ics` file names, with what an edit from a client must keep. */
type DavEvent = {
  id: string;
  version: number;
  team_id: string | null;
  status: string;
  priority: string;
  meeting_url: string;
};

/** Resolve a `<name>.ics` file to an event the user can see, or null. */
async function resolveFile(
  userId: string,
  file: string,
): Promise<DavEvent | null> {
  const base = file.replace(/\.ics$/i, "");
  const id: string | undefined = (
    await pool.query<{ item_id: string }>(
      "SELECT item_id FROM caldav_objects WHERE user_id=$1 AND uid=$2",
      [userId, base],
    )
  ).rows[0]?.item_id;
  const row = (
    await pool.query<DavEvent>(
      `SELECT i.id, i.version, i.team_id, i.status, i.priority, i.meeting_url
         FROM items i WHERE i.id=$2 AND ${DAV_EVENTS}`,
      [userId, id ?? (isUuid(base) ? base : null)],
    )
  ).rows[0];
  return row ?? null;
}

/**
 * The notes a client sent back, without the meeting link the feed added to
 * the description (eventLines puts it after the notes), so a round trip
 * through a calendar app doesn't copy the link into the notes each time.
 */
function notesWithoutMeetingLink(notes: string, meeting: string) {
  if (!meeting) return notes;
  const text = notes.replace(/\s+$/, "");
  if (text === meeting) return "";
  if (!text.endsWith(meeting)) return notes;
  const before = text.slice(0, -meeting.length);
  return /\n\s*$/.test(before) ? before.replace(/\s+$/, "") : notes;
}

/** A write refused by the item rules, as a plain-text CalDAV answer. */
function refused(reply: FastifyReply, e: unknown, fallback: string) {
  const status = (e as { statusCode?: number }).statusCode ?? 400;
  return reply
    .code(status >= 400 && status < 500 ? status : 400)
    .send((e as Error).message || fallback);
}

export async function davRoutes(app: FastifyInstance) {
  app.route({
    method: "OPTIONS",
    url: "/dav/*",
    handler: async (_r, reply) =>
      reply
        .header("DAV", "1, 3, calendar-access")
        .header("Allow", "OPTIONS, GET, HEAD, PUT, DELETE, PROPFIND, REPORT")
        .code(204)
        .send(),
  });
  // Discovery: some clients probe the well-known path first.
  app.route({
    method: "PROPFIND",
    url: "/.well-known/caldav",
    handler: async (_r, reply) =>
      reply.code(301).header("Location", "/dav/").send(),
  });

  app.route({
    method: "PROPFIND",
    url: "/dav/*",
    handler: async (r, reply) => {
      const u = await davAuth(r);
      if (!u) return unauthorized(reply);
      const path = "/" + ((r.params as { "*": string })["*"] ?? "");
      const depth = (r.headers.depth as string) ?? "0";
      reply.header("DAV", "1, 3, calendar-access").type("application/xml");

      // Service root and principal → point at the calendar home.
      if (path === "/" || path === "/dav" || path.startsWith("/principals")) {
        reply.code(207);
        return multistatus(
          `<response><href>${escapeXml(path === "/" ? "/dav/" : path)}</href><propstat><prop>` +
            `<current-user-principal><href>/dav/principals/me/</href></current-user-principal>` +
            `<principal-URL><href>/dav/principals/me/</href></principal-URL>` +
            `<C:calendar-home-set><href>/dav/cal/</href></C:calendar-home-set>` +
            `<resourcetype><collection/></resourcetype>` +
            `</prop><status>HTTP/1.1 200 OK</status></propstat></response>`,
        );
      }

      // Calendar home → list the one calendar collection.
      if (path === "/cal" || path === "/cal/") {
        reply.code(207);
        const tag = await ctag(u.id);
        const home = `<response><href>/dav/cal/</href><propstat><prop><resourcetype><collection/></resourcetype></prop><status>HTTP/1.1 200 OK</status></propstat></response>`;
        const cal =
          depth === "0" ? "" : calendarCollectionResponse(u.name, tag);
        return multistatus(home + cal);
      }

      // The calendar collection itself (and, at Depth 1, its events).
      if (path === "/cal/default" || path === "/cal/default/") {
        reply.code(207);
        const tag = await ctag(u.id);
        let body = calendarCollectionResponse(u.name, tag);
        if (depth === "1")
          for (const e of await events(u.id))
            body += resourceResponse(e.href, e.etag);
        return multistatus(body);
      }

      // A single event resource (clients probe it before an update).
      if (path.startsWith("/cal/default/") && path.endsWith(".ics")) {
        const file = path.slice("/cal/default/".length);
        const found = (await events(u.id)).find((e) =>
          e.href.endsWith(`/${file}`),
        );
        if (!found) return reply.code(404).send();
        reply.code(207);
        return multistatus(resourceResponse(found.href, found.etag));
      }

      reply.code(404).send();
    },
  });

  app.route({
    method: "REPORT",
    url: "/dav/cal/default/*",
    handler: async (r, reply) => {
      const u = await davAuth(r);
      if (!u) return unauthorized(reply);
      const all = await events(u.id);
      const wanted = String(r.body ?? "").includes("calendar-multiget")
        ? new Set(
            [
              ...String(r.body).matchAll(
                /<[^>]*href[^>]*>([^<]+)<\/[^>]*href>/gi,
              ),
            ].map((m) => m[1].trim()),
          )
        : null;
      const chosen = wanted ? all.filter((e) => wanted.has(e.href)) : all;
      reply.code(207).type("application/xml");
      return multistatus(
        chosen
          .map(
            (e) =>
              `<response><href>${escapeXml(e.href)}</href><propstat><prop>` +
              `<getetag>${e.etag}</getetag>` +
              `<C:calendar-data>${escapeXml(e.data)}</C:calendar-data>` +
              `</prop><status>HTTP/1.1 200 OK</status></propstat></response>`,
          )
          .join(""),
      );
    },
  });

  // One event as an .ics file.
  app.route({
    method: "GET",
    url: "/dav/cal/default/:file",
    handler: async (r, reply) => {
      const u = await davAuth(r);
      if (!u) return unauthorized(reply);
      const file = String((r.params as { file: string }).file);
      const found = (await events(u.id)).find((e) =>
        e.href.endsWith(`/${file}`),
      );
      if (!found) return reply.code(404).send();
      return reply
        .type("text/calendar; charset=utf-8")
        .header("ETag", found.etag)
        .send(found.data);
    },
  });

  // Create or replace an event from a client (Apple Calendar, Thunderbird…).
  app.route({
    method: "PUT",
    url: "/dav/cal/default/:file",
    handler: async (r, reply) => {
      const u = await davAuth(r);
      if (!u) return unauthorized(reply);
      const file = String((r.params as { file: string }).file);
      const tz = (await loadPrefs(pool, u.id)).timezone;
      const parsed = parseICalendar(String(r.body ?? ""), tz);
      if (!parsed)
        return reply.code(400).send("Could not read a VEVENT from the body.");
      const existing = await resolveFile(u.id, file);
      let data;
      try {
        data = itemData.parse({
          title: parsed.title,
          notes: existing
            ? notesWithoutMeetingLink(parsed.notes, existing.meeting_url)
            : parsed.notes,
          kind: "event",
          location: parsed.location,
          due_at: parsed.due_at,
          all_day: parsed.all_day,
          timezone: parsed.timezone,
          ...(parsed.end_at ? { end_at: parsed.end_at } : {}),
          ...(parsed.rrule ? { rrule: parsed.rrule } : {}),
          // An edit changes only what the .ics carries. The event stays in
          // its team (a calendar app knows nothing of teams) with its status
          // and priority; everything else the .ics leaves out (list, tags,
          // assignee, alerts, people invited, colour, busy, project) is
          // kept by the write path when it's omitted.
          ...(existing
            ? {
                team_id: existing.team_id,
                status: existing.status,
                priority: existing.priority,
              }
            : {}),
        });
      } catch (e) {
        return reply.code(400).send((e as Error).message ?? "Invalid event.");
      }
      const actor = { id: u.id, role: u.role };
      try {
        if (existing) {
          await transaction((db) =>
            mutate(db, actor, {
              operation: "update",
              item_id: existing.id,
              version: existing.version,
              data,
            }),
          );
          return reply.code(204).send();
        }
        const item = await transaction(async (db) => {
          const created = await mutate(db, actor, {
            operation: "create",
            data,
          });
          const uid = file.replace(/\.ics$/i, "") || parsed.uid;
          if (created && uid)
            await db.query(
              "INSERT INTO caldav_objects (user_id, uid, item_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING",
              [u.id, uid, created.id],
            );
          return created;
        });
        return reply.code(item ? 201 : 400).send();
      } catch (e) {
        return refused(reply, e, "Could not save the event.");
      }
    },
  });

  // Delete an event a client removed.
  app.route({
    method: "DELETE",
    url: "/dav/cal/default/:file",
    handler: async (r, reply) => {
      const u = await davAuth(r);
      if (!u) return unauthorized(reply);
      const file = String((r.params as { file: string }).file);
      const existing = await resolveFile(u.id, file);
      if (!existing) return reply.code(404).send();
      try {
        await transaction((db) =>
          mutate(
            db,
            { id: u.id, role: u.role },
            {
              operation: "delete",
              item_id: existing.id,
              version: existing.version,
            },
          ),
        );
      } catch (e) {
        return refused(reply, e, "Could not delete the event.");
      }
      return reply.code(204).send();
    },
  });

  // We don't let clients rename or make new calendars.
  for (const method of ["PROPPATCH", "MKCALENDAR"] as const)
    app.route({
      method,
      url: "/dav/*",
      handler: async (_r, reply) =>
        reply.code(403).send("This calendar can't be renamed or replaced."),
    });
}

/** The calendar collection's PROPFIND response (name, ctag, VEVENT support). */
function calendarCollectionResponse(name: string, tag: string): string {
  return (
    `<response><href>${CAL}</href><propstat><prop>` +
    `<resourcetype><collection/><C:calendar/></resourcetype>` +
    `<displayname>${escapeXml(name)} · Orbyn</displayname>` +
    `<CS:getctag>${tag}</CS:getctag>` +
    `<C:supported-calendar-component-set><C:comp name="VEVENT"/></C:supported-calendar-component-set>` +
    `</prop><status>HTTP/1.1 200 OK</status></propstat></response>`
  );
}

/** An event resource's row in a calendar PROPFIND. */
function resourceResponse(href: string, etag: string): string {
  return (
    `<response><href>${escapeXml(href)}</href><propstat><prop>` +
    `<getetag>${etag}</getetag>` +
    `<getcontenttype>text/calendar; component=vevent</getcontenttype>` +
    `<resourcetype/>` +
    `</prop><status>HTTP/1.1 200 OK</status></propstat></response>`
  );
}
