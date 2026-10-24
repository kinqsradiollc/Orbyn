import { useState } from "react";

export function CopyMessage({ text }: { text: string }) {
  const [status, setStatus] = useState("");
  return (
    <span className="ai-copy-action">
      <button
        type="button"
        className="text-button"
        aria-label="Copy message"
        onClick={() => {
          setStatus("");
          void (async () => {
            try {
              if (!navigator.clipboard)
                throw new Error("Clipboard unavailable");
              await navigator.clipboard.writeText(text);
              setStatus("Copied");
            } catch {
              setStatus("Couldn’t copy");
            }
          })();
        }}
      >
        Copy
      </button>
      <span className="sr-only" role="status">
        {status}
      </span>
    </span>
  );
}

/** Collapse presentation only; the full message stays available to copy. */
export function UserMessage({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const long = text.length > 700 || text.split("\n").length > 10;
  return (
    <>
      <div
        className={
          "ai-bubble ai-bubble-user" +
          (long && !expanded ? " is-truncated" : "")
        }
      >
        {text}
      </div>
      <div className="ai-message-actions">
        {long && (
          <button
            type="button"
            className="text-button"
            aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? "Show less" : "Show more"}
          </button>
        )}
        <CopyMessage text={text} />
      </div>
    </>
  );
}
