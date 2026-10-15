import { useElementWidth } from "../../hooks/useElementWidth";
import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Bot,
  Check,
  Inbox,
  Mail,
  Sparkles,
  X,
} from "lucide-react";
import type { ReviewInbox, ReviewItem } from "@orbyn/core";
import { client } from "../../lib/api";
import { onLive } from "../../lib/live";
import { timeAgo } from "../../lib/tasks";
import { EmptyState } from "../../components/EmptyState";
import { OutcomeNote, useAction } from "../../components/Outcome";
import { useConfirm } from "../../components/Confirm";
import "./review.css";

type Props = {
  report: (e: unknown) => void;
  /** A proposal to open first (from /app/review/<id> or a notice). */
  focusId?: string | null;
  onFocused?: () => void;
  /** Tells the sidebar how many wait. */
  onCount?: (pending: number) => void;
};

/** "in 2 days", "in 40 min": how long a proposal still waits. */
function expiresIn(iso: string) {
  const ms = Date.parse(iso) - Date.now();
  if (ms <= 0) return "expired";
  const min = Math.round(ms / 60_000);
  if (min < 60) return `expires in ${min} min`;
  const h = Math.round(min / 60);
  if (h < 48) return `expires in ${h} h`;
  return `expires in ${Math.round(h / 24)} days`;
}

const STATUS: Record<ReviewItem["status"], string> = {
  pending: "Waiting",
  applied: "Approved",
  declined: "Declined",
  cancelled: "Cancelled",
  expired: "Expired",
};

/**
 * Review: every change an outside agent (or the assistant) proposed, waiting
 * for you. Each shows what it would change, before and after, and whether
 * the thing changed since; approve all, some, or decline. Nothing changes
 * until you approve, and only you, signed in here, can.
 */
export function ReviewView({ report, focusId, onFocused, onCount }: Props) {
  const { ref: pageRef, width: pageWidth } = useElementWidth();
  const { ask } = useConfirm();
  const [inbox, setInbox] = useState<ReviewInbox | null>(null);
  const [openId, setOpenId] = useState<string | null>(focusId ?? null);
  const [open, setOpen] = useState<ReviewItem | null>(null);
  const [chosen, setChosen] = useState<Set<number>>(new Set());
  const action = useAction(report);
  const pendingRef = useRef(action.pending);
  pendingRef.current = action.pending;
  const detailRef = useRef<HTMLDivElement>(null);

  const mounted = useRef(true);
  const inboxEpoch = useRef(0);
  const itemEpoch = useRef(0);
  const selectedId = useRef(openId);
  selectedId.current = openId;
  const reportRef = useRef(report);
  reportRef.current = report;
  const countRef = useRef(onCount);
  countRef.current = onCount;
  const [listError, setListError] = useState(false);
  const [detailError, setDetailError] = useState(false);
  const [detailPending, setDetailPending] = useState(false);

  const load = async () => {
    const epoch = ++inboxEpoch.current;
    setListError(false);
    try {
      const next = await client.reviewInbox();
      if (!mounted.current || epoch !== inboxEpoch.current) return;
      setInbox(next);
      countRef.current?.(next.pending.length);
    } catch (error) {
      if (mounted.current && epoch === inboxEpoch.current) {
        setListError(true);
        reportRef.current(error);
      }
    }
  };
  const loadOne = async (id: string) => {
    const epoch = ++itemEpoch.current;
    setDetailPending(true);
    setDetailError(false);
    try {
      const item = await client.reviewItem(id);
      if (
        !mounted.current ||
        epoch !== itemEpoch.current ||
        selectedId.current !== id
      )
        return;
      setOpen(item);
      setChosen(new Set(item.changes.map((change) => change.index)));
    } catch (error) {
      if (
        mounted.current &&
        epoch === itemEpoch.current &&
        selectedId.current === id
      ) {
        setDetailError(true);
        reportRef.current(error);
      }
    } finally {
      if (mounted.current && epoch === itemEpoch.current)
        setDetailPending(false);
    }
  };

  useEffect(() => {
    mounted.current = true;
    void load();
    const stop = onLive((news) => {
      if (news.kind !== "changed" || (news.area && news.area !== "review"))
        return;
      void load();
      if (selectedId.current && !pendingRef.current)
        void loadOne(selectedId.current);
    });
    return () => {
      mounted.current = false;
      inboxEpoch.current++;
      itemEpoch.current++;
      stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!focusId) return;
    setOpenId(focusId);
    onFocused?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId]);

  useEffect(() => {
    itemEpoch.current++;
    setOpen(null);
    setDetailError(false);
    if (!openId) {
      return;
    }
    void loadOne(openId).then(() =>
      detailRef.current?.scrollIntoView({ block: "nearest" }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openId]);

  const approve = (item: ReviewItem) => {
    if (
      detailPending ||
      detailError ||
      selectedId.current !== item.id ||
      item.status !== "pending" ||
      !chosen.size ||
      item.changes.some(
        (c) => c.stale && (!item.partial || chosen.has(c.index)),
      )
    )
      return;
    return action.run(async () => {
      const only =
        item.partial && chosen.size < item.changes.length
          ? [...chosen]
          : undefined;
      await client.approveReview(item.id, only ? { only } : {});
      await Promise.all([load(), loadOne(item.id)]);
      return only
        ? `Approved ${only.length} of ${item.changes.length} changes.`
        : "Changes approved.";
    });
  };

  const decline = async (item: ReviewItem) => {
    if (
      action.pending ||
      detailPending ||
      detailError ||
      item.status !== "pending"
    )
      return;
    if (
      !(await ask({
        title: `Decline what ${item.proposer} suggests?`,
        body: "Nothing changes, and it leaves your inbox.",
        confirmLabel: "Decline",
        destructive: true,
      }))
    )
      return;
    if (
      selectedId.current !== item.id ||
      !mounted.current ||
      detailPending ||
      detailError
    )
      return;
    await action.run(async () => {
      await client.declineReview(item.id);
      await Promise.all([load(), loadOne(item.id)]);
      return "Suggestion declined.";
    });
  };

  const toggle = (index: number) =>
    setChosen((now) => {
      const next = new Set(now);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });

  if (!inbox)
    return listError ? (
      <div role="alert">
        <p>Couldn't load suggestions.</p>
        <button className="secondary" onClick={() => void load()}>
          Retry
        </button>
      </div>
    ) : (
      <p className="muted review-loading" role="status">
        Loading…
      </p>
    );

  const card = (item: ReviewItem) => (
    <li key={item.id}>
      <button
        className={"review-card" + (openId === item.id ? " active" : "")}
        aria-current={openId === item.id ? "true" : undefined}
        disabled={action.pending}
        onClick={() => setOpenId(item.id)}
      >
        <span className="review-card-icon" aria-hidden>
          {item.source === "assistant" ? (
            <Sparkles size={16} />
          ) : (
            <Bot size={16} />
          )}
        </span>
        <span className="review-card-text">
          <strong>{item.summary}</strong>
          <small>
            {item.kind === "idea" ? "Idea · " : ""}
            {item.proposer} · {item.changes.length} change
            {item.changes.length === 1 ? "" : "s"} ·{" "}
            {item.status === "pending"
              ? expiresIn(item.expires_at)
              : `${STATUS[item.status]} ${timeAgo(item.decided_at ?? item.expires_at)}`}
          </small>
        </span>
      </button>
    </li>
  );

  const anyStale = open?.changes.some((c) => c.stale) ?? false;
  const chosenStale =
    open?.changes.some((c) => c.stale && chosen.has(c.index)) ?? false;

  return (
    <div
      ref={pageRef}
      className={
        "review-view" +
        (pageWidth < 900 ? " is-compact" : "") +
        (pageWidth < 520 ? " is-small" : "")
      }
    >
      <section className="review-list" aria-label="Waiting for you">
        {listError && (
          <div role="alert">
            <p>Couldn't refresh suggestions.</p>
            <button className="secondary" onClick={() => void load()}>
              Retry
            </button>
          </div>
        )}
        {inbox.pending.length ? (
          <ul>{inbox.pending.map(card)}</ul>
        ) : (
          <EmptyState
            icon={Inbox}
            title="No pending suggestions"
            body="Agent changes wait here for your approval."
          />
        )}
        {inbox.recent.length > 0 && (
          <>
            <h2 className="review-list-heading">Recent decisions</h2>
            <ul>{inbox.recent.map(card)}</ul>
          </>
        )}
      </section>

      <section
        className="review-detail"
        ref={detailRef}
        aria-live="polite"
        aria-label="Changes"
      >
        {detailError && (
          <div role="alert">
            <p>Couldn't load these changes.</p>
            <button
              className="secondary"
              disabled={action.pending || detailPending}
              onClick={() => openId && void loadOne(openId)}
            >
              Retry
            </button>
          </div>
        )}
        {detailPending && (
          <p className="muted" role="status">
            Loading changes…
          </p>
        )}
        {!open ? (
          <p className="muted review-pick">
            {openId ? "" : "Choose a suggestion to review."}
          </p>
        ) : (
          <>
            <header className="review-detail-head">
              <span className="eyebrow">
                {open.kind === "idea" ? "Idea · " : ""}
                {open.proposer} · {STATUS[open.status]}
              </span>
              <h2>{open.summary}</h2>
              <p className="muted">
                Suggested {timeAgo(open.created_at)}
                {open.status === "pending" &&
                  ` · ${expiresIn(open.expires_at)}`}
              </p>
            </header>
            <ol className="review-changes">
              {open.changes.map((c) => (
                <li
                  key={c.index}
                  className={"review-change" + (c.stale ? " stale" : "")}
                >
                  <div className="review-change-head">
                    {open.partial && open.status === "pending" && (
                      <input
                        type="checkbox"
                        aria-label={`Include: ${c.headline}`}
                        checked={chosen.has(c.index)}
                        disabled={
                          action.pending || detailPending || detailError
                        }
                        onChange={() => toggle(c.index)}
                      />
                    )}
                    <strong>{c.headline}</strong>
                    <span className="chip">{c.space}</span>
                  </div>
                  {c.rows.length > 0 && (
                    <table className="review-rows">
                      <tbody>
                        {c.rows.map((r, i) => (
                          <tr key={i}>
                            {r.label && <th scope="row">{r.label}</th>}
                            <td colSpan={r.label ? 1 : 2}>
                              {r.before !== null && (
                                <del className="review-before">{r.before}</del>
                              )}
                              {r.after !== null && (
                                <ins className="review-after">{r.after}</ins>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                  {c.emails.length > 0 && (
                    <p className="review-note">
                      <Mail size={14} /> Emails {c.emails.join(", ")}
                    </p>
                  )}
                  {c.stale && (
                    <p className="review-note warn">
                      <AlertTriangle size={14} /> {c.stale_reason}
                    </p>
                  )}
                </li>
              ))}
            </ol>
            {open.status === "pending" && (
              <div className="review-actions">
                <button
                  className="secondary"
                  disabled={action.pending || detailPending || detailError}
                  onClick={() => void decline(open)}
                >
                  <X size={15} /> Decline
                </button>
                <button
                  className="primary"
                  disabled={
                    action.pending ||
                    detailPending ||
                    detailError ||
                    chosen.size === 0 ||
                    chosenStale ||
                    (!open.partial && anyStale)
                  }
                  onClick={() => void approve(open)}
                >
                  <Check size={15} />
                  {open.partial && chosen.size < open.changes.length
                    ? `Approve ${chosen.size} of ${open.changes.length}`
                    : "Approve"}
                </button>
              </div>
            )}
            {chosenStale && open.status === "pending" && (
              <p className="muted review-hint">
                Some changes are stale. Omit them, or decline and ask again.
              </p>
            )}
            <OutcomeNote outcome={action.outcome} />
          </>
        )}
      </section>
    </div>
  );
}
