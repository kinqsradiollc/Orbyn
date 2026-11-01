import {
  assignShortcut,
  shortcutConflicts,
  SHORTCUT_CATALOG,
} from "./shortcuts";
import {
  HttpError,
  arrangeEntries,
  keysFromPress,
  keysFor,
  moveEntry,
  toggleSidebarHidden,
  type AccountPrefs,
  type CommandDef,
  type ShortcutOverrides,
  type SidebarArrangement,
} from "@orbyn/core";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useBeforeNavigate } from "../../lib/router";
import { client, getSessionVersion } from "../../lib/session";
import { messageOf } from "../../lib/resource";
import { Button, Dialog, ErrorNotice, Input, useConfirm } from "../../ui/kit";
import { reloadPrefs, savePrefs, usePrefs } from "../../screens/today/prefs";

type Choice =
  | { kind: "sidebar"; value: SidebarArrangement }
  | { kind: "shortcuts"; value: ShortcutOverrides };
function ordered(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(ordered);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, ordered(entry)]),
    );
  return value;
}
const same = (a: unknown, b: unknown) =>
  JSON.stringify(ordered(a)) === JSON.stringify(ordered(b));

/** The form owns its draft; only an exact authoritative read resolves an uncertain PUT. */
function PreferenceEditor({
  title,
  choice,
  onClose,
  children,
}: {
  title: string;
  choice: Choice;
  onClose(): void;
  children(args: {
    value: Choice;
    change(next: Choice): void;
    disabled: boolean;
  }): ReactNode;
}) {
  const [owner] = useState(getSessionVersion);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const current = () => mounted.current && owner === getSessionVersion();
  const [draft, setDraft] = useState(choice),
    [base, setBase] = useState(choice);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [unknown, setUnknown] = useState<Choice | null>(null);
  const mutex = useRef(false),
    confirm = useConfirm();
  const latest = useRef(draft);
  latest.current = draft;
  const dirty = !same(draft, base);
  useEffect(() => {
    if (!dirty && !busy && !unknown) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, busy, unknown]);
  const close = useCallback(async () => {
    if (!current() || mutex.current || unknown) return false;
    mutex.current = true;
    setBusy(true);
    const opening = latest.current;
    try {
      if (
        dirty &&
        !(await confirm({
          title: "Discard changes?",
          body: "Your saved preferences will stay as they are.",
          action: "Discard changes",
          danger: true,
        }))
      )
        return false;
      if (!current() || latest.current !== opening) return false;
      onClose();
      return true;
    } finally {
      mutex.current = false;
      if (current()) setBusy(false);
    }
  }, [dirty, unknown, confirm, onClose, owner]);
  useBeforeNavigate(close);
  const save = async () => {
    if (!current() || mutex.current || unknown || !dirty) return;
    mutex.current = true;
    setBusy(true);
    setError("");
    const attempt: Choice = structuredClone(draft);
    let saveReturned = false;
    try {
      if (!current()) return;
      await savePrefs(
        attempt.kind === "sidebar"
          ? { sidebar: attempt.value }
          : { shortcuts: attempt.value },
      );
      if (!current()) return;
      saveReturned = true;
      const observed = await client.request<AccountPrefs>("/me/prefs", {
        fresh: true,
        headers: { "X-Orbyn-Consistency": "primary" },
      });
      if (!current()) return;
      if (!same(observed[attempt.kind], attempt.value))
        throw new Error(
          "The saved preferences didn't match. Check the current saved choice before continuing.",
        );
      setBase(attempt);
      if (same(latest.current, attempt)) setDraft(attempt);
      client.noteExternalMutation();
      await reloadPrefs();
    } catch (failure) {
      if (!current()) return;
      // PUT has no compare-and-set receipt. A failed response can follow a committed write.
      if (
        saveReturned ||
        !(failure instanceof HttpError) ||
        failure.statusCode >= 500 ||
        failure.statusCode === 408
      )
        setUnknown(attempt);
      setError(
        messageOf(
          failure,
          "Couldn't confirm the saved preferences. Check the saved choice.",
        ),
      );
    } finally {
      mutex.current = false;
      if (current()) setBusy(false);
    }
  };
  const check = async () => {
    if (!current() || mutex.current || !unknown) return;
    mutex.current = true;
    setBusy(true);
    setError("");
    const attempt = unknown;
    try {
      const observed = await client.request<AccountPrefs>("/me/prefs", {
        fresh: true,
        headers: { "X-Orbyn-Consistency": "primary" },
      });
      if (!current()) return;
      if (!same(observed[attempt.kind], attempt.value)) {
        setError(
          "The saved choice doesn't match this request yet. Keep this window open and check again; it hasn't been sent again.",
        );
        return;
      }
      setBase(attempt);
      setUnknown(null);
      client.noteExternalMutation();
      await reloadPrefs();
    } catch (failure) {
      if (current())
        setError(messageOf(failure, "Couldn't check the saved preferences."));
    } finally {
      mutex.current = false;
      if (current()) setBusy(false);
    }
  };
  return (
    <Dialog
      title={title}
      onClose={() => void close()}
      wide
      actions={
        <>
          <Button disabled={busy || !!unknown} onClick={() => void close()}>
            Close
          </Button>
          {unknown ? (
            <Button busy={busy} onClick={() => void check()}>
              Check saved choice
            </Button>
          ) : (
            <Button
              variant="primary"
              disabled={!dirty}
              busy={busy}
              onClick={() => void save()}
            >
              Save changes
            </Button>
          )}
        </>
      }
    >
      {error && <ErrorNotice message={error} />}
      {unknown && (
        <p role="status">
          Save outcome unknown. Your draft is kept here. Check the saved choice
          before making another change.
        </p>
      )}
      {children({
        value: draft,
        change: (next) => {
          if (current() && !mutex.current && !unknown) setDraft(next);
        },
        disabled: busy || !!unknown,
      })}
    </Dialog>
  );
}

export function ArrangeNavigation({
  entries,
  onClose,
}: {
  entries: { label: string; key: string }[];
  onClose(): void;
}) {
  const read = usePrefs();
  if (read.phase !== "ready")
    return (
      <Dialog title="Arrange navigation" onClose={onClose}>
        <ErrorNotice
          message={read.error || "Your layout hasn't loaded."}
          onRetry={() => void reloadPrefs()}
        />
      </Dialog>
    );
  return (
    <PreferenceEditor
      title="Arrange navigation"
      choice={{ kind: "sidebar", value: structuredClone(read.prefs.sidebar) }}
      onClose={onClose}
    >
      {({ value, change, disabled }) => {
        if (value.kind !== "sidebar") return null;
        const all = arrangeEntries(
          entries,
          (entry) => entry.key,
          value.value,
          true,
        );
        return (
          <>
            <p className="muted">
              Choose the order and destinations shown. Today and Settings are
              always available.
            </p>
            <div className="shell-preference-list">
              {all.map((entry, index) => (
                <div className="shell-preference-row" key={entry.key}>
                  <span>{entry.label}</span>
                  <label>
                    <input
                      type="checkbox"
                      checked={
                        entry.key === "Overview" ||
                        !value.value.hidden.includes(entry.key)
                      }
                      disabled={
                        disabled ||
                        entry.key === "Overview" ||
                        entry.key === "Settings"
                      }
                      onChange={() =>
                        change({
                          kind: "sidebar",
                          value: toggleSidebarHidden(value.value, entry.key),
                        })
                      }
                    />
                    Shown
                  </label>
                  <Button
                    disabled={disabled || index === 0}
                    aria-label={`Move ${entry.label} up`}
                    onClick={() =>
                      change({
                        kind: "sidebar",
                        value: {
                          ...value.value,
                          order: moveEntry(
                            all.map((row) => row.key),
                            entry.key,
                            -1,
                          ),
                        },
                      })
                    }
                  >
                    ↑
                  </Button>
                  <Button
                    disabled={disabled || index === all.length - 1}
                    aria-label={`Move ${entry.label} down`}
                    onClick={() =>
                      change({
                        kind: "sidebar",
                        value: {
                          ...value.value,
                          order: moveEntry(
                            all.map((row) => row.key),
                            entry.key,
                            1,
                          ),
                        },
                      })
                    }
                  >
                    ↓
                  </Button>
                </div>
              ))}
            </div>
            <Button
              disabled={disabled}
              onClick={() =>
                change({ kind: "sidebar", value: { order: [], hidden: [] } })
              }
            >
              Reset navigation
            </Button>
          </>
        );
      }}
    </PreferenceEditor>
  );
}

export function Shortcuts({
  commands,
  onClose,
}: {
  commands: CommandDef[];
  onClose(): void;
}) {
  const read = usePrefs();
  const [query, setQuery] = useState("");
  const [recording, setRecording] = useState<string | null>(null),
    [proposed, setProposed] = useState<string[] | null>(null);
  const confirm = useConfirm(),
    recordingLock = useRef(false);
  const shortcutDraft = useRef<Choice | null>(null);
  const recorder = useRef({ recording, proposed });
  recorder.current = { recording, proposed };
  const mac = /Mac|iPhone|iPad/.test(navigator.platform);
  if (read.phase !== "ready")
    return (
      <Dialog title="Keyboard shortcuts" onClose={onClose}>
        <ErrorNotice
          message={read.error || "Your shortcuts haven't loaded."}
          onRetry={() => void reloadPrefs()}
        />
      </Dialog>
    );
  return (
    <PreferenceEditor
      title="Keyboard shortcuts"
      choice={{ kind: "shortcuts", value: { ...read.prefs.shortcuts } }}
      onClose={onClose}
    >
      {({ value, change, disabled }) => {
        if (value.kind !== "shortcuts") return null;
        shortcutDraft.current = value;
        const assign = async (
          id: string,
          keys: string[] | null,
          fromRecorder = false,
        ) => {
          if (disabled || recordingLock.current) return;
          const command = SHORTCUT_CATALOG.find((command) => command.id === id);
          if (!command) return;
          recordingLock.current = true;
          const owner = getSessionVersion(),
            opening = value,
            captured = keys;
          try {
            const conflicts = shortcutConflicts(
              value.value,
              id,
              keys ?? command.keys ?? [],
            );
            if (
              conflicts.length &&
              !(await confirm({
                title: "Move this shortcut?",
                body: `These keys are assigned to ${conflicts.map((conflict) => `“${conflict.label}”`).join(", ")}. Assigning them here removes those shortcuts.`,
                action: "Assign shortcut",
              }))
            )
              return;
            if (
              owner !== getSessionVersion() ||
              shortcutDraft.current !== opening ||
              (fromRecorder &&
                (id !== recorder.current.recording ||
                  captured !== recorder.current.proposed))
            )
              return;
            change({
              kind: "shortcuts",
              value: assignShortcut(value.value, id, keys),
            });
            if (fromRecorder) setRecording(null);
          } finally {
            recordingLock.current = false;
          }
        };

        return (
          <>
            <Input
              type="search"
              aria-label="Find a shortcut"
              placeholder="Find a command"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <div className="shell-preference-list">
              {commands
                .filter((command) =>
                  `${command.label} ${command.group}`
                    .toLowerCase()
                    .includes(query.toLowerCase()),
                )
                .map((command) => (
                  <div className="shell-preference-row" key={command.id}>
                    <span>
                      {command.label}
                      <small className="muted">{command.group}</small>
                    </span>
                    <kbd>
                      {keysFor(command, mac, value.value).join(" ") ||
                        "Not assigned"}
                    </kbd>
                    <Button
                      disabled={disabled}
                      onClick={() => {
                        setRecording(command.id);
                        setProposed(null);
                      }}
                    >
                      Change
                    </Button>
                    <Button
                      disabled={disabled}
                      aria-label={`Disable ${command.label} shortcut`}
                      onClick={() =>
                        change({
                          kind: "shortcuts",
                          value: assignShortcut(value.value, command.id, []),
                        })
                      }
                    >
                      Disable
                    </Button>
                    <Button
                      disabled={disabled}
                      aria-label={`Reset ${command.label} shortcut`}
                      onClick={() => void assign(command.id, null)}
                    >
                      Reset
                    </Button>
                  </div>
                ))}
            </div>
            {recording && (
              <div className="shell-shortcut-recorder">
                <Input
                  autoFocus
                  readOnly
                  aria-label="Press a new shortcut"
                  placeholder="Press a key combination"
                  value={proposed?.join(" + ") ?? ""}
                  onKeyDown={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    if (event.key === "Escape") {
                      setRecording(null);
                      return;
                    }
                    setProposed(keysFromPress(event));
                  }}
                />
                <Button
                  disabled={disabled || !proposed}
                  onClick={() => {
                    if (recording && proposed)
                      void assign(recording, proposed, true);
                  }}
                >
                  Use shortcut
                </Button>
                <Button onClick={() => setRecording(null)}>
                  Cancel recording
                </Button>
              </div>
            )}
            <Button
              disabled={disabled}
              onClick={() => change({ kind: "shortcuts", value: {} })}
            >
              Reset all shortcuts
            </Button>
          </>
        );
      }}
    </PreferenceEditor>
  );
}
