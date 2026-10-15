import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useModalFocus } from "../../hooks/useModalFocus";
import { Activity, X } from "lucide-react";
import {
  activityOriginLabel,
  changeEdits,
  changeTime,
  changeVerb,
  groupChangesByDay,
  type TeamChange,
} from "@orbyn/core";
import { client } from "../../lib/api";
import { deviceTimeZone, errorText } from "../../lib/planning";
import { openObject, peekObject } from "../docs/DocLinks";
import "./changes.css";
import { CONCEPT_ICON } from "../../app/concept-icons";

const HIDE_KEY = "orbyn-changes-hide-mine";

const hideMineAtFirst = () => {
  try {
    return localStorage.getItem(HIDE_KEY) !== "0";
  } catch {
    return true;
  }
};

const ICONS = {
  page: CONCEPT_ICON.page,
  task: CONCEPT_ICON.task,
  event: CONCEPT_ICON.event,
} as const;

/**
 * Recent changes (SHR-02): who changed which team page or task, grouped by
 * day, newest first, with your own hidden unless you ask. A row opens what
 * changed; ⌘-click opens it beside. For one team (the team's page), or for
 * every team you are in (Overview).
 */
export function RecentChanges({
  teamId,
  limit = 30,
  compact = false,
  showTeam = !teamId,
}: {
  teamId?: string;
  limit?: number;
  /** Overview's card: fewer rows, no paging. */
  compact?: boolean;
  showTeam?: boolean;
}) {
  const [hideMine, setHideMine] = useState(hideMineAtFirst);
  const [changes, setChanges] = useState<TeamChange[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [error, setError] = useState("");
  const zone = deviceTimeZone();
  const request = useRef(0);
  const fetching = useRef(false);
  const [loading, setLoading] = useState(false);

  const load = useCallback(
    async (before?: string) => {
      if (before && fetching.current) return;
      const version = ++request.current;
      fetching.current = true;
      setLoading(true);
      setError("");
      try {
        const page = await client.listChanges({
          team_id: teamId,
          hide_mine: hideMine,
          before,
          limit,
        });
        if (version !== request.current) return;
        setChanges((was) =>
          before ? [...(was ?? []), ...page.changes] : page.changes,
        );
        setNext(page.next);
      } catch (error) {
        if (version === request.current) setError(errorText(error));
      } finally {
        if (version === request.current) {
          fetching.current = false;
          setLoading(false);
        }
      }
    },
    [teamId, hideMine, limit],
  );
  useEffect(() => {
    setChanges(null);
    setNext(null);
    void load();
    return () => {
      request.current++;
      fetching.current = false;
    };
  }, [load]);

  const days = groupChangesByDay(changes ?? [], zone);
  return (
    <section className="card recent-changes" aria-labelledby="changes-title">
      <div className="recent-changes-head">
        <h2 id="changes-title">
          <Activity size={16} aria-hidden="true" /> Recent changes
        </h2>
        <label className="switch-line">
          <input
            type="checkbox"
            role="switch"
            className="ai-switch"
            checked={hideMine}
            onChange={(e) => {
              setHideMine(e.target.checked);
              try {
                localStorage.setItem(HIDE_KEY, e.target.checked ? "1" : "0");
              } catch {
                // The choice lasts this visit.
              }
            }}
          />
          <span>Hide my changes</span>
        </label>
      </div>
      {error && (
        <div role="alert" className="error">
          {error}
          <button
            type="button"
            className="text-button"
            disabled={loading}
            onClick={() => void load(changes ? (next ?? undefined) : undefined)}
          >
            Retry
          </button>
        </div>
      )}
      {changes === null && !error && <p className="muted">Loading…</p>}
      {changes && !changes.length && (
        <p className="section-empty">
          {hideMine ? "No recent changes from others." : "No recent changes."}
        </p>
      )}
      {days.slice(0, compact ? 2 : undefined).map((day) => (
        <div key={day.day} className="changes-day">
          <h3>{day.label}</h3>
          <ul>
            {day.changes.slice(0, compact ? 5 : undefined).map((c) => {
              const Icon = ICONS[c.kind];
              const edits = changeEdits(c);
              const via = activityOriginLabel({ via_agent: c.via_agent });
              const ref = {
                kind: c.kind === "page" ? ("doc" as const) : ("task" as const),
                id: c.object_id,
              };
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    className="change-row"
                    disabled={!c.open}
                    title={
                      c.open
                        ? "Open. ⌘-click (Ctrl-click) opens it beside."
                        : "It was deleted since."
                    }
                    onClick={(e) =>
                      e.metaKey || e.ctrlKey ? peekObject(ref) : openObject(ref)
                    }
                  >
                    <Icon size={14} aria-hidden="true" />
                    <span className="change-text">
                      <span className="change-who">{changeVerb(c)}</span>{" "}
                      <strong>{c.title || "Untitled"}</strong>
                      {(edits || showTeam || via) && (
                        <small>
                          {[edits, showTeam ? c.team_name : "", via]
                            .filter(Boolean)
                            .join(" · ")}
                        </small>
                      )}
                    </span>
                    <time dateTime={c.at}>{changeTime(c.at, zone)}</time>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      {!compact && next && (
        <button
          className="text-button"
          disabled={loading}
          onClick={() => void load(next)}
        >
          {loading ? "Loading…" : "Earlier changes"}
        </button>
      )}
    </section>
  );
}

/** Recent changes in every team you are in, over the app (⌘K). */
export function RecentChangesDialog({ onClose }: { onClose: () => void }) {
  const focus = useModalFocus(onClose);
  useEffect(() => {
    const node = focus.ref.current as HTMLDialogElement;
    node.showModal();
    return () => node.close();
  }, []);
  return createPortal(
    <dialog
      ref={(node) => {
        focus.ref.current = node;
      }}
      className="modal changes-dialog"
      data-modal-focus={focus.id}
      aria-label="Recent changes"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <button
        className="icon-button changes-close"
        aria-label="Close recent changes"
        onClick={onClose}
        autoFocus
      >
        <X size={18} />
      </button>
      <RecentChanges />
    </dialog>,
    document.body,
  );
}
