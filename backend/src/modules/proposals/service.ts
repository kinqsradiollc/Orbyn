import type { FastifyRequest } from "fastify";
import {
  actionSchema,
  fail,
  isClosed,
  itemData,
  MAX_PROPOSAL_CHANGES,
  parseDoc,
  projectInput,
  proposerName,
  reviewChange,
  reviewPath,
  type ProposalSource,
  type AssistantProposalGuard,
  type ProposalStatus,
  type ReviewApplied,
  type ReviewChange,
  type ReviewDiff,
  type ReviewInbox,
  type ReviewItem,
  type ReviewRow,
} from "@orbyn/core";
import type { Db, Queryable } from "../../db/pool.js";
import { env } from "../../config/env.js";
import { actAs } from "../../lib/actor.js";
import { audit } from "../../lib/audit.js";
import { authenticate, isApiKeyRequest, type UserRow } from "../../lib/auth.js";
import { visibleItems } from "../../lib/visibility.js";
import { agentNameOf, handTaskToAgent } from "../items/agent.js";
import { loadPrefs } from "../planner/calendar.js";
import { addSession } from "../planner/blocks.js";
import { emitInbox } from "../agent-inbox/emit.js";
import { announceTo } from "../presence/live.js";
import {
  lockItem,
  mutate,
  recomputeProgress,
  requireItemAccess,
} from "../items/service.js";
import {
  createDoc,
  restoreDocVersion,
  saveDoc,
  trashDoc,
} from "../docs/service.js";
import { createProject, deleteProject } from "../projects/service.js";
import { applyProject } from "../ai/project-proposal.js";
import { assistantProposalSourcesVisible } from "../../lib/assistant-proposal-visibility.js";
import { checkAssistantProposalRules } from "../agents/assistant-rules.js";
import { applySessionChange } from "../ai/session-change.js";
import { linkDecision } from "../work-records/service.js";
import { actionStaleness, applyAction } from "./actions.js";
import { forgetMemory, rememberMemory } from "../memory/service.js";
import {
  readAgentRoutine,
  routineFields,
  saveAgentRoutine,
} from "../assistant-workspace/routines.js";
import { readGoal, saveGoal } from "../assistant-workspace/goals.js";

/** A signed-in person using one of Orbyn's own apps, or 401/403. */
export async function firstParty(r: FastifyRequest) {
  const u = await authenticate(r);
  if (isApiKeyRequest(r))
    fail(
      403,
      "Only you, signed in to Orbyn, can approve, decline or undo changes. Keys can't.",
    );
  return u;
}

/**
 * Proposals: changes waiting for a person's approval (the Review inbox).
 * The built-in assistant proposes as it always has (its actions, drafted
 * project, session change and decision links); outside agents propose
 * typed changes (packages/core/src/review.ts) when a change is risky,
 * reaches outside Orbyn, or their connection may only suggest.
 *
 * This is the one place a proposal is applied, for both. Applying re-runs
 * every change through the same services as the app (items, pages,
 * projects, sessions) as the person approving it, so their role and the
 * item's version are checked again at that moment. Each change is checked
 * for staleness first: one whose task, page or session changed since it was
 * proposed is refused rather than written over the newer state.
 *
 * Only a person signed in to Orbyn's own apps approves: the routes refuse
 * API keys, and agent credentials never reach them (lib/auth.ts).
 */

type Row = {
  id: string;
  user_id: string;
  source: ProposalSource;
  kind: "change" | "idea";
  grant_id: string | null;
  client_name: string;
  summary: string;
  status: Exclude<ProposalStatus, "expired">;
  applied: boolean;
  created_at: Date;
  expires_at: Date;
  decided_at: Date | null;
  changes: unknown[];
  actions: unknown[];
  project: Record<string, unknown> | null;
  session_change: Record<string, unknown> | null;
  decision_links: { action_index: number; decision_id: string }[] | null;
  applied_project_id: string | null;
  team_ids: string[];
  assistant_guard: unknown;
};

const SELECT = `SELECT id, user_id, source, kind, grant_id, client_name, summary, status,
  applied, created_at, expires_at, decided_at, changes, actions, project,
  session_change, decision_links, applied_project_id, team_ids, assistant_guard FROM proposals`;

/** The web app's link to a proposal. */
export const reviewUrl = (id: string) =>
  `${env.APP_URL.replace(/\/+$/, "")}${reviewPath(id)}`;

const statusOf = (row: Row, now = new Date()): ProposalStatus =>
  row.status === "pending" && row.expires_at <= now ? "expired" : row.status;

// --- Making one ----------------------------------------------------------

export type NewProposal = {
  userId: string;
  grantId: string | null;
  clientName: string;
  summary: string;
  changes: ReviewChange[];
  kind?: "change" | "idea";
  assistantGuard?: AssistantProposalGuard;
};

/**
 * File an agent's proposal: it waits 72 hours in the person's Review inbox,
 * with a notice in the app and on their phones. Returns its id and link.
 */
export async function createAgentProposal(
  db: Queryable,
  input: NewProposal,
): Promise<{ id: string; review_url: string; expires_at: string }> {
  if (!input.changes.length) fail(422, "A proposal needs at least one change.");
  if (input.changes.length > MAX_PROPOSAL_CHANGES)
    fail(422, `A proposal holds at most ${MAX_PROPOSAL_CHANGES} changes.`);
  const changes = input.changes.map((c) => reviewChange.parse(c));
  const guard = await checkAssistantProposalRules(
    db,
    input.userId,
    input.grantId,
    input.assistantGuard,
    true,
  );
  const teams = [
    ...new Set(
      changes.flatMap((c) =>
        "team_id" in c && c.team_id ? [c.team_id] : ([] as string[]),
      ),
    ),
  ];
  const row = (
    await db.query<{ id: string; expires_at: Date }>(
      `INSERT INTO proposals (user_id, actions, source, kind, grant_id, client_name,
         summary, changes, team_ids, assistant_guard)
       VALUES ($1, '[]'::jsonb, 'agent', $2, $3, $4, $5, $6::jsonb, $7::uuid[], $8::jsonb)
       RETURNING id, expires_at`,
      [
        input.userId,
        input.kind ?? "change",
        input.grantId,
        input.clientName.slice(0, 200),
        input.summary.slice(0, 500),
        JSON.stringify(changes),
        teams,
        guard === null ? null : JSON.stringify(guard),
      ],
    )
  ).rows[0];
  const who = input.clientName.trim() || "An outside agent";
  await noticeReview(db, input.userId, row.id, {
    title: `${who} suggests ${changes.length === 1 ? "a change" : `${changes.length} changes`}`,
    body: `${input.summary.slice(0, 300)} Review it in Orbyn before anything changes.`,
  });
  return {
    id: row.id,
    review_url: reviewUrl(row.id),
    expires_at: row.expires_at.toISOString(),
  };
}

/** A notice (in the app and on phones) that something waits for review. */
async function noticeReview(
  db: Queryable,
  userId: string,
  proposalId: string,
  n: { title: string; body: string },
) {
  await db.query(
    `INSERT INTO notifications (user_id, item_id, item_version, channel, destination,
       title, body, state, kind, ref)
     SELECT u.id, NULL, 0, c.channel, c.destination, $2, $3,
       CASE WHEN c.channel = 'inapp' THEN 'sent' ELSE 'pending' END, 'review', $4
     FROM users u
     CROSS JOIN LATERAL (
       SELECT 'inapp' AS channel, u.id::text AS destination
       UNION ALL SELECT 'push', d.token FROM devices d WHERE d.user_id = u.id
     ) c
     WHERE u.id = $1 AND NOT u.disabled
     ON CONFLICT DO NOTHING`,
    [
      userId,
      n.title.slice(0, 200),
      n.body.slice(0, 2000),
      `proposal:${proposalId}`,
    ],
  );
  await announceTo(db as never, { user_id: userId }, "changed", {
    area: "review",
  });
}

// --- Reading -------------------------------------------------------------

const FIELD_LABELS: Record<string, string> = {
  title: "Title",
  notes: "Notes",
  kind: "Kind",
  status: "Status",
  priority: "Priority",
  due_at: "Due",
  end_at: "Ends",
  all_day: "All day",
  estimate_minutes: "Estimate",
  progress: "Progress",
  team_id: "Space",
  project_id: "Project",
  stage_id: "Stage",
  assignee_id: "Assigned to",
  list_id: "List",
  tag_ids: "Tags",
  location: "Place",
  rrule: "Repeats",
  attendees: "Invited",
};

type Names = {
  tz: string;
  teams: Map<string, string>;
  people: Map<string, string>;
  projects: Map<string, string>;
  lists: Map<string, string>;
  /** The person's agent's chosen name, for tasks handed to it. */
  agentName: string;
};

/** Names for the ids a set of changes mentions, read once. */
async function namesFor(db: Queryable, userId: string, rows: Row[]) {
  const ids = new Set<string>();
  const walk = (v: unknown) => {
    if (typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v)) ids.add(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  for (const r of rows) {
    walk(r.changes);
    walk(r.actions);
  }
  const all = [...ids];
  const [prefs, teams, people, projects, lists, agentName] = await Promise.all([
    loadPrefs(db, userId),
    db.query<{ id: string; name: string }>(
      "SELECT id, name FROM teams WHERE id = ANY($1::uuid[])",
      [all],
    ),
    db.query<{ id: string; name: string }>(
      "SELECT id, name FROM users WHERE id = ANY($1::uuid[])",
      [all],
    ),
    db.query<{ id: string; name: string }>(
      "SELECT id, name FROM projects WHERE id = ANY($1::uuid[])",
      [all],
    ),
    db.query<{ id: string; name: string }>(
      "SELECT id, name FROM lists WHERE id = ANY($1::uuid[])",
      [all],
    ),
    agentNameOf(db, userId),
  ]);
  const map = (q: { rows: { id: string; name: string }[] }) =>
    new Map(q.rows.map((r) => [r.id, r.name]));
  return {
    tz: prefs.timezone,
    teams: map(teams),
    people: map(people),
    projects: map(projects),
    lists: map(lists),
    agentName,
  } satisfies Names;
}

const when = (value: string, tz: string) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  })
    .format(new Date(value))
    .replace(",", "");

/** A field's value in words. */
function shown(field: string, value: unknown, n: Names): string | null {
  if (value === null || value === undefined || value === "") return null;
  if ((field === "due_at" || field === "end_at") && typeof value === "string")
    return Number.isFinite(Date.parse(value)) ? when(value, n.tz) : value;
  if (field === "team_id") return n.teams.get(String(value)) ?? "a team";
  if (field === "assignee_id") return n.people.get(String(value)) ?? "someone";
  if (field === "project_id")
    return n.projects.get(String(value)) ?? "a project";
  if (field === "list_id") return n.lists.get(String(value)) ?? "a list";
  if (field === "estimate_minutes" && typeof value === "number")
    return value >= 60
      ? `${Math.floor(value / 60)} h${value % 60 ? ` ${value % 60} min` : ""}`
      : `${value} min`;
  if (field === "progress" && typeof value === "number") return `${value}%`;
  if (field === "attendees" && Array.isArray(value))
    return value
      .map((a) => (a as { email?: string }).email ?? "")
      .filter(Boolean)
      .join(", ");
  if (Array.isArray(value)) return `${value.length}`;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  const text = String(value);
  return text.length > 400 ? `${text.slice(0, 400)}…` : text;
}

const spaceOf = (teamId: string | null | undefined, n: Names) =>
  teamId ? (n.teams.get(teamId) ?? "A team") : "Personal";

/** Rows for a task's fields: every one given, as before and after. */
function fieldRows(
  after: Record<string, unknown>,
  before: Record<string, unknown> | null,
  n: Names,
): ReviewRow[] {
  return Object.keys(after)
    .filter((f) => FIELD_LABELS[f])
    .map((f) => ({
      label: FIELD_LABELS[f],
      before: before ? shown(f, before[f], n) : null,
      after: shown(f, after[f], n),
    }))
    .filter((r) => r.before !== r.after);
}

const quote = (t: string) => `“${t.trim() || "Untitled"}”`;

/** Why a change can't be applied as proposed any more, or null. */
export async function staleness(
  db: Queryable,
  userId: string,
  c: ReviewChange,
): Promise<string | null> {
  const item = async (id: string) =>
    (
      await db.query<{ version: number; status: string }>(
        `SELECT i.version, i.status FROM items i WHERE i.id = $2 AND ${visibleItems()}`,
        [userId, id],
      )
    ).rows[0];
  const doc = async (id: string) =>
    (
      await db.query<{ version: number; deleted: boolean }>(
        "SELECT version, deleted_at IS NOT NULL AS deleted FROM docs WHERE id = $1",
        [id],
      )
    ).rows[0];
  switch (c.type) {
    case "task.update":
    case "task.delete":
    case "task.complete": {
      const found = await item(c.item_id);
      if (!found) return "It's gone, or you can no longer see it.";
      if (found.version !== c.version)
        return "It changed since this was suggested.";
      return null;
    }
    case "checklist.edit": {
      const found = await item(c.item_id);
      return found ? null : "It's gone, or you can no longer see it.";
    }
    case "checklist.remove": {
      const step = (
        await db.query(
          "SELECT 1 FROM item_steps WHERE id = $1 AND item_id = $2",
          [c.step_id, c.item_id],
        )
      ).rowCount;
      return step ? null : "That step is already gone.";
    }
    case "doc.edit":
    case "doc.delete":
    case "doc.restore_version": {
      const found = await doc(c.doc_id);
      if (!found || found.deleted) return "The page is gone or in Trash.";
      if (found.version !== c.version)
        return "The page changed since this was suggested.";
      return null;
    }
    case "agent.update": {
      const found = (
        await db.query<{ updated_at: Date }>(
          "SELECT updated_at FROM agent_settings WHERE user_id = $1",
          [userId],
        )
      ).rows[0];
      const current = found?.updated_at.toISOString() ?? null;
      return current === c.before_updated_at
        ? null
        : "Your agent's name or persona changed since this was suggested.";
    }
    case "memory.remember":
      return null;
    case "routine.save": {
      if (!c.routine_id || !c.before) return null;
      const found = await readAgentRoutine(db, userId, c.routine_id);
      if (!found) return "That routine is gone.";
      const now = routineFields(found);
      const was = c.before;
      return now.instruction === was.instruction &&
        now.rrule === was.rrule &&
        now.timezone === was.timezone &&
        now.paused === was.paused
        ? null
        : "That routine changed since this was suggested.";
    }
    case "task.hand": {
      const row = (
        await db.query<{ status: string; agent_grant_id: string | null }>(
          `SELECT i.status, i.agent_grant_id FROM items i
            WHERE i.id = $2 AND ${visibleItems()}`,
          [userId, c.item_id],
        )
      ).rows[0];
      if (!row) return "That task is gone.";
      if (isClosed(row.status)) return "That task is finished.";
      return row.agent_grant_id ? "Your agent has that task already." : null;
    }
    case "goal.save": {
      if (!c.goal_id || !c.before) return null;
      const found = await readGoal(db, userId, c.goal_id, true);
      if (!found) return "That goal is gone, or kept out of the assistant.";
      const was = c.before;
      return found.title === was.title &&
        found.target === was.target &&
        found.target_date === was.target_date &&
        found.plan_doc_id === was.plan_doc_id &&
        found.project_id === was.project_id &&
        found.status === was.status
        ? null
        : "That goal changed since this was suggested.";
    }
    case "memory.forget": {
      const current = (
        await db.query<{ id: string; version: number }>(
          `SELECT id::text, version FROM docs
            WHERE user_id = $1 AND team_id IS NULL AND kind = 'memory'
              AND deleted_at IS NULL AND lower(title) = lower($2)
            ORDER BY id`,
          [userId, c.topic],
        )
      ).rows;
      const expected = [...c.docs].sort((a, b) => a.id.localeCompare(b.id));
      if (
        current.length !== expected.length ||
        current.some(
          (row, index) =>
            row.id !== expected[index].id ||
            row.version !== expected[index].version,
        )
      )
        return "That memory changed since this was suggested.";
      return null;
    }
    case "project.delete": {
      const found = (
        await db.query("SELECT 1 FROM projects WHERE id = $1", [c.project_id])
      ).rowCount;
      return found ? null : "The project is already gone.";
    }
    case "session.move":
    case "session.remove": {
      const b = (
        await db.query<{ start_at: Date; end_at: Date }>(
          "SELECT start_at, end_at FROM time_blocks WHERE id = $1 AND user_id = $2",
          [c.block_id, userId],
        )
      ).rows[0];
      if (!b) return "That session is gone.";
      if (
        b.start_at.getTime() !== Date.parse(c.from_start_at) ||
        b.end_at.getTime() !== Date.parse(c.from_end_at)
      )
        return "That session moved since this was suggested.";
      return null;
    }
    case "session.add": {
      const found = await item(c.item_id);
      if (!found || found.status === "done" || found.status === "cancelled")
        return "The task is closed or gone.";
      return null;
    }
    case "action":
      return actionStaleness(db, userId, c);
    default:
      return null;
  }
}

/** A typed change as the inbox shows it. */
function diffOf(c: ReviewChange, index: number, n: Names): ReviewDiff {
  const base = {
    index,
    type: c.type,
    space: spaceOf("team_id" in c ? c.team_id : null, n),
    emails: "emails" in c ? c.emails : [],
    stale: false,
    stale_reason: null,
  };
  switch (c.type) {
    case "task.create":
      return {
        ...base,
        headline: `New ${c.data.kind === "event" ? "event" : "task"} ${quote(c.title)}`,
        rows: fieldRows(c.data, null, n),
      };
    case "task.update":
      return {
        ...base,
        headline: `Change ${quote(c.title)}`,
        rows: fieldRows(c.patch, c.before, n),
      };
    case "task.delete":
      return { ...base, headline: `Delete ${quote(c.title)}`, rows: [] };
    case "task.complete":
      return {
        ...base,
        headline: `${c.done ? "Complete" : "Reopen"} ${quote(c.title)}`,
        rows: [],
      };
    case "checklist.remove":
      return {
        ...base,
        headline: `Remove a step from ${quote(c.title)}`,
        rows: [{ label: "Step", before: c.step, after: null }],
      };
    case "checklist.edit":
      return {
        ...base,
        headline: `Change the checklist of ${quote(c.title)}`,
        rows: [
          ...c.add.map((t) => ({ label: "Add step", before: null, after: t })),
          ...c.rename.map((r) => ({
            label: "Rename step",
            before: null,
            after: r.title,
          })),
          ...(c.move.length
            ? [{ label: "Move steps", before: null, after: `${c.move.length}` }]
            : []),
          ...(c.tick.length
            ? [{ label: "Tick", before: null, after: `${c.tick.length}` }]
            : []),
          ...(c.untick.length
            ? [{ label: "Untick", before: null, after: `${c.untick.length}` }]
            : []),
        ],
      };
    case "doc.create":
      return {
        ...base,
        headline: `New page ${quote(c.title)}`,
        rows: parseDoc(c.markdown)
          .slice(0, 40)
          .map((b) => ({
            label: "",
            before: null,
            after: "text" in b ? b.text : "———",
          })),
      };
    case "agent.update":
      return {
        ...base,
        headline: `Change your agent to ${quote(c.name)}`,
        rows: [
          { label: "Name", before: c.before_name, after: c.name },
          { label: "Persona", before: c.before_persona, after: c.persona },
        ].filter((row) => row.before !== row.after),
      };
    case "memory.remember":
      return {
        ...base,
        headline: `Add to Memory: ${quote(c.topic)}`,
        rows: c.facts.map((fact) => ({
          label: "Fact",
          before: "Not saved",
          after: fact,
        })),
      };
    case "routine.save": {
      const was = c.before;
      const now = c.routine;
      const row = (label: string, before: unknown, after: unknown) => ({
        label,
        before: was ? String(before) : null,
        after: String(after),
      });
      return {
        ...base,
        headline: c.routine_id
          ? `Change an assistant routine: ${quote(c.title)}`
          : `New assistant routine: ${quote(c.title)}`,
        rows: [
          row("Instruction", was?.instruction, now.instruction),
          row("Repeats", was?.rrule, now.rrule),
          row("Time zone", was?.timezone, now.timezone ?? "UTC"),
          row(
            "Next run",
            was ? when(was.next_run_at, n.tz) : "",
            when(now.next_run_at, n.tz),
          ),
          row("Paused", was?.paused ? "Yes" : "No", now.paused ? "Yes" : "No"),
          {
            label: "Runs as",
            before: null,
            after: "Orbyn's assistant, on its own schedule",
          },
        ].filter((r) => r.before !== r.after),
      };
    }
    case "task.hand":
      return {
        ...base,
        headline: `Hand ${quote(c.title)} to ${n.agentName}`,
        rows: [
          {
            label: "Who's on it",
            before: "You",
            after: `${n.agentName}, working on its own`,
          },
        ],
      };
    case "goal.save": {
      const was = c.before as Record<string, unknown> | null;
      const now = c.goal as Record<string, unknown>;
      const labels: Record<string, string> = {
        title: "Title",
        target: "Target",
        target_date: "Target date",
        project_id: "Project",
        status: "Status",
      };
      return {
        ...base,
        headline: c.goal_id
          ? `Change the goal ${quote(c.title)}`
          : `New goal ${quote(c.title)}`,
        rows: [
          ...Object.entries(labels).map(([field, label]) => ({
            label,
            before: was ? shown(field, was[field], n) : null,
            after: shown(field, now[field], n),
          })),
          ...(c.goal_id
            ? []
            : [
                {
                  label: "Check-ins",
                  before: null,
                  after: "Orbyn's assistant checks in weekly",
                },
              ]),
        ].filter((r) => r.before !== r.after),
      };
    }
    case "memory.forget":
      return {
        ...base,
        headline: `Forget Memory topic: ${quote(c.topic)}`,
        rows: [
          {
            label: "Saved notes",
            before: `${c.docs.length} note${c.docs.length === 1 ? "" : "s"}`,
            after: "Permanently removed",
          },
        ],
      };
    case "doc.edit":
      return {
        ...base,
        headline: `Edit the page ${quote(c.title)}`,
        rows: [
          ...(c.new_title !== undefined
            ? [{ label: "Title", before: c.title, after: c.new_title }]
            : []),
          ...c.lines.map((l) => ({
            label: "",
            before: l.before,
            after: l.after,
          })),
        ],
      };
    case "doc.delete":
      return {
        ...base,
        headline: `Move the page ${quote(c.title)} to Trash`,
        rows: [],
      };
    case "doc.restore_version":
      return {
        ...base,
        headline: `Put back an older version of ${quote(c.title)}`,
        rows: [
          { label: "Version", before: null, after: `Version ${c.to_version}` },
        ],
      };
    case "project.create":
      return {
        ...base,
        headline: `New project ${quote(c.title)}`,
        rows: c.stages.flatMap((s) => [
          { label: "Stage", before: null, after: s.name },
          ...s.tasks.map((t) => ({ label: "Task", before: null, after: t })),
        ]),
      };
    case "project.delete":
      return {
        ...base,
        headline: `Delete the project ${quote(c.title)} (its tasks stay)`,
        rows: [],
      };
    case "session.add":
      return {
        ...base,
        headline: `Plan a session for ${quote(c.title)}`,
        rows: [
          {
            label: "When",
            before: null,
            after: `${when(c.start_at, n.tz)} – ${when(c.end_at, n.tz)}`,
          },
        ],
      };
    case "session.move":
      return {
        ...base,
        headline: `Move a session for ${quote(c.title)}`,
        rows: [
          {
            label: "When",
            before: `${when(c.from_start_at, n.tz)} – ${when(c.from_end_at, n.tz)}`,
            after: `${when(c.start_at, n.tz)} – ${when(c.end_at, n.tz)}`,
          },
        ],
      };
    case "session.remove":
      return {
        ...base,
        headline: `Remove a session for ${quote(c.title)}`,
        rows: [
          {
            label: "When",
            before: `${when(c.from_start_at, n.tz)} – ${when(c.from_end_at, n.tz)}`,
            after: null,
          },
        ],
      };
    case "link.remove":
      return {
        ...base,
        headline: `Unlink ${quote(c.title)}`,
        rows: [],
      };
    case "action":
      return { ...base, headline: c.headline, rows: c.rows };
  }
}

/** The assistant's older proposal, as inbox changes. */
async function assistantDiffs(
  db: Queryable,
  userId: string,
  row: Row,
  n: Names,
): Promise<ReviewDiff[]> {
  const diffs: ReviewDiff[] = [];
  const base = (index: number) => ({
    index,
    space: "Personal",
    emails: [] as string[],
    stale: false,
    stale_reason: null as string | null,
  });
  if (row.project) {
    const p = row.project as {
      title?: string;
      team_id?: string | null;
      tasks?: { title?: string }[];
    };
    diffs.push({
      ...base(0),
      type: "project.create",
      space: spaceOf(p.team_id ?? null, n),
      headline: `New project ${quote(p.title ?? "")}`,
      rows: (p.tasks ?? []).slice(0, 50).map((t) => ({
        label: "Task",
        before: null,
        after: t.title ?? "",
      })),
    });
    return diffs;
  }
  for (const [index, raw] of (row.actions ?? []).entries()) {
    const parsed = actionSchema.safeParse(raw);
    if (!parsed.success) continue;
    const a = parsed.data;
    if (a.operation === "create") {
      diffs.push({
        ...base(index),
        type: "task.create",
        space: spaceOf(a.data?.team_id ?? null, n),
        headline: `New ${a.data?.kind === "event" ? "event" : "task"} ${quote(a.data?.title ?? "")}`,
        rows: fieldRows(a.data ?? {}, null, n),
      });
      continue;
    }
    const current = (
      await db.query<Record<string, unknown> & { version: number }>(
        `SELECT i.* FROM items i WHERE i.id = $2 AND ${visibleItems()}`,
        [userId, a.item_id],
      )
    ).rows[0];
    const stale = !current
      ? "It's gone, or you can no longer see it."
      : current.version !== a.version
        ? "It changed since this was suggested."
        : null;
    const before = current
      ? {
          ...current,
          due_at: (current.due_at as Date | null)?.toISOString() ?? null,
          end_at: (current.end_at as Date | null)?.toISOString() ?? null,
        }
      : null;
    diffs.push({
      ...base(index),
      type: a.operation === "delete" ? "task.delete" : "task.update",
      space: spaceOf((current?.team_id as string | null) ?? null, n),
      headline: `${a.operation === "delete" ? "Delete" : "Change"} ${quote(
        String(current?.title ?? a.data?.title ?? ""),
      )}`,
      rows: a.operation === "delete" ? [] : fieldRows(a.data ?? {}, before, n),
      stale: !!stale,
      stale_reason: stale,
    });
  }
  if (row.session_change) {
    const s = row.session_change as {
      operation: "move" | "remove";
      title: string;
      block_id: string;
      from_start_at: string;
      from_end_at: string;
      start_at?: string;
      end_at?: string;
    };
    const current = (
      await db.query<{ start_at: Date; end_at: Date }>(
        "SELECT start_at, end_at FROM time_blocks WHERE id = $1 AND user_id = $2",
        [s.block_id, userId],
      )
    ).rows[0];
    const stale = !current
      ? "That session is gone."
      : current.start_at.toISOString() !== s.from_start_at ||
          current.end_at.toISOString() !== s.from_end_at
        ? "That session moved since this was suggested."
        : null;
    diffs.push({
      ...base(diffs.length),
      type: s.operation === "move" ? "session.move" : "session.remove",
      headline: `${s.operation === "move" ? "Move" : "Remove"} a session for ${quote(s.title)}`,
      rows: [
        {
          label: "When",
          before: `${when(s.from_start_at, n.tz)} – ${when(s.from_end_at, n.tz)}`,
          after:
            s.operation === "move" && s.start_at && s.end_at
              ? `${when(s.start_at, n.tz)} – ${when(s.end_at, n.tz)}`
              : null,
        },
      ],
      stale: !!stale,
      stale_reason: stale,
    });
  }
  return diffs;
}

async function itemOf(
  db: Queryable,
  userId: string,
  row: Row,
  n: Names,
): Promise<ReviewItem> {
  let changes: ReviewDiff[];
  if (row.source === "agent") {
    const typed = row.changes
      .map((c) => reviewChange.safeParse(c))
      .flatMap((p) => (p.success ? [p.data] : []));
    changes = [];
    for (const [index, c] of typed.entries()) {
      const d = diffOf(c, index, n);
      const why =
        row.status === "pending" ? await staleness(db, userId, c) : null;
      changes.push({ ...d, stale: !!why, stale_reason: why });
    }
  } else changes = await assistantDiffs(db, userId, row, n);
  return {
    id: row.id,
    source: row.source,
    ...(row.kind === "idea" ? { kind: "idea" as const } : {}),
    proposer: proposerName(row.source, row.client_name),
    summary:
      row.summary ||
      (row.source === "assistant"
        ? "Changes the assistant suggested."
        : "Changes an agent suggested."),
    status: statusOf(row),
    created_at: row.created_at.toISOString(),
    expires_at: row.expires_at.toISOString(),
    decided_at: row.decided_at?.toISOString() ?? null,
    changes,
    partial: row.source === "agent" && changes.length > 1,
  };
}

/** One proposal of `userId`'s; 404 for anyone else's. */
export async function reviewItem(
  db: Queryable,
  userId: string,
  id: string,
): Promise<ReviewItem> {
  const row = (
    await db.query<Row>(
      `${SELECT} WHERE id = $1 AND user_id = $2 AND ${assistantProposalSourcesVisible("proposals", "$2")}`,
      [id, userId],
    )
  ).rows[0];
  if (!row) fail(404, "That suggestion isn't here any more.");
  return itemOf(db, userId, row, await namesFor(db, userId, [row]));
}

/**
 * The inbox: every pending proposal still in time (newest first), and those
 * decided in the last week. The assistant's appear here too, though its
 * chat is where they are usually taken.
 */
export async function reviewInbox(
  db: Queryable,
  userId: string,
): Promise<ReviewInbox> {
  const rows = (
    await db.query<Row>(
      `${SELECT}
        WHERE user_id = $1 AND ${assistantProposalSourcesVisible()}
          AND ((status = 'pending' AND expires_at > now())
            OR (source = 'agent' AND coalesce(decided_at, expires_at) > now() - interval '7 days'))
        ORDER BY created_at DESC LIMIT 100`,
      [userId],
    )
  ).rows;
  const names = await namesFor(db, userId, rows);
  const items = [];
  for (const row of rows) items.push(await itemOf(db, userId, row, names));
  return {
    pending: items.filter((i) => i.status === "pending"),
    recent: items.filter((i) => i.status !== "pending").slice(0, 30),
  };
}

/** How many wait, for a badge. */
export async function pendingCount(
  db: Queryable,
  userId: string,
): Promise<number> {
  return Number(
    (
      await db.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM proposals
          WHERE user_id = $1 AND status = 'pending' AND expires_at > now() AND ${assistantProposalSourcesVisible()}`,
        [userId],
      )
    ).rows[0].n,
  );
}

/**
 * What became of a proposal an agent made, for fetch(proposal:…) and a
 * retried call: only its own connection's proposals (or, with no
 * connection, the person's own).
 */
export async function proposalOutcome(
  db: Queryable,
  userId: string,
  grantId: string | null,
  id: string,
): Promise<{
  id: string;
  status: ProposalStatus;
  summary: string;
  changes: number;
  decided_at: string | null;
  expires_at: string;
  review_url: string;
} | null> {
  const row = (
    await db.query<Row>(
      `${SELECT} WHERE id = $1 AND user_id = $2
         AND ($3::uuid IS NULL OR grant_id = $3) AND ${assistantProposalSourcesVisible("proposals", "$2")}`,
      [id, userId, grantId],
    )
  ).rows[0];
  if (!row) return null;
  return {
    id: row.id,
    status: statusOf(row),
    summary: row.summary,
    changes: row.source === "agent" ? row.changes.length : row.actions.length,
    decided_at: row.decided_at?.toISOString() ?? null,
    expires_at: row.expires_at.toISOString(),
    review_url: reviewUrl(row.id),
  };
}

// --- Deciding ------------------------------------------------------------

/** Merge a patch over an item as it stands, for an update through mutate. */
export function mergedItem(
  row: Record<string, unknown>,
  patch: Record<string, unknown>,
) {
  const iso = (v: unknown) =>
    v instanceof Date ? v.toISOString() : (v as string | null);
  return itemData.parse({
    title: row.title,
    notes: row.notes,
    kind: row.kind,
    status: row.status,
    priority: row.priority,
    due_at: iso(row.due_at),
    end_at: iso(row.end_at),
    team_id: row.team_id,
    ...patch,
  });
}

/** Apply one typed change as `u` (inside the approving transaction). */
export async function applyChange(
  db: Db,
  u: UserRow,
  c: ReviewChange,
): Promise<{ project_id?: string }> {
  switch (c.type) {
    case "task.create": {
      await mutate(db, u, {
        operation: "create",
        data: itemData.parse(c.data),
      });
      return {};
    }
    case "task.update": {
      const row = await lockItem(db, c.item_id);
      await mutate(db, u, {
        operation: "update",
        item_id: c.item_id,
        version: c.version,
        data: mergedItem(row, c.patch),
      });
      return {};
    }
    case "task.delete":
      await mutate(db, u, {
        operation: "delete",
        item_id: c.item_id,
        version: c.version,
      });
      return {};
    case "task.complete": {
      const row = await lockItem(db, c.item_id);
      await mutate(db, u, {
        operation: "update",
        item_id: c.item_id,
        version: c.version,
        data: mergedItem(row, { status: c.done ? "done" : "todo" }),
      });
      return {};
    }
    case "checklist.remove": {
      const item = await lockItem(db, c.item_id);
      await requireItemAccess(u, item, "items:write", db);
      await db.query("DELETE FROM item_steps WHERE id = $1 AND item_id = $2", [
        c.step_id,
        c.item_id,
      ]);
      await recomputeProgress(db, c.item_id);
      return {};
    }
    case "checklist.edit":
      await editSteps(db, u, c.item_id, c);
      return {};
    case "doc.create":
      await createDoc(db, u, {
        title: c.title,
        kind: c.kind,
        team_id: c.team_id,
        item_id: null,
        content: parseDoc(c.markdown),
        folder_id: c.folder_id,
        project_id: c.project_id,
        tags: [],
      });
      return {};
    case "agent.update":
      await db.query(
        `INSERT INTO agent_settings (user_id, name, persona, named_at)
         VALUES ($1, $2, $3, now())
         ON CONFLICT (user_id) DO UPDATE SET name = EXCLUDED.name,
           persona = EXCLUDED.persona,
           named_at = coalesce(agent_settings.named_at, now()),
           updated_at = now()`,
        [u.id, c.name, c.persona],
      );
      await db.query(
        `UPDATE agent_grants SET name = $2, client_name = $2
          WHERE user_id = $1 AND kind = 'assistant' AND revoked_at IS NULL`,
        [u.id, c.name],
      );
      return {};
    case "memory.remember":
      await rememberMemory(db, u.id, c.topic, c.facts, c.sources);
      return {};
    case "memory.forget":
      await forgetMemory(db, u.id, c.topic, { includeKeptOut: true });
      return {};
    case "routine.save":
      await saveAgentRoutine(db, u.id, c.routine_id, c.routine, {
        advance: true,
      });
      return {};
    case "task.hand":
      await handTaskToAgent(db, u, c.item_id);
      return {};
    case "goal.save":
      await saveGoal(db, u.id, c.goal_id, c.goal, true);
      return {};
    case "doc.edit":
      await saveDoc(
        db,
        u,
        c.doc_id,
        {
          version: c.version,
          content: c.content as never,
          ...(c.new_title !== undefined ? { title: c.new_title } : {}),
        },
        { always: true },
      );
      return {};
    case "doc.delete":
      await trashDoc(db, u, c.doc_id);
      return {};
    case "doc.restore_version":
      await restoreDocVersion(db, u, c.doc_id, c.to_version);
      return {};
    case "project.create": {
      const project = await createProject(
        db,
        u,
        projectInput.parse({
          name: c.title,
          team_id: c.team_id,
          summary: c.summary,
          deadline: c.deadline,
          stages: c.stages.map((s) => s.name),
        }),
      );
      const stages = (
        await db.query<{ id: string; position: number }>(
          "SELECT id, position FROM project_stages WHERE project_id = $1 ORDER BY position",
          [project.id],
        )
      ).rows;
      for (const [i, s] of c.stages.entries())
        for (const title of s.tasks)
          await mutate(db, u, {
            operation: "create",
            data: itemData.parse({
              title,
              team_id: c.team_id,
              project_id: project.id,
              stage_id: stages[i]?.id ?? null,
            }),
          });
      return { project_id: project.id };
    }
    case "project.delete":
      await deleteProject(db, u, c.project_id);
      return {};
    case "session.add":
      await addSession(db, u.id, {
        item_id: c.item_id,
        start_at: c.start_at,
        end_at: c.end_at,
      });
      return {};
    case "session.move":
    case "session.remove":
      await applySessionChange(db, u.id, {
        operation: c.type === "session.move" ? "move" : "remove",
        block_id: c.block_id,
        item_id: c.item_id,
        project_id: null,
        title: c.title,
        from_start_at: new Date(c.from_start_at).toISOString(),
        from_end_at: new Date(c.from_end_at).toISOString(),
        ...(c.type === "session.move"
          ? {
              start_at: new Date(c.start_at).toISOString(),
              end_at: new Date(c.end_at).toISOString(),
            }
          : {}),
      });
      return {};
    case "link.remove":
      await removeLink(db, u, c);
      return {};
    case "action":
      await applyAction(db, u, c);
      return {};
  }
}

/**
 * Add, tick, untick or rename a task's checklist steps (never remove one),
 * as `u`, then recompute its progress. Returns the steps as they were, for
 * Undo. Steps don't change the task's edit version (as in the app).
 */
export async function editSteps(
  db: Db,
  u: UserRow,
  itemId: string,
  e: {
    add?: string[];
    tick?: string[];
    untick?: string[];
    rename?: { id: string; title: string }[];
    move?: { id: string; position: number }[];
  },
) {
  const item = await lockItem(db, itemId);
  await requireItemAccess(u, item, "items:write", db);
  const before = (
    await db.query<{
      id: string;
      title: string;
      done: boolean;
      position: number;
    }>(
      "SELECT id, title, done, position FROM item_steps WHERE item_id = $1 ORDER BY position",
      [itemId],
    )
  ).rows;
  const known = new Set(before.map((s) => s.id));
  for (const id of [
    ...(e.tick ?? []),
    ...(e.untick ?? []),
    ...(e.rename ?? []).map((r) => r.id),
    ...(e.move ?? []).map((m) => m.id),
  ])
    if (!known.has(id)) fail(404, "That step isn't on this task's checklist.");
  for (const title of e.add ?? [])
    await db.query(
      `INSERT INTO item_steps (item_id, title, position)
       VALUES ($1, $2, (SELECT coalesce(max(position), -1) + 1 FROM item_steps WHERE item_id = $1))`,
      [itemId, title.trim().slice(0, 500)],
    );
  for (const r of e.rename ?? [])
    await db.query(
      "UPDATE item_steps SET title = $3 WHERE id = $1 AND item_id = $2",
      [r.id, itemId, r.title.trim().slice(0, 500)],
    );
  if (e.tick?.length)
    await db.query(
      "UPDATE item_steps SET done = true WHERE item_id = $1 AND id = ANY($2::uuid[])",
      [itemId, e.tick],
    );
  if (e.untick?.length)
    await db.query(
      "UPDATE item_steps SET done = false WHERE item_id = $1 AND id = ANY($2::uuid[])",
      [itemId, e.untick],
    );
  if (e.move?.length) {
    // Each step taken out and put back at its place (0 is the top), in the
    // order given; then the list is numbered again from 0.
    const order = (
      await db.query<{ id: string }>(
        "SELECT id FROM item_steps WHERE item_id = $1 ORDER BY position, id",
        [itemId],
      )
    ).rows.map((r) => r.id);
    for (const m of e.move) {
      const at = order.indexOf(m.id);
      if (at < 0) continue;
      order.splice(at, 1);
      order.splice(Math.min(m.position, order.length), 0, m.id);
    }
    await db.query(
      `UPDATE item_steps s SET position = x.n - 1
         FROM unnest($2::uuid[]) WITH ORDINALITY AS x(id, n)
        WHERE s.id = x.id AND s.item_id = $1`,
      [itemId, order],
    );
  }
  await recomputeProgress(db, itemId);
  await announceTo(
    db as never,
    { user_id: item.user_id, team_id: item.team_id },
    "changed",
    { area: "items" },
  );
  return { item, before };
}

/** Take a link away (never any content). */
export async function removeLink(
  db: Db,
  u: UserRow,
  c: Extract<ReviewChange, { type: "link.remove" }>,
) {
  const item = await lockItem(db, c.from_id);
  await requireItemAccess(u, item, "items:write", db);
  if (c.kind === "depends_on")
    await db.query(
      "DELETE FROM item_dependencies WHERE item_id = $1 AND prerequisite_id = $2",
      [c.from_id, c.to_id],
    );
  else if (c.kind === "doc_task")
    await db.query(
      "DELETE FROM doc_task_links WHERE item_id = $1 AND doc_id = $2",
      [c.from_id, c.to_id],
    );
  else
    await db.query(
      `UPDATE items SET project_id = NULL, stage_id = NULL, version = version + 1,
         updated_at = now() WHERE id = $1 AND project_id = $2`,
      [c.from_id, c.to_id],
    );
}

/** The proposal, locked, when it is `userId`'s and still waiting. */
async function lockPending(db: Db, userId: string, id: string) {
  const row = (
    await db.query<Row>(`${SELECT} WHERE id = $1 AND user_id = $2 FOR UPDATE`, [
      id,
      userId,
    ])
  ).rows[0];
  if (!row) fail(404, "That suggestion isn't here any more.");
  return row;
}

/**
 * Approve a proposal (all of it, or `only` some of an agent's changes) as
 * `u`, in one transaction: every change is checked for staleness, then
 * made through the app's own services. Approving an applied proposal again
 * answers as before (a retried request).
 */
export async function applyProposal(
  db: Db,
  u: UserRow,
  id: string,
  input: {
    only?: number[];
    steps?: string[];
    give_tasks_deadlines?: boolean;
  } = {},
): Promise<ReviewApplied> {
  const row = await lockPending(db, u.id, id);
  if (row.status === "applied" || row.applied)
    return {
      applied: true,
      changes: [],
      project_id: row.applied_project_id ?? null,
    };
  if (row.status !== "pending") fail(409, `This suggestion was ${row.status}.`);
  if (row.expires_at <= new Date())
    fail(
      409,
      row.source === "assistant"
        ? "Proposal expired. Ask the assistant again."
        : "This suggestion expired. Ask the agent again.",
    );
  await actAs(db, u.id, null);
  // A project's History says the assistant made these changes.
  if (row.source !== "agent")
    await db.query("SELECT set_config('orbyn.origin', 'assistant', true)");
  let projectId: string | null = null;
  let made: number[] = [];
  if (row.source === "agent") {
    const guard = await checkAssistantProposalRules(
      db,
      u.id,
      row.grant_id,
      row.assistant_guard,
    );
    const changes = row.changes.map((c) => reviewChange.parse(c));
    for (const change of changes) {
      if (
        change.type === "action" &&
        change.action === "plan.apply" &&
        (typeof change.input.grant_id !== "string" ||
          change.input.grant_id.toLowerCase() !== row.grant_id)
      )
        fail(403, "A reviewed plan must use its original connection.");
      if (change.type === "action" && change.action === "plan.apply") {
        // Only the separately stored server guard may select assistant identity.
        delete change.input.assistant_lane;
        delete change.input.assistant_job_id;
        delete change.input.assistant_rules_revision;
        if (guard) {
          change.input.assistant_lane = guard.lane;
          if (guard.job_id) change.input.assistant_job_id = guard.job_id;
          change.input.assistant_rules_revision = guard.rules_revision;
        }
      }
    }
    if (input.steps) {
      const change = changes[0];
      if (
        changes.length !== 1 ||
        change.type !== "action" ||
        change.action !== "plan.apply"
      )
        fail(422, "Step selection is only available for a single plan.");
      const raw = change.input.steps;
      if (!Array.isArray(raw)) fail(422, "This plan's steps cannot be read.");
      const wanted = new Set(input.steps);
      const selected = raw.filter((step) => wanted.has(String(step.id)));
      if (selected.length !== wanted.size)
        fail(422, "Choose steps that belong to this plan.");
      changes[0] = { ...change, input: { ...change.input, steps: selected } };
    }
    const chosen = input.only
      ? [...new Set(input.only)].filter((i) => i < changes.length)
      : changes.map((_, i) => i);
    if (!chosen.length) fail(422, "Choose at least one change to approve.");
    for (const i of chosen) {
      const why = await staleness(db, u.id, changes[i]);
      if (why) fail(409, `${why} Decline it, or ask the agent again.`);
    }
    for (const i of chosen) {
      const done = await applyChange(db, u, changes[i]);
      projectId = done.project_id ?? projectId;
    }
    made = chosen;
  } else {
    if (input.only || input.steps)
      fail(422, "The assistant's suggestions are approved all together.");
    if (row.project)
      ({ project_id: projectId } = await applyProject(
        db,
        u,
        row.project as never,
        new Date(),
        undefined,
        input.give_tasks_deadlines ?? true,
      ));
    else
      for (const [index, raw] of row.actions.entries()) {
        const action = actionSchema.parse(raw);
        const item = await mutate(db, u, action);
        const link = (row.decision_links ?? []).find(
          (candidate) => candidate.action_index === index,
        );
        if (!link) continue;
        if (
          action.operation !== "create" ||
          !item ||
          !action.data?.project_id ||
          item.project_id !== action.data.project_id
        )
          fail(
            409,
            "The decision task could not be linked. Ask for a new proposal.",
          );
        const linked = await linkDecision(
          db,
          u.id,
          link.decision_id,
          item.id,
          item.project_id,
        );
        if (!linked)
          fail(
            409,
            "The decision changed since this proposal. Ask again to review it.",
          );
      }
    if (row.session_change)
      await applySessionChange(db, u.id, row.session_change);
    made = row.actions.map((_, i) => i);
  }
  await db.query(
    `UPDATE proposals SET applied = true, status = 'applied', decided_at = now(),
       applied_project_id = $2 WHERE id = $1`,
    [row.id, projectId],
  );
  await db.query(
    "UPDATE notifications SET read = true WHERE kind = 'review' AND ref = $1",
    [`proposal:${row.id}`],
  );
  // The agent that suggested it hears how it went (its inbox, H0).
  if (row.source === "agent" && row.grant_id)
    await emitInbox(db, {
      userId: row.user_id,
      grantId: row.grant_id,
      kind: "review",
      key: `proposal:${row.id}`,
      title: `Approved: ${row.summary}`,
      body:
        made.length < row.changes.length
          ? `${made.length} of ${row.changes.length} changes were approved and made; the rest were left out.`
          : "Every change was made.",
      entity: { type: "proposal", id: row.id },
    });
  await audit(
    {
      actorId: u.id,
      action:
        row.source === "agent"
          ? "agent.proposal_applied"
          : "ai.proposal_applied",
      targetType: "proposal",
      targetId: row.id,
      details:
        row.source === "agent"
          ? { changes: made, of: row.changes.length, grant_id: row.grant_id }
          : {
              actions: row.actions.length,
              session_change: !!row.session_change,
            },
    },
    db,
  );
  await announceTo(db as never, { user_id: u.id }, "changed", {
    area: "review",
  });
  return { applied: true, changes: made, project_id: projectId };
}

/** Decline a proposal: nothing changes, and it leaves the inbox. */
export async function declineProposal(db: Db, u: UserRow, id: string) {
  const row = await lockPending(db, u.id, id);
  if (row.status === "declined") return;
  if (row.status !== "pending" || row.applied)
    fail(
      409,
      `This suggestion was already ${row.applied ? "applied" : row.status}.`,
    );
  await db.query(
    "UPDATE proposals SET status = 'declined', decided_at = now() WHERE id = $1",
    [row.id],
  );
  await db.query(
    "UPDATE notifications SET read = true WHERE kind = 'review' AND ref = $1",
    [`proposal:${row.id}`],
  );
  if (row.source === "agent" && row.grant_id)
    await emitInbox(db, {
      userId: row.user_id,
      grantId: row.grant_id,
      kind: "review",
      key: `proposal:${row.id}`,
      title: `Declined: ${row.summary}`,
      body: "Nothing was changed.",
      entity: { type: "proposal", id: row.id },
    });
  await audit(
    {
      actorId: u.id,
      action: "agent.proposal_declined",
      targetType: "proposal",
      targetId: row.id,
      details: { source: row.source },
    },
    db,
  );
  await announceTo(db as never, { user_id: u.id }, "changed", {
    area: "review",
  });
}

/**
 * A team switched outside agents off or down to reading: its pending agent
 * proposals are cancelled (their people are told through the inbox).
 */
export async function cancelTeamProposals(
  db: Queryable,
  teamId: string,
): Promise<number> {
  const gone = (
    await db.query<{ user_id: string }>(
      `UPDATE proposals SET status = 'cancelled', decided_at = now()
        WHERE source = 'agent' AND status = 'pending' AND $1 = ANY(team_ids)
        RETURNING user_id`,
      [teamId],
    )
  ).rows;
  for (const userId of new Set(gone.map((g) => g.user_id)))
    await announceTo(db as never, { user_id: userId }, "changed", {
      area: "review",
    });
  return gone.length;
}
