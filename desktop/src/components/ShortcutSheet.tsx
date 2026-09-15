import { useEffect, useRef } from "react";
import { X } from "lucide-react";

const MOD = /Mac|iPhone|iPad/.test(navigator.userAgent) ? "⌘" : "Ctrl";

/** Every keyboard shortcut in the app, grouped by where it works. */
const GROUPS: { title: string; keys: { keys: string[]; label: string }[] }[] = [
  {
    title: "Anywhere",
    keys: [
      {
        keys: [MOD, "K"],
        label: "Search, jump somewhere, or ask the assistant",
      },
      { keys: ["N"], label: "New item" },
      { keys: ["?"], label: "Show these shortcuts" },
      { keys: ["Esc"], label: "Close a dialog, panel or menu" },
    ],
  },
  {
    title: "Calendar",
    keys: [
      { keys: ["←", "→"], label: "Previous or next period" },
      { keys: ["T"], label: "Jump to today" },
      { keys: ["M", "W", "D", "A"], label: "Month, week, day or agenda" },
      {
        keys: ["C"],
        label:
          "New event at the selected time. Click an empty spot in week or day view to pick one.",
      },
      { keys: ["P"], label: "Open or close the planner" },
      { keys: ["1–9"], label: "Show a calendar set" },
      { keys: ["0"], label: "Show everything" },
    ],
  },
  {
    title: "Quick add, typed in the command bar",
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
      { keys: ["Enter"], label: "Run the highlighted result" },
    ],
  },
];

type Props = { onClose: () => void };

/** The "?" sheet. Escape, "?" or a click outside closes it. */
export function ShortcutSheet({ onClose }: Props) {
  const closeButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    closeButton.current?.focus();
    return () => opener?.focus?.();
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "?") {
        e.preventDefault();
        onClose();
      }
      // The close button is the only stop: keep Tab inside.
      if (e.key === "Tab") {
        e.preventDefault();
        closeButton.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        className="modal shortcut-sheet scale-in"
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-title"
      >
        <div className="section-heading">
          <h2 id="shortcuts-title">Keyboard shortcuts</h2>
          <button
            ref={closeButton}
            className="icon-button"
            aria-label="Close shortcuts"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </div>
        <div className="shortcut-groups">
          {GROUPS.map((g) => (
            <section key={g.title} className="shortcut-group">
              <h3>{g.title}</h3>
              <dl>
                {g.keys.map((k) => (
                  <div key={k.label}>
                    <dt>
                      {k.keys.map((key) => (
                        <kbd key={key}>{key}</kbd>
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
          Single-key shortcuts pause while you type in a field.
        </p>
      </section>
    </div>
  );
}
