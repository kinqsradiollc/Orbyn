import { useEffect, useRef, useState } from "react";
import { ListFilter, Settings2 } from "lucide-react";
import {
  cellText,
  daysLeft,
  daysLeftText,
  isOverdue,
  liveListText,
  parseLiveList,
  VIEW_SOURCE_LABELS,
  type SavedView,
  type ViewDefinitionInput,
  type ViewResult,
  type ViewRow,
} from "@orbyn/core";
import { client } from "../../lib/api";
import { Popover } from "../../components/Popover";
import { OPEN_LINK_EVENT, usePageActions } from "../docs/DocLinks";
import "./views.css";

/** Something to open, asked of the app the way link pills ask. */
const openRow = (row: ViewRow) =>
  window.dispatchEvent(
    new CustomEvent(OPEN_LINK_EVENT, {
      detail: `orbyn://${row.kind === "page" ? "doc" : row.kind}/${row.id}`,
    }),
  );

/** Ready-made lists for a page; its project's open tasks lead. */
export function liveListChoices(projectId: string | null) {
  const out: { label: string; text: string }[] = [];
  if (projectId)
    out.push({
      label: "Open tasks in this page's project",
      text: liveListText({
        title: "Open tasks",
        definition: { source: "tasks", filters: { project: projectId } },
      }),
    });
  out.push(
    {
      label: "Tasks due in the next 7 days",
      text: liveListText({
        title: "Due this week",
        definition: { source: "tasks", filters: { due_within_days: 7 } },
      }),
    },
    {
      label: "Overdue tasks",
      text: liveListText({
        title: "Overdue",
        definition: { source: "tasks", filters: { overdue: true } },
      }),
    },
    {
      label: "Pages changed this week",
      text: liveListText({
        title: "Changed this week",
        definition: {
          source: "pages",
          filters: { updated_within_days: 7 },
          sort: { by: "updated", dir: "asc" },
        } as ViewDefinitionInput,
      }),
    },
  );
  return out;
}

/**
 * A live list in a page (SRCH-02): rows of a saved view, or of a filter of
 * its own ("Open tasks in this project"), read afresh each time the page is
 * shown, with working ticks. Everyone sees only what they can open. The
 * page keeps it as a fenced block, so exports and imports keep it too.
 */
export function LiveList({
  text,
  projectId,
  onChange,
}: {
  text: string;
  projectId: string | null;
  /** Choose another list (only for someone editing the page). */
  onChange?: (text: string) => void;
}) {
  const spec = parseLiveList(text);
  const page = usePageActions();
  const [note, setNote] = useState<string | null>(null);
  const [result, setResult] = useState<ViewResult | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [stamp, setStamp] = useState(0);
  const [picker, setPicker] = useState<DOMRect | null>(null);
  const [views, setViews] = useState<SavedView[]>([]);
  const key = JSON.stringify(spec);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    if (!spec) return;
    setFailed(null);
    const run =
      "id" in spec
        ? client.runView(spec.id, spec.limit)
        : client.runDefinition(spec.definition, spec.limit);
    run.then(
      (r) => alive.current && setResult(r),
      (e: { statusCode?: number }) =>
        alive.current &&
        setFailed(
          e?.statusCode === 404
            ? "This list's view isn't shared with you, or was deleted."
            : "This list couldn't be read just now.",
        ),
    );
  }, [key, stamp]); // eslint-disable-line react-hooks/exhaustive-deps

  const title =
    spec && "id" in spec
      ? (result?.view?.name ?? "A saved view")
      : spec && "title" in spec && spec.title
        ? spec.title
        : spec
          ? VIEW_SOURCE_LABELS[spec.definition.source]
          : "Live list";

  /**
   * Tick or untick a task the way the app's ticks do: as an update on its
   * timeline (POST /items/:id/updates), so teammates see who finished it,
   * and the planner reads its list afresh.
   */
  const tick = async (row: ViewRow) => {
    if (!row.item) return;
    setNote(null);
    const status =
      row.status !== "done"
        ? "done"
        : (row.item.progress ?? 0) > 0
          ? "in_progress"
          : "todo";
    try {
      await client.postItemUpdate(row.id, { status });
      page.onItemsChanged?.();
    } catch {
      setNote("That task couldn't be changed just now.");
    }
    setStamp((n) => n + 1);
  };

  // Days are read in the account's zone, as the server filtered them.
  const ctx = {
    now: new Date(),
    timeZone:
      result?.time_zone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
  };

  return (
    <div
      className="live-list"
      // A click inside the list is about the list, not a request to edit
      // the block's source.
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <div className="live-list-head">
        <ListFilter size={13} aria-hidden="true" />
        <span>{title}</span>
        {spec && "id" in spec && (
          <button
            className="text-button"
            onClick={() =>
              window.dispatchEvent(
                new CustomEvent(OPEN_LINK_EVENT, {
                  detail: `orbyn://view/${spec.id}`,
                }),
              )
            }
          >
            Open as a view
          </button>
        )}
        {onChange && (
          <button
            className="icon-button"
            aria-label="Choose what this list shows"
            title="Choose what this list shows"
            onClick={(e) => {
              setPicker(e.currentTarget.getBoundingClientRect());
              client.listViews().then(setViews, () => setViews([]));
            }}
          >
            <Settings2 size={14} />
          </button>
        )}
      </div>
      {!spec ? (
        <p className="live-list-empty">
          This list's settings can't be read. Choose what it shows again.
        </p>
      ) : failed ? (
        <p className="live-list-empty">{failed}</p>
      ) : !result ? (
        <p className="live-list-empty">Loading…</p>
      ) : !result.rows.length ? (
        <p className="live-list-empty">Nothing here right now.</p>
      ) : (
        <ul>
          {result.rows.map((row) => {
            const left = row.kind !== "page" ? daysLeft(row, ctx) : null;
            return (
              <li
                key={row.id}
                className={row.status === "done" ? "is-done" : ""}
              >
                {row.kind === "task" && (
                  <input
                    type="checkbox"
                    aria-label={`${row.status === "done" ? "Reopen" : "Finish"} ${row.title}`}
                    checked={row.status === "done"}
                    disabled={!row.can_write}
                    onChange={() => void tick(row)}
                  />
                )}
                <button
                  className="view-title-link"
                  onClick={() => openRow(row)}
                >
                  {row.title || "Untitled"}
                </button>
                <small
                  className={isOverdue(row, ctx) ? "view-overdue" : undefined}
                >
                  {left !== null && row.status !== "done"
                    ? daysLeftText(left)
                    : row.kind === "page"
                      ? cellText(row, "updated", ctx)
                      : ""}
                </small>
              </li>
            );
          })}
        </ul>
      )}
      {note && <small className="muted">{note}</small>}
      {result?.truncated && (
        <small className="muted">
          {spec && "id" in spec
            ? `More than ${result.rows.length}; open it as a view to see all.`
            : `Showing the first ${result.rows.length}.`}
        </small>
      )}
      {picker && onChange && (
        <Popover
          anchor={picker}
          label="What this list shows"
          onClose={() => setPicker(null)}
        >
          <div className="popover-actions">
            {liveListChoices(projectId).map((c) => (
              <button
                key={c.label}
                onClick={() => {
                  setPicker(null);
                  onChange(c.text);
                }}
              >
                {c.label}
              </button>
            ))}
            {views.length > 0 && (
              <small className="popover-note">Your saved views</small>
            )}
            {views.map((v) => (
              <button
                key={v.id}
                onClick={() => {
                  setPicker(null);
                  onChange(liveListText({ id: v.id }));
                }}
              >
                {v.name}
              </button>
            ))}
          </div>
        </Popover>
      )}
    </div>
  );
}
