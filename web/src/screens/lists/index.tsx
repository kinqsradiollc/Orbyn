import { hasTeamPermission, type TaskList } from "@orbyn/core";
import {
  ArrowLeft,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ScreenProps } from "../../app/routes";
import { useAccount } from "../../app/account";
import { useTitle } from "../../lib/router";
import { messageOf } from "../../lib/resource";
import { client, getToken } from "../../lib/session";
import {
  Button,
  Dialog,
  Empty,
  ErrorNotice,
  Field,
  IconButton,
  Input,
  Loading,
  Menu,
  SelectBox,
  useConfirm,
  useToast,
} from "../../ui/kit";
import {
  byScore,
  plural,
  refreshPlanner,
  Swatches,
  SWATCHES,
  TaskHost,
  TaskRow,
  tasks,
  useItems,
  usePlanning,
} from "../shared-task";
import "./lists.css";

type Editing = TaskList | "new";

export default function ListsScreen(_: ScreenProps) {
  useTitle("Lists");
  const { token } = useAccount();
  return (
    <>
      <TaskHost />
      <ListsBody key={token} />
    </>
  );
}

function ListsBody() {
  const items = useItems();
  const { lists, teams, phase, error, canWrite, canWriteIn, retry } =
    usePlanning();
  const confirm = useConfirm();
  const toast = useToast();
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [query, setQuery] = useState("");
  const [refreshFailed, setRefreshFailed] = useState(false);
  const chosen = useRef(false);
  const active = lists.find((list) => list.id === selected) ?? null;

  // On a wide page the first list with work in it opens straight away.
  useEffect(() => {
    if (
      selected === null &&
      !chosen.current &&
      lists.length &&
      matchMedia("(min-width: 901px)").matches
    ) {
      chosen.current = true;
      setSelected((lists.find((list) => list.item_count > 0) ?? lists[0]).id);
    }
  }, [lists, selected]);

  const sections = useMemo(() => {
    const words = query.trim().toLocaleLowerCase();
    return [
      {
        key: "personal",
        title: "Personal",
        lists: lists.filter((l) => !l.team_id),
      },
      ...teams.map((team) => ({
        key: team.id,
        title: team.name,
        lists: lists.filter((l) => l.team_id === team.id),
      })),
    ]
      .map((section) => ({
        ...section,
        lists: section.lists.filter((l) =>
          l.name.toLocaleLowerCase().includes(words),
        ),
      }))
      .filter((section) => section.lists.length);
  }, [lists, teams, query]);

  const inList = useMemo(
    () =>
      active
        ? items
            .filter((item) => item.list_id === active.id)
            .sort(byScore(new Date(), items))
        : [],
    [active, items],
  );

  const refresh = async () => {
    try {
      await refreshPlanner();
      setRefreshFailed(false);
      return true;
    } catch {
      setRefreshFailed(true);
      return false;
    }
  };

  const remove = async (list: TaskList) => {
    if (
      !(await confirm({
        title: "Delete list?",
        body: `${list.name}. Its tasks stay in your planner without a list.`,
        action: "Delete",
        danger: true,
      }))
    )
      return;
    try {
      await client.deleteList(list.id);
      setSelected((id) => (id === list.id ? null : id));
      toast({
        text: (await refresh())
          ? "List deleted"
          : "Deleted. Couldn't refresh lists.",
      });
    } catch (e) {
      toast({ text: messageOf(e, "Couldn't delete the list."), error: true });
    }
  };

  const options = (list: TaskList) => (
    <Menu
      label={`Options for ${list.name}`}
      trigger={(open, expanded) => (
        <IconButton
          label={`Options for ${list.name}`}
          aria-expanded={expanded}
          onClick={open}
        >
          <MoreHorizontal />
        </IconButton>
      )}
    >
      {(close) => (
        <>
          <button
            onClick={() => {
              close();
              setEditing(list);
            }}
          >
            <Pencil aria-hidden="true" /> Edit list
          </button>
          <button
            className="is-danger"
            onClick={() => {
              close();
              void remove(list);
            }}
          >
            <Trash2 aria-hidden="true" /> Delete list
          </button>
        </>
      )}
    </Menu>
  );

  const firstLoad = phase === "loading" && !lists.length;
  return (
    <div className={`lists${active ? " has-active" : ""}`}>
      <section className="lists-nav" aria-label="Lists">
        <header className="lists-head">
          <h1>Lists</h1>
          <span className="lists-count">{lists.length}</span>
          <span className="lists-gap" />
          <Button variant="primary" onClick={() => setEditing("new")}>
            <Plus aria-hidden="true" /> New list
          </Button>
        </header>
        {lists.length > 4 && (
          <label className="lists-search">
            <Search aria-hidden="true" />
            <input
              type="search"
              aria-label="Find a list"
              placeholder="Find a list"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
        )}
        {refreshFailed && (
          <ErrorNotice
            message="Couldn't refresh lists."
            onRetry={() => void refresh()}
          />
        )}
        {firstLoad ? (
          <Loading label="Loading lists" />
        ) : phase === "error" && !lists.length ? (
          <ErrorNotice
            message={error}
            onRetry={() => void retry().catch(() => undefined)}
          />
        ) : sections.length ? (
          sections.map((section) => (
            <div key={section.key} className="lists-section">
              <h2 dir="auto">{section.title}</h2>
              {section.lists.map((list) => (
                <div
                  key={list.id}
                  className={`lists-row${selected === list.id ? " is-active" : ""}`}
                >
                  <button
                    type="button"
                    aria-pressed={selected === list.id}
                    onClick={() => setSelected(list.id)}
                  >
                    <i style={{ background: list.color }} aria-hidden="true" />
                    <span className="lists-name" dir="auto">
                      {list.name}
                    </span>
                    <span
                      className="lists-count"
                      title={plural(list.item_count, "open task")}
                    >
                      {list.item_count}
                    </span>
                  </button>
                  {canWriteIn(list.team_id) && options(list)}
                </div>
              ))}
            </div>
          ))
        ) : (
          <Empty title={query ? "No matching lists" : "No lists yet"}>
            {!query && <p>Lists keep related tasks together.</p>}
          </Empty>
        )}
      </section>
      <section
        className="lists-detail"
        aria-label={active ? active.name : "List"}
      >
        {active ? (
          <>
            <header className="lists-head">
              <IconButton
                className="lists-back"
                label="All lists"
                onClick={() => setSelected(null)}
              >
                <ArrowLeft />
              </IconButton>
              <i
                className="lists-dot"
                style={{ background: active.color }}
                aria-hidden="true"
              />
              <h2 dir="auto">{active.name}</h2>
              <span className="lists-count">{inList.length}</span>
              <span className="lists-gap" />
              {canWriteIn(active.team_id) && (
                <>
                  <Button
                    onClick={() =>
                      tasks.create({
                        prefill: {
                          list_id: active.id,
                          team_id: active.team_id,
                        },
                      })
                    }
                  >
                    <Plus aria-hidden="true" /> New task
                  </Button>
                  {options(active)}
                </>
              )}
            </header>
            {inList.length ? (
              <div className="lists-rows st-rows">
                {inList.map((item) => (
                  <TaskRow
                    key={item.id}
                    item={item}
                    readOnly={!canWrite(item)}
                  />
                ))}
              </div>
            ) : (
              <Empty title="No tasks yet">
                <p>Add a task or move one into this list.</p>
              </Empty>
            )}
          </>
        ) : (
          <Empty title="Choose a list">
            <p>Open a list to see its tasks.</p>
          </Empty>
        )}
      </section>
      {editing && (
        <ListEditor
          editing={editing}
          onClose={() => setEditing(null)}
          onSaved={(id) => {
            setEditing(null);
            if (id) setSelected(id);
            void refresh().then((ok) =>
              toast({
                text: ok ? "List saved" : "Saved. Couldn't refresh lists.",
              }),
            );
          }}
        />
      )}
    </div>
  );
}

function ListEditor({
  editing,
  onClose,
  onSaved,
}: {
  editing: Editing;
  onClose: () => void;
  onSaved: (id?: string) => void;
}) {
  const { teams, canWriteIn } = usePlanning();
  const isNew = editing === "new";
  const [name, setName] = useState(isNew ? "" : editing.name);
  const [color, setColor] = useState(isNew ? SWATCHES[0] : editing.color);
  const [scope, setScope] = useState(isNew ? "" : (editing.team_id ?? ""));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const account = useState(getToken)[0];
  const writable = teams.filter((team) =>
    hasTeamPermission(team.role, "items:write"),
  );

  const save = async () => {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    if (isNew ? !canWriteIn(scope || null) : !canWriteIn(editing.team_id)) {
      setError("You can no longer change lists in this space.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      if (isNew) {
        const made = await client.createList({
          name: trimmed,
          color,
          team_id: scope || null,
        });
        if (account === getToken()) onSaved(made.id);
      } else {
        await client.updateList(editing.id, { name: trimmed, color });
        if (account === getToken()) onSaved();
      }
    } catch (e) {
      setError(
        messageOf(e, "Couldn't save the list. Your changes are still here."),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={isNew ? "New list" : "Edit list"}
      onClose={() => !busy && onClose()}
      actions={
        <>
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            busy={busy}
            disabled={!name.trim()}
            onClick={() => void save()}
          >
            {isNew ? "Create list" : "Save"}
          </Button>
        </>
      }
    >
      <Field label="List name">
        <Input
          autoFocus
          required
          dir="auto"
          maxLength={80}
          value={name}
          disabled={busy}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void save();
            }
          }}
        />
      </Field>
      {isNew && writable.length > 0 && (
        <Field label="Space">
          <SelectBox
            value={scope}
            disabled={busy}
            onChange={(event) => setScope(event.target.value)}
          >
            <option value="">Personal</option>
            {writable.map((team) => (
              <option key={team.id} value={team.id}>
                {team.name}
              </option>
            ))}
          </SelectBox>
        </Field>
      )}
      {!isNew && (
        <p className="muted small">{editing.team_name || "Personal"}</p>
      )}
      <Swatches
        label="List colour"
        value={color}
        disabled={busy}
        onChange={setColor}
      />
      {error && <ErrorNotice message={error} />}
    </Dialog>
  );
}
