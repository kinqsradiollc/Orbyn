import { useConfirm } from "../../components/Confirm";
import { useEffect, useState } from "react";
import { Trash2, X } from "lucide-react";
import type { Frame, Team } from "@orbyn/core";
import { client } from "../../lib/api";
import { FrameForm } from "../settings/FrameForm";

type Props = {
  frameId: string;
  teams: Team[];
  report: (e: unknown) => void;
  onClose: () => void;
  onSaved: () => void;
  /** The frame was deleted. */
  onDeleted: () => void;
};

/** The frame editor over the calendar, opened from a frame's band. */
export function FrameDialog({
  frameId,
  teams,
  report,
  onClose,
  onSaved,
  onDeleted,
}: Props) {
  const { ask, tell } = useConfirm();
  /** Undefined while loading; null when the frame is gone. */
  const [frame, setFrame] = useState<Frame | null | undefined>(undefined);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    let alive = true;
    client.listFrames().then(
      (all) => alive && setFrame(all.find((f) => f.id === frameId) ?? null),
      (e) => {
        if (!alive) return;
        setFrame(null);
        report(e);
      },
    );
    return () => {
      alive = false;
    };
  }, [frameId, report]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const remove = async () => {
    if (!frame) return;
    if (
      !(await ask({
        title: `Delete the frame “${frame.name}”? Every day of it goes, not just this one.`,
        confirmLabel: "Delete",
        destructive: true,
      }))
    )
      return;
    setDeleting(true);
    try {
      await client.deleteFrame(frame.id);
      onDeleted();
    } catch (e) {
      report(e);
      setDeleting(false);
    }
  };

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        className="modal frame-dialog scale-in"
        role="dialog"
        aria-modal="true"
        aria-labelledby="frame-dialog-title"
      >
        <div className="section-heading">
          <h2 id="frame-dialog-title">
            {frame ? `Edit “${frame.name}”` : "Edit frame"}
          </h2>
          <button
            className="icon-button"
            aria-label="Close frame editor"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </div>
        <div className="frame-dialog-body">
          {frame === undefined ? (
            <p className="muted">Loading the frame…</p>
          ) : frame === null ? (
            <p className="muted">This frame no longer exists.</p>
          ) : (
            <>
              <FrameForm
                frame={frame}
                teams={teams}
                report={report}
                onSaved={onSaved}
                onCancel={onClose}
              />
              <div className="button-row start">
                <button
                  type="button"
                  className="danger"
                  disabled={deleting}
                  onClick={() => void remove()}
                >
                  <Trash2 size={16} /> {deleting ? "Deleting…" : "Delete frame"}
                </button>
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
