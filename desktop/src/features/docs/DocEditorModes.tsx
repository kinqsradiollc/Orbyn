import "./doc-editor-modes.css";

export type DocumentEditorMode = "note" | "markdown" | "latex";

/** Editing formats are primary document tools, visible before opening a menu. */
export function DocEditorModes({
  value,
  disabled = false,
  onChange,
}: {
  value: DocumentEditorMode;
  disabled?: boolean;
  onChange: (mode: DocumentEditorMode) => void;
}) {
  return (
    <div className="doc-editor-modes" role="group" aria-label="Document editor">
      {(
        [
          ["note", "Note"],
          ["markdown", "Markdown"],
          ["latex", "LaTeX"],
        ] as const
      ).map(([mode, label]) => (
        <button
          key={mode}
          type="button"
          disabled={disabled}
          aria-pressed={value === mode}
          onClick={() => onChange(mode)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
