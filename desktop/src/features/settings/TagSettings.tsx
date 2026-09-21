import { Select } from "../../components/Select";
import { useConfirm } from "../../components/Confirm";
import { useState, type FormEvent } from "react";
import { Check, Pencil, Plus, Trash2, X } from "lucide-react";
import { hasTeamPermission, type Tag, type Team } from "@orbyn/core";
import { client } from "../../lib/api";
import { usePlanning } from "../../app/planning";
import { OutcomeNote, useAction } from "../../components/Outcome";
import { Swatches } from "../lists/ListsView";
import { SWATCHES } from "../../lib/planning";

type Props = { teams: Team[]; report: (e: unknown) => void };

/** Personal and team tags: create, rename, recolour and delete. */
export function TagSettings({ teams, report }: Props) {
  const { ask, tell } = useConfirm();
  const { tags, reload } = usePlanning();
  const [editing, setEditing] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftColor, setDraftColor] = useState(SWATCHES[1]);
  const [name, setName] = useState("");
  const [color, setColor] = useState(SWATCHES[1]);
  const [scope, setScope] = useState("");
  const action = useAction(report);

  const writable = teams.filter((t) =>
    hasTeamPermission(t.role, "items:write"),
  );
  const canEdit = (t: Tag) =>
    !t.team_id ||
    hasTeamPermission(
      teams.find((x) => x.id === t.team_id)?.role,
      "items:write",
    );

  const create = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    void action.run(async () => {
      await client.createTag({ name: trimmed, color, team_id: scope || null });
      await reload();
      setName("");
      return `Added “${trimmed}”.`;
    });
  };

  const save = (t: Tag) => {
    const trimmed = draftName.trim();
    if (!trimmed) return;
    void action
      .run(async () => {
        await client.updateTag(t.id, { name: trimmed, color: draftColor });
        await reload();
      })
      .then((ok) => ok && setEditing(null));
  };

  const remove = async (t: Tag) => {
    if (
      !(await ask({
        title: `Delete the tag “${t.name}”? Tasks keep everything else.`,
        confirmLabel: "Delete",
        destructive: true,
      }))
    )
      return;
    void action.run(async () => {
      await client.deleteTag(t.id);
      await reload();
      return `Deleted “${t.name}”.`;
    });
  };

  const sections = [
    {
      key: "personal",
      title: "Personal tags",
      tags: tags.filter((t) => !t.team_id),
    },
    ...teams
      .map((team) => ({
        key: team.id,
        title: team.name,
        tags: tags.filter((t) => t.team_id === team.id),
      }))
      .filter((s) => s.tags.length),
  ];

  return (
    <section className="card settings-card" aria-labelledby="tags-title">
      <h2 id="tags-title">Tags</h2>
      <p className="muted">
        Tags cut across lists, like “errand” or “waiting”. Personal tags go on
        personal items; a team&apos;s tags go on its items.
      </p>
      {sections.map((s) => (
        <div key={s.key} className="tag-section">
          <h3 className="settings-subtitle">{s.title}</h3>
          {!s.tags.length ? (
            <p className="muted">None yet.</p>
          ) : (
            <ul className="settings-list">
              {s.tags.map((t) =>
                editing === t.id ? (
                  <li key={t.id} className="is-editing">
                    <form
                      className="tag-edit"
                      onSubmit={(e) => {
                        e.preventDefault();
                        save(t);
                      }}
                    >
                      <input
                        aria-label="Tag name"
                        autoFocus
                        required
                        maxLength={40}
                        value={draftName}
                        onChange={(e) => setDraftName(e.target.value)}
                      />
                      <Swatches
                        label={`Colour for ${t.name}`}
                        value={draftColor}
                        onChange={setDraftColor}
                      />
                      <span className="button-row">
                        <button
                          type="button"
                          className="secondary"
                          onClick={() => setEditing(null)}
                        >
                          <X size={14} /> Cancel
                        </button>
                        <button className="primary" disabled={action.pending}>
                          <Check size={14} /> Save
                        </button>
                      </span>
                    </form>
                  </li>
                ) : (
                  <li key={t.id}>
                    <span
                      className="tag-chip"
                      style={{ "--tag": t.color } as never}
                    >
                      <i aria-hidden="true" />
                      {t.name}
                    </span>
                    <span className="settings-list-main" />
                    {canEdit(t) && (
                      <>
                        <button
                          className="icon-button"
                          aria-label={`Rename or recolour ${t.name}`}
                          onClick={() => {
                            setEditing(t.id);
                            setDraftName(t.name);
                            setDraftColor(t.color);
                          }}
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          className="icon-button"
                          aria-label={`Delete ${t.name}`}
                          disabled={action.pending}
                          onClick={() => remove(t)}
                        >
                          <Trash2 size={14} />
                        </button>
                      </>
                    )}
                  </li>
                ),
              )}
            </ul>
          )}
        </div>
      ))}
      <form className="settings-subform" onSubmit={create}>
        <h3 className="settings-subtitle">New tag</h3>
        <div className="inline-form">
          <input
            aria-label="New tag name"
            placeholder="Tag name"
            required
            maxLength={40}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          {writable.length > 0 && (
            <Select
              aria-label="Who the tag is for"
              value={scope}
              onChange={(e) => setScope(e.target.value)}
            >
              <option value="">Personal</option>
              {writable.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          )}
          <button className="primary" disabled={action.pending || !name.trim()}>
            <Plus size={14} /> Create tag
          </button>
        </div>
        <Swatches label="New tag colour" value={color} onChange={setColor} />
      </form>
      <OutcomeNote outcome={action.outcome} />
    </section>
  );
}
