import { dateLabel, type Item, type Proposal } from "@orbyn/core";

type Props = {
  proposal: Proposal;
  items: Item[];
  busy: boolean;
  onApply: () => void;
  onDismiss: () => void;
};

/** The assistant's summary plus each proposed change, with Approve/Discard. */
export function ProposalReview({
  proposal,
  items,
  busy,
  onApply,
  onDismiss,
}: Props) {
  return (
    <div className="proposal">
      <p>{proposal.summary}</p>
      {proposal.actions.map((a, n) => (
        <div className="proposal-action" key={n}>
          <strong>
            {a.operation.toUpperCase()} ·{" "}
            {a.data?.title ||
              items.find((i) => i.id === a.item_id)?.title ||
              a.item_id}
          </strong>
          {a.data && (
            <>
              <p>{a.data.notes}</p>
              <small>
                {a.data.kind} · {a.data.status} · {a.data.priority} priority
                <br />
                {dateLabel(a.data.due_at)}
                {a.data.end_at && " → " + dateLabel(a.data.end_at)} · Remind{" "}
                {a.data.reminder_minutes} min before
              </small>
            </>
          )}
        </div>
      ))}
      {proposal.actions.length > 0 && (
        <div className="button-row">
          <button className="primary" disabled={busy} onClick={onApply}>
            Approve {proposal.actions.length} changes
          </button>
          <button className="secondary" disabled={busy} onClick={onDismiss}>
            Discard
          </button>
        </div>
      )}
    </div>
  );
}
