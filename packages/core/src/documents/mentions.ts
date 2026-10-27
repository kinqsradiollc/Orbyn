/**
 * @mentions in pages. Writing "@" in a line and picking a person puts a link
 * to them into the line's Markdown: `[@Anna Lee](/app/person/<id>)`. It is
 * an ordinary Markdown link, so a page still exports and reads anywhere,
 * and a relative path, never an `orbyn:` address (that scheme belongs to the
 * phone app's own links). Only people who can already open the page are
 * offered, recorded or told.
 */

/** The path a mention links to. */
export const PERSON_PATH = "/app/person/";

const PERSON_LINK =
  /^\/app\/person\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/** The person a link names, or null when it isn't a mention. */
export function mentionedPerson(
  link: string | null | undefined,
): string | null {
  const m = link ? PERSON_LINK.exec(link) : null;
  return m ? m[1].toLowerCase() : null;
}

/** A mention of `name` as it is written into a line. */
export function mentionMarkdown(person: { id: string; name: string }): string {
  // Brackets and newlines would end the link early.
  const name = person.name.replace(/[[\]\n\r()]/g, " ").trim() || "someone";
  return `[@${name}](${PERSON_PATH}${person.id.toLowerCase()})`;
}

/** Everyone a line of Markdown names, by id, in order, once each. */
export function mentionsIn(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/\]\((\/app\/person\/[0-9a-f-]{36})\)/gi)) {
    const id = mentionedPerson(m[1]);
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

/**
 * The "@word" being typed just before the caret, for the people picker, or
 * null. The "@" must start the line or follow a space, so an email address
 * isn't taken for a mention.
 */
export function mentionQuery(
  text: string,
  caret: number,
): { from: number; query: string } | null {
  const before = text.slice(0, caret);
  const at = before.lastIndexOf("@");
  if (at === -1) return null;
  if (at > 0 && !/\s/.test(before[at - 1])) return null;
  const query = before.slice(at + 1);
  if (/[\s[\]()]/.test(query) || query.length > 30) return null;
  return { from: at, query };
}

/** A page that names you, as "Mentioned in" lists it. */
export type PageMention = {
  doc_id: string;
  title: string;
  block_id: string;
  /** The line around the mention, as plain words. */
  quote: string;
  mentioned_by: string | null;
  project_id: string | null;
  created_at: string;
};
