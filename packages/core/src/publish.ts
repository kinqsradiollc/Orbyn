import { z } from "zod";
import { colors } from "./presentation.js";
import type { OutlineEntry } from "./doc-outline.js";

/**
 * Publishing pages to the web (SHR-05, SHR-06).
 *
 * A page or a whole folder can be read at /p/<slug> by anyone with the
 * address, with no account. It is off until someone turns it on, a team
 * can switch it off for all its pages, and Unpublish works at once. A
 * published page is hidden from search engines unless the publisher says
 * otherwise, can have a password, and carries a description and a picture
 * for the card a link shows when it is shared.
 *
 * The page is written on the server as plain HTML in Orbyn's calm style:
 * no script, nothing from anyone else, fast on any phone.
 */

export type PublishedInfo = {
  id: string;
  kind: "page" | "folder";
  slug: string;
  /** Where it is read, from the site's root: "/p/physics-notes-3f2a1c". */
  path: string;
  noindex: boolean;
  description: string;
  has_password: boolean;
  views: number;
  created_at: string;
  updated_at: string;
};

export type PublishState = {
  /** The page (or folder) itself, when it is on the web. */
  published: PublishedInfo | null;
  /** For a page: the folder it is in, when that folder is on the web. */
  via_folder: (PublishedInfo & { folder_name: string }) | null;
  /** Whether you may publish or unpublish it, and if not, why. */
  can_publish: boolean;
  reason: string | null;
  /** For a page: its own description, used on its card. */
  web_description: string;
};

export const PUBLISH_SLUG = /^[a-z0-9][a-z0-9-]{2,79}$/;

export const publishInput = z.object({
  /** The address after /p/; one is made from the title when left out. */
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(PUBLISH_SLUG, "Use 3 to 80 letters, numbers and dashes.")
    .optional(),
  /** Hidden from search engines. On unless turned off. */
  noindex: z.boolean().default(true),
  description: z.string().trim().max(300).default(""),
  /** A new password; null takes it away; left out keeps it. */
  password: z.string().min(4).max(200).nullable().optional(),
});
export type PublishInput = z.input<typeof publishInput>;

export const webDescriptionInput = z.object({
  description: z.string().trim().max(300),
});

/** An address made from a title: "physics-notes-3f2a1c". */
export function publishSlug(title: string, id: string): string {
  const words = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  const tail = id
    .replace(/[^a-f0-9]/gi, "")
    .slice(0, 6)
    .toLowerCase();
  return `${words || "page"}-${tail}`;
}

/** The first words of a page, for a card with no description written. */
export function cardDescription(text: string, max = 160): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

const esc = (text: string) =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

/**
 * The stylesheet every published page shares. The colours are the light
 * theme's own (from the shared palette), written out because a published
 * page is read far from the app and its stylesheet.
 */
const STYLE = `
:root { color-scheme: light; }
* { box-sizing: border-box; }
body { margin: 0; background: ${colors.background}; color: ${colors.text};
  font: 17px/1.65 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  -webkit-text-size-adjust: 100%; }
a { color: ${colors.accent}; }
a:focus-visible, button:focus-visible, input:focus-visible {
  outline: 2px solid ${colors.accent}; outline-offset: 2px; }
.wrap { max-width: 46rem; margin: 0 auto; padding: 2.5rem 1rem 4rem; }
.crumbs { font-size: 13px; color: ${colors.muted}; margin-bottom: 1.25rem; }
.crumbs a { color: ${colors.textSoft}; text-decoration: none; }
article { background: ${colors.surface}; border: 1px solid ${colors.border};
  border-radius: 16px; padding: 2rem 1.5rem; }
h1 { font-size: 36px; line-height: 1.15; letter-spacing: -0.02em; margin: 0 0 0.75rem; }
h2 { font-size: 24px; line-height: 1.25; margin: 2rem 0 0.5rem; }
h3 { font-size: 18px; margin: 1.5rem 0 0.4rem; }
h4 { font-size: 15px; margin: 1.25rem 0 0.3rem; }
p, li { overflow-wrap: anywhere; }
code, pre { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 0.9em; }
pre { background: ${colors.surfaceMuted}; border-radius: 8px; padding: 0.9rem 1rem; overflow-x: auto; }
blockquote { margin: 1rem 0; padding: 0.2rem 0 0.2rem 1rem; border-left: 3px solid ${colors.border}; color: ${colors.textSoft}; }
blockquote.c { border-left-color: ${colors.accent}; background: ${colors.surfaceMuted}; color: inherit; border-radius: 4px; padding: 0.6rem 1rem; }
.m { font-style: italic; }
.math { margin: 1rem 0; overflow-x: auto; text-align: center; }
math { font-size: 1.1em; }
li.t { list-style: none; margin-left: -1.2rem; }
mark { background: ${colors.highBg}; color: inherit; padding: 0 0.1em; }
mark.green { background: ${colors.accentSoft}; }
mark.rose { background: ${colors.dangerSoft}; }
table { border-collapse: collapse; margin: 1rem 0; display: block; overflow-x: auto; }
th, td { border: 1px solid ${colors.border}; padding: 0.35rem 0.65rem; }
figure { margin: 1rem 0; } img { max-width: 100%; height: auto; border-radius: 8px; }
figcaption { font-size: 13px; color: ${colors.muted}; }
ol.fn { font-size: 0.9em; color: ${colors.textSoft}; }
hr { border: none; border-top: 1px solid ${colors.border}; margin: 2rem 0; }
.meta { font-size: 13px; color: ${colors.muted}; margin: 0 0 1.5rem; }
.box { background: ${colors.surface}; border: 1px solid ${colors.border}; border-radius: 12px;
  padding: 1rem 1.25rem; margin-top: 1.25rem; }
.box h2 { font-size: 15px; margin: 0 0 0.5rem; color: ${colors.textSoft}; }
.box ul { margin: 0; padding-left: 1.1rem; }
.box li { margin: 0.2rem 0; }
.box li.here { font-weight: 600; }
.pages { list-style: none; padding: 0; margin: 0; }
.pages li { border-top: 1px solid ${colors.divider}; }
.pages li:first-child { border-top: none; }
.pages a { display: block; padding: 0.8rem 0; text-decoration: none; color: ${colors.text}; }
.pages small { display: block; color: ${colors.muted}; }
footer { margin-top: 2rem; font-size: 13px; color: ${colors.muted}; text-align: center; }
form.lock { display: flex; flex-direction: column; gap: 0.75rem; max-width: 22rem; }
form.lock input { font: inherit; padding: 0.6rem 0.8rem; border: 1px solid ${colors.border};
  border-radius: 8px; background: ${colors.surface}; color: ${colors.text}; }
form.lock button { font: inherit; padding: 0.6rem 0.8rem; border: none; border-radius: 8px;
  background: ${colors.accent}; color: ${colors.white}; cursor: pointer; }
.error { color: ${colors.danger}; margin: 0; }
@media (max-width: 600px) {
  .wrap { padding: 1.25rem 1rem 3rem; }
  article { padding: 1.25rem 1rem; border-radius: 12px; }
  h1 { font-size: 24px; }
  h2 { font-size: 18px; }
}
`;

type Head = {
  title: string;
  description: string;
  /** The address this page is read at, whole, for the card. */
  url: string;
  image: string | null;
  noindex: boolean;
};

function head(h: Head) {
  const robots = h.noindex
    ? `<meta name="robots" content="noindex, nofollow">`
    : `<meta name="robots" content="index, follow">`;
  const tags = [
    `<meta charset="utf-8">`,
    `<meta name="viewport" content="width=device-width, initial-scale=1">`,
    `<title>${esc(h.title)}</title>`,
    robots,
    `<meta name="referrer" content="strict-origin-when-cross-origin">`,
    h.description
      ? `<meta name="description" content="${esc(h.description)}">`
      : "",
    `<meta property="og:type" content="article">`,
    `<meta property="og:site_name" content="Orbyn">`,
    `<meta property="og:title" content="${esc(h.title)}">`,
    h.description
      ? `<meta property="og:description" content="${esc(h.description)}">`
      : "",
    `<meta property="og:url" content="${esc(h.url)}">`,
    h.image ? `<meta property="og:image" content="${esc(h.image)}">` : "",
    `<meta name="twitter:card" content="${h.image ? "summary_large_image" : "summary"}">`,
    `<link rel="canonical" href="${esc(h.url)}">`,
    `<style>${STYLE}</style>`,
  ];
  return tags.filter(Boolean).join("\n");
}

const page = (h: Head, body: string) => `<!doctype html>
<html lang="en">
<head>
${head(h)}
</head>
<body>
<div class="wrap">
${body}
<footer>Published with Orbyn</footer>
</div>
</body>
</html>
`;

export type PublishedPageView = {
  title: string;
  /** The page's lines as HTML (`blocksHtml` with headings anchored). */
  bodyHtml: string;
  description: string;
  url: string;
  image: string | null;
  noindex: boolean;
  updatedAt: string;
  contents: OutlineEntry[];
  /** Published pages that link here. */
  linkedHere: { title: string; href: string }[];
  /** The published folder it is read in, with its other pages. */
  folder: {
    name: string;
    href: string;
    pages: { title: string; href: string; here: boolean }[];
  } | null;
};

const updated = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(iso));

/** A published page as a whole web page. */
export function publishedPageHtml(v: PublishedPageView): string {
  const crumbs = v.folder
    ? `<nav class="crumbs" aria-label="Where this is"><a href="${esc(v.folder.href)}">${esc(v.folder.name)}</a></nav>`
    : "";
  const contents =
    v.contents.length >= 3
      ? `<nav class="box" aria-label="Contents"><h2>Contents</h2><ul>${v.contents
          .map(
            (e) =>
              `<li style="margin-left:${(e.level - 1) * 0.9}rem"><a href="#h-${e.index}">${esc(e.text)}</a></li>`,
          )
          .join("")}</ul></nav>`
      : "";
  const linked = v.linkedHere.length
    ? `<section class="box" aria-label="Linked here"><h2>Linked here</h2><ul>${v.linkedHere
        .map((l) => `<li><a href="${esc(l.href)}">${esc(l.title)}</a></li>`)
        .join("")}</ul></section>`
    : "";
  const siblings =
    v.folder && v.folder.pages.length > 1
      ? `<nav class="box" aria-label="${esc(v.folder.name)}"><h2>In ${esc(v.folder.name)}</h2><ul>${v.folder.pages
          .map((p) =>
            p.here
              ? `<li class="here" aria-current="page">${esc(p.title)}</li>`
              : `<li><a href="${esc(p.href)}">${esc(p.title)}</a></li>`,
          )
          .join("")}</ul></nav>`
      : "";
  return page(
    {
      title: v.title || "Untitled",
      description: v.description,
      url: v.url,
      image: v.image,
      noindex: v.noindex,
    },
    `${crumbs}
<article>
<h1>${esc(v.title || "Untitled")}</h1>
<p class="meta">Updated ${esc(updated(v.updatedAt))}</p>
${contents}
${v.bodyHtml}
</article>
${linked}
${siblings}`,
  );
}

/** A published folder's own page: its pages, newest first. */
export function publishedFolderHtml(v: {
  name: string;
  description: string;
  url: string;
  noindex: boolean;
  pages: { title: string; href: string; description: string }[];
}): string {
  const list = v.pages.length
    ? `<ul class="pages">${v.pages
        .map(
          (p) =>
            `<li><a href="${esc(p.href)}">${esc(p.title || "Untitled")}${
              p.description ? `<small>${esc(p.description)}</small>` : ""
            }</a></li>`,
        )
        .join("")}</ul>`
    : `<p class="meta">Nothing here yet.</p>`;
  return page(
    {
      title: v.name,
      description: v.description,
      url: v.url,
      image: null,
      noindex: v.noindex,
    },
    `<article>
<h1>${esc(v.name)}</h1>
${v.description ? `<p class="meta">${esc(v.description)}</p>` : ""}
${list}
</article>`,
  );
}

/** Asked for a password before a page or folder shows. */
export function publishedLockHtml(v: {
  title: string;
  action: string;
  wrong: boolean;
}): string {
  return page(
    {
      title: v.title,
      description: "",
      url: v.action,
      image: null,
      noindex: true,
    },
    `<article>
<h1>${esc(v.title)}</h1>
<p class="meta">This page needs a password.</p>
<form class="lock" method="post" action="${esc(v.action)}">
<label for="pw">Password</label>
<input id="pw" name="password" type="password" autocomplete="current-password" required autofocus>
${v.wrong ? `<p class="error" role="alert">That password isn't right.</p>` : ""}
<button type="submit">Open</button>
</form>
</article>`,
  );
}

/** Not published (or no longer): the same answer either way. */
export const publishedMissingHtml = () =>
  page(
    {
      title: "Not published",
      description: "",
      url: "/",
      image: null,
      noindex: true,
    },
    `<article>
<h1>Not here</h1>
<p>This page isn't published, or it was taken off the web.</p>
</article>`,
  );
