import type { SearchHit } from "@orbyn/core";
import { useEffect, useRef, useState } from "react";
import { useResource } from "../../lib/resource";
import { navigate } from "../../lib/router";
import { client } from "../../lib/session";
import { Dialog, Empty, ErrorNotice, Input, Loading } from "../../ui/kit";
import { tasks } from "../shared-task";

const open = (hit: SearchHit) => {
  if (hit.type === "doc") navigate(`/app/doc/${hit.id}`);
  else if (hit.type === "project") navigate(`/app/project/${hit.id}`);
  else if (hit.type === "task") tasks.open(hit.id);
  else navigate("/app");
};

/**
 * `/app/search?q=words`: the words already searched, over Today. The app's
 * shell has no way to hand a query to its command bar, so this stands in.
 */
export function SearchDialog({ query }: { query: string }) {
  const [text, setText] = useState(query);
  const [asked, setAsked] = useState(query.trim());
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => setAsked(text.trim()), 180);
    return () => clearTimeout(timer);
  }, [text]);
  const hits = useResource<SearchHit[]>(
    () => (asked ? client.search(asked, { limit: 30 }) : Promise.resolve([])),
    [asked],
  );
  const close = () => navigate("/app", true);
  const choose = (hit: SearchHit) => {
    close();
    open(hit);
  };
  return (
    <Dialog title="Search" onClose={close}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (hits.data?.[0]) choose(hits.data[0]);
        }}
      >
        <Input
          ref={input}
          type="search"
          aria-label="Search your work"
          placeholder="Tasks, pages and projects"
          maxLength={200}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              close();
            }
          }}
        />
      </form>
      {hits.error && (
        <ErrorNotice message={hits.error} onRetry={() => void hits.reload()} />
      )}
      {hits.loading && !hits.data && <Loading label="Searching" />}
      {asked && hits.data && !hits.data.length && !hits.loading && (
        <Empty title="No matches" />
      )}
      <div className="rows">
        {hits.data?.map((hit) => (
          <button
            key={`${hit.type}:${hit.id}`}
            className="row"
            onClick={() => choose(hit)}
          >
            <span className="row-main">
              <span className="row-title" dir="auto">
                {hit.title || "Untitled"}
              </span>
              <span className="muted small">
                {hit.type === "doc"
                  ? "Page"
                  : hit.type === "task"
                    ? "Task"
                    : hit.type === "project"
                      ? "Project"
                      : "Record"}
              </span>
            </span>
          </button>
        ))}
      </div>
    </Dialog>
  );
}
