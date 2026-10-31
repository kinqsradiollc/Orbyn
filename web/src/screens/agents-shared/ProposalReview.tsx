import {
  aiFeatureProviderLabel,
  dateLabel,
  describeRrule,
  planOutcome,
  type Action,
  type AssistantSource,
  type Item,
  type ItemInput,
  type Plan,
  type Proposal,
} from "@orbyn/core";
import {
  Bell,
  Calendar,
  Clock,
  FileText,
  Flag,
  Repeat,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { navigate } from "../../lib/router";
import { client } from "../../lib/session";
import { Button, Pill } from "../../ui/kit";
import { refreshPlanner, tasks } from "../shared-task";
import { alertLabel } from "../shared-task/format";
import { DraftNotes } from "./DraftNotes";
import { useOwner } from "./hooks";
import { More } from "./parts";
import { PlanPreview } from "./PlanPreview";
import { ProjectDraft } from "./ProjectDraft";
import { ReplyText } from "./ReplyText";
import "./agents-shared.css";

export type ProposalState = "pending" | "applied" | "discarded" | "info";

export type ProposalReviewProps = {
  proposal: Proposal;
  /** Items in the planner, to name what a change touches. */
  items?: Item[];
  /** Items as they stood when the reply arrived; diffs read these first. */
  before?: Item[];
  busy?: boolean;
  /** Defaults to pending when the reply proposes changes. */
  state?: ProposalState;
  /** Approve. `giveTasksDeadlines` applies to drafted projects. */
  onApply: (giveTasksDeadlines: boolean) => void;
  onDismiss: () => void;
  /** Sends a suggested reply. Only the newest reply takes one. */
  onFollowUp?: (text: string) => void;
  onApplyPlan?: (plan: Plan, moves: string[]) => Promise<string>;
  onOpenPlan?: (plan: Plan) => void;
  onShowOnCalendar?: (at: string) => void;
  onOpenSource?: (source: AssistantSource) => void;
  onKeptNote?: (docId: string) => void;
  /** Sources are read from a details panel instead. */
  hideSourceDetails?: boolean;
};

const OPERATION = {
  create: { label: "New", tone: "green" },
  update: { label: "Update", tone: "blue" },
  delete: { label: "Delete", tone: "red" },
} as const;

const teamName = (items: Item[], teamId: string | null) =>
  teamId
    ? items.find((item) => item.team_id === teamId && item.team_name)
        ?.team_name || "A team"
    : "Personal";

function reminders(item: {
  alerts?: number[] | null;
  reminder_minutes?: number | null;
}) {
  const alerts =
    item.alerts ??
    (item.reminder_minutes != null ? [item.reminder_minutes] : null);
  if (alerts === null) return null;
  return alerts.length ? alerts.map(alertLabel).join(", ") : "No reminder";
}

/** Plain "field: before → after" lines for an update. */
function diffLines(data: ItemInput, current: Item, items: Item[]) {
  const lines: string[] = [];
  const compare = (label: string, before: string, after: string) => {
    if (before !== after) lines.push(`${label}: ${before} → ${after}`);
  };
  compare("Title", current.title, data.title);
  compare("Due", dateLabel(current.due_at), dateLabel(data.due_at));
  if (current.end_at || data.end_at)
    compare("Ends", dateLabel(current.end_at), dateLabel(data.end_at));
  if (data.rrule !== undefined)
    compare(
      "Repeats",
      describeRrule(current.rrule) || "Doesn't repeat",
      describeRrule(data.rrule) || "Doesn't repeat",
    );
  compare("Priority", current.priority, data.priority);
  compare("Status", current.status, data.status);
  compare("Type", current.kind, data.kind);
  const after = reminders(data);
  if (after !== null)
    compare("Reminder", reminders(current) ?? "No reminder", after);
  compare(
    "Shared with",
    teamName(items, current.team_id),
    teamName(items, data.team_id),
  );
  if (current.notes !== data.notes) lines.push("Notes updated");
  return lines;
}

function Notes({ before, after }: { before?: string; after: string }) {
  return (
    <More summary={before === undefined ? "Notes" : "Notes change"}>
      {before !== undefined && (
        <>
          <strong className="small">Before</strong>
          <div
            className="agents-notes"
            tabIndex={0}
            role="region"
            aria-label="Previous notes"
            dir="auto"
          >
            {before || "Empty"}
          </div>
          <strong className="small">After</strong>
        </>
      )}
      <div
        className="agents-notes"
        tabIndex={0}
        role="region"
        aria-label="Proposed notes"
        dir="auto"
      >
        {after || "Empty"}
      </div>
    </More>
  );
}

const Fact = ({
  icon: Icon,
  children,
  title,
}: {
  icon: LucideIcon;
  children: ReactNode;
  title?: string;
}) => (
  <span className="agents-fact" title={title}>
    <Icon aria-hidden="true" />
    {children}
  </span>
);

function ChangeDetail({
  action,
  items,
  before,
}: {
  action: Action;
  items: Item[];
  before?: Item[];
}) {
  const data = action.data;
  const current =
    before?.find((item) => item.id === action.item_id) ??
    items.find((item) => item.id === action.item_id);
  if (action.operation === "delete")
    return <p className="muted small">Removes this item from your planner.</p>;
  if (!data) return null;
  if (action.operation === "update" && current) {
    const lines = diffLines(data, current, items);
    return (
      <>
        {lines.length ? (
          <ul className="agents-lines">
            {lines.map((line) => (
              <li key={line} dir="auto">
                {line}
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted small">No visible changes.</p>
        )}
        {current.notes !== data.notes && (
          <Notes before={current.notes} after={data.notes} />
        )}
      </>
    );
  }
  return (
    <>
      <div className="agents-facts">
        <Fact icon={data.kind === "event" ? Calendar : Clock}>
          {dateLabel(data.due_at)}
          {data.end_at && ` → ${dateLabel(data.end_at)}`}
        </Fact>
        {data.rrule && (
          <Fact icon={Repeat} title={data.rrule}>
            {describeRrule(data.rrule)}
          </Fact>
        )}
        <Fact icon={Flag}>{data.priority}</Fact>
        {data.due_at && (
          <Fact icon={Bell}>{reminders(data) ?? "Your default reminders"}</Fact>
        )}
        {data.team_id && (
          <Fact icon={Users}>{teamName(items, data.team_id)}</Fact>
        )}
      </div>
      {data.notes && <Notes after={data.notes} />}
    </>
  );
}

const sourceKey = (source: AssistantSource) =>
  "doc_id" in source ? `page:${source.doc_id}` : `${source.kind}:${source.id}`;

/**
 * One assistant reply: its answer, what it read, each proposed change and the
 * decision. Keyed so a new proposal never inherits another's choices.
 */
export function ProposalReview(props: ProposalReviewProps) {
  const owner = useOwner();
  return <Reply key={`${owner}:${props.proposal.id}`} {...props} />;
}

function Reply({
  proposal,
  items = [],
  before,
  busy = false,
  state,
  onApply,
  onDismiss,
  onFollowUp,
  onApplyPlan,
  onOpenPlan,
  onShowOnCalendar,
  onOpenSource,
  onKeptNote,
  hideSourceDetails = false,
}: ProposalReviewProps) {
  const count = proposal.actions.length;
  const session = proposal.session_change;
  const total = count + Number(!!session);
  const [deadlines, setDeadlines] = useState(true);
  const status = state ?? (total ? "pending" : "info");
  const followUps = (proposal.follow_ups ?? []).filter((text) => text.trim());
  const plan = proposal.plan;
  const sources = proposal.sources ?? [];
  const title = (action: Action) =>
    action.data?.title ||
    before?.find((item) => item.id === action.item_id)?.title ||
    items.find((item) => item.id === action.item_id)?.title ||
    "An item in your planner";
  return (
    <div className="agents-proposal">
      <ReplyText text={proposal.summary} />
      {proposal.provider && (
        <p className="muted small">
          {aiFeatureProviderLabel(proposal.provider)}
        </p>
      )}
      {!hideSourceDetails && sources.length > 0 && (
        <More summary={`Sources (${sources.length})`}>
          {(
            [
              ["Used", sources.filter((source) => source.used)],
              ["Also read", sources.filter((source) => !source.used)],
            ] as const
          ).map(
            ([label, group]) =>
              group.length > 0 && (
                <div key={label} className="agents-sources">
                  <span className="muted small">{label}</span>
                  {group.map((source) => (
                    <button
                      key={sourceKey(source)}
                      type="button"
                      title={source.quote}
                      disabled={!onOpenSource}
                      onClick={() => onOpenSource?.(source)}
                    >
                      <FileText aria-hidden="true" />
                      <span dir="auto">
                        [{source.number}] {source.title || "Untitled"}
                      </span>
                    </button>
                  ))}
                </div>
              ),
          )}
        </More>
      )}
      {plan && (
        <PlanPreview
          plan={plan}
          onApply={onApplyPlan && ((moves) => onApplyPlan(plan, moves))}
          onOpen={onOpenPlan && (() => onOpenPlan(plan))}
          onShowOnCalendar={onShowOnCalendar}
        />
      )}
      <DraftNotes notes={proposal.notes ?? []} onKept={onKeptNote} />
      {proposal.project && <ProjectDraft project={proposal.project} />}
      {proposal.project && status === "pending" && (
        <label className="check agents-check">
          <input
            type="checkbox"
            disabled={busy}
            checked={deadlines}
            onChange={(event) => setDeadlines(event.target.checked)}
          />
          <span>Give tasks these deadlines</span>
        </label>
      )}
      {count > 0 && !proposal.project && (
        <ul
          className={`agents-changes${status === "discarded" ? " is-discarded" : ""}`}
        >
          {proposal.actions.map((action, index) => {
            const link = proposal.decision_links?.find(
              (one) => one.action_index === index,
            );
            return (
              <li key={index}>
                <Pill tone={OPERATION[action.operation].tone}>
                  {OPERATION[action.operation].label}
                </Pill>
                <div>
                  <strong dir="auto">{title(action)}</strong>
                  <ChangeDetail action={action} items={items} before={before} />
                  {link && (
                    <p className="small">
                      Delivers decision: {link.decision_title}
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {session && (
        <ul className="agents-changes">
          <li>
            <Pill tone={session.operation === "move" ? "blue" : "red"}>
              {session.operation === "move" ? "Move session" : "Remove session"}
            </Pill>
            <div>
              <strong dir="auto">{session.title}</strong>
              <p className="small">
                {new Date(session.from_start_at).toLocaleString()}–
                {new Date(session.from_end_at).toLocaleTimeString()}
                {session.operation === "move" &&
                  ` → ${new Date(session.start_at).toLocaleString()}–${new Date(session.end_at).toLocaleTimeString()}`}
              </p>
            </div>
          </li>
        </ul>
      )}
      {status === "pending" && (
        <div className="agents-buttons">
          <Button
            variant="primary"
            disabled={busy}
            onClick={() => onApply(deadlines)}
          >
            {proposal.project
              ? "Create project and schedule"
              : `Approve ${total} ${total === 1 ? "change" : "changes"}`}
          </Button>
          <Button disabled={busy} onClick={onDismiss}>
            Discard
          </Button>
        </div>
      )}
      {status === "applied" && total > 0 && (
        <p className="agents-done">Saved to your planner</p>
      )}
      {status === "discarded" && <p className="muted small">Discarded</p>}
      {onFollowUp && followUps.length > 0 && (
        <div
          className="agents-chips"
          role="group"
          aria-label="Suggested replies"
        >
          {followUps.map((text, index) => (
            <button
              key={index}
              type="button"
              disabled={busy}
              onClick={() => onFollowUp(text)}
              dir="auto"
            >
              {text}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Where a proposal's links go, for a screen that has no reason to differ. */
export const proposalLinks = {
  onApplyPlan: async (plan: Plan, moves: string[]) => {
    const result = await client.applyPlan(plan.id, { moves });
    await refreshPlanner(true).catch(() => undefined);
    return planOutcome(result, plan.at_risk);
  },
  onOpenPlan: (plan: Plan) =>
    navigate(`/app/calendar?plan_id=${encodeURIComponent(plan.id)}`),
  onShowOnCalendar: (at: string) =>
    navigate(`/app/calendar?date=${encodeURIComponent(at.slice(0, 10))}`),
  onOpenSource: (source: AssistantSource) => {
    if ("doc_id" in source)
      navigate(
        `/app/doc/${source.doc_id}${source.block_id ? `?block=${encodeURIComponent(source.block_id)}` : ""}`,
      );
    else if (source.kind === "task") tasks.open(source.id);
    else if (source.project_id) navigate(`/app/project/${source.project_id}`);
  },
  onKeptNote: (docId: string) => navigate(`/app/doc/${docId}`),
};
