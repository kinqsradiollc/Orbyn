import {
  HttpError,
  ALWAYS_SHOWN,
  COMMANDS,
  accountPrefsInput,
  arrangeEntries,
  dropEntry,
  effectiveKeys,
  hasSystemPermission,
  keysFromPress,
  readStartScreen,
  setShortcut,
  shortcutClash,
  START_SCREENS,
  START_SCREEN_LABELS,
  toggleSidebarHidden,
  type SidebarArrangement,
  type ShortcutOverrides,
} from "@orbyn/core";
import { useEffect, useRef, useState } from "react";
import { useAccount } from "../../../app/account";
import { client } from "../../../lib/session";
import { messageOf } from "../../../lib/resource";
import { setTheme, useTheme } from "../../../lib/theme";
import {
  Button,
  ErrorNotice,
  Field,
  Input,
  SelectBox,
  useConfirm,
} from "../../../ui/kit";
import { Customize } from "../../today/Customize";
import { reloadPrefs } from "../../today/prefs";
import {
  SettingsSection,
  useSettingsExit,
  useSettingsOwner,
  useSettingsRead,
} from "../shared";

type Draft = { sidebar: SidebarArrangement; shortcuts: ShortcutOverrides };
function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, value]) => [key, sorted(value)]),
    );
  return value;
}
const same = (a: unknown, b: unknown) =>
  JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));
const local = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
export function Preferences() {
  const owner = useSettingsOwner(),
    confirm = useConfirm(),
    account = useAccount(),
    [theme] = useTheme();
  const read = useSettingsRead(() => client.getPrefs());
  const [draft, setDraft] = useState<Draft | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [deviceError, setDeviceError] = useState(""),
    [home, setHome] = useState(false),
    [recording, setRecording] = useState<string | null>(null),
    [query, setQuery] = useState(""),
    [unknown, setUnknown] = useState<Draft | null>(null);
  const lock = useRef(false),
    drag = useRef<string | null>(null);
  const [start, setStart] = useState(() =>
      readStartScreen(local("orbyn-start")),
    ),
    [tabs, setTabs] = useState(() => local("orbyn-tabs-enabled") !== "off"),
    [reading, setReading] = useState(() =>
      local("orbyn-pages-read-first") === null
        ? matchMedia("(pointer: coarse)").matches
        : local("orbyn-pages-read-first") === "1",
    );
  useEffect(() => {
    if (read.data && !draft)
      setDraft({ sidebar: read.data.sidebar, shortcuts: read.data.shortcuts });
  }, [read.data, draft]);
  const dirty =
    !!draft &&
    !!read.data &&
    !same(draft, {
      sidebar: read.data.sidebar,
      shortcuts: read.data.shortcuts,
    });
  useSettingsExit({
    dirty: dirty || !!unknown || home,
    pending: busy,
    message: unknown
      ? "Check the saved layout before leaving."
      : "Save or discard your preference changes before leaving.",
  });
  const commands = COMMANDS.filter(
    (c) =>
      c.on !== "phone" &&
      (c.needs !== "admin" ||
        hasSystemPermission(account.user?.role, "admin:access")),
  );
  const allViews = [
    ...new Set([
      ...commands.flatMap((c) => (c.view ? [c.view] : [])),
      "Starred",
      ...(draft?.sidebar.order ?? []),
      ...(draft?.sidebar.hidden ?? []),
    ]),
  ];
  const ordered = draft
    ? arrangeEntries(allViews, (x) => x, draft.sidebar, true)
    : allViews;
  const label = (id: string) =>
    commands.find((c) => c.view === id)?.label.replace(/^Go to /i, "") ??
    (id === "Overview" ? "Today" : id);
  const change = (next: Draft) => {
    if (owner() && !lock.current && !unknown) {
      setDraft(next);
      setNotice("");
    }
  };
  const persistDevice = (
    key: string,
    value: string,
    commit: () => void,
    event?: string,
  ) => {
    if (!owner()) return;
    try {
      localStorage.setItem(key, value);
      commit();
      setDeviceError("");
      if (event) window.dispatchEvent(new Event(event));
    } catch {
      setDeviceError(
        "Couldn't save this device preference. Your previous choice is kept.",
      );
    }
  };
  const save = async () => {
    if (!owner() || lock.current || !draft || !dirty || !read.fresh || unknown)
      return;
    const parsed = accountPrefsInput.safeParse(draft);
    if (!parsed.success) {
      setError(
        parsed.error.issues[0]?.message ?? "Check the preference changes.",
      );
      return;
    }
    const submitted = draft;
    lock.current = true;
    setBusy(true);
    setError("");
    read.invalidate();
    try {
      const receipt = await client.savePrefs(parsed.data);
      if (!owner()) return;
      if (
        !same(submitted, {
          sidebar: receipt.sidebar,
          shortcuts: receipt.shortcuts,
        })
      )
        throw Error(
          "The saved preferences don't match this draft. Check their current state.",
        );
      read.commit(receipt);
      setDraft((current) =>
        same(current, submitted)
          ? { sidebar: receipt.sidebar, shortcuts: receipt.shortcuts }
          : current,
      );
      setNotice("Account preferences saved.");
      void reloadPrefs();
      window.dispatchEvent(new Event("orbyn:prefs-changed"));
    } catch (failure) {
      if (owner()) {
        const unclear =
          !(failure instanceof HttpError) ||
          failure.statusCode >= 500 ||
          [408, 429].includes(failure.statusCode);
        if (unclear) setUnknown(submitted);
        else await read.reload();
        if (owner())
          setError(
            messageOf(
              failure,
              "Couldn't save these preferences. Your draft is kept.",
            ),
          );
      }
    } finally {
      lock.current = false;
      if (owner()) setBusy(false);
    }
  };
  const check = async () => {
    if (!owner() || lock.current || !unknown) return;
    const submitted = unknown;
    lock.current = true;
    setBusy(true);
    try {
      const current = await client.getPrefs();
      if (!owner()) return;
      read.commit(current);
      if (
        same(submitted, {
          sidebar: current.sidebar,
          shortcuts: current.shortcuts,
        })
      ) {
        setUnknown(null);
        setError("");
        setDraft(submitted);
        setNotice("Saved preferences confirmed.");
        void reloadPrefs();
        window.dispatchEvent(new Event("orbyn:prefs-changed"));
      } else
        setError(
          "The current layout differs from this draft. The earlier save has not been resent. Keep checking, or explicitly discard this draft to review the saved layout.",
        );
    } catch (failure) {
      if (owner())
        setError(messageOf(failure, "Couldn't check the saved preferences."));
    } finally {
      lock.current = false;
      if (owner()) setBusy(false);
    }
  };
  const discard = async () => {
    if (!owner() || lock.current || !read.data) return;
    lock.current = true;
    try {
      if (
        !(await confirm({
          title: "Discard preference changes?",
          body: unknown
            ? "This abandons the local draft only. The earlier server save may still finish."
            : "Restores your last loaded account preferences.",
          action: "Discard",
          danger: true,
        }))
      )
        return;
      if (owner()) {
        setDraft({
          sidebar: read.data.sidebar,
          shortcuts: read.data.shortcuts,
        });
        setUnknown(null);
        setError("");
        setRecording(null);
        await read.reload();
      }
    } finally {
      lock.current = false;
    }
  };
  useEffect(() => {
    if (!recording || !draft) return;
    const capture = (event: KeyboardEvent) => {
      if (!owner() || lock.current || unknown || event.isComposing) return;
      if (event.key === "Tab") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.key === "Escape") {
        setRecording(null);
        return;
      }
      const keys = keysFromPress(event);
      if (!keys) return;
      const clash = shortcutClash(commands, draft.shortcuts, recording, keys);
      change({
        ...draft,
        shortcuts: setShortcut(commands, draft.shortcuts, recording, keys),
      });
      setRecording(null);
      setNotice(
        clash
          ? `These keys were assigned to “${clash.label}”. That command now has no shortcut.`
          : "Shortcut draft updated. Save account preferences to keep it.",
      );
    };
    window.addEventListener("keydown", capture, true);
    return () => window.removeEventListener("keydown", capture, true);
  }, [recording, draft, owner, unknown]);
  const move = (id: string, by: -1 | 1) => {
    if (!draft) return;
    const at = ordered.indexOf(id),
      to = at + by;
    if (to < 0 || to >= ordered.length) return;
    const next = [...ordered];
    [next[at], next[to]] = [next[to], next[at]];
    change({ ...draft, sidebar: { ...draft.sidebar, order: next } });
  };
  const disabled = busy || !!unknown || !read.fresh;
  const shownCommands = commands.filter((c) =>
    `${c.label} ${effectiveKeys(c, draft?.shortcuts).join(" ")}`
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );
  return (
    <>
      <SettingsSection title="Appearance">
        <Field label="Theme">
          <SelectBox
            value={theme}
            onChange={(event) => {
              if (
                owner() &&
                (event.target.value === "light" ||
                  event.target.value === "dark")
              )
                setTheme(event.target.value);
            }}
          >
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </SelectBox>
        </Field>
        <p className="small muted">Saved on this device.</p>
      </SettingsSection>
      <SettingsSection title="Reading">
        <label className="check">
          <input
            type="checkbox"
            checked={reading}
            onChange={(event) => {
              const next = event.target.checked;
              persistDevice("orbyn-pages-read-first", next ? "1" : "0", () =>
                setReading(next),
              );
            }}
          />
          Open pages for reading
        </label>
        <p className="small muted">Use Edit when you want to change a page.</p>
        {deviceError && <ErrorNotice message={deviceError} />}
      </SettingsSection>
      <SettingsSection title="Start">
        <Field label="Open to">
          <SelectBox
            value={start}
            onChange={(event) => {
              const next = readStartScreen(event.target.value);
              persistDevice(
                "orbyn-start",
                next,
                () => setStart(next),
                "orbyn:start-setting",
              );
            }}
          >
            {START_SCREENS.map((value) => (
              <option key={value} value={value}>
                {START_SCREEN_LABELS[value]}
              </option>
            ))}
          </SelectBox>
        </Field>
        <label className="check">
          <input
            type="checkbox"
            checked={tabs}
            onChange={(event) => {
              const next = event.target.checked;
              persistDevice(
                "orbyn-tabs-enabled",
                next ? "on" : "off",
                () => setTabs(next),
                "orbyn:tabs-setting",
              );
            }}
          />
          Open pages, projects and views in tabs
        </label>
        <p className="small muted">These choices are saved on this device.</p>
      </SettingsSection>
      <SettingsSection title="Home">
        <Button onClick={() => owner() && setHome(true)}>
          Customize Today
        </Button>
        {home && (
          <Customize
            onClose={() => {
              if (owner()) setHome(false);
            }}
          />
        )}
      </SettingsSection>
      <SettingsSection
        title="Arrange"
        description="Sidebar order and visibility follow your account."
      >
        {read.error && (
          <ErrorNotice
            message={read.error}
            onRetry={() => void read.reload()}
          />
        )}
        {!draft && read.loading && (
          <p role="status">Loading account preferences…</p>
        )}
        {draft && (
          <>
            <ul className="settings-account-order">
              {ordered.map((id, index) => (
                <li
                  key={id}
                  draggable={!disabled}
                  onDragStart={(event) => {
                    if (disabled) return;
                    drag.current = id;
                    event.dataTransfer.setData("application/x-orbyn-nav", id);
                  }}
                  onDragEnd={() => {
                    drag.current = null;
                  }}
                  onDragOver={(event) => {
                    if (!disabled && drag.current) event.preventDefault();
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    if (!disabled && owner() && drag.current) {
                      change({
                        ...draft,
                        sidebar: {
                          ...draft.sidebar,
                          order: dropEntry(ordered, drag.current, id),
                        },
                      });
                      drag.current = null;
                    }
                  }}
                >
                  <label className="check">
                    <input
                      type="checkbox"
                      aria-label={`Show ${label(id)}`}
                      checked={
                        !draft.sidebar.hidden.includes(id) ||
                        (ALWAYS_SHOWN as readonly string[]).includes(id)
                      }
                      disabled={
                        disabled ||
                        (ALWAYS_SHOWN as readonly string[]).includes(id)
                      }
                      onChange={() =>
                        change({
                          ...draft,
                          sidebar: toggleSidebarHidden(draft.sidebar, id),
                        })
                      }
                    />
                    {label(id)}
                  </label>
                  <Button
                    variant="ghost"
                    disabled={disabled || index === 0}
                    aria-label={`Move ${label(id)} up`}
                    onClick={() => move(id, -1)}
                  >
                    Up
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={disabled || index === ordered.length - 1}
                    aria-label={`Move ${label(id)} down`}
                    onClick={() => move(id, 1)}
                  >
                    Down
                  </Button>
                </li>
              ))}
            </ul>
            <Button
              variant="ghost"
              disabled={disabled}
              onClick={() =>
                change({ ...draft, sidebar: { order: [], hidden: [] } })
              }
            >
              Reset sidebar draft
            </Button>
          </>
        )}
      </SettingsSection>
      <SettingsSection
        title="Keyboard shortcuts"
        description="Search a command, record new keys, or restore its default."
      >
        <Input
          type="search"
          aria-label="Find command or keys"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        {draft && (
          <ul className="settings-account-shortcuts">
            {shownCommands.map((command) => {
              const keys = effectiveKeys(command, draft.shortcuts);
              return (
                <li key={command.id}>
                  <div className="settings-account-row">
                    <strong>{command.label}</strong>
                    <span>
                      {recording === command.id
                        ? "Press keys · Escape to stop"
                        : keys.length
                          ? keys.join(" + ")
                          : "No shortcut"}
                    </span>
                  </div>
                  <div className="settings-account-actions">
                    <Button
                      variant="ghost"
                      disabled={disabled}
                      onClick={() =>
                        setRecording((current) =>
                          current === command.id ? null : command.id,
                        )
                      }
                    >
                      {recording === command.id
                        ? "Stop recording"
                        : "Change keys"}
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={disabled || !keys.length}
                      onClick={() =>
                        change({
                          ...draft,
                          shortcuts: setShortcut(
                            commands,
                            draft.shortcuts,
                            command.id,
                            [],
                          ),
                        })
                      }
                    >
                      Remove shortcut
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={
                        disabled || !Object.hasOwn(draft.shortcuts, command.id)
                      }
                      onClick={() =>
                        change({
                          ...draft,
                          shortcuts: setShortcut(
                            commands,
                            draft.shortcuts,
                            command.id,
                            null,
                          ),
                        })
                      }
                    >
                      Reset shortcut
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {draft && !shownCommands.length && (
          <p>No command or keys match this search.</p>
        )}
        {error && <ErrorNotice message={error} />}
        {notice && <p role="status">{notice}</p>}
        <div className="settings-account-actions">
          <Button
            variant="primary"
            disabled={disabled || !dirty}
            onClick={() => void save()}
          >
            Save account preferences
          </Button>
          <Button
            disabled={busy || !draft || (!dirty && !unknown)}
            onClick={() => void discard()}
          >
            Discard changes
          </Button>
          {unknown && (
            <Button disabled={busy} onClick={() => void check()}>
              Check saved preferences
            </Button>
          )}
          <Button
            variant="ghost"
            disabled={busy || !!unknown}
            onClick={() => void read.reload()}
          >
            Refresh account preferences
          </Button>
        </div>
      </SettingsSection>
    </>
  );
}
