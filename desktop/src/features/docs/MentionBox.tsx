import { useEffect, useRef, useState } from "react";
import { session } from "../../lib/session";
import { client } from "../../lib/api";

export type Person = { id: string; name: string; email: string };

/**
 * A comment box that can name people.
 *
 * Typing `@` offers the people who can already see this page, and nobody
 * else: naming someone is not a way to show them a document they have no
 * business reading. The name goes into the text as plain words and the
 * person's id is kept beside it, so the body still reads for anyone and the
 * notice still reaches the right person.
 */
export function MentionBox({
  id,
  value,
  onChange,
  onNamed,
  named,
  docId,
  placeholder,
  rows = 2,
  autoFocus,
  onSubmit,
  onCancel,
  disabled = false,
}: {
  id: string;
  value: string;
  onChange: (text: string) => void;
  /** Called with everyone the text still names, whenever it changes. */
  onNamed: (ids: string[]) => void;
  named: Map<string, string>;
  docId: string;
  placeholder: string;
  rows?: number;
  autoFocus?: boolean;
  onSubmit: () => void;
  onCancel?: () => void;
  disabled?: boolean;
}) {
  const accountAtRender = session.get();
  const [people, setPeople] = useState<Person[] | null>(null);
  const [query, setQuery] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const [pick, setPick] = useState(0);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const loadedOwner = useRef<{ id: string; account: string } | null>(null);
  useEffect(() => {
    loadedOwner.current = null;
    setPeople(null);
    setQuery(null);
    setFailed(false);
  }, [docId, accountAtRender]);

  // The list is fetched once, the first time anyone reaches for it.
  const needsPeople = query !== null;
  useEffect(() => {
    if (disabled || query === null || people !== null) return;
    let alive = true;
    const account = session.get();
    setFailed(false);
    client.docPeople(docId).then(
      (rows) => {
        if (alive && session.get() === account) {
          loadedOwner.current = { id: docId, account };
          setPeople(rows);
        }
      },
      () => {
        if (alive && session.get() === account) setFailed(true);
      },
    );
    return () => {
      alive = false;
    };
  }, [disabled, needsPeople, people, docId, retry, accountAtRender]);

  /** The word being typed after an `@`, or null when there isn't one. */
  const watch = (text: string, caret: number) => {
    const before = text.slice(0, caret);
    const at = before.lastIndexOf("@");
    if (at === -1) return setQuery(null);
    const word = before.slice(at + 1);
    if (/\s/.test(word) || word.length > 30) return setQuery(null);
    if (at > 0 && !/\s/.test(before[at - 1])) return setQuery(null);
    setQuery(word);
    setPick(0);
  };

  const matches = (
    loadedOwner.current?.id === docId &&
    loadedOwner.current.account === session.get()
      ? (people ?? [])
      : []
  )
    .filter((p) =>
      query ? p.name.toLowerCase().includes(query.toLowerCase()) : true,
    )
    .slice(0, 6);

  const choose = (person: Person | undefined) => {
    if (
      disabled ||
      query === null ||
      !person ||
      !matches.some((match) => match.id === person.id)
    )
      return;
    const area = areaRef.current;
    if (!area) return;
    const caret = area.selectionStart;
    const before = value.slice(0, caret);
    const at = before.lastIndexOf("@");
    if (at < 0 || /\s/.test(before.slice(at + 1))) return;
    const next = `${value.slice(0, at)}@${person.name} ${value.slice(caret)}`;
    named.set(person.id, person.name);
    onChange(next);
    setQuery(null);
    onNamed(stillNamed(next, named));
    // Put the caret after the name that was just inserted.
    requestAnimationFrame(() => {
      const to = at + person.name.length + 2;
      if (areaRef.current !== area || !area.isConnected || area.disabled)
        return;
      area.focus();
      area.setSelectionRange(to, to);
    });
  };

  return (
    <div className="doc-mention-box">
      <textarea
        id={id}
        disabled={disabled}
        aria-label={placeholder}
        ref={areaRef}
        autoFocus={autoFocus}
        value={value}
        placeholder={placeholder}
        maxLength={4000}
        rows={rows}
        onChange={(e) => {
          onChange(e.target.value);
          watch(e.target.value, e.target.selectionStart);
          onNamed(stillNamed(e.target.value, named));
        }}
        onKeyDown={(e) => {
          if (disabled || e.nativeEvent.isComposing) return;
          if (query !== null && matches.length) {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              return setPick((i) => (i + 1) % matches.length);
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              return setPick((i) => (i - 1 + matches.length) % matches.length);
            }
            if (e.key === "Enter" || e.key === "Tab") {
              e.preventDefault();
              return choose(matches[pick] ?? matches[0]);
            }
            if (e.key === "Escape") {
              e.preventDefault();
              return setQuery(null);
            }
          }
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            onSubmit();
          }
          if (e.key === "Escape" && onCancel) onCancel();
        }}
      />
      {query !== null && failed && (
        <p className="doc-menu-note" role="alert">
          Could not load members.{" "}
          <button
            className="text-button"
            disabled={disabled}
            onClick={() => setRetry(retry + 1)}
          >
            Retry
          </button>
        </p>
      )}
      {query !== null && !failed && people === null && (
        <p className="doc-menu-note">Loading members…</p>
      )}
      {query !== null && people !== null && !matches.length && (
        <p className="doc-menu-note">No matching member.</p>
      )}
      {query !== null && !disabled && matches.length > 0 && (
        <ul className="doc-mention-list" role="listbox" aria-label="People">
          {matches.map((person, i) => (
            <li key={person.id}>
              <button
                type="button"
                disabled={disabled}
                role="option"
                aria-selected={i === pick}
                className={i === pick ? "is-on" : undefined}
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(person);
                }}
              >
                <strong>{person.name}</strong>
                <small>{person.email}</small>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * The people a body still names. Someone whose name has been deleted from
 * the text is no longer being spoken to, so they are not told about it.
 */
export function stillNamed(text: string, named: Map<string, string>): string[] {
  return [...named.entries()]
    .filter(([, name]) => text.includes(`@${name}`))
    .map(([id]) => id);
}
