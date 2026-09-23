import { X } from "lucide-react";
import type { Item } from "@orbyn/core";

/** The most a task may wait on, matching the schema. */
const MAX = 14;

type Props = {
  /** The task being edited, so it cannot be offered to itself. */
  selfId: string | null;
  /** Everything this person can see; only open tasks are offered. */
  items: Item[];
  selected: string[];
  onChange: (ids: string[]) => void;
  readOnly?: boolean;
};

/**
 * What a task waits on.
 *
 * The planner will not place a task until every prerequisite is finished or
 * fully scheduled, so this is the field that explains a task the planner
 * keeps refusing to place. A loop would leave every task in it permanently
 * unplaceable, so the server refuses one; here we only keep the task from
 * offering itself, and let the server speak for the rest.
 */
export function WaitsOnPicker({
  selfId,
  items,
  selected,
  onChange,
  readOnly = false,
}: Props) {
  const byId = new Map(items.map((i) => [i.id, i]));
  const open = items.filter(
    (i) =>
      i.kind === "task" &&
      i.id !== selfId &&
      i.status !== "done" &&
      i.status !== "cancelled" &&
      !selected.includes(i.id),
  );
  const full = selected.length >= MAX;

  return (
    <fieldset className="waits-on">
      <legend>Waiting on</legend>
      {selected.length > 0 && (
        <ul className="waits-on-list">
          {selected.map((id) => (
            <li key={id}>
              <span>{byId.get(id)?.title ?? "A task you can't see"}</span>
              {!readOnly && (
                <button
                  type="button"
                  aria-label={`Stop waiting on ${byId.get(id)?.title ?? "this task"}`}
                  onClick={() => onChange(selected.filter((x) => x !== id))}
                >
                  <X size={13} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {!readOnly &&
        (open.length > 0 ? (
          <select
            aria-label="Add a task to wait on"
            disabled={full}
            value=""
            onChange={(e) => {
              if (e.target.value) onChange([...selected, e.target.value]);
            }}
          >
            <option value="">
              {full ? `That's ${MAX}, the most it can wait on` : "Add a task…"}
            </option>
            {open.map((i) => (
              <option key={i.id} value={i.id}>
                {i.title}
              </option>
            ))}
          </select>
        ) : (
          <small className="field-hint">
            Nothing else open to wait on yet.
          </small>
        ))}
      {selected.length === 0 && readOnly && (
        <small className="field-hint">Nothing.</small>
      )}
    </fieldset>
  );
}
