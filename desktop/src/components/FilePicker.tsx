import { useRef, useState } from "react";
import { FileUp, X } from "lucide-react";

/**
 * Choosing a file, in Orbyn's own words.
 *
 * The browser's file input writes its own button and its own "No file
 * chosen" in the platform's typeface, and neither can be styled. The real
 * input is still here — it is the only way to reach the file dialog, and it
 * is what keyboards and screen readers already know how to use — but it is
 * hidden behind a button and a line of our own, and the file can be dropped
 * on it as well.
 */
export function FilePicker({
  accept,
  onFile,
  label = "Choose a file",
  hint,
  disabled,
  id,
}: {
  accept?: string;
  onFile: (file: File) => void;
  label?: string;
  /** Shown while nothing is chosen, e.g. which kinds are accepted. */
  hint?: string;
  disabled?: boolean;
  id?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [chosen, setChosen] = useState<File | null>(null);
  const [over, setOver] = useState(false);

  const take = (file: File | undefined) => {
    if (!file) return;
    setChosen(file);
    onFile(file);
  };

  return (
    <div
      className={"file-picker" + (over ? " is-over" : "")}
      onDragOver={(e) => {
        if (disabled) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        if (disabled) return;
        e.preventDefault();
        setOver(false);
        take(e.dataTransfer.files?.[0]);
      }}
    >
      {/* The real input: hidden from sight, still the thing that is clicked. */}
      <input
        ref={input}
        id={id}
        type="file"
        accept={accept}
        disabled={disabled}
        className="file-picker-input"
        onChange={(e) => take(e.target.files?.[0])}
      />
      <button
        type="button"
        className="secondary"
        disabled={disabled}
        onClick={() => input.current?.click()}
      >
        <FileUp size={15} aria-hidden="true" /> {label}
      </button>
      {chosen ? (
        <span className="file-picker-chosen">
          <strong>{chosen.name}</strong>
          <button
            type="button"
            className="icon-button"
            aria-label={`Forget ${chosen.name}`}
            onClick={() => {
              setChosen(null);
              if (input.current) input.current.value = "";
            }}
          >
            <X size={14} />
          </button>
        </span>
      ) : (
        <span className="file-picker-hint">{hint ?? "or drop one here"}</span>
      )}
    </div>
  );
}
