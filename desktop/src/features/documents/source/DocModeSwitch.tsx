import { Eye } from "lucide-react";
import { Select } from "../../../components/Select";
import { MODE_LABELS, modesFor, type DocMode } from "@orbyn/core";

const MOD =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad/.test(navigator.userAgent)
    ? "⌘"
    : "Ctrl+";

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
    <Select
      className="doc-mode-picker"
      aria-label="How you're working on this page"
      title={`Page mode (${MOD}⇧R switches)`}
      value={mode}
      onChange={(event) => onChange(event.target.value as DocMode)}
    >
      {modes.map((value) => (
        <option key={value} value={value}>
          {MODE_LABELS[value].name}
        </option>
      ))}
    </Select>
  );
}
