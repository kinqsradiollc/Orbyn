import { useConfirm } from "../../components/Confirm";
import { useEffect, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import { HttpError, type Frame, type Team } from "@orbyn/core";
import { client } from "../../lib/api";
import { FrameForm } from "../settings/FrameForm";
import { SettingsEditor } from "../settings/SettingsEditor";

type Props = {
  frameId: string;
  teams: Team[];
  report: (e: unknown) => void;
  onClose: () => void;
  onSaved: () => void;
  onDeleted: () => void;
};

/** The calendar frame editor owns its reads, writes and dismissal. */
export function FrameDialog({
  frameId,
  teams,
  report,
  onClose,
  onSaved,
  onDeleted,
}: Props) {
  const { ask } = useConfirm();
  const [frame, setFrame] = useState<Frame | null | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [deleting, setDeleting] = useState(false);
  const [editing, setEditing] = useState(false);
  const deletingRef = useRef(false);
  const mounted = useRef(true);
  const busy = deleting || editing;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    let alive = true;
    setFrame(undefined);
    setFailed(false);
    client.listFrames().then(
      (all) => {
        if (alive) setFrame(all.find((f) => f.id === frameId) ?? null);
      },
      (error) => {
        if (!alive) return;
        setFailed(true);
        if (error instanceof HttpError && error.statusCode === 401)
          report(error);
      },
    );
    return () => {
      alive = false;
    };
  }, [frameId, attempt]);

  const remove = async () => {
    if (!frame || busy || deletingRef.current) return;
    deletingRef.current = true;
    try {
      if (
        !(await ask({
          title: `Delete “${frame.name}”?`,
          body: "All occurrences of this frame are removed. Tasks are unchanged.",
          confirmLabel: "Delete",
          destructive: true,
        })) ||
        !mounted.current
      )
        return;
      setDeleting(true);
      await client.deleteFrame(frame.id);
      if (mounted.current) onDeleted();
    } catch (error) {
      if (mounted.current) report(error);
    } finally {
      deletingRef.current = false;
      if (mounted.current) setDeleting(false);
    }
  };

  return (
    <SettingsEditor title="Edit frame" pending={busy} onClose={onClose}>
      {failed ? (
        <>
          <p role="alert">Couldn't load the frame.</p>
          <button
            className="secondary"
            onClick={() => setAttempt((n) => n + 1)}
          >
            Retry
          </button>
        </>
      ) : frame === undefined ? (
        <p className="muted">Loading frame…</p>
      ) : frame === null ? (
        <p className="muted">This frame no longer exists.</p>
      ) : (
        <>
          <div className="button-row start">
            <button
              type="button"
              className="icon-button"
              disabled={busy}
              aria-label={`Delete ${frame.name}`}
              title="Delete frame"
              onClick={() => void remove()}
            >
              <Trash2 size={16} />
            </button>
          </div>
          <FrameForm
            key={frame.id}
            frame={frame}
            teams={teams}
            report={report}
            onPendingChange={setEditing}
            onSaved={onSaved}
            onCancel={onClose}
          />
        </>
      )}
    </SettingsEditor>
  );
}
