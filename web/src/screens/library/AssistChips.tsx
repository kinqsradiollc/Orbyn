import { ASSIST_CHIPS, CHIP_CARDS, type AssistChip } from "@orbyn/core";
import { useState } from "react";
import { MakeCards } from "../study/MakeCards";
import { AssistDialog } from "./AssistDialog";

/** Optional help on an imported page; each result waits for review. */
export function AssistChips({
  docId,
  title,
}: {
  docId: string;
  title: string;
  onCards?: () => void;
}) {
  const [open, setOpen] = useState<AssistChip | null>(null);
  return (
    <span className="lib-chips" role="group" aria-label="Ask the assistant">
      {ASSIST_CHIPS.map((chip) => (
        <button
          key={chip.id}
          type="button"
          className="small"
          onClick={() => setOpen(chip.id)}
        >
          {chip.label}
        </button>
      ))}
      {open === "cards" && (
        <MakeCards
          docId={docId}
          title={title}
          max={CHIP_CARDS}
          onClose={() => setOpen(null)}
        />
      )}
      {open && open !== "cards" && (
        <AssistDialog
          chip={open}
          docId={docId}
          title={title}
          onClose={() => setOpen(null)}
        />
      )}
    </span>
  );
}
