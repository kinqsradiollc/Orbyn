import type { EditScope, Kind } from "@orbyn/core";
import { Button, Dialog } from "../../ui/kit";

/** Which times of a repeating item a change or delete covers. */
export function ScopeDialog({
  kind,
  action,
  onChoose,
  onCancel,
}: {
  kind: Kind;
  action: "save" | "move" | "delete";
  onChoose: (scope: EditScope) => void;
  onCancel: () => void;
}) {
  const noun = kind === "event" ? "event" : "task";
  const verb = { save: "Change", move: "Move", delete: "Delete" }[action];
  const options: { scope: EditScope; title: string; hint: string }[] = [
    { scope: "this", title: `This ${noun}`, hint: "Only this one" },
    {
      scope: "following",
      title: `This and following ${noun}s`,
      hint: "This one and every one after it",
    },
    { scope: "all", title: `All ${noun}s`, hint: "The whole series" },
  ];
  return (
    <Dialog
      title={`${verb} a repeating ${noun}`}
      onClose={onCancel}
      actions={
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      }
    >
      <div className="rows">
        {options.map((option) => (
          <button
            key={option.scope}
            type="button"
            className="row"
            onClick={() => onChoose(option.scope)}
          >
            <span className="row-main">
              <span className="row-title">{option.title}</span>
              <span className="muted small">{option.hint}</span>
            </span>
          </button>
        ))}
      </div>
    </Dialog>
  );
}
