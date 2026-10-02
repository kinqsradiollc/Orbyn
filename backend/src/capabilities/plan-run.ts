import { randomBytes } from "node:crypto";
import { z } from "zod";
import {
  AGENT_BULK_LIMIT,
  AGENT_TOOLSETS,
  assistantActionRules,
  assistantActionRule,
  fail,
  type AgentAccess,
  type AgentAskFirst,
  type AgentSpaceTrust,
  type AgentToolset,
  type AgentTrust,
  type ReviewChangeInput,
} from "@orbyn/core";
import type { Db } from "../db/pool.js";
import { actAs } from "../lib/actor.js";
import type { UserRow } from "../lib/auth.js";
import { loadPrefs } from "../modules/planner/calendar.js";
import { applyProposal } from "../modules/proposals/service.js";
import { asCapabilityError } from "./execute.js";
import { cleanTitle } from "./format.js";
import { registry } from "./index.js";
import { policy, reachableTeams, type Principal } from "./policy.js";
import {
  CapabilityError,
  argsDigest,
  cursorCodec,
  type Asking,
  type Capability,
  type CapabilityContext,
  type CapabilityResult,
} from "./registry.js";
import { parseRef, refUri, refUrl } from "./refs.js";
import {
  actorOf,
  dbOf,
  linkLines,
  recordChange,
  toReview,
  withAppLink,
  type DoneEntry,
  type Pending,
} from "./write.js";

/**
 * One call, whole job (H5): running an agent's plan, an ordered list of
 * steps made of Orbyn's own write tools, as one piece of work.
 *
 * - Every step is checked first (a tool plans may use and this connection
 *   has, its arguments against the tool's schema, $refs only to earlier
 *   steps, a space it can change), and the whole plan is refused with a
 *   report per step when any is wrong.
 * - Steps run in order inside the call's one transaction; a step's $refs
 *   are read from the earlier steps' results just before it runs. A step
 *   that fails rolls everything back: all or nothing.
 * - Asking happens once for the whole plan: the steps run first (in a
 *   savepoint) noting what would need the person; then the app asks in
 *   the chat, or the plan is rolled back and waits in the Review inbox as
 *   one proposal that runs the whole plan when approved.
 * - Every step's change is recorded with one job id, so undo({job}) takes
 *   the whole plan back, last step first.
 *
 * Nothing here calls any AI: the agent did the thinking, Orbyn stores it.
 */

/** The tools a plan's steps may use: Orbyn's changes that only store. */
export const PLAN_TOOLS = [
  "create_doc",
  "append_doc",
  "edit_doc",
  "create_tasks",
  "update_tasks",
  "complete_tasks",
  "edit_checklist",
  "create_project",
  "update_project",
  "link",
  "organize",
  "tasks_from_doc",
  "comment_on_doc",
  "update_study",
  "manage_memory",
  "schedule_sessions",
  "reschedule_sessions",
  "update_planner_settings",
  "save_source",
  "save_record",
  "add_progress",
] as const;

/** The most steps one plan holds (a proposal holds one change per step). */
export const MAX_PLAN_STEPS = 50;
/** The most a plan's steps may weigh, as JSON. */
export const MAX_PLAN_BYTES = 1_000_000;
/** How long a plan may run in the request before it's refused. */
export const PLAN_TIME_MS = 30_000;

const STEP_ID = /^[A-Za-z][\w-]{0,31}$/;
/** A whole-string reference: `$notes.id`, `$proj.stages[0].id`. */
const WHOLE_REF = /^\$([A-Za-z][\w-]{0,31})((?:\.[\w-]{1,64}|\[\d{1,3}\])*)$/;
/** A reference inside words: `{$notes.uri}`. */
const EMBED_REF =
  /\{\$([A-Za-z][\w-]{0,31})((?:\.[\w-]{1,64}|\[\d{1,3}\])*)\}/g;

export const planStep = z
  .object({
    id: z
      .string()
      .max(32)
      .refine(
        (v) => STEP_ID.test(v),
        "Use a short name: letters, digits, _ or -.",
      ),
    tool: z.enum(PLAN_TOOLS),
    args: z.record(z.string(), z.unknown()),
  })
  .strict();
export type PlanStep = z.output<typeof planStep>;

/** How a step went, for the answer and for refusals. */
export type StepReport = {
  id: string;
  tool: string;
  status: "ok" | "invalid" | "failed" | "not_run" | "rolled_back";
  error?: string;
};

type Path = (string | number)[];
type Found = { path: Path; step: string; whole: boolean };

/** Splits `.a[0].b` into its keys and indexes. */
function pathOf(tail: string): Path {
  const out: Path = [];
  for (const m of tail.matchAll(/\.([\w-]+)|\[(\d+)\]/g))
    out.push(m[1] !== undefined ? m[1] : Number(m[2]));
  return out;
}

/**
 * Every $ref in a step's arguments, with where it is. A whole-string ref to
 * a name no step has, with a path, is an error; `$word` alone and `{$…}`
 * naming no step are just words.
 */
function refsIn(
  value: unknown,
  known: Set<string>,
  path: Path = [],
  out: Found[] = [],
  depth = 0,
): Found[] {
  if (depth > 20) return out;
  if (typeof value === "string") {
    const whole = WHOLE_REF.exec(value);
    if (whole) {
      if (known.has(whole[1]) || whole[2])
        out.push({ path, step: whole[1], whole: true });
      return out;
    }
    for (const m of value.matchAll(EMBED_REF))
      if (known.has(m[1])) out.push({ path, step: m[1], whole: false });
  } else if (Array.isArray(value))
    value.forEach((v, i) => refsIn(v, known, [...path, i], out, depth + 1));
  else if (value && typeof value === "object")
    for (const [k, v] of Object.entries(value))
      refsIn(v, known, [...path, k], out, depth + 1);
  return out;
}

const startsWith = (path: PropertyKey[], prefix: Path) =>
  prefix.length <= path.length && prefix.every((p, i) => path[i] === p);

const invalidStep = (report: StepReport[]) => {
  const bad = report.filter((r) => r.status === "invalid");
  return new CapabilityError(
    "INVALID",
    `The plan wasn't applied: ${bad.length} step${bad.length === 1 ? " is" : "s are"} invalid. ${bad
      .slice(0, 5)
      .map((r) => `${r.id} (${r.tool}): ${r.error}`)
      .join(" ")}`.slice(0, 1500),
    "Correct those steps and send the whole plan again; nothing was changed.",
    { steps: report },
  );
};

/**
 * Checks a plan before anything is written: the tools, the connection's
 * access to them, step names, $refs (only to earlier steps), each step's
 * arguments against its tool's schema (refs aside) and the spaces named.
 */
export function checkPlan(p: Principal, steps: PlanStep[]) {
  const report: StepReport[] = [];
  const seen = new Set<string>();
  const all = new Set(steps.map((s) => s.id));
  if (Buffer.byteLength(JSON.stringify(steps)) > MAX_PLAN_BYTES)
    throw new CapabilityError(
      "INVALID",
      "That plan is over 1 MB.",
      "Send long page text with append_doc first (parts), and finish it in the plan with its draft; or split the plan.",
    );
  for (const step of steps) {
    const problems: string[] = [];
    const cap = registry.get(step.tool);
    if (seen.has(step.id)) problems.push(`two steps are called ${step.id}`);
    if (!cap || !policy.allows(p, cap))
      problems.push(
        `this connection can't use ${step.tool} (its toolset or access)`,
      );
    const refs = refsIn(step.args, all);
    for (const r of refs)
      if (!seen.has(r.step))
        problems.push(
          all.has(r.step)
            ? `$${r.step} is a later step (or this one); refer only to earlier steps`
            : `$${r.step} names no step`,
        );
    if ("client_ref" in step.args)
      problems.push("give client_ref for the whole plan, not a step");
    if (step.tool === "append_doc" && step.args.finish !== true)
      problems.push("append_doc in a plan must finish the page (finish: true)");
    if (cap && !problems.length) {
      const parsed = cap.input.safeParse(step.args);
      if (!parsed.success) {
        const issues = parsed.error.issues.filter(
          (i) => !refs.some((r) => startsWith(i.path, r.path)),
        );
        if (issues.length)
          problems.push(
            issues
              .slice(0, 2)
              .map(
                (i) =>
                  `${i.message}${i.path.length ? ` (${i.path.join(".")})` : ""}`,
              )
              .join("; "),
          );
      }
      const team = step.args.team;
      if (typeof team === "string" && !refs.some((r) => r.path[0] === "team")) {
        const id =
          team.toLowerCase() === "personal" ? null : team.toLowerCase();
        const level = policy.levelIn(p, id);
        if (level === null)
          problems.push("that space isn't reachable from this connection");
        else if (level === "read")
          problems.push("this connection can only read in that space");
      }
    }
    seen.add(step.id);
    report.push({
      id: step.id,
      tool: step.tool,
      status: problems.length ? "invalid" : "ok",
      ...(problems.length ? { error: problems.join("; ") } : {}),
    });
  }
  if (report.some((r) => r.status === "invalid")) throw invalidStep(report);
}

/** What a step answered, as later steps' $refs read it. */
type StepView = Record<string, unknown>;

function lookup(view: StepView, path: Path): unknown {
  let at: unknown = view;
  for (const key of path) {
    if (at === null || at === undefined || typeof at !== "object")
      return undefined;
    at = (at as Record<string | number, unknown>)[key];
  }
  return at;
}

/** The step's arguments with its $refs filled from earlier steps. */
function resolve(
  value: unknown,
  views: Map<string, StepView>,
  depth = 0,
): unknown {
  if (depth > 20) return value;
  if (typeof value === "string") {
    const whole = WHOLE_REF.exec(value);
    if (whole) {
      const view = views.get(whole[1]);
      if (!view) return value;
      const got = lookup(view, pathOf(whole[2]));
      if (got === undefined)
        throw new CapabilityError(
          "INVALID",
          `${value} isn't in step ${whole[1]}'s result.`,
          "Use id, ids, uri, title, url, version, lines.<anchor>, stages[n].id or a field of its answer.",
        );
      return got;
    }
    return value.replace(EMBED_REF, (all, step: string, tail: string) => {
      const view = views.get(step);
      if (!view) return all;
      const got = lookup(view, pathOf(tail));
      if (typeof got !== "string" && typeof got !== "number")
        throw new CapabilityError(
          "INVALID",
          `${all} isn't a word or number in step ${step}'s result.`,
        );
      return String(got);
    });
  }
  if (Array.isArray(value))
    return value.map((v) => resolve(v, views, depth + 1));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, resolve(v, views, depth + 1)]),
    );
  return value;
}

/** A step's result as done entries (write tools share that shape). */
function doneOf(answer: CapabilityResult<unknown>): DoneEntry[] {
  const s = answer.structured as { done?: DoneEntry[] } | null;
  if (Array.isArray(s?.done)) return s.done;
  const links = answer.links ?? [];
  return (answer.targets ?? []).slice(0, 20).map((id, i) => ({
    id,
    title: cleanTitle(links[i]?.name ?? "") || id,
    url: urlOf(id),
    version: null,
    change: "Saved",
  }));
}

/** The web link for a typed id that opens somewhere, else "". */
function urlOf(id: string): string {
  const ref = parseRef(id);
  return ref.type === "task" ||
    ref.type === "event" ||
    ref.type === "doc" ||
    ref.type === "project" ||
    ref.type === "view" ||
    ref.type === "proposal"
    ? refUrl(ref)
    : "";
}

const UUID_IN = /^(\w+):([0-9a-f-]{36})/i;

/** The view later steps read: the answer plus handy fields. */
async function viewOf(
  ctx: CapabilityContext,
  answer: CapabilityResult<unknown>,
  done: DoneEntry[],
): Promise<StepView> {
  const s = (answer.structured ?? {}) as Record<string, unknown>;
  const first = done[0];
  const view: StepView = {
    ...s,
    id: first?.id ?? (typeof s.source === "string" ? s.source : null),
    ids: done.map((d) => d.id),
    title: first?.title ?? null,
    url: first?.url ?? null,
    version: first?.version ?? null,
    done,
  };
  const m = first ? UUID_IN.exec(first.id) : null;
  if (m) {
    const type = m[1].toLowerCase();
    const id = m[2].toLowerCase();
    if (["task", "doc", "project", "record", "template"].includes(type))
      view.uri = refUri({ type: type as "doc", id });
    if (type === "doc") {
      const row = (
        await ctx.db.query<{ content: { id?: string }[] }>(
          "SELECT content FROM docs WHERE id = $1",
          [id],
        )
      ).rows[0];
      view.lines = Object.fromEntries(
        (row?.content ?? [])
          .filter((b) => typeof b.id === "string" && b.id)
          .map((b) => [b.id, `doc:${id}#${b.id}`]),
      );
    }
    if (type === "project")
      view.stages = (
        await ctx.db.query<{ id: string; name: string }>(
          "SELECT id::text, name FROM project_stages WHERE project_id = $1 ORDER BY position",
          [id],
        )
      ).rows;
  }
  return view;
}

type Ran = {
  step: PlanStep;
  cap: Capability;
  args: Record<string, unknown>;
  answer: CapabilityResult<unknown>;
  done: DoneEntry[];
  skipped: string[];
  proposal: string | null;
};

/** Runs the steps in order, each with its $refs filled. */
async function runSteps(
  ctx: CapabilityContext,
  steps: PlanStep[],
  started: number,
): Promise<Ran[]> {
  const views = new Map<string, StepView>();
  const ran: Ran[] = [];
  for (const [i, step] of steps.entries()) {
    const report = (error: string): StepReport[] =>
      steps.map((s, j) => ({
        id: s.id,
        tool: s.tool,
        status: j < i ? "rolled_back" : j === i ? "failed" : "not_run",
        ...(j === i ? { error } : {}),
      }));
    if (Date.now() - started > PLAN_TIME_MS)
      throw new CapabilityError(
        "LIMITED",
        `The plan took too long and stopped before step ${step.id}; nothing was changed.`,
        "Split it into smaller plans.",
        { steps: report("not run: the plan took too long") },
      );
    const cap = registry.get(step.tool)!;
    try {
      const args = resolve(step.args, views) as Record<string, unknown>;
      const input = cap.input.parse(args);
      ctx.progress?.(i, steps.length, `${step.id}: ${cap.title}`);
      const answer = await cap.run(
        { ...ctx, cursor: cursorCodec(ctx.principal, cap.name, args) },
        input as never,
      );
      const done = doneOf(answer);
      const skipped = (
        ((answer.structured as { skipped?: { reason: string }[] } | null)
          ?.skipped ?? []) as { reason: string }[]
      ).map((x) => x.reason);
      views.set(step.id, await viewOf(ctx, answer, done));
      ran.push({
        step,
        cap,
        args,
        answer,
        done,
        skipped,
        proposal: answer.write?.proposal_id ?? null,
      });
    } catch (e) {
      const err = asCapabilityError(e);
      throw new CapabilityError(
        err.code,
        `Step ${step.id} (${step.tool}) failed: ${err.message} Nothing in the plan was applied.`.slice(
          0,
          1500,
        ),
        err.fix ?? "Correct that step and send the whole plan again.",
        { steps: report(err.message) },
      );
    }
  }
  return ran;
}

/** A new job id: every change of one plan shares it. */
export const newJob = () => `plan_${randomBytes(12).toString("base64url")}`;

/** One step's outcome, as the answer lists it. */
export const stepOutput = z.object({
  id: z.string(),
  tool: z.string(),
  done: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      url: z.string(),
      app_url: z.string(),
      change: z.string(),
    }),
  ),
});

export type PlanAnswer = {
  status: "done" | "pending_review";
  job: string | null;
  steps: z.output<typeof stepOutput>[];
  pending: Pending | null;
};

/** The Review inbox's one change for a whole plan. */
function planChange(
  p: Principal,
  job: string,
  summary: string,
  steps: PlanStep[],
  ran: Ran[],
): ReviewChangeInput {
  return {
    type: "action",
    action: "plan.apply",
    target_id: null,
    title: summary,
    team_id: null,
    headline: summary,
    rows: ran.map((r) => ({
      label: `${r.step.id} · ${r.cap.title}`.slice(0, 60),
      before: null,
      after:
        (r.done.length
          ? r.done.map((d) => `${d.change}: ${d.title}`).join("\n")
          : r.cap.title
        ).slice(0, 2000) || null,
    })),
    input: { grant_id: p.grant_id, job, summary, steps },
  };
}

/**
 * Runs a plan in the call's transaction and says how it went. `job` names
 * every change it makes. With `asking` collecting (the app can ask in the
 * chat), what needs the person is left on ctx.asking for the caller to
 * ask about; without it, the plan is rolled back and filed as one
 * proposal. Records every step's change for undo when made.
 */
export async function runPlan(
  ctx: CapabilityContext,
  plan: { steps: PlanStep[]; summary?: string },
  job: string,
  requestId?: string,
): Promise<CapabilityResult<PlanAnswer>> {
  const p = ctx.principal;
  const db = dbOf(ctx);
  checkPlan(p, plan.steps);
  const started = Date.now();
  const outer = ctx.asking;
  const inner: Asking = outer ?? { mode: "collect", reasons: [] };
  const summary = cleanTitle(
    plan.summary?.trim() ||
      `A plan of ${plan.steps.length} step${plan.steps.length === 1 ? "" : "s"}`,
  ).slice(0, 300);
  await db.query("SAVEPOINT apply_plan");
  const ran = await runSteps({ ...ctx, asking: inner }, plan.steps, started);
  const changes = ran.reduce((n, r) => n + r.done.length, 0);
  const bulk: AgentAskFirst = "bulk";
  if (
    inner.mode === "collect" &&
    changes > AGENT_BULK_LIMIT &&
    !p.trust.acts_alone.includes(bulk)
  )
    inner.reasons.push({
      kind: bulk,
      text: `it changes ${changes} things at once`,
    });
  const waits = ran.filter((r) => r.proposal);
  // Approved in the Review inbox already: a step that files its own
  // proposal (sessions on a team task, say) is approved with the plan.
  if (outer?.reviewed)
    for (const r of waits) {
      const id = r.proposal!.replace(/^proposal:/, "");
      await applyProposal(db, actorOf(ctx.principal), id);
      await db.query(
        "DELETE FROM notifications WHERE kind = 'review' AND ref = $1 AND state = 'pending'",
        [`proposal:${id}`],
      );
      r.done = [
        ...r.done,
        {
          id: `proposal:${id}`,
          title: r.cap.title,
          url: refUrl({ type: "proposal", id }),
          version: null,
          change: "Approved with the plan",
        },
      ];
    }
  if (
    (p.unattended && changes > AGENT_BULK_LIMIT) ||
    (waits.length && !outer?.reviewed) ||
    (inner.reasons.length && !outer)
  ) {
    // Nothing is made now: the whole plan waits for one yes.
    await db.query("ROLLBACK TO SAVEPOINT apply_plan");
    if (outer?.mode === "collect") outer.reasons.length = 0;
    const pending = await toReview(ctx, summary, [
      planChange(p, job, summary, plan.steps, ran),
    ]);
    const { targets, ...out } = pending;
    const lines = ran.flatMap((r) =>
      r.done.map((d) => `- ${r.step.id}: ${d.change}: ${d.title}`),
    );
    return {
      structured: {
        status: "pending_review",
        job,
        steps: ran.map((r) => ({ id: r.step.id, tool: r.cap.name, done: [] })),
        pending: out,
      },
      markdown: [
        `The whole plan (${plan.steps.length} steps) waits for the person's approval in Orbyn's Review inbox (expires ${out.expires_at}); nothing has changed yet. Approved, it is made all at once as job ${job}.`,
        ...lines.slice(0, 30),
        `proposal: ${out.proposal_id} · review: ${out.review_url}`,
      ].join("\n"),
      targets,
      write: { outcome: "proposed", proposal_id: out.proposal_id, job },
    };
  }
  await db.query("RELEASE SAVEPOINT apply_plan");
  // Collecting for the chat: the caller rolls it all back and asks.
  const asking = inner.mode === "collect" && inner.reasons.length > 0;
  if (p.grant_id && !asking)
    for (const r of ran)
      await recordChange(db, p, {
        tool: r.cap.name,
        tier: r.cap.tier,
        outcome: r.answer.write?.outcome ?? "ok",
        targets: r.answer.targets ?? [],
        argsDigest: argsDigest(r.args),
        summary: `${r.cap.title} (plan step ${r.step.id})`,
        meta: { ...(r.answer.write ?? {}), after: undefined, job },
        requestId,
      });
  const steps = ran.map((r) => ({
    id: r.step.id,
    tool: r.cap.name,
    done: r.done
      .map(withAppLink)
      .map(({ id, title, url, app_url, change }) => ({
        id,
        title,
        url,
        app_url,
        change,
      })),
  }));
  const markdown = [
    `Plan applied: ${plan.steps.length} step${plan.steps.length === 1 ? "" : "s"}, ${changes} change${changes === 1 ? "" : "s"}, as one job (${job}). undo({"job": "${job}"}) takes it all back.`,
    ...ran.flatMap((r) => [
      `${r.step.id} (${r.cap.name}):`,
      ...r.done.map((d) => `- ${d.change}: ${d.title} (${d.id})`),
      ...r.skipped.map((s) => `- Not done: ${s}`),
    ]),
    ...linkLines(steps.flatMap((s) => s.done)),
  ].join("\n");
  const targets = ran.flatMap((r) => r.done.map((d) => d.id));
  return {
    structured: { status: "done", job, steps, pending: null },
    markdown,
    targets,
    links: ran
      .flatMap((r) => r.done)
      .filter((d) => UUID_IN.test(d.id))
      .slice(0, 20)
      .map((d) => ({
        uri: d.id
          .replace(/^event:/, "task:")
          .replace(/^(\w+):([0-9a-f-]{36}).*$/, "orbyn://$1/$2"),
        name: d.title || d.id,
      })),
    write: {
      outcome: "ok",
      job,
      after: ran.flatMap((r) => r.answer.write?.after ?? []),
    },
  };
}

// --- Approved in the Review inbox -----------------------------------------

/** What the Review inbox keeps for a whole plan (a "plan.apply" action). */
export const planApplyInput = z.object({
  grant_id: z.uuid(),
  assistant_lane: assistantActionRule.shape.lane.optional(),
  assistant_job_id: z.uuid().optional(),
  assistant_rules_revision: z.number().int().positive().optional(),
  job: z.string().min(1).max(64),
  summary: z.string().max(300),
  steps: z.array(planStep).min(1).max(MAX_PLAN_STEPS),
});
export type PlanApplyInput = z.output<typeof planApplyInput>;

type GrantRow = {
  id: string;
  kind: string;
  resource_kind: "mcp" | "plugin";
  assistant_rules: unknown;
  assistant_rules_revision: number;
  client_id: string | null;
  client_name: string | null;
  name: string;
  access: AgentAccess;
  team_ids: string[] | null;
  personal: boolean;
  toolsets: AgentToolset[];
  flags: { notify_teammates?: boolean; hide_outside_content?: boolean } | null;
  trust: AgentTrust | null;
  space_trust: AgentSpaceTrust | null;
  acts_alone: AgentAskFirst[] | null;
  suspended_at: Date | null;
  revoked_at: Date | null;
  expires_at: Date | null;
};

async function grantOf(db: Db, userId: string, grantId: string) {
  return (
    await db.query<GrantRow>(
      `SELECT id, kind, client_id, client_name, name, access, team_ids, personal,
              toolsets, flags, trust, space_trust, acts_alone, suspended_at,
              revoked_at, expires_at, resource_kind, assistant_rules, assistant_rules_revision
         FROM agent_grants WHERE id = $1 AND user_id = $2 FOR SHARE`,
      [grantId, userId],
    )
  ).rows[0];
}

/** Why an approved plan can't run any more (its connection went), or null. */
export async function planStaleness(
  db: Db,
  userId: string,
  input: PlanApplyInput,
): Promise<string | null> {
  const g = await grantOf(db, userId, input.grant_id);
  if (!g || g.revoked_at) return "The agent's connection was removed.";
  if (g.suspended_at) return "The agent's connection is suspended.";
  if (g.expires_at && g.expires_at <= new Date())
    return "The agent's connection has expired.";
  return null;
}

/**
 * Runs a whole plan the person approved in the Review inbox, as the agent
 * acting for them (so every step is labelled with it and undo({job}) takes
 * it back), all in the approval's transaction.
 */
export async function applyApprovedPlan(
  db: Db,
  u: UserRow,
  input: PlanApplyInput,
): Promise<void> {
  const g = await grantOf(db, u.id, input.grant_id);
  const why = await planStaleness(db, u.id, input);
  if (!g || why) fail(409, `${why} Decline it, or ask the agent again.`);
  const via =
    g.kind === "assistant"
      ? "assistant"
      : g.kind === "oauth"
        ? g.resource_kind === "plugin"
          ? "plugin"
          : "oauth"
        : g.kind === "legacy"
          ? "legacy_key"
          : "agent_key";
  const p: Principal = {
    user: { id: u.id, name: u.name, role: "member" },
    via,
    ...(via === "assistant"
      ? {
          assistant_lane: input.assistant_lane ?? "interactive",
          assistant_job_id: input.assistant_job_id,
          assistant_rules_revision: g.assistant_rules_revision,
          assistant_rules: assistantActionRules.parse(g.assistant_rules),
        }
      : {}),
    grant_id: g.id,
    client: { id: g.client_id, name: g.client_name || g.name },
    access: g.access,
    team_ids: g.team_ids,
    personal: g.personal,
    toolsets: (
      g.toolsets ??
      (via === "assistant"
        ? AGENT_TOOLSETS.filter((toolset) => toolset !== "booking")
        : [])
    ).filter((t) => (AGENT_TOOLSETS as readonly string[]).includes(t)),
    flags: {
      notify_teammates: !!g.flags?.notify_teammates,
      hide_outside_content: !!g.flags?.hide_outside_content,
      readonly: false,
    },
    trust: {
      level: g.trust ?? "full",
      spaces: g.space_trust ?? {},
      acts_alone: g.acts_alone ?? [],
    },
    teams: await reachableTeams(db, u.id, g.team_ids, via),
  };
  if (
    via === "assistant" &&
    (input.assistant_rules_revision ?? 1) !== g.assistant_rules_revision
  )
    fail(409, "Assistant rules changed. Ask for a new plan before approving.");
  await actAs(db, u.id, g.id);
  const prefs = await loadPrefs(db, u.id);
  const ctx: CapabilityContext = {
    principal: p,
    db,
    now: new Date(),
    timezone: prefs.timezone,
    spaces: policy.spaces(p),
    cursor: cursorCodec(p, "apply_plan", {}),
    asking: { mode: "approved", reasons: [], reviewed: true },
  };
  try {
    const answer = await runPlan(ctx, input, input.job, input.job);
    await recordChange(db, p, {
      tool: "apply_plan",
      tier: "W2",
      outcome: "ok",
      targets: answer.targets ?? [],
      argsDigest: argsDigest(input.steps),
      summary: `Plan approved: ${input.summary}`,
      meta: { outcome: "ok", job: input.job },
      requestId: input.job,
    });
  } catch (e) {
    const err = asCapabilityError(e);
    fail(
      err.code === "NOT_FOUND" ? 404 : err.code === "FORBIDDEN" ? 403 : 409,
      `${err.message} Decline it, or ask the agent again.`,
    );
  }
}
