import { useEffect, useMemo, useState, type DragEvent } from "react";
import {
  ArrowDown,
  ArrowUp,
  GripVertical,
  Keyboard,
  RotateCcw,
} from "lucide-react";
import {
  ALWAYS_SHOWN,
  arrangeEntries,
  COMMANDS,
  HOME_PANEL_LABELS,
  homePanels,
  type DocSummary,
  type HomePanel,
  dropEntry,
  effectiveKeys,
  hasSystemPermission,
  keysFromPress,
  moveEntry,
  setShortcut,
  shortcutClash,
  START_SCREEN_LABELS,
  START_SCREENS,
  toggleSidebarHidden,
  type StartScreen,
  type User,
} from "@orbyn/core";
import { Select } from "../../components/Select";
import { keysFor } from "../../app/commands";
import { NAV_GROUPS, navName, type View } from "../../app/views";
import { setStartScreen, startScreen, usePrefs } from "../../app/prefs";
import { SettingsSection } from "./SettingsSection";
import { client } from "../../lib/api";

const MAC = /Mac|iPhone|iPad/.test(navigator.userAgent);

/** What opens at start, on this device (NAV-12). */
export function StartSettings() {
  const [start, setStart] = useState<StartScreen>(startScreen);
  return (
    <SettingsSection className="card settings-card">
      <h2>Start</h2>
      <div className="preference">
        <span>
          <strong>Open to</strong>
          <small>
            What Orbyn shows when it starts. Saved on this device only, so a
            phone and a desk can differ.
          </small>
        </span>
        <Select
          aria-label="Open to"
          value={start}
          onChange={(e) => {
            const next = e.target.value as StartScreen;
            setStart(next);
            setStartScreen(next);
          }}
        >
          {START_SCREENS.map((s) => (
            <option key={s} value={s}>
              {START_SCREEN_LABELS[s]}
            </option>
          ))}
        </Select>
      </div>
    </SettingsSection>
  );
}

/**
 * Arrange (NAV-08): one list of what the sidebar shows, in order, with a
 * switch to hide each. It follows the account. Overview and Settings always
 * show; drag a row by its handle, or use the arrows.
 */
export function ArrangeSettings({ user }: { user: User | null }) {
  const { prefs, save } = usePrefs();
  const isAdmin = hasSystemPermission(user?.role, "admin:access");
  const arrangement = prefs.sidebar;
  const [dragging, setDragging] = useState<string | null>(null);
  const groups = NAV_GROUPS.map((g) => ({
    label: g.label,
    items: arrangeEntries(
      g.items.filter((n) => !n.adminOnly || isAdmin),
      (n) => n.label,
      arrangement,
      true,
    ).map((n) => n.label as string),
  }));
  /** Save a group's new order, keeping the other groups' as they are. */
  const reorder = (group: string, labels: string[]) => {
    const order = groups.flatMap((g) => (g.label === group ? labels : g.items));
    // What only the phone lists keeps its place in the one list.
    const rest = arrangement.order.filter((l) => !order.includes(l));
    save({ sidebar: { ...arrangement, order: [...order, ...rest] } });
  };
  const hide = (label: string) =>
    save({ sidebar: toggleSidebarHidden(arrangement, label) });
  const onDrop =
    (group: string, labels: string[], before: string) => (e: DragEvent) => {
      e.preventDefault();
      if (dragging && labels.includes(dragging) && dragging !== before)
        reorder(group, dropEntry(labels, dragging, before));
      setDragging(null);
    };
  const row = (group: string, labels: string[], label: string, i: number) => {
    const fixed = (ALWAYS_SHOWN as readonly string[]).includes(label);
    const hidden = arrangement.hidden.includes(label);
    return (
      <li
        key={label}
        className={
          "arrange-row" +
          (dragging === label ? " is-dragging" : "") +
          (hidden ? " is-hidden" : "")
        }
        draggable
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", label);
          setDragging(label);
        }}
        onDragEnd={() => setDragging(null)}
        onDragOver={(e) => dragging && e.preventDefault()}
        onDrop={onDrop(group, labels, label)}
      >
        <GripVertical size={14} className="arrange-grip" aria-hidden="true" />
        <span className="arrange-name">{navName(label as View)}</span>
        <button
          className="icon-button"
          aria-label={`Move ${label} up`}
          disabled={i === 0}
          onClick={() => reorder(group, moveEntry(labels, label, -1))}
        >
          <ArrowUp size={14} />
        </button>
        <button
          className="icon-button"
          aria-label={`Move ${label} down`}
          disabled={i === labels.length - 1}
          onClick={() => reorder(group, moveEntry(labels, label, 1))}
        >
          <ArrowDown size={14} />
        </button>
        <input
          type="checkbox"
          role="switch"
          className="ai-switch"
          aria-label={`Show ${label}`}
          title={fixed ? `${label} always shows` : undefined}
          checked={!hidden}
          disabled={fixed}
          onChange={() => hide(label)}
        />
      </li>
    );
  };
  return (
    <SettingsSection className="card settings-card">
      <h2>Arrange</h2>
      <p className="muted">
        Show, hide and reorder what the sidebar lists, on every computer you
        sign in to.
      </p>
      {groups.map((g) => (
        <div key={g.label} className="arrange-group">
          <h3>{g.label.charAt(0) + g.label.slice(1).toLowerCase()}</h3>
          <ul className="arrange-list">
            {g.items.map((label, i) => row(g.label, g.items, label, i))}
          </ul>
        </div>
      ))}
      <div className="arrange-group">
        <h3>More</h3>
        <ul className="arrange-list">
          <li className="arrange-row">
            <span className="arrange-name">Starred</span>
            <input
              type="checkbox"
              role="switch"
              className="ai-switch"
              aria-label="Show Starred"
              checked={!arrangement.hidden.includes("Starred")}
              onChange={() => hide("Starred")}
            />
          </li>
        </ul>
      </div>
      {(arrangement.order.length > 0 || arrangement.hidden.length > 0) && (
        <button
          className="text-button"
          onClick={() => save({ sidebar: { order: [], hidden: [] } })}
        >
          <RotateCcw size={14} /> Back to how it came
        </button>
      )}
    </SettingsSection>
  );
}

/**
 * Home (W1): show, hide and reorder its hubs and panels, and the line from
 * one of your pages under the greeting. It follows the account.
 */
export function HomeArrangeSettings() {
  const { prefs, save } = usePrefs();
  const home = prefs.home;
  const order = homePanels(home, true);
  const [pages, setPages] = useState<DocSummary[] | null>(null);
  useEffect(() => {
    client.listDocs().then(
      (all) => setPages(all.filter((d) => d.kind !== "agenda")),
      () => setPages([]),
    );
  }, []);
  const reorder = (next: HomePanel[]) =>
    save({ home: { ...home, order: next } });
  const toggle = (p: HomePanel) =>
    save({
      home: {
        ...home,
        hidden: home.hidden.includes(p)
          ? home.hidden.filter((h) => h !== p)
          : [...home.hidden, p],
      },
    });
  const quote = home.quote;
  const setQuote = (next: Partial<typeof quote>) =>
    save({ home: { ...home, quote: { ...quote, ...next } } });
  return (
    <SettingsSection className="card settings-card">
      <h2>Home</h2>
      <p className="muted">
        Show, hide and reorder what Home shows under the greeting, on every
        computer you sign in to.
      </p>
      <ul className="arrange-list">
        {order.map((p, i) => {
          const label = HOME_PANEL_LABELS[p];
          const hidden = home.hidden.includes(p);
          return (
            <li
              key={p}
              className={"arrange-row" + (hidden ? " is-hidden" : "")}
            >
              <span className="arrange-name">{label}</span>
              <button
                className="icon-button"
                aria-label={`Move ${label} up`}
                disabled={i === 0}
                onClick={() => reorder(moveEntry(order, p, -1) as HomePanel[])}
              >
                <ArrowUp size={14} />
              </button>
              <button
                className="icon-button"
                aria-label={`Move ${label} down`}
                disabled={i === order.length - 1}
                onClick={() => reorder(moveEntry(order, p, 1) as HomePanel[])}
              >
                <ArrowDown size={14} />
              </button>
              <input
                type="checkbox"
                role="switch"
                className="ai-switch"
                aria-label={`Show ${label}`}
                checked={!hidden}
                onChange={() => toggle(p)}
              />
            </li>
          );
        })}
      </ul>
      <div className="preference home-quote-setting">
        <span>
          <strong>A quote under the greeting</strong>
          <small>
            A line from one of your pages, a different one each visit.
          </small>
        </span>
        <input
          type="checkbox"
          role="switch"
          className="ai-switch"
          aria-label="Show a quote under the greeting"
          checked={quote.on}
          onChange={(e) => setQuote({ on: e.target.checked })}
        />
      </div>
      {quote.on && (
        <div className="preference home-quote-setting">
          <span>
            <strong>Quotes page</strong>
            <small>Each line of the page is a quote.</small>
          </span>
          <Select
            aria-label="Quotes page"
            value={quote.doc_id ?? ""}
            onChange={(e) => setQuote({ doc_id: e.target.value || null })}
          >
            <option value="">Choose a page</option>
            {(pages ?? []).map((d) => (
              <option key={d.id} value={d.id}>
                {d.title || "Untitled"}
              </option>
            ))}
          </Select>
        </div>
      )}
      {(home.order.length > 0 || home.hidden.length > 0) && (
        <button
          className="text-button"
          onClick={() => save({ home: { ...home, order: [], hidden: [] } })}
        >
          <RotateCcw size={14} /> Back to how it came
        </button>
      )}
    </SettingsSection>
  );
}

/**
 * Keyboard shortcuts (NAV-09): every command, with its keys, searchable by
 * name or by key. Change records the next keys pressed; a key taken from
 * another command says so. The changes follow the account.
 */
export function ShortcutSettings() {
  const { prefs, save } = usePrefs();
  const [query, setQuery] = useState("");
  const [recording, setRecording] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const commands = useMemo(() => COMMANDS.filter((c) => c.on !== "phone"), []);
  const overrides = prefs.shortcuts;
  useEffect(() => {
    if (!recording) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") {
        setRecording(null);
        return;
      }
      const keys = keysFromPress(e);
      if (!keys) return;
      const clash = shortcutClash(commands, overrides, recording, keys);
      save({
        shortcuts: setShortcut(commands, overrides, recording, keys),
      });
      setNotice(
        clash
          ? `${keysFor({ ...clash, keys } as never, MAC).join(" ")} was “${clash.label}”; it has no keys now.`
          : "",
      );
      setRecording(null);
    };
    // Captured first, so the app's own shortcuts don't also run.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [recording, overrides, commands, save]);

  const q = query.trim().toLowerCase();
  const shown = commands.filter((c) => {
    if (!q) return true;
    const keys = keysFor(c, MAC, overrides).join(" ").toLowerCase();
    return (
      c.label.toLowerCase().includes(q) ||
      keys.includes(q) ||
      keys.replace(/\s/g, "").includes(q.replace(/\s/g, ""))
    );
  });
  return (
    <SettingsSection className="card settings-card">
      <h2>Keyboard shortcuts</h2>
      <p className="muted">
        Give any command your own keys, or take one away, on every computer you
        sign in to.
      </p>
      <input
        type="search"
        className="shortcut-search"
        aria-label="Find a command or keys"
        placeholder="Find a command or keys"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {notice && (
        <p className="settings-note" role="status">
          {notice}
        </p>
      )}
      <ul className="shortcut-list">
        {shown.map((c) => {
          const keys = keysFor(c, MAC, overrides);
          const changed = Object.prototype.hasOwnProperty.call(overrides, c.id);
          return (
            <li key={c.id} className="shortcut-row">
              <span className="shortcut-name">
                {c.label}
                <small>{c.group}</small>
              </span>
              <span className="shortcut-keys" aria-label="Keys">
                {recording === c.id ? (
                  <em>Press the keys… (Esc to stop)</em>
                ) : keys.length ? (
                  keys.map((k) => <kbd key={k}>{k}</kbd>)
                ) : (
                  <small className="muted">None</small>
                )}
              </span>
              <span className="shortcut-actions">
                <button
                  className="text-button"
                  aria-pressed={recording === c.id}
                  onClick={() => {
                    setNotice("");
                    setRecording(recording === c.id ? null : c.id);
                  }}
                >
                  <Keyboard size={14} />{" "}
                  {recording === c.id ? "Stop" : "Change"}
                </button>
                {effectiveKeys(c, overrides).length > 0 && (
                  <button
                    className="text-button"
                    onClick={() =>
                      save({
                        shortcuts: setShortcut(commands, overrides, c.id, []),
                      })
                    }
                  >
                    Remove
                  </button>
                )}
                {changed && (
                  <button
                    className="text-button"
                    onClick={() =>
                      save({
                        shortcuts: setShortcut(commands, overrides, c.id, null),
                      })
                    }
                  >
                    Reset
                  </button>
                )}
              </span>
            </li>
          );
        })}
        {!shown.length && (
          <li className="muted">No command or keys match that.</li>
        )}
      </ul>
    </SettingsSection>
  );
}
