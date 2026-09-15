import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  CalendarCheck,
  CalendarDays,
  CircleCheck,
  ListChecks,
  ListTodo,
  Plus,
  Search,
  Settings,
  Sparkles,
  Users,
  Wand2,
  type LucideIcon,
} from "lucide-react";
import {
  dateLabel,
  searchItems,
  type Item,
  type Plan,
  type Proposal,
} from "@orbyn/core";
import { client } from "../lib/api";
import type { View } from "../app/views";
import { deviceTimeZone, errorText, nextUp } from "../lib/planning";
import { ProposalReview } from "./ProposalReview";

type Props = {
  items: Item[];
  onClose: () => void;
  onOpenItem: (item: Item) => void;
  onNewItem: () => void;
  onPlanDay: () => void;
  onNavigate: (view: View) => void;
  onApplyPlan: (plan: Plan) => Promise<string>;
  onOpenPlan: (plan: Plan) => void;
  /** Refresh the planner after the assistant's changes are applied. */
  onApplied: () => Promise<void>;
  report: (e: unknown) => void;
};

type Command = {
  id: string;
  label: ReactNode;
  /** Words matched against the query. */
  text: string;
  hint?: string;
  icon: LucideIcon;
  run: () => void;
};

type Ask = {
  question: string;
  proposal: Proposal | null;
  state: "pending" | "applied" | "discarded" | "info";
  error: string;
};

/**
 * ⌘K / Ctrl+K: find a task, jump somewhere, or ask the assistant. Arrow keys
 * move through results, Enter runs one, Escape closes.
 */
export function CommandBar({
  items,
  onClose,
  onOpenItem,
  onNewItem,
  onPlanDay,
  onNavigate,
  onApplyPlan,
  onOpenPlan,
  onApplied,
  report,
}: Props) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [ask, setAsk] = useState<Ask | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    input.current?.focus();
    return () => opener?.focus?.();
  }, []);

  const go = (fn: () => void) => () => {
    onClose();
    fn();
  };
  const q = query.trim();
  const actions: Command[] = [
    {
      id: "new",
      text: "new task item add create",
      label: "New task",
      icon: Plus,
      run: go(onNewItem),
    },
    {
      id: "plan",
      text: "plan my day planner schedule",
      label: "Plan my day",
      hint: "Preview a plan for today",
      icon: Wand2,
      run: go(onPlanDay),
    },
    {
      id: "calendar",
      text: "go calendar",
      label: "Go to Calendar",
      icon: CalendarDays,
      run: go(() => onNavigate("Calendar")),
    },
    {
      id: "tasks",
      text: "go my tasks",
      label: "Go to My tasks",
      icon: ListTodo,
      run: go(() => onNavigate("My tasks")),
    },
    {
      id: "lists",
      text: "go lists",
      label: "Go to Lists",
      icon: ListChecks,
      run: go(() => onNavigate("Lists")),
    },
    {
      id: "booking",
      text: "go booking pages",
      label: "Go to Booking",
      icon: CalendarCheck,
      run: go(() => onNavigate("Booking")),
    },
    {
      id: "teams",
      text: "go teams",
      label: "Go to Teams",
      icon: Users,
      run: go(() => onNavigate("Teams")),
    },
    {
      id: "settings",
      text: "go settings preferences",
      label: "Go to Settings",
      icon: Settings,
      run: go(() => onNavigate("Settings")),
    },
  ];
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const matchingActions = words.length
    ? actions.filter((a) => words.every((w) => a.text.includes(w)))
    : actions;
  const tasks = (
    q ? searchItems(items, q).slice(0, 6) : nextUp(items, undefined, 4)
  ).map((i): Command => ({
    id: "item-" + i.id,
    text: i.title,
    label: i.title,
    hint: i.due_at
      ? dateLabel(i.due_at)
      : i.kind === "event"
        ? "Event"
        : "Task",
    icon: i.status === "done" ? CircleCheck : Search,
    run: go(() => onOpenItem(i)),
  }));
  const askCommand: Command | null = q
    ? {
        id: "ask",
        text: q,
        label: (
          <>
            Ask the assistant: <em>“{q}”</em>
          </>
        ),
        icon: Sparkles,
        run: () => void startAsk(q),
      }
    : null;
  // Questions go to the assistant first; short words look for things.
  const question = /\?$/.test(q) || q.split(/\s+/).length >= 4;
  const commands = [
    ...(askCommand && question ? [askCommand] : []),
    ...tasks,
    ...matchingActions,
    ...(askCommand && !question ? [askCommand] : []),
  ];
  const current = Math.min(active, Math.max(0, commands.length - 1));

  const startAsk = async (text: string) => {
    setAsk({ question: text, proposal: null, state: "info", error: "" });
    setBusy(true);
    try {
      const proposal = await client.chat(text, deviceTimeZone(), []);
      setAsk({
        question: text,
        proposal,
        state: proposal.actions.length ? "pending" : "info",
        error: "",
      });
    } catch (e) {
      if ((e as { status?: number }).status === 401) report(e);
      setAsk({
        question: text,
        proposal: null,
        state: "info",
        error: errorText(e),
      });
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    if (!ask?.proposal) return;
    setBusy(true);
    try {
      await client.applyProposal(ask.proposal.id);
      setAsk({ ...ask, state: "applied" });
      await onApplied();
    } catch (e) {
      setAsk({ ...ask, error: errorText(e) });
    } finally {
      setBusy(false);
    }
  };

  // Escape closes; Tab stays inside.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
      if (e.key !== "Tab" || !dialog.current) return;
      const focusable = dialog.current.querySelectorAll<HTMLElement>(
        "input, button:not(:disabled), a[href]",
      );
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="command-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialog}
        className="command-bar scale-in"
        role="dialog"
        aria-modal="true"
        aria-label="Search or ask"
      >
        {ask ? (
          <div className="command-ask">
            <button
              className="text-button"
              onClick={() => {
                setAsk(null);
                setTimeout(() => input.current?.focus(), 0);
              }}
            >
              <ArrowLeft size={14} /> Back to search
            </button>
            <p className="command-question">{ask.question}</p>
            <div aria-live="polite">
              {busy && !ask.proposal ? (
                <p className="muted" role="status">
                  <Sparkles size={14} /> Thinking…
                </p>
              ) : ask.error ? (
                <div className="error" role="alert">
                  {ask.error}
                </div>
              ) : ask.proposal ? (
                <ProposalReview
                  proposal={ask.proposal}
                  items={items}
                  busy={busy}
                  state={ask.state}
                  onApply={() => void apply()}
                  onDismiss={() => setAsk({ ...ask, state: "discarded" })}
                  onApplyPlan={onApplyPlan}
                  onOpenPlan={(plan) => {
                    onClose();
                    onOpenPlan(plan);
                  }}
                />
              ) : null}
            </div>
          </div>
        ) : (
          <>
            <div className="command-input">
              <Search size={17} aria-hidden="true" />
              <input
                ref={input}
                role="combobox"
                aria-expanded="true"
                aria-controls="command-list"
                aria-activedescendant={
                  commands[current] ? "cmd-" + commands[current].id : undefined
                }
                aria-autocomplete="list"
                aria-label="Search tasks, pick an action, or ask the assistant"
                placeholder="Search tasks, jump somewhere, or ask…"
                value={query}
                maxLength={4000}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActive(0);
                }}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setActive((current + 1) % Math.max(1, commands.length));
                  } else if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setActive(
                      (current - 1 + commands.length) %
                        Math.max(1, commands.length),
                    );
                  } else if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    commands[current]?.run();
                  }
                }}
              />
              <kbd>Esc</kbd>
            </div>
            <ul
              id="command-list"
              role="listbox"
              aria-label="Results"
              className="command-list"
            >
              {!q && tasks.length > 0 && (
                <li role="presentation" className="command-group">
                  Next up
                </li>
              )}
              {commands.map((c, n) => {
                const Icon = c.icon;
                return (
                  <li
                    key={c.id}
                    id={"cmd-" + c.id}
                    role="option"
                    aria-selected={n === current}
                    className={n === current ? "active" : ""}
                    onMouseEnter={() => setActive(n)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={c.run}
                  >
                    <Icon size={15} aria-hidden="true" />
                    <span className="command-label">{c.label}</span>
                    {c.hint && <small>{c.hint}</small>}
                  </li>
                );
              })}
              {!commands.length && (
                <li role="presentation" className="command-empty">
                  Nothing matches. Type a question to ask the assistant.
                </li>
              )}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
