import { useEffect, useId, useRef, useState } from "react";
import { X } from "lucide-react";
import { useModalFocus } from "../../hooks/useModalFocus";

/** A retained instruction; failed provider calls never discard the person's draft. */
export function DocSourceAsk({
  text,
  onAsk,
  onClose,
}: {
  text: string;
  onAsk: (instruction: string) => Promise<unknown>;
  onClose: () => void;
}) {
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);
  const mounted = useRef(true);
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();
  const close = () => {
    if (!pending.current) onClose();
  };
  const focus = useModalFocus(close, busy);
  useEffect(() => {
    mounted.current = true;
    dialog.current?.showModal();
    return () => {
      mounted.current = false;
      dialog.current?.close();
    };
  }, []);
  const submit = async () => {
    if (pending.current || !instruction.trim()) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      await onAsk(instruction.trim());
      if (mounted.current) onClose();
    } catch (failure) {
      if (mounted.current)
        setError(
          failure instanceof Error
            ? failure.message
            : "Couldn’t ask the assistant. Try again.",
        );
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  return (
    <dialog
      ref={(node) => {
        dialog.current = node;
        focus.ref.current = node;
      }}
      data-modal-focus={focus.id}
      tabIndex={-1}
      className="doc-source-dialog doc-source-ask"
      aria-labelledby={id}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <div className="section-heading">
        <h2 id={id}>Ask assistant</h2>
        <button
          className="icon-button"
          aria-label="Close assistant request"
          disabled={busy}
          onClick={close}
        >
          <X size={20} />
        </button>
      </div>
      <details>
        <summary>Selected source</summary>
        <pre className="doc-source-quote">{text}</pre>
      </details>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <label htmlFor={`${id}-instruction`}>What should change?</label>
        <textarea
          id={`${id}-instruction`}
          value={instruction}
          maxLength={500}
          rows={3}
          disabled={busy}
          onChange={(event) => setInstruction(event.currentTarget.value)}
        />
        {error && <p role="alert">{error}</p>}
        <div className="doc-card-actions">
          <button type="button" disabled={busy} onClick={close}>
            Cancel
          </button>
          <button
            className="primary"
            type="submit"
            disabled={busy || !instruction.trim()}
          >
            {busy ? "Asking…" : "Ask assistant"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
