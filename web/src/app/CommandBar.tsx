import { useCalendarZone } from "./controls/calendar-zone";
import { flushSync } from "react-dom";
import {
  localDateKey,
  editedSince,
  hasSearchFilters,
  orderCommands,
  parseSearch,
  searchHitTarget,
  searchSummary,
  keysFor,
  type CommandMemory,
  type FindHit,
  type SearchHit,
  type CalendarSearchResult,
  type Named,
} from "@orbyn/core";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "../lib/router";
import { client, getSessionVersion } from "../lib/session";
import { messageOf } from "../lib/resource";
import { useTasks } from "../screens/shared-task";
import {
  Dialog,
  ErrorNotice,
  IconButton,
  Input,
  Loading,
  SelectBox,
  useToast,
} from "../ui/kit";
import { RouteScopeProvider, useRouteScope } from "../lib/route-scope";
import { usePrefs } from "../screens/today/prefs";
import { useRegisteredRouteCommands } from "./controls/page-commands";
import {
  availableCommands,
  runCommand,
  type CommandAction,
  type CommandActions,
} from "./controls/commands";

type Props = {
  initial?: string;
  isAdmin: boolean;
  onToggleTheme: () => void;
  onClose: () => void;
  actions?: CommandActions;
  memory?: CommandMemory;
  onPin?: (id: string) => void;
  onRun?: (id: string) => void;
  openPath?: (path: string, mode?: "foreground" | "background") => void;
};
type Result = {
  key: string;
  label: string;
  hint: string;
  href?: string;
  run?: CommandAction;
  command?: string;
};
type Names = { projects: Named[]; tags: Named[]; teams: Named[] };
/** A typed name never silently chooses one of two equally named spaces. */
const unique = (rows: Named[], name: string | null) => {
  if (!name) return null;
  const word = name.trim().toLocaleLowerCase();
  const exact = rows.filter(
    (row) => row.name.trim().toLocaleLowerCase() === word,
  );
  if (exact.length) return exact.length === 1 ? exact[0] : null;
  const prefix = rows.filter((row) =>
    row.name.trim().toLocaleLowerCase().startsWith(word),
  );
  return prefix.length === 1 ? prefix[0] : null;
};
function CommandBarBody(props: Props) {
  const navigate = useNavigate(),
    tasks = useTasks(),
    scope = useRouteScope(),
    toast = useToast();
  const calendar = useCalendarZone();
  const page = useRegisteredRouteCommands(scope),
    prefs = usePrefs();
  const [generation] = useState(getSessionVersion),
    alive = useRef(true),
    lock = useRef(false);
  const current = () => alive.current && generation === getSessionVersion();
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const [query, setQuery] = useState(props.initial ?? ""),
    [active, setActive] = useState(0);
  const [archived, setArchived] = useState(false),
    [fullText, setFullText] = useState(false),
    [attempt, retry] = useState(0);
  const [names, setNames] = useState<Names | null>(null),
    [namesError, setNamesError] = useState("");
  const [selection, setSelection] = useState<Record<string, string>>({});
  const [receipt, setReceipt] = useState<{
    key: string;
    rows: Result[];
    error: string;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const filters = useMemo(() => parseSearch(query), [query]);
  const filtering = hasSearchFilters(filters) || fullText;
  const key = JSON.stringify([
    query.trim(),
    archived,
    fullText,
    selection,
    calendar.zone,
  ]);
  const latestKey = useRef(key);
  latestKey.current = key;
  const tooLong = query.length > 200;
  const allActions: CommandActions = {
    ...(props.actions ?? {}),
    ...Object.fromEntries(
      Object.entries(page).map(([id, command]) => [id, command.run]),
    ),
  };
  const available = availableCommands(allActions, props.isAdmin);
  const allowed = new Set(available.map((command) => command.id));
  const commands = orderCommands(
    query,
    props.memory ?? { recent: [], pinned: [] },
    (command) => allowed.has(command.id),
  );
  useEffect(() => {
    input.current?.focus();
  }, []);
  useEffect(() => {
    if (!filters.project && !filters.tag && !filters.team) return;
    let live = true;
    setNamesError("");
    void Promise.all([
      client.listProjects(),
      client.listTags(),
      client.listTeams(),
    ]).then(
      ([projects, tags, teams]) => {
        if (live && current()) setNames({ projects, tags, teams });
      },
      (failure) => {
        if (live && current())
          setNamesError(messageOf(failure, "Couldn't load search filters."));
      },
    );
    return () => {
      live = false;
    };
  }, [!!filters.project, !!filters.tag, !!filters.team, attempt]);
  useEffect(() => {
    let live = true;
    if (tooLong) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const timer = setTimeout(
      async () => {
        const rows: Result[] = [];
        if (!live || !current()) return;
        try {
          const named = (kind: keyof Names, name: string | null) => {
            if (!name) return null;
            if (!names)
              throw new Error(
                namesError ||
                  "Loading named filters. No unfiltered search has been sent.",
              );
            const list =
              kind === "teams"
                ? [...names.teams, { id: "personal", name: "Personal" }]
                : names[kind];
            const picked = list.find(
              (row) => row.id === selection[`${kind}:${name}`],
            );
            const match = picked ?? unique(list, name);
            if (!match)
              throw new Error(
                `Choose a matching ${kind === "teams" ? "team" : kind === "tags" ? "tag" : "project"} below. No unfiltered search has been sent.`,
              );
            return match.id;
          };
          if (filtering) {
            const project = named("projects", filters.project),
              tag = named("tags", filters.tag),
              team = named("teams", filters.team);
            const hits: SearchHit[] = await client.search(filters.words, {
              ...(filters.type ? { type: filters.type } : {}),
              ...(project ? { project } : {}),
              ...(tag ? { tag } : {}),
              ...(team ? { team } : {}),
              ...(filters.date
                ? { updated_after: editedSince(filters.date) }
                : {}),
              include_archived: archived,
              limit: 16,
            });
            for (const hit of hits) {
              const target = searchHitTarget(hit);
              if (!target) continue;
              rows.push({
                key: `${hit.type}:${hit.id}:${hit.block_id ?? ""}`,
                label: hit.title || "Untitled",
                hint:
                  hit.type === "record"
                    ? "Project record"
                    : hit.type === "doc"
                      ? "Page"
                      : hit.type === "task"
                        ? "Task"
                        : "Project",
                href:
                  target.type === "doc"
                    ? `/app/doc/${target.id}${hit.block_id ? `#${encodeURIComponent(hit.block_id)}` : ""}`
                    : target.type === "project"
                      ? `/app/project/${target.id}`
                      : `/app/task/${target.id}`,
              });
            }
          } else {
            const hits: FindHit[] = await client.find(query.trim(), {
              include_archived: archived,
              limit: 12,
            });
            for (const hit of hits)
              rows.push({
                key: `${hit.type}:${hit.id}`,
                label: hit.title || "Untitled",
                hint: `${hit.recent ? "Recent · " : ""}${hit.type === "event" ? "Event" : hit.type === "doc" ? "Page" : hit.type === "project" ? "Project" : "Task"}`,
                href:
                  hit.type === "doc"
                    ? `/app/doc/${hit.id}`
                    : hit.type === "project"
                      ? `/app/project/${hit.id}`
                      : `/app/task/${hit.id}`,
              });
            if (
              query.trim().length >= 2 &&
              live &&
              current() &&
              calendar.zone
            ) {
              const events = await client.searchCalendar(query.trim());
              for (const [index, event] of events.results.entries())
                rows.push(eventChoice(event, index, calendar.zone));
            }
          }
          if (live && current() && latestKey.current === key)
            setReceipt({ key, rows, error: "" });
        } catch (failure) {
          if (live && current() && latestKey.current === key)
            setReceipt({
              key,
              rows,
              error: messageOf(failure, "Couldn't search. Try again."),
            });
        } finally {
          if (live && current() && latestKey.current === key) setLoading(false);
        }
      },
      query ? 180 : 0,
    );
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [key, attempt, names, namesError, calendar.zone]);
  const visible = receipt?.key === key && !tooLong ? receipt.rows : [];
  const choices: Result[] = [
    ...commands.map((command) => ({
      key: command.id,
      label: command.label,
      hint: command.section,
      command: command.id,
      run: () => allActions[command.id]?.(),
    })),
    ...visible,
  ];
  if (!query.trim())
    choices.push({
      key: "theme",
      label: "Switch theme",
      hint: "Appearance",
      run: props.onToggleTheme,
    });
  if (query.trim() && !filtering && !tooLong)
    choices.push({
      key: "quick-create",
      label: `Add “${query.trim()}”`,
      hint: "Review a new item",
      run: () => tasks.create({ text: query.trim() }),
    });
  const open = (choice: Result | undefined, background = false) => {
    if (!choice || !current() || lock.current || tooLong) return;
    lock.current = true;
    // Release the command dialog before the next owner asks for input or a leave decision.
    flushSync(() => props.onClose());
    if (generation !== getSessionVersion()) return;
    const activeScope = scope?.getSnapshot();
    if (activeScope && (!activeScope.visible || !activeScope.focused)) return;
    try {
      if (choice.command) props.onRun?.(choice.command);
      if (choice.href) {
        if (props.openPath)
          props.openPath(choice.href, background ? "background" : "foreground");
        else navigate(choice.href);
      } else {
        if (choice.run)
          runCommand(choice.run, (text) => {
            if (generation === getSessionVersion())
              toast({ text, error: true });
          });
      }
    } catch {
      if (generation === getSessionVersion())
        toast({ text: "Couldn’t open that action.", error: true });
      lock.current = false;
    }
  };
  useEffect(() => setActive(0), [key, receipt]);
  const mac = /Mac|iPhone|iPad/.test(navigator.platform);
  return (
    <Dialog title="Search and commands" wide onClose={props.onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          open(
            choices[active],
            event.nativeEvent instanceof KeyboardEvent &&
              (event.nativeEvent.metaKey || event.nativeEvent.ctrlKey),
          );
        }}
      >
        <Input
          ref={input}
          type="search"
          role="combobox"
          aria-expanded="true"
          aria-controls="command-results"
          aria-activedescendant={
            choices[active] ? `command-${active}` : undefined
          }
          aria-label="Search or add"
          placeholder="Find work, filter, or run a command"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setSelection({});
          }}
          onKeyDown={(event) => {
            const step =
              event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
            if (!step || !choices.length) return;
            event.preventDefault();
            setActive((at) => (at + step + choices.length) % choices.length);
          }}
        />
      </form>
      <div className="shell-search-options">
        <label>
          <input
            type="checkbox"
            checked={fullText}
            onChange={(event) => setFullText(event.target.checked)}
          />
          Search page and task content
        </label>
        <label>
          <input
            type="checkbox"
            checked={archived}
            onChange={(event) => setArchived(event.target.checked)}
          />
          Include archived
        </label>
      </div>
      {tooLong && (
        <p role="alert">
          Search supports 200 characters. Your text is kept; shorten it to
          search or add an item.
        </p>
      )}
      {filtering && <p className="muted small">{searchSummary(filters)}</p>}
      {names &&
        (
          [
            ["projects", filters.project],
            ["tags", filters.tag],
            ["teams", filters.team],
          ] as const
        ).map(
          ([kind, name]) =>
            name && (
              <label className="field" key={kind}>
                {kind === "projects"
                  ? "Project"
                  : kind === "tags"
                    ? "Tag"
                    : "Team"}
                <SelectBox
                  aria-label={`Choose ${kind}`}
                  value={
                    selection[`${kind}:${name}`] ??
                    unique(
                      kind === "teams"
                        ? [...names.teams, { id: "personal", name: "Personal" }]
                        : names[kind],
                      name,
                    )?.id ??
                    ""
                  }
                  onChange={(e) =>
                    setSelection((before) => ({
                      ...before,
                      [`${kind}:${name}`]: e.target.value,
                    }))
                  }
                >
                  <option value="">Choose a match</option>
                  {(kind === "teams"
                    ? [...names.teams, { id: "personal", name: "Personal" }]
                    : names[kind]
                  ).map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.name} · {row.id.slice(0, 8)}
                    </option>
                  ))}
                </SelectBox>
              </label>
            ),
        )}
      {namesError && (
        <ErrorNotice
          message={namesError}
          onRetry={() => retry((at) => at + 1)}
        />
      )}
      {receipt?.key === key && receipt.error && (
        <ErrorNotice
          message={receipt.error}
          onRetry={() => retry((at) => at + 1)}
        />
      )}
      {calendar.loading && (
        <p className="small muted" role="status">
          Loading calendar time zone. Page and task search is available.
        </p>
      )}
      {calendar.error && (
        <ErrorNotice message={calendar.error} onRetry={calendar.reload} />
      )}
      {loading && <Loading label="Searching" />}
      <div
        className="shell-command-results"
        id="command-results"
        role="listbox"
        aria-label="Results"
      >
        {choices.map((choice, index) => (
          <div className="shell-command-row" key={choice.key}>
            <button
              id={`command-${index}`}
              role="option"
              aria-selected={index === active}
              onMouseEnter={() => setActive(index)}
              onClick={(event) => open(choice, event.metaKey || event.ctrlKey)}
            >
              <span className="row-main row-title" dir="auto">
                {choice.label}
              </span>
              <small className="muted">{choice.hint}</small>
              {choice.command && (
                <kbd>
                  {keysFor(
                    available.find((command) => command.id === choice.command),
                    mac,
                    prefs.prefs.shortcuts,
                  ).join(" ")}
                </kbd>
              )}
            </button>
            {choice.command && props.onPin && (
              <IconButton
                label={`${props.memory?.pinned.includes(choice.command) ? "Unpin" : "Pin"} ${choice.label}`}
                aria-pressed={props.memory?.pinned.includes(choice.command)}
                onClick={() => props.onPin?.(choice.command!)}
              >
                ◇
              </IconButton>
            )}
            {choice.href && props.openPath && (
              <IconButton
                label={`Open ${choice.label} in a background tab`}
                onClick={() => open(choice, true)}
              >
                ↗
              </IconButton>
            )}
          </div>
        ))}
      </div>
      {!loading && receipt?.key === key && !choices.length && (
        <p className="muted">No matches.</p>
      )}
    </Dialog>
  );
}
function eventChoice(
  event: CalendarSearchResult,
  index: number,
  zone: string,
): Result {
  const date = localDateKey(new Date(event.start_at), zone);
  return {
    key: `calendar:${index}:${event.start_at}`,
    label: event.title || "Untitled event",
    hint: `Calendar · ${new Date(event.start_at).toLocaleString(undefined, { timeZone: zone })}`,
    href: `/app/calendar?date=${encodeURIComponent(date)}`,
  };
}
/** Keep all callbacks and destination scope captured at opening, including background-tab actions. */
export function CommandBar(props: Props) {
  const opening = useRouteScope();
  const [scope] = useState(opening),
    [captured] = useState(props);
  return (
    <RouteScopeProvider value={scope}>
      <CommandBarBody {...captured} memory={props.memory} onPin={props.onPin} />
    </RouteScopeProvider>
  );
}
