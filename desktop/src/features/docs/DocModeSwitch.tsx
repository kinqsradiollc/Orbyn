import { Eye, PencilLine } from "lucide-react";
import { MODE_LABELS, modesFor, type DocMode } from "@orbyn/core";

const ICONS: Record<DocMode, typeof Eye> = {
  edit: PencilLine,
  suggest: PencilLine,
  read: Eye,
};

/**
 * How this page is being worked on: changing it, or only reading it.
 *
 * Someone who cannot change a team's page is not shown an editor that will
 * refuse their first save — they are shown the page, and a note saying why
 * it is theirs to read. Everyone can still remark on it, whichever mode
 * they are in.
 */
export function DocModeSwitch({
  mode,
  canWrite,
  teamName,
  onChange,
}: {
  mode: DocMode;
  canWrite: boolean;
  /** Named in the explanation when the page belongs to a team. */
  teamName?: string | null;
  onChange: (mode: DocMode) => void;
}) {
  const modes = modesFor(canWrite);
  if (modes.length < 2)
    return (
      <span className="doc-mode-fixed">
        <Eye size={13} aria-hidden="true" /> View only
        {teamName ? ` — you're a viewer in ${teamName}` : ""}
      </span>
    );
  return (
    <span
      className="doc-mode"
      role="radiogroup"
      aria-label="How you're working on this page"
    >
      {modes.map((m) => {
        const Icon = ICONS[m];
        return (
          <button
            key={m}
            role="radio"
            aria-checked={mode === m}
            className={mode === m ? "is-on" : undefined}
            title={MODE_LABELS[m].blurb}
            onClick={() => onChange(m)}
          >
            <Icon size={13} aria-hidden="true" /> {MODE_LABELS[m].name}
          </button>
        );
      })}
    </span>
  );
}
