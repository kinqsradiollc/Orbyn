import {
  Children,
  isValidElement,
  useId,
  useState,
  type ReactNode,
} from "react";
import { ChevronDown } from "lucide-react";

const REMEMBER = "orbyn-settings-open";

/** Which sections someone has opened, kept between visits. */
function remembered(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(REMEMBER) ?? "{}");
  } catch {
    return {};
  }
}

function remember(key: string, open: boolean) {
  try {
    const all = remembered();
    if (open) all[key] = true;
    else delete all[key];
    localStorage.setItem(REMEMBER, JSON.stringify(all));
  } catch {
    // Storage can be unavailable; the section still opens for this visit.
  }
}

/**
 * One settings section, folded away until it is wanted.
 *
 * Settings had grown to where a tab ran eight screens, so finding anything
 * meant scrolling past everything. Each section now shows only its heading
 * until it is opened, which turns a tab into a short list of what is in it.
 *
 * The heading is the section's own `<h2>`: the component picks it out of the
 * children rather than taking it as a prop, so a section becomes foldable by
 * changing the tag it is wrapped in and nothing else.
 *
 * What a section opened last time stays open, so somewhere returned to often
 * is not folded away every visit.
 */
export function SettingsSection({
  children,
  className,
  title,
  "aria-labelledby": labelledBy,
  /** Open on arrival, for a section that is mostly what people came for. */
  defaultOpen = false,
}: {
  children: ReactNode;
  className?: string;
  "aria-labelledby"?: string;
  defaultOpen?: boolean;
  /**
   * The section's name, for a section whose heading sits inside a header row
   * with its description and buttons and so cannot be lifted out.
   */
  title?: ReactNode;
}) {
  const kids = Children.toArray(children);
  const headIndex = kids.findIndex((c) => isValidElement(c) && c.type === "h2");
  const head = title ? (
    <h2>{title}</h2>
  ) : headIndex >= 0 ? (
    kids[headIndex]
  ) : null;
  const body = title ? kids : kids.filter((_, i) => i !== headIndex);

  // The heading's own text names the section in what we remember, so the
  // choice survives a re-order.
  const headText =
    (typeof title === "string" && title) ||
    (isValidElement(head) &&
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      String((head.props as any)?.children ?? "").slice(0, 60)) ||
    labelledBy ||
    "";
  const key = labelledBy || headText;
  const [open, setOpen] = useState(
    () => defaultOpen || remembered()[key] === true,
  );
  const bodyId = useId();

  // Falling back leaves the section unfolded, which is easy to miss; say so
  // while developing rather than quietly shipping a tab that never folds.
  if (!head) {
    if (import.meta.env.DEV)
      console.warn(
        "SettingsSection: no <h2> among its children and no `title` — this section will not fold.",
      );
    return <section className={className}>{children}</section>;
  }

  return (
    <section
      className={(className ?? "") + " settings-section"}
      data-open={open || undefined}
    >
      <button
        type="button"
        className="settings-section-head"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => {
          setOpen((v) => {
            remember(key, !v);
            return !v;
          });
        }}
      >
        {head}
        <ChevronDown size={16} aria-hidden="true" />
      </button>
      <div id={bodyId} className="settings-section-body" hidden={!open}>
        {body}
      </div>
    </section>
  );
}
