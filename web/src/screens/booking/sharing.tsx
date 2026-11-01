import { useEffect, useRef, useState } from "react";
import { Button, ErrorNotice, Field, TextArea } from "../../ui/kit";
import { useExit, useOwner } from "./shared";
export function CopyButton({ text, label }: { text: string; label: string }) {
  const owned = useOwner(),
    lock = useRef(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [copied, setCopied] = useState(false);
  const current = useRef(text);
  current.current = text;
  useEffect(() => {
    setCopied(false);
    setError("");
  }, [text]);
  useExit({ pending: busy }, lock);
  async function copy() {
    if (lock.current || !owned()) return;
    const snapshot = text;
    lock.current = true;
    setBusy(true);
    setError("");
    setCopied(false);
    try {
      await navigator.clipboard.writeText(snapshot);
      if (owned() && current.current === snapshot) setCopied(true);
    } catch {
      if (owned() && current.current === snapshot)
        setError("Copy failed. Select and copy the displayed text manually.");
    } finally {
      lock.current = false;
      if (owned()) setBusy(false);
    }
  }
  return (
    <>
      <Button busy={busy} onClick={() => void copy()}>
        {copied ? "Copied" : label}
      </Button>
      {error && (
        <>
          <ErrorNotice message={error} />
          <Field label="Text to copy manually">
            <TextArea
              readOnly
              value={text}
              onFocus={(e) => e.target.select()}
            />
          </Field>
        </>
      )}
    </>
  );
}
