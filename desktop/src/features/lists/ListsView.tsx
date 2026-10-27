import { useElementWidth } from "../../hooks/useElementWidth";
import { Select } from "../../components/Select";
import { useConfirm } from "../../components/Confirm";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  Check,
  ListChecks,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import {
  hasTeamPermission,
  type Item,
  type ItemInput,
  type TaskList,
  type Team,
} from "@orbyn/core";
import { client } from "../../lib/api";
import { usePlanning } from "../../app/planning";
import { EmptyState } from "../../components/EmptyState";
import { ItemRow } from "../tasks/ItemRow";
import { byScore, plural, SWATCHES } from "../planner/planning";
import { session } from "../../lib/session";
import { Popover } from "../../components/Popover";
import { useAction, OutcomeNote } from "../../components/Outcome";
import { SettingsEditor } from "../settings/SettingsEditor";

type Props = {
  items: Item[];
  teams: Team[];
  busy: boolean;
  canWrite: (item: Item) => boolean;
  onToggle: (item: Item) => void;
  onOpen: (item: Item) => void;
  /** Starts a new item, prefilled (here: the list and its team). */
  onNewItem: (draft: Partial<ItemInput>) => void;
  report: (e: unknown) => void;
};

/** A row of colour choices, as a radio group. */
export function Swatches({
  value,
  onChange,
  label,
  disabled = false,
}: {
  value: string;
  onChange: (color: string) => void;
  label: string;
  disabled?: boolean;
}) {
  const selected = Math.max(
    0,
    SWATCHES.findIndex((c) => c === value.toLowerCase()),
  );
  const names = [
    "Green",
    "Sage",
    "Blue",
    "Purple",
    "Rust",
    "Amber",
    "Teal",
    "Slate",
  ];
  return (
    <div className="swatches" role="radiogroup" aria-label={label}>
      {SWATCHES.map((c, index) => (
        <button
          key={c}
          type="button"
          disabled={disabled}
          role="radio"
          aria-checked={value.toLowerCase() === c}
          aria-label={names[index] ?? c}
          tabIndex={selected === index ? 0 : -1}
          onKeyDown={(event) => {
            const direction =
              event.key === "ArrowRight" || event.key === "ArrowDown"
                ? 1
                : event.key === "ArrowLeft" || event.key === "ArrowUp"
                  ? -1
                  : 0;
            if (!direction && event.key !== "Home" && event.key !== "End")
              return;
            event.preventDefault();
            const next =
              event.key === "Home"
                ? 0
                : event.key === "End"
                  ? SWATCHES.length - 1
                  : (index + direction + SWATCHES.length) % SWATCHES.length;
            onChange(SWATCHES[next]);
            const group = event.currentTarget.parentElement;
            group?.querySelectorAll<HTMLButtonElement>("button")[next]?.focus();
          }}
          className={value.toLowerCase() === c ? "active" : ""}
          style={{ background: c }}
          onClick={() => onChange(c)}
        >
          {value.toLowerCase() === c && <Check size={11} aria-hidden="true" />}
        </button>
      ))}
    </div>
  );
}

/** Personal and shared lists with focused management and a usable narrow task pane. */
export function ListsView(props: Props) {
  return <ListsBody key={session.get()} {...props} />;
}
function ListsBody({
  items,
  teams,
  busy,
  canWrite,
  onToggle,
  onOpen,
  onNewItem,
  report,
}: Props) {
  const { ref: pageRef, width: pageWidth } = useElementWidth();
  const { ask } = useConfirm();
  const { lists, reload } = usePlanning();
  const action = useAction(report);
  const locked = busy || action.pending;
  const owner = session.get();
  const mounted = useRef(true);
  const current = () => mounted.current && session.get() === owner;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [selected, setSelected] = useState<string | null>(null);
  const [editor, setEditor] = useState<TaskList | "new" | null>(null);
  const [name, setName] = useState("");
  const [color, setColor] = useState(SWATCHES[0]);
  const [scope, setScope] = useState("");
  const [query, setQuery] = useState("");
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [menu, setMenu] = useState<{ list: TaskList; anchor: DOMRect } | null>(
    null,
  );
  const writableTeams = teams.filter((t) =>
    hasTeamPermission(t.role, "items:write"),
  );
  const canEdit = (list: TaskList) =>
    !list.team_id ||
    hasTeamPermission(
      teams.find((t) => t.id === list.team_id)?.role,
      "items:write",
    );
  const active = lists.find((l) => l.id === selected) ?? null;
  const sections = [
    {
      key: "personal",
      title: "Personal",
      lists: lists.filter((l) => !l.team_id),
    },
    ...teams.map((t) => ({
      key: t.id,
      title: t.name,
      lists: lists.filter((l) => l.team_id === t.id),
    })),
  ]
    .map((s) => ({
      ...s,
      lists: s.lists.filter((l) =>
        l.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
      ),
    }))
    .filter((s) => s.lists.length);
  const inList = active
    ? items
        .filter((i) => i.list_id === active.id)
        .sort(byScore(new Date(), items))
    : [];
  const refresh = async () => {
    try {
      await reload();
      if (current()) setRefreshFailed(false);
      return true;
    } catch {
      if (current()) setRefreshFailed(true);
      return false;
    }
  };
  const openEditor = (list: TaskList | "new") => {
    if (locked || editor || (list !== "new" && !canEdit(list))) return;
    setMenu(null);
    action.setOutcome(null);
    setName(list === "new" ? "" : list.name);
    setColor(list === "new" ? SWATCHES[0] : list.color);
    setScope(list === "new" ? "" : (list.team_id ?? ""));
    setEditor(list);
  };
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!editor || !name.trim() || locked) return;
    if (
      (editor !== "new" && !canEdit(editor)) ||
      (editor === "new" && scope && !writableTeams.some((t) => t.id === scope))
    ) {
      action.setOutcome({
        ok: false,
        text: "You can no longer change lists in this space.",
      });
      return;
    }
    await action.run(async () => {
      if (editor === "new") {
        const made = await client.createList({
          name: name.trim(),
          color,
          team_id: scope || null,
        });
        if (!current()) return;
        setSelected(made.id);
      } else await client.updateList(editor.id, { name: name.trim(), color });
      if (!current()) return;
      setEditor(null);
      return (await refresh())
        ? "List saved."
        : "Saved. Couldn't refresh lists. Try again.";
    });
  };
  const remove = (list: TaskList) =>
    action.run(async () => {
      setMenu(null);
      if (
        !canEdit(list) ||
        !(await ask({
          title: "Delete list?",
          body: `${list.name} · Its tasks stay in your planner without a list.`,
          confirmLabel: "Delete",
          destructive: true,
        })) ||
        !current()
      )
        return;
      await client.deleteList(list.id);
      if (!current()) return;
      setSelected((id) => (id === list.id ? null : id));
      return (await refresh())
        ? "List deleted."
        : "Deleted. Couldn't refresh lists. Try again.";
    });
  return (
    <div
      ref={pageRef}
      className={"lists-layout" + (pageWidth < 900 ? " is-compact" : "")}
    >
      {(!active || pageWidth >= 900) && (
        <section className="card lists-card" aria-label="Lists">
          <div className="section-heading">
            <h2>
              Lists <span>{lists.length}</span>
            </h2>
            <button
              className="text-button"
              disabled={locked}
              onClick={() => openEditor("new")}
            >
              <Plus size={15} /> New list
            </button>
          </div>
          <label className="lists-search">
            Find a list
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          {!editor && <OutcomeNote outcome={action.outcome} />}
          {refreshFailed && (
            <button
              className="secondary"
              disabled={locked}
              onClick={() =>
                void action.run(async () => {
                  if (await refresh()) return "Lists refreshed.";
                  throw new Error("Couldn't refresh lists. Try again.");
                })
              }
            >
              Retry
            </button>
          )}
          <div className="lists-navigation">
            {sections.map((section) => (
              <div key={section.key} className="list-section">
                <h3 className="list-section-title">{section.title}</h3>
                {section.lists.map((list) => (
                  <div
                    key={list.id}
                    className={
                      "list-row" + (selected === list.id ? " active" : "")
                    }
                  >
                    <button
                      className="list-row-main"
                      aria-pressed={selected === list.id}
                      disabled={locked}
                      onClick={() => setSelected(list.id)}
                    >
                      <i
                        className="list-dot"
                        style={{ background: list.color }}
                        aria-hidden="true"
                      />
                      <strong>{list.name}</strong>
                      <small>{plural(list.item_count, "open task")}</small>
                    </button>
                    {canEdit(list) && (
                      <button
                        className="icon-button"
                        aria-label={`Options for ${list.name}`}
                        aria-haspopup="dialog"
                        disabled={locked}
                        onClick={(e) =>
                          setMenu({
                            list,
                            anchor: e.currentTarget.getBoundingClientRect(),
                          })
                        }
                      >
                        <MoreHorizontal size={16} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            ))}
            {!sections.length && (
              <p className="section-empty">
                {query ? "No matching lists." : "No lists yet."}
              </p>
            )}
          </div>
        </section>
      )}
      {(active || pageWidth >= 900) && (
        <section
          className="card"
          aria-labelledby={active ? "list-title" : undefined}
        >
          {active ? (
            <>
              <div className="section-heading">
                <h2 id="list-title">
                  <i
                    className="list-dot"
                    style={{ background: active.color }}
                    aria-hidden="true"
                  />{" "}
                  {active.name} <span>{inList.length}</span>
                </h2>
                <div className="button-row">
                  {pageWidth < 900 && (
                    <button
                      className="secondary"
                      disabled={locked}
                      onClick={() => setSelected(null)}
                    >
                      All lists
                    </button>
                  )}
                  {canEdit(active) && (
                    <>
                      <button
                        className="secondary"
                        disabled={locked}
                        onClick={() =>
                          onNewItem({
                            list_id: active.id,
                            team_id: active.team_id,
                          })
                        }
                      >
                        <Plus size={15} /> New task
                      </button>
                      <button
                        className="icon-button"
                        disabled={locked}
                        aria-label={`Options for ${active.name}`}
                        onClick={(e) =>
                          setMenu({
                            list: active,
                            anchor: e.currentTarget.getBoundingClientRect(),
                          })
                        }
                      >
                        <MoreHorizontal size={16} />
                      </button>
                    </>
                  )}
                </div>
              </div>
              {pageWidth < 900 && !editor && (
                <OutcomeNote outcome={action.outcome} />
              )}
              {pageWidth < 900 && refreshFailed && (
                <button
                  className="secondary"
                  disabled={locked}
                  onClick={() =>
                    void action.run(async () => {
                      if (await refresh()) return "Lists refreshed.";
                      throw new Error("Couldn't refresh lists. Try again.");
                    })
                  }
                >
                  Retry
                </button>
              )}
              {inList.length ? (
                inList.map((item, index) => (
                  <ItemRow
                    key={item.id}
                    item={item}
                    index={index}
                    busy={busy}
                    readOnly={!canWrite(item)}
                    onToggle={onToggle}
                    onOpen={onOpen}
                  />
                ))
              ) : (
                <EmptyState
                  icon={ListChecks}
                  title="No tasks yet"
                  body="Add a task or move one into this list."
                />
              )}
            </>
          ) : (
            <EmptyState
              icon={ListChecks}
              title="Choose a list"
              body="Open a list to see its tasks."
            />
          )}
        </section>
      )}
      {menu && (
        <Popover
          anchor={menu.anchor}
          label={`Options for ${menu.list.name}`}
          onClose={() => setMenu(null)}
        >
          <div className="popover-actions">
            <button disabled={locked} onClick={() => openEditor(menu.list)}>
              <Pencil size={15} /> Edit list
            </button>
            <button
              disabled={locked}
              className="is-danger"
              onClick={() => void remove(menu.list)}
            >
              <Trash2 size={15} /> Delete list
            </button>
          </div>
        </Popover>
      )}
      {editor && (
        <SettingsEditor
          title={editor === "new" ? "New list" : "Edit list"}
          pending={action.pending}
          closeDisabled={busy}
          onClose={() => {
            setEditor(null);
            action.setOutcome(null);
          }}
        >
          <form className="list-editor" onSubmit={(e) => void save(e)}>
            <label>
              List name
              <input
                autoFocus
                required
                maxLength={80}
                value={name}
                disabled={locked}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            {editor === "new" && writableTeams.length > 0 && (
              <label>
                Space
                <Select
                  value={scope}
                  disabled={locked}
                  onChange={(e) => setScope(e.target.value)}
                >
                  <option value="">Personal</option>
                  {writableTeams.map((team) => (
                    <option key={team.id} value={team.id}>
                      {team.name}
                    </option>
                  ))}
                </Select>
              </label>
            )}
            {editor !== "new" && (
              <p className="muted">{editor.team_name || "Personal"}</p>
            )}
            <Swatches
              label="List colour"
              value={color}
              disabled={locked}
              onChange={setColor}
            />
            <OutcomeNote outcome={action.outcome} />
            <div className="button-row">
              <button
                type="button"
                className="secondary"
                disabled={locked}
                onClick={() => {
                  setEditor(null);
                  action.setOutcome(null);
                }}
              >
                Cancel
              </button>
              <button className="primary" disabled={locked || !name.trim()}>
                {action.pending
                  ? "Saving…"
                  : editor === "new"
                    ? "Create list"
                    : "Save"}
              </button>
            </div>
          </form>
        </SettingsEditor>
      )}
    </div>
  );
}
