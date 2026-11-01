import { useLayoutEffect, useRef, useState } from "react";
import { Button } from "../../../ui/kit";

/** Public text only. A late clipboard result cannot label a newer value copied. */
export function CopyText({
  text,
  label = "Copy",
}: {
  text: string;
  label?: string;
}) {
  const owner = useRef(0),
    pending = useRef(false);
  const [busy, setBusy] = useState(false),
    [result, setResult] = useState("");
  useLayoutEffect(() => {
    owner.current++;
    pending.current = false;
    setBusy(false);
    setResult("");
    return () => {
      owner.current++;
      pending.current = false;
    };
  }, [text]);
  async function copy() {
    if (pending.current) return;
    const captured = owner.current;
    pending.current = true;
    setBusy(true);
    setResult("");
    try {
      if (!navigator.clipboard?.writeText) throw Error("Clipboard unavailable");
      await navigator.clipboard.writeText(text);
      if (captured === owner.current) setResult("Copied");
    } catch {
      if (captured === owner.current)
        setResult("Copy failed. Select the text and copy it manually.");
    } finally {
      if (captured === owner.current) {
        pending.current = false;
        setBusy(false);
      }
    }
  }
  return (
    <div className="developers-copy">
      <Button busy={busy} onClick={() => void copy()}>
        {label}
      </Button>
      <span role="status" className="small">
        {result}
      </span>
    </div>
  );
}
