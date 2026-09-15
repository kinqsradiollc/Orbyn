import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ArrowLeft,
  CalendarCheck,
  CalendarDays,
  CalendarPlus,
  CircleCheck,
  Keyboard,
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
  parseQuickAdd,
  searchItems,
  type CalendarSearchResult,
  type Item,
  type Plan,
  type Proposal,
  type QuickAddChip,
  type QuickAddMember,
  type Team,
} from "@orbyn/core";
import { client } from "../lib/api";
import { celebrate } from "../lib/celebrate";
import { usePlanning } from "../app/planning";
import type { View } from "../app/views";
import {
  deviceTimeZone,
  errorText,
  fromDayKey,
  minutesLabel,
  nextUp,
} from "../lib/planning";
import { ProposalReview } from "./ProposalReview";
import "./event-fields.css";

type Props = {
  items: Item[];
  /** Your teams: quick add finds teammates by name ("@anna"). */
  teams: Team[];
  /** You, so quick add can assign you but never invites you. */
  userId?: string;
  onClose: () => void;
  onOpenItem: (item: Item) => void;
  onNewItem: () => void;
  onPlanDay: () => void;
  onNavigate: (view: View) => void;
  /** Shows a day in the calendar (from an event search result). */
  onJumpToDate: (date: Date) => void;
  onApplyPlan: (plan: Plan) => Promise<string>;
  onOpenPlan: (plan: Plan) => void;
  /** Refresh the planner after something is created or applied. */
  onApplied: () => Promise<void>;
  /** Opens the keyboard shortcut sheet. */
  onShowShortcuts: () => void;
  report: (e: unknown) => void;
};

type Command = {
  id: string;
  label: ReactNode;
  /** Words matched against the query. */
  text: string;
  hint?: string;
  icon: LucideIcon;
  /** A heading shown above the first command of a group. */
  group?: string;
  run: () => void;
};

type Ask = {
  question: string;
  proposal: Proposal | null;
  state: "pending" | "applied" | "discarded" | "info";
  error: string;
};

/** The longest text event search and quick add take (the assistant takes 4000). */
const SEARCH_MAX = 100;
const QUICK_MAX = 500;

/** A quick-add chip as a short readable label. */
function chipLabel(c: QuickAddChip) {
  switch (c.kind) {
    case "date":
      return fromDayKey(c.value).toLocaleDateString([], {
        weekday: "short",
        month: "short",
        day: "numeric",
      });
    case "time":
      return c.value.replace("-", "–");
    case "duration":
      return minutesLabel(Number(c.value));
    case "estimate":
      return `~${minutesLabel(Number(c.value))}`;
    case "all_day":
      return "All day";
    case "priority":
      return `${c.value} priority`;
    case "location":
      return `At ${c.value}`;
    default:
      return c.text;
  }
}

/**
 * ⌘K / Ctrl+K: find a task or an event, jump somewhere, add something from
 * one line ("Lunch with @anna fri 1pm ;Cafe Roma"), or ask the assistant.
 * Arrow keys move through results, Enter runs one, Escape closes.
 */
export function CommandBar({
  items,
  teams,
  userId,
  onClose,
  onOpenItem,
  onNewItem,
  onPlanDay,
  onNavigate,
  onJumpToDate,
  onApplyPlan,
  onOpenPlan,
  onApplied,
  onShowShortcuts,
  report,
}: Props) {
  const { lists, tags } = usePlanning();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [ask, setAsk] = useState<Ask | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [members, setMembers] = useState<QuickAddMember[]>([]);
  const [events, setEvents] = useState<CalendarSearchResult[]>([]);
  const input = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    input.current?.focus();
    return () => opener?.focus?.();
  }, []);

  // Teammates, for "@name" in quick add.
  useEffect(() => {
    if (!teams.length) return;
    let alive = true;
    Promise.all(teams.map((t) => client.getTeam(t.id))).then(
      (details) => {
        if (!alive) return;
        const byId = new Map<string, QuickAddMember>();
        for (const team of details)
          for (const m of team.members) {
            const known = byId.get(m.user_id);
            if (known) known.team_ids.push(team.id);
            else
              byId.set(m.user_id, {
                user_id: m.user_id,
                name: m.name,
                email: m.email,
                team_ids: [team.id],
              });
          }
        setMembers([...byId.values()]);
      },
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [teams]);

  const go = (fn: () => void) => () => {
    onClose();
    fn();
  };
  const q = query.trim();

  // Events, past and future, once there's something to look for.
  useEffect(() => {
    if (q.length < 2 || q.length > SEARCH_MAX) {
      setEvents([]);
      return;
    }
    let alive = true;
    const id = setTimeout(() => {
      client.searchCalendar(q).then(
        (r) => alive && setEvents(r.results.slice(0, 5)),
        () => alive && setEvents([]),
      );
    }, 250);
    return () => {
      alive = false;
      clearTimeout(id);
    };
  }, [q]);

  // What the text would make as an item, parsed here without AI.
  const quick = useMemo(() => {
    if (!q || q.length > QUICK_MAX) return null;
    try {
      return parseQuickAdd(q, {
        timeZone: deviceTimeZone(),
        lists: lists.map((l) => ({
          id: l.id,
          name: l.name,
          team_id: l.team_id,
        })),
        tags: tags.map((t) => ({ id: t.id, name: t.name, team_id: t.team_id })),
        members,
        selfId: userId,
      });
    } catch {
      return null;
    }
  }, [q, lists, tags, members, userId]);

  const createQuick = async () => {
    if (q.length > QUICK_MAX) return;
    setBusy(true);
    setNotice("");
    try {
      const { item } = await client.quickAdd(q, deviceTimeZone());
      await onApplied();
      onClose();
      onOpenItem(item);
    } catch (e) {
      if ((e as { status?: number }).status === 401) report(e);
      setNotice(errorText(e));
    } finally {
      setBusy(false);
    }
  };

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
    {
      id: "shortcuts",
      text: "keyboard shortcuts keys help",
      label: "Keyboard shortcuts",
      hint: "?",
      icon: Keyboard,
      run: go(onShowShortcuts),
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
    group: q ? "Tasks" : "Next up",
    run: go(() => onOpenItem(i)),
  }));
  const eventCommands = events.map((e, n): Command => ({
    id: "event-" + n,
    text: e.title,
    label: e.title,
    hint:
      dateLabel(e.start_at) + (e.source === "external" ? ` · ${e.name}` : ""),
    icon: CalendarDays,
    group: "Events",
    run: go(() => onJumpToDate(new Date(e.start_at))),
  }));
  const chips = (quick?.chips ?? []).filter((c) => c.kind !== "kind");
  const quickCommand: Command | null =
    quick && quick.input.title
      ? {
          id: "quick",
          text: q,
          label: (
            <>
              {quick.input.kind === "event" ? "Create event" : "Create task"}:{" "}
              <em>“{quick.input.title}”</em>
              {chips.length > 0 && (
                <span className="quick-chips">
                  {chips.map((c, n) => (
                    <span key={n} className="quick-chip">
                      {chipLabel(c)}
                    </span>
                  ))}
                </span>
              )}
            </>
          ),
          icon: quick.input.kind === "event" ? CalendarPlus : Plus,
          run: () => void createQuick(),
        }
      : null;
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
  // Questions go to the assistant first; text quick add understood makes
  // the item first; short words look for things.
  const question = /\?$/.test(q) || (!chips.length && words.length >= 4);
  const quickFirst = !!quickCommand && !question && chips.length > 0;
  const commands = [
    ...(askCommand && question ? [askCommand] : []),
    ...(quickCommand && quickFirst ? [quickCommand] : []),
    ...tasks,
    ...eventCommands,
    ...matchingActions,
    ...(quickCommand && !quickFirst ? [quickCommand] : []),
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
      // Celebrate when the assistant's changes finish a task.
      const finished = ask.proposal.actions.some(
        (a) =>
          a.operation === "update" &&
          a.data?.status === "done" &&
          items.find((i) => i.id === a.item_id)?.status !== "done",
      );
      if (finished) celebrate();
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
        aria-label="Search, add or ask"
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
                aria-label="Search, add something, or ask the assistant"
                placeholder="Search, add “Lunch fri 1pm”, or ask…"
                value={query}
                maxLength={4000}
                disabled={busy}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActive(0);
                  setNotice("");
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
            {notice && (
              <div className="error" role="alert">
                {notice}
              </div>
            )}
            <ul
              id="command-list"
              role="listbox"
              aria-label="Results"
              className="command-list"
            >
              {commands.map((c, n) => {
                const Icon = c.icon;
                const heading =
                  c.group && c.group !== commands[n - 1]?.group
                    ? c.group
                    : null;
                return (
                  <Fragment key={c.id}>
                    {heading && (
                      <li role="presentation" className="command-group">
                        {heading}
                      </li>
                    )}
                    <li
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
                  </Fragment>
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
