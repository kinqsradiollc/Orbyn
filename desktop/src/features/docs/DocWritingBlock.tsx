import type { ReactNode } from "react";
import { DocBlockActions } from "./DocBlockActions";

/** Render and edit occupy the same place; block tools never add a row of chrome. */
export function DocWritingBlock({
  children,
  index,
  path,
  blockId,
  text,
  canWrite,
  editing,
  sourceOpen,
  onSourceFocus,
  onEdit,
  onDone,
  onChange,
  onComment,
  onAssist,
  assistDisabled,
  keepRendered = false,
}: {
  children: ReactNode;
  index: number;
  path: number[];
  blockId?: string;
  text: string | null;
  canWrite: boolean;
  editing: boolean;
  sourceOpen: boolean;
  onSourceFocus: () => void;
  onEdit: () => void;
  onDone: () => void;
  onChange: (text: string) => void;
  onComment: () => void;
  onAssist: () => void;
  assistDisabled: boolean;
  /** Stateful code previews stay alive while their source is edited. */
  keepRendered?: boolean;
}) {
  const writable = canWrite && text !== null;
  return (
    <div
      className="structured-doc-leaf"
      role="group"
      data-editing={editing || undefined}
      data-block-id={blockId}
      data-leaf-index={index}
      data-container-path={path.join("/")}
      tabIndex={writable ? 0 : undefined}
      aria-label={`Block ${index + 1}`}
      aria-description={writable ? "Press Enter to edit." : undefined}
      onKeyDown={(event) => {
        if (
          event.target === event.currentTarget &&
          event.key === "Enter" &&
          writable
        ) {
          event.preventDefault();
          onEdit();
        }
      }}
      onClick={(event) => {
        if (
          (event.target as HTMLElement).closest(
            "a, button, input, textarea, iframe, summary",
          ) ||
          !window.getSelection()?.isCollapsed
        )
          return;
        if (sourceOpen) onSourceFocus();
        else if (writable) onEdit();
      }}
    >
      {writable && editing && (
        <textarea
          autoFocus
          rows={1}
          aria-label={`Edit block ${index + 1}`}
          value={text}
          onChange={(event) => onChange(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              event.currentTarget.parentElement?.focus();
              onDone();
            }
          }}
          onBlur={(event) => {
            if (
              !event.currentTarget.parentElement?.contains(
                event.relatedTarget as Node | null,
              )
            )
              onDone();
          }}
        />
      )}
      {(!writable || !editing || keepRendered) && (
        <div
          className="doc-writing-rendered"
          hidden={writable && editing}
          inert={writable && editing}
        >
          {children}
        </div>
      )}
      {writable && (
        <DocBlockActions
          index={index}
          editing={editing}
          onEdit={onEdit}
          onDone={onDone}
          onComment={onComment}
          onAssist={onAssist}
          assistDisabled={assistDisabled}
        />
      )}
    </div>
  );
}
