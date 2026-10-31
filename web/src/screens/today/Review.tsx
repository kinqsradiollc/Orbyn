import { AssistantProfileStore } from "@orbyn/api-client";
import {
  assistantOutcomeDetails,
  assistantReviewGroupSummary,
  groupAssistantReview,
  type AssistantMorningReviewGroup,
  type AssistantMorningReviewItem,
  type ReentryBrief,
  type ReentryLine,
} from "@orbyn/core";
import { ChevronDown, ChevronRight } from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { messageOf, useResource } from "../../lib/resource";
import { navigate } from "../../lib/router";
import { client, getToken } from "../../lib/session";
import { useAccount } from "../../app/account";
import { Button, ErrorNotice, Loading, Pill } from "../../ui/kit";
import { tasks } from "../shared-task";

const KINDS = {
  goal: "Goal",
  routine: "Routine",
  project: "Project",
  task: "Task",
  chat: "Conversation",
  activity: "Activity",
  page: "Page",
};

const PREVIEW = 240;

function Run({
  row,
  onOpen,
}: {
  row: AssistantMorningReviewItem;
  onOpen: () => void;
}) {
  const long = (row.summary?.length ?? 0) > PREVIEW;
  return (
    <li className="today-run">
      <div className="today-run-main">
        <strong dir="auto">{row.title}</strong>
        <span className="today-facts">
          {row.detail}
          {row.at ? ` · ${new Date(row.at).toLocaleString()}` : ""}
        </span>
        {row.summary && (
          <p dir="auto">
            {long ? `${row.summary.slice(0, PREVIEW)}…` : row.summary}
          </p>
        )}
        {long && (
          <details>
            <summary>Full result summary</summary>
            <p dir="auto">{row.summary}</p>
          </details>
        )}
        {row.execution_outcome && (
          <details>
            <summary>Evidence &amp; open questions</summary>
            <ul>
              {assistantOutcomeDetails(row.execution_outcome).map((line, n) => (
                <li key={n}>{line}</li>
              ))}
            </ul>
          </details>
        )}
      </div>
      <Button variant="ghost" onClick={onOpen}>
        {row.action}
      </Button>
    </li>
  );
}

function Group({
  group,
  open,
}: {
  group: AssistantMorningReviewGroup;
  open: (row: AssistantMorningReviewItem) => void;
}) {
  const [shown, setShown] = useState(false);
  const decisions = group.items.filter((i) => i.priority === 0).length;
  const failures = group.items.filter((i) => i.priority === 1).length;
  const Chevron = shown ? ChevronDown : ChevronRight;
  return (
    <li className="today-source">
      <button
        className="today-source-head"
        aria-expanded={shown}
        aria-label={`Review ${group.items.length} ${group.items.length === 1 ? "run" : "runs"} for ${group.title}`}
        onClick={() => setShown(!shown)}
      >
        <Chevron aria-hidden="true" />
        <span className="today-source-main">
          <span className="today-source-title" dir="auto">
            {group.title}
          </span>
          <span className="today-facts">
            {KINDS[group.kind]} · {assistantReviewGroupSummary(group)}
          </span>
        </span>
        {decisions > 0 && <Pill tone="blue">{decisions}</Pill>}
        {failures > 0 && <Pill tone="red">{failures}</Pill>}
      </button>
      {shown && (
        <ul className="today-runs">
          {group.items.map((row) => (
            <Run key={row.id} row={row} onOpen={() => open(row)} />
          ))}
        </ul>
      )}
    </li>
  );
}

/**
 * Agent work since the last look, grouped by the goal, routine or project it
 * came from. Finished runs say so and nothing more: a finished run is not an
 * accepted result. On failure or sign-out the names go, not just the rows.
 */
export function SinceAway() {
  const { user } = useAccount();
  const store = useMemo(
    () => new AssistantProfileStore(client, getToken),
    [user?.id],
  );
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [all, setAll] = useState(false);
  useEffect(() => {
    const refresh = () => {
      if (!document.hidden) void store.refresh();
    };
    refresh();
    document.addEventListener("visibilitychange", refresh);
    const timer = setInterval(refresh, 60_000);
    return () => {
      document.removeEventListener("visibilitychange", refresh);
      clearInterval(timer);
      store.reset();
    };
  }, [store]);
  const groups = snapshot.data ? groupAssistantReview(snapshot.data) : [];
  if (snapshot.data && !snapshot.error && !groups.length) return null;
  const open = (row: AssistantMorningReviewItem) => {
    if (row.docId) navigate(`/app/doc/${row.docId}`);
    else if (row.target === "review") navigate("/app/review");
    else if (row.chatId)
      navigate(`/app/assistant?chat=${encodeURIComponent(row.chatId)}`);
    else
      navigate(
        row.lane === "background" ? "/app/background" : "/app/overnight",
      );
  };
  return (
    <section className="today-section" aria-labelledby="today-away">
      <header className="today-section-head">
        <h2 id="today-away">Since you were away</h2>
        <Button
          variant="ghost"
          disabled={snapshot.loading}
          onClick={() => void store.refresh()}
        >
          {snapshot.loading
            ? "Refreshing…"
            : snapshot.error
              ? "Try again"
              : "Refresh"}
        </Button>
      </header>
      {snapshot.error ? (
        <ErrorNotice
          message="Couldn't load recent agent work."
          onRetry={() => void store.refresh()}
        />
      ) : !snapshot.data ? (
        <Loading label="Loading recent agent work" />
      ) : (
        <>
          <ul className="today-sources">
            {(all ? groups : groups.slice(0, 4)).map((group) => (
              <Group key={group.id} group={group} open={open} />
            ))}
          </ul>
          {groups.length > 4 && (
            <Button variant="ghost" onClick={() => setAll(!all)}>
              {all
                ? "Show fewer groups"
                : `Show all recent work (${groups.length} groups)`}
            </Button>
          )}
          {snapshot.data.profiles.some(
            (p) =>
              p.work_truncated || p.outputs_truncated || p.page_runs_truncated,
          ) && (
            <p className="muted small">
              More runs are in agent activity and Review.
            </p>
          )}
          <p className="muted small">
            Checked {new Date(snapshot.data.observed_at).toLocaleString()}
          </p>
          <nav className="today-links" aria-label="Agent activity">
            <button onClick={() => navigate("/app/review")}>
              All decisions &amp; changes
            </button>
            <button onClick={() => navigate("/app/background")}>
              Background activity
            </button>
            <button onClick={() => navigate("/app/overnight")}>
              Overnight activity
            </button>
          </nav>
        </>
      )}
    </section>
  );
}

const SECTIONS: { key: keyof ReentryBrief; label: string }[] = [
  { key: "asks", label: "Waiting for your answer" },
  { key: "assigned", label: "Handed to you" },
  { key: "due", label: "Due now" },
  { key: "changed", label: "Moved on your tasks" },
  { key: "mentions", label: "You were mentioned" },
  { key: "pages", label: "Pages that changed" },
];

/** Back after days away: what happened, most pressing first. Shows once. */
export function WelcomeBack() {
  const brief = useResource(() => client.reentry(), []);
  const [gone, setGone] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);
  const data = brief.data;
  if (!data || gone) return null;
  const sections = SECTIONS.map((s) => ({
    ...s,
    lines: data[s.key] as ReentryLine[],
  })).filter((s) => s.lines.length);
  const dismiss = async () => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await client.dismissReentry();
      setGone(true);
    } catch (failure) {
      setError(messageOf(failure, "Couldn't dismiss this."));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const open = (line: ReentryLine) =>
    line.ask_id
      ? navigate("/app/notifications")
      : line.item_id
        ? tasks.open(line.item_id)
        : line.doc_id
          ? navigate(`/app/doc/${line.doc_id}`)
          : undefined;
  return (
    <section className="today-welcome" aria-labelledby="today-welcome">
      <header className="today-section-head">
        <h2 id="today-welcome">
          Welcome back
          <span className="today-head-note">
            {data.days_away} {data.days_away === 1 ? "day" : "days"} away
          </span>
        </h2>
        <Button busy={busy} onClick={() => void dismiss()}>
          Got it
        </Button>
      </header>
      {error && <ErrorNotice message={error} onRetry={() => void dismiss()} />}
      <div className="today-welcome-grid">
        {sections.map((s) => (
          <div key={s.key}>
            <h3>
              {s.label} <span className="today-count">{s.lines.length}</span>
            </h3>
            <ul>
              {(expanded ? s.lines : s.lines.slice(0, 3)).map((line, n) => (
                <li key={n}>
                  <button
                    disabled={!line.ask_id && !line.item_id && !line.doc_id}
                    onClick={() => open(line)}
                  >
                    <span dir="auto">{line.title}</span>
                    <small dir="auto">{line.detail}</small>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      {sections.some((s) => s.lines.length > 3) && (
        <Button variant="ghost" onClick={() => setExpanded(!expanded)}>
          {expanded ? "Show less" : "Show all updates"}
        </Button>
      )}
    </section>
  );
}
