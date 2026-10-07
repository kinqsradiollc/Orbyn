import { filterChoices } from "@orbyn/core";
import { createPortal } from "react-dom";
import {
  Children,
  isValidElement,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Check, ChevronDown } from "lucide-react";

type Option = { value: string; label: string; disabled?: boolean };

type Props = {
  /** Numbers are allowed, as a native select allows them. */
  value?: string | number;
  defaultValue?: string | number;
  /**
   * Shaped like a native change event, so call sites read `e.target.value`.
   * Left out for a select that a surrounding form reads on submit, which is
   * what the hidden input below is for.
   */
  onChange?: (e: { target: { value: string } }) => void;
  /** `<option>` elements, exactly as a native select would take them. */
  children: ReactNode;
  disabled?: boolean;
  /** Search large catalogs without changing the selected value. */
  searchable?: boolean;
  required?: boolean;
  id?: string;
  name?: string;
  title?: string;
  className?: string;
  "aria-label"?: string;
  "aria-describedby"?: string;
};

/** Read `<option>` children — including ones produced by a `.map()`. */
function readOptions(children: ReactNode): Option[] {
  const out: Option[] = [];
  const walk = (nodes: ReactNode) => {
    Children.forEach(nodes, (child) => {
      if (!isValidElement(child)) return;
      if (child.type === "option") {
        const p = child.props as {
          value?: string | number;
          children?: ReactNode;
          disabled?: boolean;
        };
        const label = Children.toArray(p.children)
          .map((c) => (typeof c === "string" || typeof c === "number" ? c : ""))
          .join("");
        out.push({
          value: String(p.value ?? label),
          label,
          disabled: p.disabled,
        });
      } else {
        // Fragments and `.map()` results arrive wrapped; look inside.
        const p = child.props as { children?: ReactNode };
        if (p?.children) walk(p.children);
      }
    });
  };
  walk(children);
  return out;
}

/**
 * A dropdown that belongs to Orbyn.
 *
 * A native `<select>` draws its open list with the operating system: another
 * typeface, another set of colours, and on some platforms another corner of
 * the screen. This keeps the same children a native one takes — so it is a
 * drop-in — and draws the list itself.
 *
 * What it must not lose by doing that is everything the native element gave
 * for free: the arrows and Home/End move through the list, typing jumps to a
 * matching entry, Enter chooses, Escape and Tab leave, and the whole thing is
 * a labelled `combobox` over a `listbox` for anyone using a screen reader.
 */
export function Select({
  value,
  defaultValue,
  onChange,
  children,
  disabled,
  searchable = false,
  required,
  id,
  name,
  title,
  className,
  "aria-label": ariaLabel,
  "aria-describedby": ariaDescribedBy,
}: Props) {
  const options = readOptions(children);
  // A select with no `value` keeps its own, as an uncontrolled native one does.
  const [own, setOwn] = useState(
    defaultValue === undefined ? "" : String(defaultValue),
  );
  const current = value === undefined ? own : String(value);
  const chosen = options.find((o) => o.value === current);

  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const filtered = searchable ? filterChoices(options, searchQuery) : options;
  const visible = searchable ? filtered.slice(0, 100) : filtered;
  if (
    searchable &&
    !searchQuery.trim() &&
    chosen &&
    !visible.includes(chosen)
  ) {
    if (visible.length >= 100) visible.pop();
    visible.push(chosen);
  }
  useEffect(() => {
    if (!open) setSearchQuery("");
  }, [open]);
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  const [active, setActive] = useState(0);
  const [above, setAbove] = useState(false);
  /** Where the list sits: it's drawn on top of the page (a portal), so a
   * card, table or dialog that clips its contents can't cut it off. */
  const [place, setPlace] = useState<{
    left: number;
    top: number;
    width: number;
  } | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const typed = useRef({ text: "", at: 0 });
  const listId = useId();

  // Open at the current choice, so the arrows carry on from where you are.
  useEffect(() => {
    if (!open) return;
    const at = visible.findIndex((o) => o.value === current);
    setActive(at < 0 ? 0 : at);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Near the bottom of the window the list goes above the control instead.
  // It follows the control while the page scrolls or resizes.
  useLayoutEffect(() => {
    if (!open || !wrap.current) return;
    const measure = () => {
      if (!wrap.current) return;
      const box = wrap.current.getBoundingClientRect();
      const height = list.current?.offsetHeight ?? 0;
      const width = Math.min(
        box.width,
        480,
        Math.max(0, window.innerWidth - 16),
      );
      const up =
        box.bottom + height + 8 > window.innerHeight && box.top > height + 8;
      setAbove(up);
      setPlace({
        left: Math.max(8, Math.min(box.left, window.innerWidth - 8 - width)),
        top: Math.max(
          8,
          Math.min(
            up ? box.top - height - 4 : box.bottom + 4,
            window.innerHeight - height - 8,
          ),
        ),
        width,
      });
    };
    measure();
    // A second pass once the list has its real height.
    const frame = requestAnimationFrame(measure);
    window.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
    };
  }, [open, searchQuery, visible.length]);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!wrap.current?.contains(target) && !list.current?.contains(target))
        setOpen(false);
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);

  useEffect(() => {
    if (open)
      list.current
        ?.querySelector<HTMLElement>('[data-active="true"]')
        ?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  const choose = (option: Option) => {
    if (disabled || option.disabled) return;
    if (value === undefined) setOwn(option.value);
    onChange?.({ target: { value: option.value } });
    setOpen(false);
    button.current?.focus();
  };

  const step = (by: number) => {
    let next = active;
    for (let i = 0; i < visible.length; i++) {
      next = (next + by + visible.length) % visible.length;
      if (!visible[next].disabled) break;
    }
    setActive(next);
  };

  /** Typing a few letters jumps to the entry that starts with them. */
  const typeahead = (key: string) => {
    const now = Date.now();
    typed.current = {
      text: now - typed.current.at > 900 ? key : typed.current.text + key,
      at: now,
    };
    const at = (open ? visible : options).findIndex(
      (o) =>
        !o.disabled &&
        o.label.toLowerCase().startsWith(typed.current.text.toLowerCase()),
    );
    if (at < 0) return;
    if (open) setActive(at);
    else choose(options[at]);
  };

  const onKey = (e: React.KeyboardEvent, editing = false) => {
    if (disabled) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) setOpen(true);
      else step(e.key === "ArrowDown" ? 1 : -1);
    } else if (e.key === "Home" || e.key === "End") {
      if (!open || editing) return;
      e.preventDefault();
      const indexes = visible
        .map((o, i) => (o.disabled ? -1 : i))
        .filter((i) => i >= 0);
      setActive((e.key === "Home" ? indexes[0] : indexes.at(-1)) ?? -1);
    } else if (e.key === "Enter" || (e.key === " " && !editing)) {
      e.preventDefault();
      if (open && visible[active]) choose(visible[active]);
      else setOpen(true);
    } else if (e.key === "Escape") {
      if (!open) return;
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      button.current?.focus();
    } else if (e.key === "Tab") {
      if (editing) button.current?.focus();
      setOpen(false);
    } else if (!editing && e.key.length === 1 && !e.metaKey && !e.ctrlKey) {
      typeahead(e.key);
    }
  };

  return (
    <div
      className={"select" + (className ? " " + className : "")}
      ref={wrap}
      data-open={open || undefined}
    >
      <button
        ref={button}
        type="button"
        id={id}
        title={title}
        disabled={disabled}
        className="select-control"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={
          open && visible[active] ? `${listId}-option-${active}` : undefined
        }
        aria-required={required}
        aria-label={ariaLabel}
        aria-describedby={ariaDescribedBy}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={onKey}
      >
        <span className="select-value">{chosen?.label ?? ""}</span>
        <ChevronDown size={15} aria-hidden="true" />
      </button>

      {/* The value still travels with a surrounding form. */}
      {name && <input type="hidden" name={name} value={current} />}

      {open &&
        createPortal(
          <div
            ref={list}
            className={"select-list is-floating" + (above ? " is-above" : "")}
            tabIndex={-1}
            style={
              place
                ? { left: place.left, top: place.top, minWidth: place.width }
                : { visibility: "hidden" }
            }
          >
            {searchable && (
              <div className="select-search">
                <input
                  autoFocus
                  aria-label={`Search ${ariaLabel ?? title ?? "options"}`}
                  placeholder="Search…"
                  role="combobox"
                  aria-expanded={true}
                  aria-autocomplete="list"
                  aria-controls={listId}
                  aria-activedescendant={
                    visible[active] ? `${listId}-option-${active}` : undefined
                  }
                  value={searchQuery}
                  maxLength={256}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setActive(0);
                  }}
                  onKeyDown={(e) => onKey(e, true)}
                />
              </div>
            )}
            <div id={listId} role="listbox" aria-label={ariaLabel}>
              {visible.map((o, i) => (
                <div
                  key={o.value + i}
                  id={`${listId}-option-${i}`}
                  role="option"
                  aria-selected={o.value === current}
                  aria-disabled={o.disabled}
                  data-active={i === active || undefined}
                  className={
                    "select-option" +
                    (i === active ? " is-active" : "") +
                    (o.disabled ? " is-disabled" : "")
                  }
                  onMouseEnter={() => !o.disabled && setActive(i)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => choose(o)}
                >
                  <span>{o.label}</span>
                  {o.value === current && (
                    <Check size={14} aria-hidden="true" />
                  )}
                </div>
              ))}
            </div>
            {searchable && !visible.length && (
              <div className="select-summary" role="status">
                No matches
              </div>
            )}
            {searchable && filtered.length > visible.length && (
              <div className="select-summary" role="status">
                Showing {visible.length} of {filtered.length}. Search to narrow
                the list.
              </div>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}
