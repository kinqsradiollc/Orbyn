import {
  AGENT_PROFILE_TEMPLATE,
  AGENT_PROFILE_TITLE,
  agentInstructionsInput,
  docLines,
  learningProfileOf,
  newBlockId,
  parseDoc,
  type AgentContextSettings,
  type AgentInstructions,
  type AgentInstructionsInput,
  type DocBlock,
  type LearningProfile,
} from "@orbyn/core";
import type { Db, Queryable } from "../../db/pool.js";
import { audit } from "../../lib/audit.js";
import type { UserRow } from "../../lib/auth.js";
import { requireTeam } from "../../lib/teams.js";
import { Params, visibleDocs } from "../../lib/visibility.js";
import { createDoc } from "../docs/service.js";

/**
 * Agents start warm (H8): the person's "About me for agents" page and each
 * space's instructions, for Settings → Connected agents, get_context and
 * the study tools. The page is a private Memory note; agent_profiles only
 * remembers which one it is. Standing rules stay in agent_rules (H0),
 * linked from the page.
 */

export type ProfileDoc = {
  id: string;
  title: string;
  version: number;
  content: DocBlock[];
  updated_at: Date;
};

/**
 * The person's profile note, when there is one in Personal. `forAgents`
 * also leaves it out when it is in a project kept out of the assistant.
 */
export async function profileDoc(
  db: Queryable,
  userId: string,
  forAgents = false,
): Promise<ProfileDoc | null> {
  const p = new Params();
  const scope = { user: p.add(userId), ai: forAgents };
  return (
    (
      await db.query<ProfileDoc>(
        `SELECT d.id, d.title, d.version, d.content, d.updated_at
           FROM agent_profiles a JOIN docs d ON d.id = a.doc_id
          WHERE a.user_id = ${scope.user} AND d.team_id IS NULL
            AND ${visibleDocs("d", scope)}`,
        p.values,
      )
    ).rows[0] ?? null
  );
}

/** Blocks of Markdown, each line with an id. */
const blocksOf = (markdown: string): DocBlock[] =>
  parseDoc(markdown).map((b) => (b.id ? b : { ...b, id: newBlockId() }));

/**
 * The person's profile page, made (from `content`, or Orbyn's starting
 * page) when there isn't one. One per person, whoever asks first.
 */
export async function ensureProfile(
  db: Db,
  u: UserRow,
  content?: DocBlock[],
): Promise<{ doc: ProfileDoc; created: boolean }> {
  await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
    `agent_profile:${u.id}`,
  ]);
  const had = await profileDoc(db, u.id);
  if (had) return { doc: had, created: false };
  const made = await createDoc(db, u, {
    title: AGENT_PROFILE_TITLE,
    kind: "memory",
    team_id: null,
    item_id: null,
    content: content ?? blocksOf(AGENT_PROFILE_TEMPLATE),
    folder_id: null,
    project_id: null,
    tags: [],
  });
  await db.query(
    `INSERT INTO agent_profiles (user_id, doc_id) VALUES ($1, $2)
     ON CONFLICT (user_id) DO UPDATE SET doc_id = EXCLUDED.doc_id, created_at = now()`,
    [u.id, made.id],
  );
  return { doc: (await profileDoc(db, u.id))!, created: true };
}

/** The profile page's words: Orbyn Markdown, with anchors when asked. */
export const profileMarkdown = (doc: ProfileDoc, anchors: boolean) =>
  docLines(Array.isArray(doc.content) ? doc.content : [], { anchors }).join(
    "\n\n",
  );

/**
 * What the person's profile says about how they learn, for quizzes,
 * revision plans and prompts; null without a page (or one kept out of
 * agents' reach).
 */
export async function learningFor(
  db: Queryable,
  userId: string,
): Promise<LearningProfile | null> {
  const doc = await profileDoc(db, userId, true);
  return doc ? learningProfileOf(profileMarkdown(doc, false)) : null;
}

// --- Instructions per space ------------------------------------------------

type InstructionRow = {
  team_id: string | null;
  space: string;
  text: string | null;
  role: string | null;
  updated_at: Date | null;
  updated_by: string | null;
  updated_via: string | null;
};

/** Personal's and every team's instructions the person is in. */
export async function listInstructions(
  db: Queryable,
  userId: string,
): Promise<AgentInstructions[]> {
  const rows = (
    await db.query<InstructionRow>(
      `SELECT NULL::uuid AS team_id, 'Personal' AS space, i.text, 'owner' AS role,
              i.updated_at, who.name AS updated_by, g.name AS updated_via
         FROM (SELECT 1) one
         LEFT JOIN agent_instructions i ON i.user_id = $1
         LEFT JOIN users who ON who.id = i.updated_by
         LEFT JOIN agent_grants g ON g.id = i.updated_via
       UNION ALL
       SELECT t.id, t.name, i.text, m.role, i.updated_at, who.name, g.name
         FROM team_members m JOIN teams t ON t.id = m.team_id
         LEFT JOIN agent_instructions i ON i.team_id = t.id
         LEFT JOIN users who ON who.id = i.updated_by
         LEFT JOIN agent_grants g ON g.id = i.updated_via
        WHERE m.user_id = $1`,
      [userId],
    )
  ).rows;
  return rows
    .map((r) => ({
      team_id: r.team_id,
      space: r.space,
      text: r.text ?? "",
      can_edit: r.role !== "viewer",
      updated_at: r.updated_at?.toISOString() ?? null,
      updated_by: r.updated_by,
      updated_via: r.updated_via,
    }))
    .sort(
      (a, b) =>
        Number(a.team_id !== null) - Number(b.team_id !== null) ||
        a.space.localeCompare(b.space),
    );
}

/**
 * The instructions an agent sees: Personal's when it reaches Personal, and
 * those of the teams it reaches (the caller passes them), non-empty only.
 */
export async function instructionsFor(
  db: Queryable,
  userId: string,
  personal: boolean,
  teamIds: string[],
): Promise<{ team_id: string | null; text: string }[]> {
  return (
    await db.query<{ team_id: string | null; text: string }>(
      `SELECT i.team_id, i.text FROM agent_instructions i
        WHERE i.text <> ''
          AND ((i.user_id = $1 AND $2::boolean)
               OR (i.team_id = ANY ($3::uuid[]) AND EXISTS (
                     SELECT 1 FROM team_members m
                      WHERE m.team_id = i.team_id AND m.user_id = $1)))
        ORDER BY i.team_id NULLS FIRST`,
      [userId, personal, teamIds],
    )
  ).rows;
}

/**
 * Change one space's instructions (Personal's, or a team's by a member
 * who can change the team's work); what they said before.
 */
export async function setInstructions(
  db: Db,
  u: UserRow,
  teamId: string | null,
  input: AgentInstructionsInput,
  via: string | null = null,
  requestId?: string,
): Promise<{ was: string; team: string | null }> {
  const d = agentInstructionsInput.parse(input);
  let team: string | null = null;
  if (teamId) team = (await requireTeam(teamId, u, "items:write", db)).name;
  const where = teamId ? "team_id = $1" : "user_id = $1";
  const was =
    (
      await db.query<{ text: string }>(
        `SELECT text FROM agent_instructions WHERE ${where} FOR UPDATE`,
        [teamId ?? u.id],
      )
    ).rows[0]?.text ?? "";
  await db.query(
    `INSERT INTO agent_instructions (${teamId ? "team_id" : "user_id"}, text, updated_by, updated_via)
     VALUES ($1, $2, $3, coalesce($4::uuid, (SELECT g.id FROM agent_grants g
               WHERE g.id = nullif(current_setting('orbyn.agent_grant', true), '')::uuid)))
     ON CONFLICT (${teamId ? "team_id" : "user_id"}) WHERE ${teamId ? "team_id" : "user_id"} IS NOT NULL
     DO UPDATE SET text = EXCLUDED.text, updated_by = EXCLUDED.updated_by,
       updated_via = EXCLUDED.updated_via, updated_at = now()`,
    [teamId ?? u.id, d.text, u.id, via],
  );
  await audit(
    {
      actorId: u.id,
      action: "agent_instructions.set",
      targetType: teamId ? "team" : "user",
      targetId: teamId ?? u.id,
      details: { length: d.text.length, ...(via ? { grant_id: via } : {}) },
      requestId,
    },
    db,
  );
  return { was, team };
}

/** Settings → Connected agents: the profile page and every space's instructions. */
export async function contextSettings(
  db: Queryable,
  userId: string,
): Promise<AgentContextSettings> {
  const doc = await profileDoc(db, userId);
  return {
    profile: doc
      ? {
          doc_id: doc.id,
          title: doc.title,
          updated_at: doc.updated_at.toISOString(),
        }
      : null,
    instructions: await listInstructions(db, userId),
  };
}
