import { ProjectDraftReview } from "./ProjectDraftReview";
import { alertLabel } from "./EventFields";
import { Fragment, useState, type ReactNode } from "react";
import {
  Bell,
  Calendar,
  Check,
  Clock,
  Flag,
  Repeat,
  Users,
  X,
} from "lucide-react";
import {
  aiFeatureProviderLabel,
  describeRrule,
  dateLabel,
  type Action,
  type Item,
  type ItemInput,
  type Plan,
  type AssistantSource,
  type Proposal,
  parseRichText,
  type RichInline,
} from "@orbyn/core";
import type { TurnState } from "../hooks/useAssistant";
import { stagger } from "../lib/motion";
import { PlanCard } from "./PlanCard";
import { DraftNotes } from "./DraftNotes";
import { FileText } from "lucide-react";

type Props = {
  proposal: Proposal;
  items: Item[];
  /** Items as they were when the reply arrived; diffs use these first. */
  before?: Item[];
  busy: boolean;
  /** Defaults to "pending" when the reply proposes changes, otherwise "info". */
  state?: TurnState;
  onApply: (giveTasksDeadlines?: boolean) => void;
  onDismiss: () => void;
  /** Sends a suggested quick reply; only the latest reply gets one. */
  onFollowUp?: (text: string) => void;
  /** Saves the reply's plan (when it has one); resolves with a message. */
  onApplyPlan?: (plan: Plan, moves?: string[]) => Promise<string>;
  /** Shows the reply's plan in the calendar's planner. */
  onOpenPlan?: (plan: Plan) => void;
  /** After the plan is applied: the calendar at its first changed session. */
  onShowOnCalendar?: (at: string) => void;
  /** Opens a page the assistant read, at the line it cited. */
  onOpenSource?: (source: AssistantSource) => void;
  /** Opens a note once it has been kept. */
  onKeptNote?: (docId: string) => void;
};

const OPERATION = {
  create: { label: "New", className: "ai-op-create" },
  update: { label: "Update", className: "ai-op-update" },
  delete: { label: "Delete", className: "ai-op-delete" },
} as const;

function Inlines({ parts }: { parts: RichInline[] }) {
  return (
    <>
      {parts.map((part, n) => {
        let node: ReactNode = part.code ? <code>{part.text}</code> : part.text;
        if (part.italic) node = <em>{node}</em>;
        if (part.bold) node = <strong>{node}</strong>;
        return <Fragment key={n}>{node}</Fragment>;
      })}
    </>
  );
}

/** A Markdown table; it scrolls sideways on its own so it never widens the page. */
function Table({
  header,
  rows,
}: {
  header: RichInline[][];
  rows: RichInline[][][];
}) {
  return (
    <div
      className="ai-table-wrap"
      role="region"
      aria-label="Table"
      tabIndex={0}
    >
      <table className="ai-table">
        <thead>
          <tr>
            {header.map((cell, c) => (
              <th key={c} scope="col">
                <Inlines parts={cell} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => (
            <tr key={r}>
              {row.map((cell, c) => (
                <td key={c}>
                  <Inlines parts={cell} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The reply as headings, paragraphs, lists and tables (shared parser with mobile). */
export function SummaryText({ text }: { text: string }) {
  return (
    <div className="ai-summary">
      {parseRichText(text).map((block, n) =>
        block.type === "heading" ? (
          <h4 key={n}>
            <Inlines parts={block.inlines} />
          </h4>
        ) : block.type === "table" ? (
          <Table key={n} header={block.header} rows={block.rows} />
        ) : block.type === "list" ? (
          block.ordered ? (
            <ol key={n}>
              {block.items.map((item, m) => (
                <li key={m}>
                  <Inlines parts={item} />
                </li>
              ))}
            </ol>
          ) : (
            <ul key={n}>
              {block.items.map((item, m) => (
                <li key={m}>
                  <Inlines parts={item} />
                </li>
              ))}
            </ul>
          )
        ) : (
          <p key={n}>
            <Inlines parts={block.inlines} />
          </p>
        ),
      )}
    </div>
  );
}

const teamName = (items: Item[], teamId: string | null) =>
  teamId
    ? items.find((i) => i.team_id === teamId && i.team_name)?.team_name ||
      "A team"
    : "Personal";

/** "15 min before, 1 day before", "No reminder", or null when none are given. */
function reminderText(i: {
  alerts?: number[] | null;
  reminder_minutes?: number | null;
}) {
  const alerts =
    i.alerts ?? (i.reminder_minutes != null ? [i.reminder_minutes] : null);
  if (alerts === null) return null;
  return alerts.length ? alerts.map(alertLabel).join(", ") : "No reminder";
}

/** Human-readable "field: before → after" lines for an update. */
function changes(data: ItemInput, current: Item, items: Item[]) {
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
  // Only when the change sets reminders; left out, they stay as they are.
  const after = reminderText(data);
  if (after !== null)
    compare("Reminder", reminderText(current) ?? "No reminder", after);
  compare(
    "Shared with",
    teamName(items, current.team_id),
    teamName(items, data.team_id),
  );
  if (current.notes !== data.notes) lines.push("Notes updated");
  return lines;
}

function Details({
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
    before?.find((i) => i.id === action.item_id) ??
    items.find((i) => i.id === action.item_id);
  if (action.operation === "delete")
    return (
      <small className="ai-muted">Removes this item from your planner.</small>
    );
  if (!data) return null;
  if (action.operation === "update" && current) {
    const lines = changes(data, current, items);
    return lines.length ? (
      <ul className="ai-diff">
        {lines.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
    ) : (
      <small className="ai-muted">No visible changes.</small>
    );
  }
  return (
    <div className="ai-chips">
      <span>
        {data.kind === "event" ? <Calendar size={12} /> : <Clock size={12} />}
        {dateLabel(data.due_at)}
        {data.end_at && ` → ${dateLabel(data.end_at)}`}
      </span>
      {data.rrule && (
        <span className="ai-repeat" title={data.rrule}>
          <Repeat size={12} />
          {describeRrule(data.rrule)}
        </span>
      )}
      <span className={`ai-priority ai-priority-${data.priority}`}>
        <Flag size={12} />
        {data.priority}
      </span>
      {data.due_at && (
        <span>
          <Bell size={12} />
          {reminderText(data) ?? "Your default reminders"}
        </span>
      )}
      {data.team_id && (
        <span>
          <Users size={12} />
          {teamName(items, data.team_id)}
        </span>
      )}
      {data.notes && <p className="ai-notes">{data.notes}</p>}
    </div>
  );
}

/** One assistant reply: its summary, each proposed change, and the approve/discard decision. */
export function ProposalReview({
  proposal,
  items,
  before,
  busy,
  state,
  onApply,
  onDismiss,
  onFollowUp,
  onApplyPlan,
  onOpenPlan,
  onShowOnCalendar,
  onOpenSource,
  onKeptNote,
}: Props) {
  const count = proposal.actions.length;
  const sessionChange = proposal.session_change;
  const total = count + Number(!!sessionChange);
  const [giveTasksDeadlines, setGiveTasksDeadlines] = useState(true);
  const status = state ?? (count || sessionChange ? "pending" : "info");
  const followUps = (proposal.follow_ups ?? []).filter((t) => t.trim());
  const plan = proposal.plan;
  const sources = proposal.sources ?? [];
  const usedSources = sources.filter((source) => source.used);
  const otherSources = sources.filter((source) => !source.used);
  return (
    <div className="ai-proposal">
      <SummaryText text={proposal.summary} />
      {proposal.provider && (
        <small className="muted ai-feature-provider">
          {aiFeatureProviderLabel(proposal.provider)}
        </small>
      )}
      {/* What the assistant actually read, so the answer can be checked
          against it rather than taken on trust. */}
      {sources.length > 0 && (
        <div className="ai-sources">
          {(
            [
              ["Used", usedSources],
              ["Also read", otherSources],
            ] as const
          ).map(([label, group]) =>
            group.length ? (
              <div key={label} className="ai-sources-group">
                <span className="ai-sources-label">{label}:</span>
                {group.map((source) => (
                  <button
                    key={
                      "doc_id" in source
                        ? `page:${source.doc_id}`
                        : `${source.kind}:${source.id}`
                    }
                    className="ai-source"
                    title={source.quote}
                    disabled={!onOpenSource}
                    onClick={() => onOpenSource?.(source)}
                  >
                    <FileText size={12} aria-hidden="true" /> [{source.number}]{" "}
                    {source.title || "Untitled"}
                  </button>
                ))}
              </div>
            ) : null,
          )}
        </div>
      )}
      {plan && (
        <PlanCard
          plan={plan}
          onApply={onApplyPlan && ((moves) => onApplyPlan(plan, moves))}
          onOpenInPlanner={onOpenPlan && (() => onOpenPlan(plan))}
          onShowOnCalendar={onShowOnCalendar}
        />
      )}
      <DraftNotes
        notes={proposal.notes ?? []}
        onKept={onKeptNote}
        report={() => {}}
      />
      {proposal.project && <ProjectDraftReview project={proposal.project} />}
      {proposal.project && status === "pending" && (
        <label className="ai-switch-row">
          <input
            type="checkbox"
            role="switch"
            className="ai-switch"
            checked={giveTasksDeadlines}
            onChange={(event) => setGiveTasksDeadlines(event.target.checked)}
          />
          Give tasks these deadlines
        </label>
      )}
      {count > 0 && !proposal.project && (
        <div
          className={
            "ai-actions" + (status === "discarded" ? " is-discarded" : "")
          }
        >
          {proposal.actions.map((a, n) => (
            <div
              className="ai-action fade-up stagger"
              style={stagger(n)}
              key={n}
            >
              <span className={"ai-op " + OPERATION[a.operation].className}>
                {OPERATION[a.operation].label}
              </span>
              <div className="ai-action-body">
                <strong>
                  {a.data?.title ||
                    before?.find((i) => i.id === a.item_id)?.title ||
                    items.find((i) => i.id === a.item_id)?.title ||
                    "An item in your planner"}
                </strong>
                <Details action={a} items={items} before={before} />
                {proposal.decision_links?.find(
                  (link) => link.action_index === n,
                ) && (
                  <p>
                    Delivers decision:{" "}
                    {
                      proposal.decision_links.find(
                        (link) => link.action_index === n,
                      )?.decision_title
                    }
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      {sessionChange && (
        <div className="ai-action">
          <span className="ai-op">
            {sessionChange.operation === "move"
              ? "Move session"
              : "Remove session"}
          </span>
          <div className="ai-action-body">
            <strong>{sessionChange.title}</strong>
            <p>
              {new Date(sessionChange.from_start_at).toLocaleString()}–
              {new Date(sessionChange.from_end_at).toLocaleTimeString()}
              {sessionChange.operation === "move" && (
                <>
                  {" "}
                  → {new Date(sessionChange.start_at).toLocaleString()}–
                  {new Date(sessionChange.end_at).toLocaleTimeString()}
                </>
              )}
            </p>
          </div>
        </div>
      )}
      {status === "pending" && (
        <div className="ai-decide">
          <button
            className="primary"
            disabled={busy}
            onClick={() => onApply(giveTasksDeadlines)}
          >
            <Check size={15} />{" "}
            {proposal.project
              ? "Create project and schedule"
              : `Approve ${total} ${total === 1 ? "change" : "changes"}`}
          </button>
          <button className="secondary" disabled={busy} onClick={onDismiss}>
            Discard
          </button>
        </div>
      )}
      {status === "applied" && total > 0 && (
        <p className="ai-status ai-status-ok">
          <Check size={14} /> Saved to your planner
        </p>
      )}
      {status === "discarded" && (
        <p className="ai-status">
          <X size={14} /> Discarded
        </p>
      )}
      {onFollowUp && followUps.length > 0 && (
        <div
          className="ai-follow-ups"
          role="group"
          aria-label="Suggested replies"
        >
          {followUps.map((text, n) => (
            <button
              key={n}
              type="button"
              disabled={busy}
              onClick={() => onFollowUp(text)}
            >
              {text}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
