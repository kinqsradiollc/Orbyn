import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import {
  Bell,
  CalendarCog,
  ChevronDown,
  Palette,
  Plug,
  ShieldCheck,
  Sparkles,
  UserRound,
  X,
} from "lucide-react";
import { SETTINGS_CATEGORIES, type SettingsCategoryId } from "@orbyn/core";

const ICONS = {
  account: UserRound,
  appearance: Palette,
  planning: CalendarCog,
  notifications: Bell,
  ai: Sparkles,
  connections: Plug,
  security: ShieldCheck,
  privacy: ShieldCheck,
};

/** A category rail and a modal category menu share the same destinations. */
export function SettingsNavigation({
  category,
  onChoose,
}: {
  category: SettingsCategoryId;
  onChoose: (category: SettingsCategoryId) => void;
}) {
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const heading = useId();
  const current = SETTINGS_CATEGORIES.find((value) => value.id === category)!;

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) {
      element.showModal();
      element.querySelector<HTMLButtonElement>("button[aria-current]")?.focus();
    } else if (!open && element.open) element.close();
  }, [open]);
  useEffect(() => {
    const host = opener.current?.closest(".settings-workspace");
    if (!host) return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width !== undefined && width > 760) setOpen(false);
    });
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  const choose = (value: SettingsCategoryId) => {
    onChoose(value);
    setOpen(false);
  };
  const navigate = (event: KeyboardEvent<HTMLElement>) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const buttons = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>("button"),
    );
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    event.preventDefault();
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? buttons.length - 1
          : (at + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) %
            buttons.length;
    buttons[next]?.focus();
  };
  const options = () =>
    SETTINGS_CATEGORIES.map(({ id, label }) => {
      const Icon = ICONS[id];
      return (
        <button
          type="button"
          key={id}
          aria-current={category === id ? "page" : undefined}
          onClick={() => choose(id)}
        >
          <Icon size={17} aria-hidden="true" />
          <span>{label}</span>
        </button>
      );
    });

  return (
    <>
      <nav
        className="settings-category-rail"
        aria-label="Settings categories"
        onKeyDown={navigate}
      >
        {options()}
      </nav>
      <button
        ref={opener}
        type="button"
        className="settings-category-opener secondary"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <span>{current.label}</span>
        <ChevronDown size={16} aria-hidden="true" />
      </button>
      {createPortal(
        <dialog
          ref={dialog}
          className="settings-category-sheet"
          aria-labelledby={heading}
          aria-modal={open ? true : undefined}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Escape") {
              event.preventDefault();
              setOpen(false);
            }
          }}
          onCancel={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setOpen(false);
          }}
          onClose={() => {
            setOpen(false);
            opener.current?.focus();
          }}
        >
          <header>
            <h2 id={heading}>Settings</h2>
            <button
              type="button"
              className="icon-button"
              aria-label="Close settings categories"
              onClick={() => setOpen(false)}
            >
              <X size={20} aria-hidden="true" />
            </button>
          </header>
          <nav aria-label="Settings categories" onKeyDown={navigate}>
            {options()}
          </nav>
        </dialog>,
        document.body,
      )}
    </>
  );
}
