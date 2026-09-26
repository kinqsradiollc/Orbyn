import { Select } from "../../components/Select";
import { useConfirm } from "../../components/Confirm";
import { useState, type FormEvent } from "react";
import { Check, ListChecks, Pencil, Plus, Trash2, X } from "lucide-react";
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
import { ItemRow } from "../../components/ItemRow";
import { byScore, plural, SWATCHES } from "../../lib/planning";
import { stagger } from "../../lib/motion";

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
}: {
  value: string;
  onChange: (color: string) => void;
  label: string;
}) {
  return (
    <div className="swatches" role="radiogroup" aria-label={label}>
      {SWATCHES.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value.toLowerCase() === c}
          aria-label={c}
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

/**
 * Personal and team lists: make, rename, recolour and delete them, and see
 * the tasks in one. Team lists follow team roles (viewers only look).
 */
export function ListsView({
  items,
  teams,
  busy,
  canWrite,
  onToggle,
  onOpen,
  onNewItem,
  report,
}: Props) {
  const { ask, tell } = useConfirm();
  const { lists, reload } = usePlanning();
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftColor, setDraftColor] = useState(SWATCHES[0]);
  const [name, setName] = useState("");
  const [color, setColor] = useState(SWATCHES[0]);
  const [scope, setScope] = useState("");
  const [pending, setPending] = useState(false);

  const writableTeams = teams.filter((t) =>
    hasTeamPermission(t.role, "items:write"),
  );
  const canEdit = (l: TaskList) =>
    !l.team_id ||
    hasTeamPermission(
      teams.find((t) => t.id === l.team_id)?.role,
      "items:write",
    );
  const active = lists.find((l) => l.id === selected) ?? null;

  const run = async (fn: () => Promise<unknown>) => {
    setPending(true);
    try {
      await fn();
      await reload();
      return true;
    } catch (e) {
      report(e);
      return false;
    } finally {
      setPending(false);
    }
  };

  const create = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    void run(async () => {
      const list = await client.createList({
        name: trimmed,
        color,
        team_id: scope || null,
      });
      setName("");
      setSelected(list.id);
    });
  };

  const save = (l: TaskList) => {
    const trimmed = draftName.trim();
    if (!trimmed) return;
    void run(() =>
      client.updateList(l.id, { name: trimmed, color: draftColor }),
    ).then((ok) => ok && setEditing(null));
  };

  const remove = async (l: TaskList) => {
    if (
      !(await ask({
        title: `Delete “${l.name}”? Its tasks stay; they just leave the list.`,
        confirmLabel: "Delete",
        destructive: true,
      }))
    )
      return;
    void run(async () => {
      await client.deleteList(l.id);
      if (selected === l.id) setSelected(null);
    });
  };

  // Personal lists first, then each team's.
  const sections: { key: string; title: string; lists: TaskList[] }[] = [
    {
      key: "personal",
      title: "Personal",
      lists: lists.filter((l) => !l.team_id),
    },
    ...teams
      .map((t) => ({
        key: t.id,
        title: t.name,
        lists: lists.filter((l) => l.team_id === t.id),
      }))
      .filter((s) => s.lists.length),
  ];

  const inList = active
    ? items
        .filter((i) => i.list_id === active.id)
        .sort(byScore(new Date(), items))
    : [];

  return (
    <div className="lists-layout">
      <section className="card lists-card">
        <div className="section-heading">
          <h2>
            Your lists <span>{lists.length}</span>
          </h2>
        </div>
        {sections.map((s) => (
          <div key={s.key} className="list-section">
            <h3 className="list-section-title">{s.title}</h3>
            {!s.lists.length && (
              <p className="section-empty">No personal lists yet.</p>
            )}
            {s.lists.map((l, n) =>
              editing === l.id ? (
                <form
                  key={l.id}
                  className="list-edit"
                  onSubmit={(e) => {
                    e.preventDefault();
                    save(l);
                  }}
                >
                  <input
                    aria-label="List name"
                    autoFocus
                    required
                    maxLength={80}
                    value={draftName}
                    onChange={(e) => setDraftName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") {
                        e.preventDefault();
                        setEditing(null);
                      }
                    }}
                  />
                  <Swatches
                    label={`Colour for ${l.name}`}
                    value={draftColor}
                    onChange={setDraftColor}
                  />
                  <div className="button-row">
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => setEditing(null)}
                    >
                      <X size={14} /> Cancel
                    </button>
                    <button className="primary" disabled={pending}>
                      <Check size={14} /> Save
                    </button>
                  </div>
                </form>
              ) : (
                <div
                  key={l.id}
                  className={
                    "list-row fade-up stagger " +
                    (selected === l.id ? "active" : "")
                  }
                  style={stagger(n)}
                >
                  <button
                    className="list-row-main"
                    aria-pressed={selected === l.id}
                    onClick={() => setSelected(l.id)}
                  >
                    <i
                      className="list-dot"
                      style={{ background: l.color }}
                      aria-hidden="true"
                    />
                    <strong>{l.name}</strong>
                    <small>{plural(l.item_count, "open task")}</small>
                  </button>
                  {canEdit(l) && (
                    <span className="list-row-actions">
                      <button
                        className="icon-button"
                        aria-label={`Rename or recolour ${l.name}`}
                        disabled={pending}
                        onClick={() => {
                          setEditing(l.id);
                          setDraftName(l.name);
                          setDraftColor(l.color);
                        }}
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        className="icon-button"
                        aria-label={`Delete ${l.name}`}
                        disabled={pending}
                        onClick={() => remove(l)}
                      >
                        <Trash2 size={14} />
                      </button>
                    </span>
                  )}
                </div>
              ),
            )}
          </div>
        ))}
        <form className="list-create" onSubmit={create}>
          <div className="inline-form">
            <input
              aria-label="New list name"
              placeholder="New list name"
              maxLength={80}
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            {writableTeams.length > 0 && (
              <Select
                aria-label="Who the list is for"
                value={scope}
                onChange={(e) => setScope(e.target.value)}
              >
                <option value="">Personal</option>
                {writableTeams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
            )}
            <button
              className="primary"
              disabled={pending || busy || !name.trim()}
            >
              <Plus size={15} /> Create
            </button>
          </div>
          <Swatches label="New list colour" value={color} onChange={setColor} />
        </form>
      </section>
      {active ? (
        <section className="card" aria-labelledby="list-title">
          <div className="section-heading">
            <h2 id="list-title">
              <i
                className="list-dot"
                style={{ background: active.color }}
                aria-hidden="true"
              />{" "}
              {active.name} <span>{inList.length}</span>
            </h2>
            {canEdit(active) && (
              <button
                className="secondary"
                onClick={() =>
                  onNewItem({ list_id: active.id, team_id: active.team_id })
                }
              >
                <Plus size={15} /> New task here
              </button>
            )}
          </div>
          {inList.length ? (
            inList.map((i, n) => (
              <ItemRow
                key={i.id}
                item={i}
                index={n}
                busy={busy}
                readOnly={!canWrite(i)}
                onToggle={onToggle}
                onOpen={onOpen}
              />
            ))
          ) : (
            <EmptyState
              icon={ListChecks}
              title="Nothing in this list yet."
              body="Pick this list when you add or edit a task."
            />
          )}
        </section>
      ) : (
        <section className="card">
          <EmptyState
            icon={ListChecks}
            title="Pick a list."
            body="Select a list to see its tasks, or make a new one."
          />
        </section>
      )}
    </div>
  );
}
