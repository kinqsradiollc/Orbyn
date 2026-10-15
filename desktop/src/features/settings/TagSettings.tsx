import { SettingsEditor } from "./SettingsEditor";
import { SettingsSection } from "./SettingsSection";
import { Select } from "../../components/Select";
import { useConfirm } from "../../components/Confirm";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Check, Pencil, Plus, Trash2 } from "lucide-react";
import { hasTeamPermission, type Tag, type Team } from "@orbyn/core";
import { client } from "../../lib/api";
import { usePlanning } from "../../app/planning";
import { OutcomeNote, useAction } from "../../components/Outcome";
import { Swatches } from "../lists/ListsView";
import { SWATCHES } from "../../lib/planning";

type Props = { teams: Team[]; report: (e: unknown) => void };

/** Personal and team tags: create, rename, recolour and delete. */
export function TagSettings({ teams, report }: Props) {
  const { ask } = useConfirm();
  const { tags, reload } = usePlanning();
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
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

  const canEditNow = useRef(canEdit);
  canEditNow.current = canEdit;

  const create = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (
      !trimmed ||
      action.pending ||
      (scope && !writable.some((t) => t.id === scope))
    )
      return;
    void action.run(async () => {
      await client.createTag({ name: trimmed, color, team_id: scope || null });
      if (!alive.current) return;
      setName("");
      setAdding(false);
      await reload();
      return `Added “${trimmed}”.`;
    });
  };

  const save = (t: Tag) => {
    const trimmed = draftName.trim();
    if (!trimmed || action.pending || !canEdit(t)) return;
    void action.run(async () => {
      await client.updateTag(t.id, { name: trimmed, color: draftColor });
      if (!alive.current) return;
      setEditing(null);
      await reload();
    });
  };

  const remove = async (t: Tag) => {
    if (action.pending || !canEdit(t)) return;
    if (
      !(await ask({
        title: `Delete the tag “${t.name}”? Tasks keep everything else.`,
        confirmLabel: "Delete",
        destructive: true,
      }))
    )
      return;
    if (!alive.current || !canEditNow.current(t)) return;
    void action.run(async () => {
      await client.deleteTag(t.id);
      if (!alive.current) return;
      await reload();
      return `Deleted “${t.name}”.`;
    });
  };

  const selected = tags.find((t) => t.id === editing && canEdit(t));
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
    <SettingsSection
      className="card settings-card"
      aria-labelledby="tags-title"
    >
      <h2 id="tags-title">Tags</h2>

      {sections.map((s) => (
        <div key={s.key} className="tag-section">
          <h3 className="settings-subtitle">{s.title}</h3>
          {!s.tags.length ? (
            <p className="muted">None yet.</p>
          ) : (
            <ul className="settings-list">
              {s.tags.map((t) => (
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
                        disabled={action.pending}
                        onClick={() => {
                          action.setOutcome(null);
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
              ))}
            </ul>
          )}
        </div>
      ))}
      <button
        className="secondary"
        disabled={action.pending}
        onClick={() => {
          setAdding(true);
          action.setOutcome(null);
        }}
      >
        <Plus size={14} /> Add tag
      </button>
      {adding && (
        <SettingsEditor
          title="Add tag"
          pending={action.pending}
          onClose={() => setAdding(false)}
        >
          <form className="tag-edit" onSubmit={create}>
            <fieldset disabled={action.pending}>
              <label>
                Name
                <input
                  aria-label="New tag name"
                  placeholder="Tag name"
                  required
                  maxLength={40}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              {!!scope && !writable.some((t) => t.id === scope) && (
                <p role="alert">Choose an available space.</p>
              )}
              {writable.length > 0 && (
                <label>
                  Space
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
                </label>
              )}
              <div>
                <p className="field-label">Colour</p>
                <Swatches
                  label="New tag colour"
                  value={color}
                  onChange={setColor}
                />
              </div>
            </fieldset>
            <button
              className="primary"
              disabled={
                action.pending ||
                !name.trim() ||
                (!!scope && !writable.some((t) => t.id === scope))
              }
            >
              <Plus size={14} /> Create tag
            </button>
          </form>
          <OutcomeNote outcome={action.outcome} />
        </SettingsEditor>
      )}
      {selected && (
        <SettingsEditor
          title="Edit tag"
          pending={action.pending}
          onClose={() => setEditing(null)}
        >
          <form
            className="tag-edit"
            onSubmit={(e) => {
              e.preventDefault();
              selected && save(selected);
            }}
          >
            <label>
              Name
              <input
                aria-label="Tag name"
                disabled={action.pending}
                autoFocus
                required
                maxLength={40}
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
              />
            </label>
            <fieldset disabled={action.pending}>
              <legend>Colour</legend>
              <Swatches
                label={`Colour for ${selected?.name ?? "tag"}`}
                value={draftColor}
                onChange={setDraftColor}
              />
            </fieldset>
            <span className="button-row">
              <button className="primary" disabled={action.pending}>
                <Check size={14} /> Save
              </button>
            </span>
          </form>
          <OutcomeNote outcome={action.outcome} />
        </SettingsEditor>
      )}

      <OutcomeNote outcome={action.outcome} />
    </SettingsSection>
  );
}
