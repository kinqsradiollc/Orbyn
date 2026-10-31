import { activityOriginLabel, type DocSuggestion } from "@orbyn/core";
import { Check, Undo2, X } from "lucide-react";
import { Button } from "../../../ui/kit";
import { when } from "../model";

/** Changes waiting to be taken or left. A detached one is kept, not offered. */
export function Suggestions({
  suggestions,
  userId,
  canDecide,
  busy,
  onDecide,
  onWithdraw,
  onDecideAll,
}: {
  suggestions: DocSuggestion[];
  userId?: string;
  canDecide: boolean;
  busy: boolean;
  onDecide: (suggestion: DocSuggestion, take: boolean) => void;
  onWithdraw: (suggestion: DocSuggestion) => void;
  onDecideAll: (list: DocSuggestion[], take: boolean) => void;
}) {
  const open = suggestions.filter((suggestion) => suggestion.status === "open");
  if (!open.length) return null;
  const live = open.filter((suggestion) => !suggestion.detached);
  return (
    <section className="doc-suggestions" aria-label="Proposed changes">
      <div className="doc-suggest-head">
        <h3>
          {open.length} proposed change{open.length === 1 ? "" : "s"}
        </h3>
        {canDecide && live.length > 1 && (
          <>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => onDecideAll(live, true)}
            >
              <Check /> Accept all
            </Button>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => onDecideAll(live, false)}
            >
              <X /> Reject all
            </Button>
          </>
        )}
      </div>
      {open.map((suggestion) => (
        <details
          key={suggestion.id}
          className="doc-suggest"
          open={open.length === 1}
        >
          <summary>
            <strong className="small" dir="auto">
              {suggestion.author}
            </strong>
            <span className="small muted">
              {when(suggestion.created_at)}
              {suggestion.via_agent
                ? ` · ${activityOriginLabel({ via_agent: suggestion.via_agent })}`
                : ""}
            </span>
          </summary>
          {!!suggestion.quote && (
            <p className="doc-suggest-before small" dir="auto">
              <span className="muted">Before </span>
              <del>{suggestion.quote}</del>
            </p>
          )}
          <p className="doc-suggest-after small" dir="auto">
            <span className="muted">After </span>
            {suggestion.text ? (
              <ins>{suggestion.text}</ins>
            ) : (
              <em className="muted">Removed</em>
            )}
          </p>
          {suggestion.note && (
            <p className="small muted" dir="auto">
              {suggestion.note}
            </p>
          )}
          {suggestion.detached && (
            <p className="small muted">
              The words this was about have gone from the page.
            </p>
          )}
          <div className="doc-suggest-actions">
            {canDecide && !suggestion.detached && (
              <>
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() => onDecide(suggestion, true)}
                >
                  <Check /> Accept
                </Button>
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() => onDecide(suggestion, false)}
                >
                  <X /> Reject
                </Button>
              </>
            )}
            {(suggestion.user_id === userId ||
              (canDecide && suggestion.detached)) && (
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => onWithdraw(suggestion)}
              >
                <Undo2 /> Withdraw
              </Button>
            )}
          </div>
        </details>
      ))}
    </section>
  );
}
