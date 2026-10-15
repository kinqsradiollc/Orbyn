import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import { useModalFocus } from "../hooks/useModalFocus";
import { hasHigherDialog } from "../lib/dialogLayers";
import { isTyping } from "../lib/keys";
import { Select } from "./Select";
import { X } from "lucide-react";
import { commandShortcuts } from "../app/commands";
import { usePrefs } from "../app/prefs";

const MAC = /Mac|iPhone|iPad/.test(navigator.userAgent);
const MOD = MAC ? "⌘" : "Ctrl";

/**
 * Every keyboard shortcut in the app, grouped by where it works. The
 * "Anywhere" ones come from the command list (app/commands.ts), which ⌘K
 * shows too, so the two never disagree.
 */
const GROUPS: { title: string; keys: { keys: string[]; label: string }[] }[] = [
  {
    title: "Calendar",
    keys: [
      { keys: ["←", "→"], label: "Previous or next period" },
      { keys: ["T"], label: "Jump to today" },
      { keys: ["M", "W", "D", "A"], label: "Month, week, day or agenda" },
      {
        keys: ["C"],
        label: "New event at the selected time",
      },
      { keys: ["P"], label: "Open or close the planner" },
      { keys: ["1–9"], label: "Show a calendar set" },
      { keys: ["0"], label: "Show everything" },
    ],
  },
  {
    title: "Pages",
    keys: [
      { keys: [MOD, "B"], label: "Bold the selected words" },
      { keys: [MOD, "I"], label: "Italic" },
      { keys: [MOD, "⇧", "H"], label: "Highlight" },
      { keys: [MOD, "E"], label: "Code" },
      { keys: [MOD, "K"], label: "Link the selected words" },
      { keys: ["Tab", "⇧Tab"], label: "Indent or outdent a list item" },
      { keys: [MOD, "Enter"], label: "Tick or untick a checklist line" },
      { keys: [MOD, "⇧", "V"], label: "Paste without formatting" },
      { keys: ["/"], label: "Open block actions" },
      { keys: [MOD + "-click"], label: "Open a link beside the page" },
    ],
  },
  {
    title: "Quick add",
    keys: [
      { keys: [";"], label: "A place: ;Cafe Roma" },
      { keys: ["@"], label: "Someone: @anna, or an email to invite" },
      { keys: [">"], label: "A list: >Work" },
      { keys: ["#"], label: "A tag: #urgent" },
      { keys: ["!", "!!", "!!!"], label: "Low, medium or high priority" },
      {
        keys: ["fri 3pm"],
        label: "When: tomorrow, next friday, sep 20, 3-4pm, all day",
      },
      { keys: ["for 1h"], label: "How long (~45m for an estimate)" },
    ],
  },
  {
    title: "Command bar",
    keys: [
      { keys: ["↑", "↓"], label: "Move through results" },
      { keys: ["Enter"], label: "Open or run the highlighted result" },
      {
        keys: ["⇧", "Enter"],
        label: "Create the typed page or task",
      },
      { keys: [MOD, "Enter"], label: "Open the result beside, in a side peek" },
      { keys: ["tag:"], label: "Pages with a tag: tag:physics" },
      { keys: ["project:"], label: 'In a project: project:"Big launch"' },
      { keys: ["team:"], label: "In a team: team:lab" },
      { keys: ["is:"], label: "One kind: is:page, is:task, is:project" },
      { keys: ["edited:"], label: "Changed lately: edited:today, week, month" },
    ],
  },
];

type Props = { onClose: () => void };

/** The "?" sheet. Escape, "?" or a click outside closes it. */
export function ShortcutSheet({ onClose }: Props) {
  const focus = useModalFocus(onClose);
  const titleId = useId();
  const [query, setQuery] = useState("");
  const [section, setSection] = useState("Anywhere");
  const { prefs } = usePrefs();
  // "Anywhere" is the command list with your own changes (NAV-09).
  const groups = [
    {
      title: "Anywhere",
      keys: [
        ...commandShortcuts(MAC, prefs.shortcuts),
        { keys: ["Esc"], label: "Close a dialog, panel or menu" },
      ],
    },
    ...GROUPS,
  ];

  useEffect(() => {
    const dialog = focus.ref.current as HTMLDialogElement | null;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (
        event.key !== "?" ||
        event.defaultPrevented ||
        isTyping(event) ||
        hasHigherDialog(focus.ref.current)
      )
        return;
      event.preventDefault();
      event.stopImmediatePropagation();
      onClose();
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [onClose]);
  const needle = query.trim().toLowerCase();
  const shown = groups
    .filter((group) => needle || section === "all" || section === group.title)
    .map((group) => ({
      ...group,
      keys: group.keys.filter(
        (row) =>
          !needle ||
          `${group.title} ${row.label} ${row.keys.join(" ")}`
            .toLowerCase()
            .includes(needle),
      ),
    }))
    .filter((group) => group.keys.length);

  return createPortal(
    <dialog
      ref={focus.ref as React.RefObject<HTMLDialogElement>}
      data-modal-focus={focus.id}
      tabIndex={-1}
      aria-modal="true"
      className="modal shortcut-sheet"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="section-heading">
        <h2 id={titleId}>Keyboard shortcuts</h2>
        <button
          type="button"
          className="icon-button"
          aria-label="Close shortcuts"
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </div>
      <div className="shortcut-filters">
        <input
          autoFocus
          aria-label="Find a shortcut"
          placeholder="Find a shortcut"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <Select
          aria-label="Shortcut section"
          value={section}
          onChange={(event) => setSection(event.target.value)}
        >
          <option value="all">All shortcuts</option>
          {groups.map((group) => (
            <option key={group.title} value={group.title}>
              {group.title}
            </option>
          ))}
        </Select>
      </div>
      <div className="shortcut-groups">
        {!shown.length && <p role="status">No matching shortcuts.</p>}
        {shown.map((g) => (
          <section key={g.title} className="shortcut-group">
            <h3>{g.title}</h3>
            <dl>
              {g.keys.map((k) => (
                <div key={k.label}>
                  <dt>
                    {k.keys.map((key, index) => (
                      <kbd key={`${index}:${key}`}>{key}</kbd>
                    ))}
                  </dt>
                  <dd>{k.label}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
      <p className="shortcut-note">
        Single-key shortcuts pause while you type in a field. Change them in
        Settings → Keyboard shortcuts.
      </p>
    </dialog>,
    document.body,
  );
}
