import { useEffect, useRef, useState } from "react";
import { session } from "../lib/session";
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
  onClear,
  value,
  label = "Choose a file",
  hint,
  disabled,
  id,
}: {
  accept?: string;
  onFile: (file: File) => void;
  onClear?: () => void;
  /** Controlled display name, including an empty value after clearing/importing. */
  value?: string;
  label?: string;
  /** Shown while nothing is chosen, e.g. which kinds are accepted. */
  hint?: string;
  disabled?: boolean;
  id?: string;
}) {
  const owner = useRef(session.get()).current;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const [chosen, setChosen] = useState<File | null>(null);
  const [over, setOver] = useState(false);
  useEffect(() => {
    if (disabled) setOver(false);
  }, [disabled]);
  const blocked = () =>
    !mounted.current ||
    session.get() !== owner ||
    !!disabled ||
    !!input.current?.matches(":disabled");
  const name = value ?? chosen?.name;

  const take = (file: File | undefined) => {
    if (!file || blocked()) return;
    setError("");
    setChosen(file);
    onFile(file);
  };

  return (
    <div
      className={"file-picker" + (over ? " is-over" : "")}
      onDragOver={(e) => {
        e.preventDefault();
        if (blocked()) return;
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        if (blocked()) return;
        if (e.dataTransfer.files.length > 1) {
          setError("Choose one file.");
          return;
        }
        take(e.dataTransfer.files?.[0]);
      }}
    >
      {/* The real input: hidden from sight, still the thing that is clicked. */}
      <input
        ref={input}
        id={id}
        type="file"
        accept={accept}
        aria-label={label}
        disabled={disabled}
        className="file-picker-input"
        onChange={(e) => {
          take(e.target.files?.[0]);
          e.currentTarget.value = "";
        }}
      />
      <button
        type="button"
        className="secondary"
        disabled={disabled}
        onClick={() => {
          if (!blocked()) input.current?.click();
        }}
      >
        <FileUp size={15} aria-hidden="true" /> {label}
      </button>
      {name ? (
        <span className="file-picker-chosen">
          <strong>{name}</strong>
          {(value === undefined || onClear) && (
            <button
              type="button"
              className="icon-button"
              aria-label={`Clear ${name}`}
              disabled={disabled}
              onClick={() => {
                if (blocked()) return;
                setError("");
                setChosen(null);
                if (input.current) input.current.value = "";
                onClear?.();
              }}
            >
              <X size={14} />
            </button>
          )}
        </span>
      ) : (
        <span className="file-picker-hint">{hint ?? "or drop one here"}</span>
      )}
      {!!error && (
        <span className="field-hint" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
