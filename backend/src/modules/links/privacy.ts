import {
  objectRefsInValue,
  redactLine,
  redactValue,
  targetKey,
  type ObjectRef,
  type RedactedLine,
} from "@orbyn/core";
import type { Queryable } from "../../db/pool.js";
import { inSpaces, type Spaces } from "../../lib/visibility.js";
import { resolveLinks } from "./service.js";

/**
 * Link words a reader may see (D3aF).
 *
 * A picker link keeps, in its brackets, the title its target had when the
 * link was made. Stored pages keep those words, so the people who can open
 * the target still read its title; everything that shows a page's words to
 * someone else goes through here first, and the words of each link to a
 * thing that reader can't open become "Private page", "Private task" or
 * "Private project". Pages, exports, "Linked here" lines, search hits and
 * what the agents fetch all use this one rule: a target is hidden exactly
 * when its pill would say "not found" (resolveLinks' "missing"): gone for
 * good, or never the reader's to open. A page in the Trash that the reader
 * could open still shows its words, as its pill does.
 */
export type LinkPrivacy = {
  /** Whether the reader can't open what `ref` points to. */
  hidden(ref: ObjectRef): boolean;
  /** A value (page lines, a comment, a hit) with hidden links' words swapped. */
  value<T>(value: T): T;
  /** One line as the reader sees it, with places carried both ways. */
  line(text: string, references?: ReadonlyMap<string, string>): RedactedLine;
};

const NOTHING_HIDDEN: LinkPrivacy = {
  hidden: () => false,
  value: (v) => v,
  line: (text) => redactLine(text, () => false),
};

/**
 * Who is reading: a person (their id), an agent connection that reaches
 * only some of its person's spaces, or nobody signed in (null).
 */
export type LinkReader = string | Spaces | null;

/**
 * What `who` may read of the links in `values` (any mix of page lines,
 * strings and rows). One look-up for every target they name; nothing is
 * read when they name none. An agent connection also can't read what lies
 * outside the spaces it was given. Nobody signed in (a published page's
 * visitor) can open nothing, so every link's words are hidden; publishing
 * uses {@link privacyFrom} with its own rule instead.
 */
export async function linkPrivacy(
  db: Queryable,
  who: LinkReader,
  ...values: unknown[]
): Promise<LinkPrivacy> {
  const refs = objectRefsInValue(values).filter((r) => r.kind !== "date");
  if (!refs.length) return NOTHING_HIDDEN;
  if (!who) return privacyFrom(() => true);
  const userId = typeof who === "string" ? who : who.userId;
  const pills = await resolveLinks(db, userId, refs);
  const hidden = new Set(
    pills.filter((p) => p.state === "missing").map((p) => targetKey(p)),
  );
  if (typeof who !== "string" && (who.teamIds !== null || !who.personal))
    for (const key of await outsideSpaces(db, who, refs)) hidden.add(key);
  if (!hidden.size) return NOTHING_HIDDEN;
  return privacyFrom((ref) => hidden.has(targetKey(ref)));
}

/** The targets whose space an agent connection wasn't given. */
async function outsideSpaces(
  db: Queryable,
  spaces: Spaces,
  refs: ObjectRef[],
): Promise<string[]> {
  const ids = (kinds: string[]) =>
    refs.filter((r) => kinds.includes(r.kind)).map((r) => r.id);
  const rows = (
    await db.query<{ kind: string; id: string; team_id: string | null }>(
      `SELECT 'doc' AS kind, id::text, team_id FROM docs WHERE id = ANY ($1::uuid[])
       UNION ALL
       SELECT 'task', id::text, team_id FROM items WHERE id = ANY ($2::uuid[])
       UNION ALL
       SELECT 'project', id::text, team_id FROM projects WHERE id = ANY ($3::uuid[])`,
      [ids(["doc"]), ids(["task", "event"]), ids(["project"])],
    )
  ).rows;
  const out = rows
    .filter((r) => !inSpaces(spaces, r.team_id))
    .map((r) => `${r.kind}:${r.id}`);
  // A person is someone the connection's person shares a team with; one
  // it can't reach through any of its spaces stays unnamed as well.
  if (spaces.teamIds !== null) {
    const people = ids(["person"]).filter((id) => id !== spaces.userId);
    if (people.length) {
      const seen = new Set(
        (
          await db.query<{ id: string }>(
            `SELECT DISTINCT m.user_id::text AS id FROM team_members m
              WHERE m.user_id = ANY ($1::uuid[])
                AND m.team_id = ANY ($2::uuid[])`,
            [people, spaces.teamIds],
          )
        ).rows.map((r) => r.id),
      );
      for (const id of people) if (!seen.has(id)) out.push(`person:${id}`);
    }
  }
  return out;
}

/** The rule as a {@link LinkPrivacy}; a date is never hidden. */
export function privacyFrom(
  isHidden: (ref: ObjectRef) => boolean,
): LinkPrivacy {
  const hidden = (ref: ObjectRef) => ref.kind !== "date" && isHidden(ref);
  return {
    hidden,
    value: (v) => redactValue(v, hidden),
    line: (text, references) => redactLine(text, hidden, references),
  };
}

/** A value as `userId` may read it: {@link linkPrivacy} in one call. */
export async function readableLinks<T>(
  db: Queryable,
  who: LinkReader,
  value: T,
): Promise<T> {
  return (await linkPrivacy(db, who, value)).value(value);
}
