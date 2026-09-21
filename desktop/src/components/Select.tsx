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
  const [active, setActive] = useState(0);
  const [above, setAbove] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const typed = useRef({ text: "", at: 0 });
  const listId = useId();

  // Open at the current choice, so the arrows carry on from where you are.
  useEffect(() => {
    if (!open) return;
    const at = options.findIndex((o) => o.value === current);
    setActive(at < 0 ? 0 : at);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Near the bottom of the window the list goes above the control instead.
  useLayoutEffect(() => {
    if (!open || !wrap.current) return;
    const box = wrap.current.getBoundingClientRect();
    const height = list.current?.offsetHeight ?? 0;
    setAbove(box.bottom + height + 8 > window.innerHeight && box.top > height);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
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
    if (option.disabled) return;
    if (value === undefined) setOwn(option.value);
    onChange?.({ target: { value: option.value } });
    setOpen(false);
    button.current?.focus();
  };

  const step = (by: number) => {
    let next = active;
    for (let i = 0; i < options.length; i++) {
      next = (next + by + options.length) % options.length;
      if (!options[next].disabled) break;
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
    const at = options.findIndex(
      (o) =>
        !o.disabled &&
        o.label.toLowerCase().startsWith(typed.current.text.toLowerCase()),
    );
    if (at < 0) return;
    if (open) setActive(at);
    else choose(options[at]);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) setOpen(true);
      else step(e.key === "ArrowDown" ? 1 : -1);
    } else if (e.key === "Home" || e.key === "End") {
      if (!open) return;
      e.preventDefault();
      setActive(e.key === "Home" ? 0 : options.length - 1);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (open && options[active]) choose(options[active]);
      else setOpen(true);
    } else if (e.key === "Escape") {
      if (!open) return;
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    } else if (e.key === "Tab") {
      setOpen(false);
    } else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey) {
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

      {open && (
        <div
          ref={list}
          id={listId}
          className={"select-list" + (above ? " is-above" : "")}
          role="listbox"
          aria-label={ariaLabel}
          tabIndex={-1}
        >
          {options.map((o, i) => (
            <div
              key={o.value + i}
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
              {o.value === current && <Check size={14} aria-hidden="true" />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
