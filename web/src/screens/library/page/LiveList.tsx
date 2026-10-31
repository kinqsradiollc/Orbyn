import {
  liveListText,
  parseLiveList,
  VIEW_SOURCE_LABELS,
  type SavedView,
  type ViewDefinitionInput,
  type ViewResult,
  type ViewRow,
} from "@orbyn/core";
import { ListFilter, Settings2 } from "lucide-react";
import { useContext, useEffect, useState } from "react";
import { messageOf } from "../../../lib/resource";
import { client } from "../../../lib/session";
import {
  ErrorNotice,
  IconButton,
  Loading,
  Menu,
  useToast,
} from "../../../ui/kit";
import { PageContext } from "./context";

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

/** Rows of a saved view or filter, read afresh each time the page shows. */
export function LiveList({
  text,
  onChange,
}: {
  text: string;
  onChange?: (text: string) => void;
}) {
  const page = useContext(PageContext);
  const toast = useToast();
  const spec = parseLiveList(text);
  const key = JSON.stringify(spec);
  const [result, setResult] = useState<ViewResult | null>(null);
  const [failed, setFailed] = useState("");
  const [stamp, setStamp] = useState(0);
  const [views, setViews] = useState<SavedView[]>([]);
  useEffect(() => {
    if (!spec) return;
    let live = true;
    setFailed("");
    setResult(null);
    const run =
      "id" in spec
        ? client.runView(spec.id, spec.limit)
        : client.runDefinition(spec.definition, spec.limit);
    run.then(
      (next) => live && setResult(next),
      (failure: { statusCode?: number }) =>
        live &&
        setFailed(
          failure?.statusCode === 404
            ? "This list's view isn't shared with you, or was deleted."
            : "This list couldn't be read just now.",
        ),
    );
    return () => {
      live = false;
    };
  }, [key, stamp]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!onChange) return;
    let live = true;
    client.listViews().then(
      (list) => live && setViews(list),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [!onChange]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!spec)
    return (
      <div className="doc-embed small muted">
        This list doesn't say what to show.
      </div>
    );
  const toggle = async (row: ViewRow) => {
    try {
      await client.updateItem(row.id, {
        status: row.status === "done" ? "todo" : "done",
      } as never);
      setStamp((n) => n + 1);
    } catch (failure) {
      toast({
        text: messageOf(failure, "Couldn't change this task."),
        error: true,
      });
    }
  };
  return (
    <div
      className="doc-embed doc-livelist"
      onClick={(event) => event.stopPropagation()}
    >
      <div className="doc-embed-head small">
        <ListFilter aria-hidden="true" />
        <span className="row-main" dir="auto">
          {("title" in spec && spec.title) || result?.view?.name || "List"}
        </span>
        {onChange && (
          <Menu
            label="Choose a list"
            trigger={(show, expanded) => (
              <IconButton
                label="Choose another list"
                aria-expanded={expanded}
                onClick={show}
              >
                <Settings2 />
              </IconButton>
            )}
          >
            {(close) => (
              <>
                {liveListChoices(page?.projectId ?? null).map((choice) => (
                  <button
                    key={choice.label}
                    type="button"
                    onClick={() => {
                      close();
                      onChange(choice.text);
                    }}
                  >
                    {choice.label}
                  </button>
                ))}
                {views.map((view) => (
                  <button
                    key={view.id}
                    type="button"
                    onClick={() => {
                      close();
                      onChange(liveListText({ id: view.id, title: view.name }));
                    }}
                  >
                    {view.name} · {VIEW_SOURCE_LABELS[view.definition.source]}
                  </button>
                ))}
              </>
            )}
          </Menu>
        )}
      </div>
      {failed && (
        <ErrorNotice message={failed} onRetry={() => setStamp((n) => n + 1)} />
      )}
      {!failed && !result && <Loading label="Loading list" />}
      {result && !result.rows.length && (
        <p className="small muted">Nothing here right now.</p>
      )}
      {result && result.rows.length > 0 && (
        <ul className="doc-embed-tasks">
          {result.rows.map((row) => (
            <li key={row.id}>
              {row.kind === "task" && (
                <input
                  type="checkbox"
                  className="doc-check"
                  checked={row.status === "done"}
                  aria-label={row.title}
                  onChange={() => void toggle(row)}
                />
              )}
              <button
                type="button"
                className={`doc-textlink${row.status === "done" ? " doc-done" : ""}`}
                onClick={() =>
                  page?.onOpen(
                    `orbyn://${row.kind === "page" ? "doc" : row.kind}/${row.id}`,
                  )
                }
                dir="auto"
              >
                {row.title}
              </button>
              {row.due_at && (
                <small className="muted">
                  {new Date(row.due_at).toLocaleDateString()}
                </small>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
