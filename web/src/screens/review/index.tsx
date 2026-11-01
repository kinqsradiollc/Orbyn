import { HttpError, reviewPath, type ReviewItem } from "@orbyn/core";
import { ArrowLeft, ArrowRight, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { messageOf } from "../../lib/resource";
import { useNavigate, useBeforeNavigate, useTitle } from "../../lib/router";
import { client } from "../../lib/session";
import {
  Button,
  Empty,
  ErrorNotice,
  Loading,
  Pill,
  useConfirm,
} from "../../ui/kit";
import { useOwned, useOwner } from "../agents-shared/hooks";
import { ReplyText } from "../agents-shared/ReplyText";
import { refreshPlanner } from "../shared-task";
import { useReviewRead } from "./data";
import "./review.css";

const STATUS: Record<ReviewItem["status"], string> = {
  pending: "Waiting for you",
  applied: "Approved",
  declined: "Declined",
  cancelled: "Cancelled",
  expired: "Expired",
};
const stamp = (at: string) => new Date(at).toLocaleString();
const validId = (id: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

export default function ReviewScreen({
  params,
}: {
  params: Record<string, string>;
}) {
  const navigate = useNavigate();
  const owner = useOwner();
  useTitle("Review");
  const id = params.id;
  return (
    <div className="review-page">
      {id ? (
        validId(id) ? (
          <Decision key={`${owner}:${id}`} id={id} />
        ) : (
          <Empty title="This review link is invalid">
            <Button onClick={() => navigate("/app/review")}>
              Back to Review
            </Button>
          </Empty>
        )
      ) : (
        <Inbox key={owner} />
      )}
    </div>
  );
}

function Inbox() {
  const read = useReviewRead(() => client.reviewInbox());
  const [recentCount, setRecentCount] = useState(10);
  return (
    <>
      <header className="review-head">
        <div>
          <h1>Review</h1>
          <p className="muted">Decide what changes in your workspace.</p>
        </div>
        <Button
          variant="ghost"
          disabled={read.loading}
          onClick={() => void read.reload()}
        >
          <RefreshCw size={16} /> Refresh
        </Button>
      </header>
      {read.error && (
        <ErrorNotice message={read.error} onRetry={() => void read.reload()} />
      )}
      {!read.data && read.loading && <Loading label="Opening Review" />}
      {read.data && (
        <>
          <section
            className="review-section"
            aria-label="Waiting for your decision"
          >
            <header>
              <h2>Waiting for you</h2>
              <Pill>{read.data.pending.length}</Pill>
            </header>
            {read.data.pending.length ? (
              <ReviewRows items={read.data.pending} />
            ) : (
              <Empty title="You're caught up">
                <p>
                  New proposals will appear here before they change your
                  workspace.
                </p>
              </Empty>
            )}
          </section>
          <section className="review-section" aria-label="Recent decisions">
            <h2>Recent decisions</h2>
            {read.data.recent.length ? (
              <ReviewRows items={read.data.recent.slice(0, recentCount)} />
            ) : (
              <p className="muted">No recent decisions.</p>
            )}
            {recentCount < read.data.recent.length && (
              <Button
                variant="ghost"
                onClick={() => setRecentCount((n) => n + 10)}
              >
                Show 10 more
              </Button>
            )}
          </section>
        </>
      )}
    </>
  );
}

function ReviewRows({ items }: { items: ReviewItem[] }) {
  const navigate = useNavigate();
  return (
    <ul className="review-list">
      {items.map((item) => (
        <li key={item.id}>
          <button
            type="button"
            className="review-open"
            onClick={() => navigate(reviewPath(item.id))}
          >
            <span className="review-row-copy">
              <strong dir="auto">
                {item.summary || "Proposed workspace changes"}
              </strong>
              <span className="small muted" dir="auto">
                {item.proposer} · {item.changes.length} change
                {item.changes.length === 1 ? "" : "s"} ·{" "}
                {stamp(item.decided_at || item.created_at)}
              </span>
            </span>
            <span className="review-row-status">
              <Pill tone={item.status === "pending" ? "amber" : undefined}>
                {STATUS[item.status]}
              </Pill>
              <ArrowRight size={16} aria-hidden="true" />
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function Decision({ id }: { id: string }) {
  const navigate = useNavigate();
  const owned = useOwned();
  const confirm = useConfirm();
  const lock = useRef(false);
  const read = useReviewRead(
    () => client.reviewItem(id),
    () => lock.current,
  );
  const [chosen, setChosen] = useState<Set<number> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const [receipt, setReceipt] = useState<"approve" | "decline" | null>(null);
  const exitState = useRef({ uncertain });
  exitState.current = { uncertain };
  const prepareLeave = useCallback(
    () => !lock.current && !exitState.current.uncertain,
    [],
  );
  useBeforeNavigate(prepareLeave);
  const [, tick] = useState(0);
  const item = read.data;
  const selected =
    chosen ??
    new Set(
      item?.changes
        .filter((c) => !item.partial || !c.stale)
        .map((c) => c.index) ?? [],
    );
  const expired = !!item && Date.parse(item.expires_at) <= Date.now();
  const pending = item?.status === "pending" && !expired;
  const stale = !!item?.changes.some(
    (c) => c.stale && (!item.partial || selected.has(c.index)),
  );
  const blocked =
    busy ||
    read.loading ||
    !read.fresh ||
    !!read.error ||
    uncertain ||
    !!receipt;
  useEffect(() => {
    if (!item || item.status !== "pending") return;
    const delay = Date.parse(item.expires_at) - Date.now();
    if (delay <= 0) return;
    const timer = window.setTimeout(
      () => {
        if (owned()) {
          tick((n) => n + 1);
          void read.reload();
        }
      },
      Math.min(delay + 10, 2_147_483_647),
    );
    return () => window.clearTimeout(timer);
  }, [item?.expires_at, item?.status, owned, read.reload]);
  useEffect(() => {
    if (item && item.status !== "pending" && uncertain) {
      setUncertain(false);
      setError("");
    }
  }, [item?.status, uncertain]);

  const decide = async (action: "approve" | "decline") => {
    if (
      !owned() ||
      lock.current ||
      read.pending() ||
      !item ||
      !pending ||
      blocked ||
      item.id !== id
    )
      return;
    const indexes = item.changes
      .filter((c) => selected.has(c.index))
      .map((c) => c.index);
    if (action === "approve" && (!indexes.length || stale)) return;
    lock.current = true;
    setBusy(true);
    setError("");
    let dispatched = false;
    try {
      if (
        action === "decline" &&
        !(await confirm({
          title: "Decline this proposal?",
          body: "Its proposed changes will be left out of your workspace.",
          action: "Decline",
          danger: true,
        }))
      )
        return;
      if (!owned()) return;
      read.invalidate();
      dispatched = true;
      if (action === "approve")
        await client.approveReview(
          id,
          item.partial && indexes.length < item.changes.length
            ? { only: indexes }
            : {},
        );
      else await client.declineReview(id);
      if (!owned()) return;
      setReceipt(action);
      if (action === "approve") void refreshPlanner();
    } catch (failure) {
      if (!owned()) return;
      const status = failure instanceof HttpError ? failure.statusCode : 0;
      const unknown =
        dispatched &&
        (!status || status >= 500 || status === 408 || status === 429);
      setUncertain(unknown);
      setError(
        unknown
          ? "The decision receipt is unavailable. Check its saved outcome before making another decision."
          : messageOf(
              failure,
              "Couldn't save this decision. Your selection is kept.",
            ),
      );
    } finally {
      lock.current = false;
      if (owned()) {
        setBusy(false);
        void read.reload();
      }
    }
  };

  return (
    <>
      <header className="review-head">
        <Button
          variant="ghost"
          disabled={busy}
          onClick={() => navigate("/app/review")}
        >
          <ArrowLeft size={16} /> All reviews
        </Button>
        <Button
          variant="ghost"
          disabled={busy || read.loading}
          onClick={() => void read.reload()}
        >
          <RefreshCw size={16} /> Check saved outcome
        </Button>
      </header>
      {read.error && (
        <ErrorNotice message={read.error} onRetry={() => void read.reload()} />
      )}
      {!item && read.loading && <Loading label="Loading proposal" />}
      {!item && !read.loading && !read.error && (
        <Empty title="This proposal is unavailable" />
      )}
      {item && (
        <>
          <header className="review-heading">
            <div className="review-kicker">
              <Pill tone={pending ? "amber" : undefined}>
                {expired && item.status === "pending"
                  ? "Expired"
                  : STATUS[item.status]}
              </Pill>
              <span className="small muted" dir="auto">
                {item.proposer} ·{" "}
                {item.source === "agent" ? "Outside agent" : "Orbyn assistant"}
              </span>
            </div>
            <h1>Review proposed changes</h1>
            <ReplyText text={item.summary} />
            <p className="small muted">
              Proposed {stamp(item.created_at)} ·{" "}
              {item.decided_at
                ? `Decided ${stamp(item.decided_at)}`
                : `Expires ${stamp(item.expires_at)}`}
            </p>
          </header>
          {error && <ErrorNotice message={error} />}
          {receipt && (
            <p className="review-confirmed" role="status">
              {receipt === "approve"
                ? "Changes approved."
                : "Proposal declined."}
              {read.error
                ? " Its saved status couldn't be refreshed; another decision remains blocked."
                : ""}
            </p>
          )}
          {uncertain && item.status === "pending" && (
            <p className="review-warning" role="status">
              A request may still be finishing. Refreshing a pending proposal
              does not confirm that it failed.
            </p>
          )}
          <section className="review-section" aria-label="Proposed changes">
            <header>
              <h2>
                {item.changes.length} proposed change
                {item.changes.length === 1 ? "" : "s"}
              </h2>
              {item.partial && pending && (
                <span className="small muted">
                  Choose which changes to approve.
                </span>
              )}
            </header>
            {item.partial && pending && (
              <div className="review-selection">
                <Button
                  variant="ghost"
                  disabled={blocked}
                  onClick={() =>
                    setChosen(
                      new Set(
                        item.changes
                          .filter((c) => !c.stale)
                          .map((c) => c.index),
                      ),
                    )
                  }
                >
                  Select available
                </Button>
                <Button
                  variant="ghost"
                  disabled={blocked}
                  onClick={() => setChosen(new Set())}
                >
                  Clear selection
                </Button>
              </div>
            )}
            <ol className="review-changes">
              {item.changes.map((change) => (
                <li key={change.index}>
                  <header>
                    <div>
                      {item.partial && pending ? (
                        <label className="review-choice">
                          <input
                            type="checkbox"
                            checked={selected.has(change.index)}
                            disabled={blocked || change.stale}
                            onChange={(event) => {
                              const next = new Set(selected);
                              if (event.target.checked) next.add(change.index);
                              else next.delete(change.index);
                              setChosen(next);
                            }}
                          />
                          <strong dir="auto">{change.headline}</strong>
                        </label>
                      ) : (
                        <h3 dir="auto">{change.headline}</h3>
                      )}
                      <span className="small muted" dir="auto">
                        {change.space}
                      </span>
                    </div>
                    {change.stale && (
                      <Pill tone="amber">Changed since proposed</Pill>
                    )}
                  </header>
                  {change.stale_reason && (
                    <p className="review-warning">{change.stale_reason}</p>
                  )}
                  {change.rows.length > 0 && (
                    <dl className="review-diff">
                      {change.rows.map((row, index) => (
                        <div key={index}>
                          <dt>{row.label}</dt>
                          <dd>
                            <div>
                              <span className="small muted">Before</span>
                              <p dir="auto">{row.before ?? "—"}</p>
                            </div>
                            <div>
                              <span className="small muted">After</span>
                              <p dir="auto">{row.after ?? "—"}</p>
                            </div>
                          </dd>
                        </div>
                      ))}
                    </dl>
                  )}
                  {change.emails.length > 0 && (
                    <p className="review-warning">
                      Notifies by email: {change.emails.join(", ")}
                    </p>
                  )}
                </li>
              ))}
            </ol>
          </section>
          {pending && (
            <footer className="review-decisions">
              <p className="small muted">
                {stale
                  ? "Refresh and review the changed items before approving."
                  : item.partial
                    ? `${item.changes.filter((c) => selected.has(c.index)).length} of ${item.changes.length} changes selected`
                    : "All changes are approved together."}
              </p>
              <div>
                <Button
                  variant="ghost"
                  disabled={blocked}
                  onClick={() => void decide("decline")}
                >
                  Decline
                </Button>
                <Button
                  variant="primary"
                  busy={busy}
                  disabled={blocked || stale || !selected.size}
                  onClick={() => void decide("approve")}
                >
                  {item.partial && selected.size < item.changes.length
                    ? "Approve selected"
                    : "Approve changes"}
                </Button>
              </div>
            </footer>
          )}
        </>
      )}
    </>
  );
}
