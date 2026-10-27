import { usePaneLeaveGuard } from "../../../app/page-commands";
import { useConfirm } from "../../../components/Confirm";
import { session } from "../../../lib/session";
import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { MAX_ALIASES } from "@orbyn/core";

/**
 * "Also called" (LNK-03): other names a page or project goes by, such as a
 * course code. The link picker, the quick switcher, search and "Mentioned
 * without a link" find it by them too. Enter adds one; × takes one off.
 */
export function AliasesField({
  aliases,
  canWrite,
  onSave,
  placeholder = "Add another name, like CS101",
}: {
  aliases: string[];
  canWrite: boolean;
  /** Saves the whole list; resolves with what was kept. */
  onSave: (next: string[]) => Promise<string[]>;
  placeholder?: string;
}) {
  const [list, setList] = useState(aliases);
  const [typed, setTyped] = useState("");
  const mutation = useRef(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => setList(aliases), [aliases]);
  const { ask } = useConfirm();
  const mounted = useRef(true);
  const account = useRef(session.get()).current;
  const latestTyped = useRef(typed);
  latestTyped.current = typed;
  const deciding = useRef(false);
  const current = () => mounted.current && account === session.get();
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  usePaneLeaveGuard(async () => {
    if (mutation.current || deciding.current) return false;
    const value = latestTyped.current;
    if (!value.trim()) return true;
    deciding.current = true;
    try {
      if (
        !(await ask({
          title: "Discard another name?",
          body: "The name you haven't added will be lost.",
          confirmLabel: "Discard name",
          cancelLabel: "Keep editing",
        }))
      )
        return false;
      if (!current() || latestTyped.current !== value || mutation.current)
        return false;
      setTyped("");
      return true;
    } finally {
      deciding.current = false;
    }
  });

  const save = (next: string[], added?: string) => {
    if (mutation.current || deciding.current || !canWrite || !current()) return;
    const submitted = latestTyped.current;
    mutation.current = true;
    setBusy(true);
    setError("");
    void onSave(next)
      .then(
        (kept) => {
          if (!current()) return;
          setList(kept);
          if (added && latestTyped.current === submitted) setTyped("");
        },
        () => {
          if (current()) setError("Could not save names. Try again.");
        },
      )
      .finally(() => {
        mutation.current = false;
        if (current()) setBusy(false);
      });
  };
  if (!canWrite && !list.length) return null;
  return (
    <div className="aliases-field">
      {list.map((a) => (
        <span key={a} className="aliases-chip">
          {a}
          {canWrite && (
            <button
              type="button"
              aria-label={`Remove ${a}`}
              disabled={busy}
              onClick={() => save(list.filter((x) => x !== a))}
            >
              <X size={12} aria-hidden="true" />
            </button>
          )}
        </span>
      ))}
      {canWrite && list.length < MAX_ALIASES && (
        <input
          value={typed}
          placeholder={list.length ? "Add another" : placeholder}
          aria-label="Add another name"
          maxLength={80}
          disabled={busy}
          onChange={(e) => {
            latestTyped.current = e.target.value;
            setTyped(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key !== "Enter" && e.key !== ",") return;
            e.preventDefault();
            const name = typed.trim();
            if (!name) return;
            if (list.some((x) => x.toLowerCase() === name.toLowerCase()))
              return;
            save([...list, name], name);
          }}
        />
      )}
      {error && (
        <span className="error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
