import type { Queryable } from "../db/pool.js";
import { assistantSourceVisible } from "../lib/assistant-source-visibility.js";
import { assistantProposalSourcesVisible } from "../lib/assistant-proposal-visibility.js";
import {
  visibleOwned,
  visibleDocs,
  visibleItems,
  visibleProjects,
} from "../lib/visibility.js";
import type { Principal } from "./policy.js";
import { parseRef } from "./refs.js";
import { CapabilityError } from "./registry.js";
import type { Recorded } from "./write.js";

const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const referenceKeys = new Set([
  "id",
  "uri",
  "url",
  "app_url",
  "source",
  "source_ref",
  "page",
  "proposal_id",
  "question_id",
]);

function target(raw: string) {
  const parsed = parseRef(raw);
  if (parsed.type !== "title" && parsed.type !== "any")
    return {
      kind: parsed.type === "event" ? "task" : parsed.type,
      id: parsed.id,
    };
  const match = /^([a-z_]+):(.+)$/.exec(raw);
  if (!match) return { kind: "unknown", id: raw };
  return { kind: match[1], id: match[2] };
}

/** Targets and structured result links are authority evidence, never parsed from prose. */
export function assistantReplayReferences(answer: Recorded) {
  const found = new Map<string, ReturnType<typeof target>>();
  const add = (ref: string) => {
    const t = target(ref);
    found.set(`${t.kind}:${t.id}`, t);
  };
  for (const ref of answer.targets ?? []) add(ref);
  const visit = (value: unknown, depth = 0) => {
    if (depth > 24)
      throw new CapabilityError(
        "FORBIDDEN",
        "The cached result was held because its references exceed the supported limit.",
      );
    if (Array.isArray(value)) {
      value.forEach((v) => visit(v, depth + 1));
      return;
    }
    if (!value || typeof value !== "object") return;
    for (const [key, entry] of Object.entries(value)) {
      if (referenceKeys.has(key) && typeof entry === "string") {
        const t = target(entry);
        // Step IDs and ordinary labels are not resource identities.
        if (
          t.kind !== "unknown" &&
          (uuid.test(t.id) ||
            [
              "exam",
              "focus",
              "settings",
              "instructions",
              "inbox",
              "change",
            ].includes(t.kind))
        )
          add(entry);
      }
      if (entry && typeof entry === "object") visit(entry, depth + 1);
    }
  };
  visit(answer.structured);
  visit(answer.links);
  if (found.size > 1000)
    throw new CapabilityError(
      "FORBIDDEN",
      "The cached result was held because it has too many references.",
    );
  return [...found.values()];
}

/** Every supported receipt family must remain readable in the current effective scope. */
export async function assertAssistantReplayTargets(
  db: Queryable,
  p: Principal,
  answer: Recorded,
) {
  if (p.via !== "assistant") return;
  const refs = assistantReplayReferences(answer);
  if (!refs.length) return;
  const scope = { user: "$1", teams: "$2", personal: p.personal, ai: true };
  const user = scope.user;
  const personal = p.personal ? "true" : "false";
  const id = "r.uuid";
  const source = (kind: string) =>
    assistantSourceVisible(`'${kind}'`, id, user, false, scope);
  const owned = (table: string, owner = "user_id") =>
    `EXISTS(SELECT 1 FROM ${table} x WHERE x.id=${id} AND ${visibleOwned("x", owner, scope)})`;
  const own = (table: string) =>
    `EXISTS(SELECT 1 FROM ${table} x WHERE x.id=${id} AND x.user_id=${user} AND ${personal})`;
  const doc = (value: string) =>
    `EXISTS(SELECT 1 FROM docs replay_doc WHERE replay_doc.id=${value} AND ${visibleDocs("replay_doc", scope)})`;
  const item = (value: string) =>
    `EXISTS(SELECT 1 FROM items replay_item WHERE replay_item.id=${value} AND ${visibleItems("replay_item", scope)})`;
  const project = (value: string) =>
    `EXISTS(SELECT 1 FROM projects replay_project WHERE replay_project.id=${value} AND ${visibleProjects("replay_project", scope)})`;
  const team = (value: string) =>
    `EXISTS(SELECT 1 FROM team_members replay_member WHERE replay_member.team_id=${value} AND replay_member.user_id=${user} AND replay_member.team_id=ANY($2::uuid[]))`;
  const teamIds = "$2";
  const condition = (kind: string): string => {
    switch (kind) {
      case "task":
        return `${source("task")}`;
      case "event":
        return `${source("task")}`;
      case "doc":
        return `${source("doc")}`;
      case "project":
        return `${source("project")}`;
      case "record":
        return `${source("record")}`;
      case "goal":
        return `${source("goal")}`;
      case "routine":
        return `${source("routine")}`;
      case "habit":
        return `${source("habit")}`;
      case "calendar":
        return `${source("calendar")}`;
      case "team":
        return `${source("team")}`;
      case "template":
        return `${owned("project_templates")}`;
      case "page_template":
        return `${owned("page_templates")}`;
      case "view":
        return `${owned("saved_views")}`;
      case "folder":
        return `${owned("folders")}`;
      case "list":
        return `${owned("lists")}`;
      case "tag":
        return `${owned("tags")}`;
      case "field":
        return `${owned("custom_fields")}`;
      case "source":
        return `${owned("sources")}`;
      case "frame":
        return `${own("frames")}`;
      case "place":
        return `${own("places")}`;
      case "card":
        return `EXISTS(SELECT 1 FROM study_cards x WHERE x.id=${id} AND x.user_id=${user} AND ${personal} AND ${doc("x.doc_id")})`;
      case "exam":
        return `EXISTS(SELECT 1 FROM study_exams x WHERE x.user_id=${user} AND (x.exam_key=r.id OR x.id=${id}) AND ${assistantSourceVisible("'exam'", "x.id", user, false, scope)})`;
      case "focus":
        return `CASE WHEN r.id='current' THEN ${personal} AND NOT EXISTS(SELECT 1 FROM focus_current x WHERE x.user_id=${user} AND x.state->>'item_id' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM items replay_item WHERE replay_item.id::text=x.state->>'item_id' AND ${visibleItems("replay_item", scope)}))
         ELSE EXISTS(SELECT 1 FROM focus_sessions x WHERE x.id=${id} AND x.user_id=${user} AND ${personal} AND (x.item_id IS NULL OR ${item("x.item_id")})) END`;
      case "settings":
        return `${personal} AND r.id IN ('planner','originals','agent')`;
      case "instructions":
        return `CASE WHEN r.id='personal' THEN ${personal} ELSE ${team(id)} END`;
      case "booking":
        return `EXISTS(SELECT 1 FROM bookings x JOIN booking_pages bp ON bp.id=x.page_id WHERE x.id=${id} AND ${personal} AND (bp.owner_id=${user} OR EXISTS(SELECT 1 FROM booking_hosts h WHERE h.page_id=bp.id AND h.user_id=${user})) AND NOT EXISTS(SELECT 1 FROM unnest(x.item_ids) item_id WHERE NOT ${item("item_id")}))`;
      case "import":
        return `EXISTS(SELECT 1 FROM imports x WHERE x.id=${id} AND x.user_id=${user} AND (${personal} OR x.project_team_id=ANY(${teamIds}::uuid[])) AND (x.project_id IS NULL OR ${project("x.project_id")}) AND (x.doc_id IS NULL OR ${doc("x.doc_id")}))`;
      case "draft":
        return `EXISTS(SELECT 1 FROM agent_doc_drafts x WHERE x.id=${id} AND x.user_id=${user} AND x.grant_id=$4 AND (CASE WHEN x.target->>'team_id' IS NULL THEN ${personal} ELSE x.target->>'team_id'=ANY(${teamIds}::text[]) END) AND (x.target->>'project_id' IS NULL OR EXISTS(SELECT 1 FROM projects replay_project WHERE replay_project.id::text=x.target->>'project_id' AND ${visibleProjects("replay_project", scope)})) AND (x.target->>'item_id' IS NULL OR EXISTS(SELECT 1 FROM items replay_item WHERE replay_item.id::text=x.target->>'item_id' AND ${visibleItems("replay_item", scope)})))`;
      case "question":
        return `EXISTS(SELECT 1 FROM agent_questions x WHERE x.id=${id} AND x.user_id=${user} AND x.grant_id=$4)`;
      case "inbox":
        return `EXISTS(SELECT 1 FROM agent_inbox x WHERE x.id::text=r.id AND x.user_id=${user} AND x.grant_id=$4 AND ${visibleOwned("x", "user_id", scope)} AND (x.project_id IS NULL OR ${project("x.project_id")}))`;
      case "change":
        return `EXISTS(SELECT 1 FROM agent_activity x WHERE x.id::text=r.id AND x.user_id=${user} AND x.grant_id=$4 AND ${visibleOwned("x", "user_id", scope)})`;
      case "proposal":
        return `EXISTS(SELECT 1 FROM proposals x WHERE x.id=${id} AND x.user_id=${user} AND x.grant_id=$4 AND (${personal} OR (cardinality(x.team_ids)>0 AND x.team_ids <@ ${teamIds}::uuid[])) AND ${assistantProposalSourcesVisible("x", user, scope)})`;
      default:
        return "false";
    }
  };
  const groups = new Map<string, typeof refs>();
  for (const ref of refs) {
    const group = groups.get(ref.kind) ?? [];
    group.push(ref);
    groups.set(ref.kind, group);
  }
  for (const [kind, group] of groups) {
    const row = (
      await db.query<{ visible: boolean }>(
        `
      WITH refs AS (SELECT id,CASE WHEN id ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' THEN id::uuid END AS uuid
        FROM jsonb_to_recordset($3::jsonb) AS target(id text))
      SELECT bool_and(coalesce(${condition(kind)},false))
        AND EXISTS(SELECT 1 FROM agent_grants live JOIN users owner ON owner.id=live.user_id
          WHERE live.id=$4 AND live.user_id=$1 AND NOT owner.disabled AND live.kind='assistant'
            AND live.revoked_at IS NULL AND live.suspended_at IS NULL
            AND (live.expires_at IS NULL OR live.expires_at>now()))
        AND NOT EXISTS(SELECT 1 FROM unnest($2::uuid[]) bound_team
          WHERE NOT EXISTS(SELECT 1 FROM team_members member JOIN teams team ON team.id=member.team_id
            WHERE member.user_id=$1 AND member.team_id=bound_team AND team.agent_access<>'off'))
        AS visible FROM refs r`,
        [
          p.user.id,
          p.teams.map((t) => t.id),
          JSON.stringify(group),
          p.grant_id,
        ],
      )
    ).rows[0];
    if (!row?.visible)
      throw new CapabilityError(
        "FORBIDDEN",
        "A target is no longer available to this assistant. The cached result was held.",
        "Read the current work or ask the person to review it. Do not repeat the change with a new client_ref.",
      );
  }
}
