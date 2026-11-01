import { useEffect, useRef, useState } from "react";
import {
  hasTeamPermission,
  isClosed,
  type Item,
  type TeamDetail,
} from "@orbyn/core";
import { client } from "../../lib/session";
import { useNavigate } from "../../lib/router";
import { Button, Field, Input, SelectBox } from "../../ui/kit";
import { TaskRow } from "../shared-task/TaskRow";
import { useTasks } from "../shared-task/host-store";
import { useItems } from "../shared-task/store";
import { ReadState, useOwned, useRead } from "./state";
export function Work({
  team,
  revision = 0,
}: {
  team: TeamDetail;
  revision?: number;
}) {
  const tasks = useTasks();
  const navigate = useNavigate();
  const owned = useOwned();
  const read = useRead(async () => {
      const rows: Item[] = [];
      for (let offset = 0; offset < 10000; offset += 500) {
        const batch = await client.listItems({
          team_id: team.id,
          limit: 500,
          offset,
        });
        if (!owned()) throw Error("This team session ended.");
        rows.push(...batch);
        if (batch.length < 500) return rows;
      }
      throw Error(
        "This team exceeds this view’s 10,000-item limit. Open Work to browse a larger collection.",
      );
    }, [team.id]),
    projects = useRead(
      () =>
        client
          .listProjects()
          .then((rows) => rows.filter((p) => p.team_id === team.id)),
      [team.id],
    ),
    live = useItems(),
    [query, setQuery] = useState(""),
    [filter, setFilter] = useState("open"),
    canWrite = hasTeamPermission(team.role, "items:write");
  const previous = useRef({ live, revision });
  useEffect(() => {
    if (
      previous.current.live !== live ||
      previous.current.revision !== revision
    ) {
      previous.current = { live, revision };
      void read.reload();
      void projects.reload();
    }
  }, [live, revision, read.reload, projects.reload]);
  const items = (read.data ?? [])
    .map(
      (item) =>
        live.find((v) => v.id === item.id && v.version >= item.version) ?? item,
    )
    .filter(
      (item) =>
        item.team_id === team.id &&
        (filter === "all" || (filter === "closed") === isClosed(item.status)) &&
        `${item.title} ${item.notes}`
          .toLocaleLowerCase()
          .includes(query.trim().toLocaleLowerCase()),
    );
  return (
    <>
      <section className="teams-section">
        <header className="teams-heading">
          <h3>Shared tasks and events</h3>
          {canWrite && (
            <Button
              variant="primary"
              onClick={() => {
                if (owned()) tasks.create({ prefill: { team_id: team.id } });
              }}
            >
              New shared item
            </Button>
          )}
        </header>
        <ReadState read={read} label="shared work" />
        <div className="teams-form-row">
          <Field label="Search work">
            <Input
              value={query}
              type="search"
              onChange={(e) => setQuery(e.target.value)}
            />
          </Field>
          <Field label="Show">
            <SelectBox
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            >
              <option value="open">Open</option>
              <option value="closed">Closed</option>
              <option value="all">All items</option>
            </SelectBox>
          </Field>
        </div>
        {!read.loading && !read.error && !items.length && (
          <p>No shared work matches these filters.</p>
        )}
        <div className="teams-items">
          {items.map((item) => (
            <TaskRow key={item.id} item={item} readOnly={!canWrite} />
          ))}
        </div>
        <Button
          variant="ghost"
          disabled={read.loading}
          onClick={() => void read.reload()}
        >
          Refresh work
        </Button>
      </section>
      <section className="teams-section">
        <h3>Team projects</h3>
        <ReadState read={projects} label="projects" />
        {projects.data && !projects.data.length && (
          <p>No projects are shared with this team.</p>
        )}
        <ul className="teams-records">
          {projects.data?.map((p) => (
            <li key={p.id}>
              <Button
                variant="ghost"
                onClick={() => tasks.peek({ kind: "project", id: p.id })}
              >
                <span dir="auto">{p.name}</span>
              </Button>
              <Button
                variant="ghost"
                onClick={() => navigate("/app/project/" + p.id)}
              >
                Open project
              </Button>
            </li>
          ))}
        </ul>
        <a
          href="/app/docs"
          onClick={(e) => {
            e.preventDefault();
            navigate("/app/docs");
          }}
        >
          Open Library
        </a>
      </section>
    </>
  );
}
