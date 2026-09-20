import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { createHash } from "node:crypto";
import { pool } from "../../db/pool.js";
import { digest } from "../../lib/auth.js";
import { eventLines, FEED_COLUMNS, type FeedItem } from "../planner/ics.js";

// A read-only CalDAV server, so Apple Calendar, Thunderbird and DAVx5 can
// subscribe to a person's events natively (in addition to the ICS feed).
// Two-way writes are deliberately out of scope here. The protocol responses
// below are tested; real-client interop is verified by hand (see docs).

type DavUser = { id: string; name: string };

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
      "SELECT u.id, u.name FROM users u JOIN api_keys k ON k.user_id = u.id WHERE k.key_hash = $1 AND NOT u.disabled",
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

/** The calendar's change tag: changes when any of the user's events change. */
async function ctag(userId: string): Promise<string> {
  const row = (
    await pool.query<{ max: Date | null; n: number }>(
      "SELECT max(updated_at) AS max, count(*)::int AS n FROM items WHERE user_id=$1 AND due_at IS NOT NULL",
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
         WHERE i.user_id=$1 AND i.kind='event' AND i.due_at IS NOT NULL
           AND (i.rrule IS NOT NULL OR i.due_at > now() - interval '90 days')
         ORDER BY i.due_at LIMIT 2000`,
      [userId],
    )
  ).rows;
  return rows.map((r) => {
    const vevent = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Orbyn//CalDAV//EN",
      ...eventLines(r),
      "END:VCALENDAR",
    ].join("\r\n");
    return {
      href: `/dav/cal/default/${r.id}.ics`,
      etag: `"${createHash("sha256").update(`${r.id}${r.updated_at.toISOString()}`).digest("hex").slice(0, 16)}"`,
      data: vevent,
    };
  });
}

const CAL = "/dav/cal/default/";

export async function davRoutes(app: FastifyInstance) {
  app.route({
    method: "OPTIONS",
    url: "/dav/*",
    handler: async (_r, reply) =>
      reply
        .header("DAV", "1, 3, calendar-access")
        .header("Allow", "OPTIONS, GET, HEAD, PROPFIND, REPORT")
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
      const id = String((r.params as { file: string }).file).replace(
        /\.ics$/,
        "",
      );
      const found = (await events(u.id)).find((e) =>
        e.href.endsWith(`/${id}.ics`),
      );
      if (!found) return reply.code(404).send();
      return reply
        .type("text/calendar; charset=utf-8")
        .header("ETag", found.etag)
        .send(found.data);
    },
  });

  // Read-only: refuse writes clearly rather than pretending to accept them.
  for (const method of ["PUT", "DELETE", "PROPPATCH", "MKCALENDAR"] as const)
    app.route({
      method,
      url: "/dav/*",
      handler: async (_r, reply) =>
        reply.code(403).send("This CalDAV calendar is read-only."),
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
