import type { SearchHit } from "@orbyn/core";
import { Moon, Plus, Settings } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useResource } from "../lib/resource";
import { navigate } from "../lib/router";
import { client } from "../lib/session";
import { tasks } from "../screens/shared-task";
import { Dialog, ErrorNotice, Input, Loading } from "../ui/kit";
import { MORE, PRIMARY } from "./nav";

const PLACES = [
  ...PRIMARY,
  ...PRIMARY.flatMap((p) => p.children ?? []),
  ...MORE,
];

const openHit = (hit: SearchHit) => {
  if (hit.type === "doc") navigate(`/app/doc/${hit.id}`);
  else if (hit.type === "project") navigate(`/app/project/${hit.id}`);
  else if (hit.type === "task") tasks.open(hit.id);
  else navigate("/app");
};

type Choice = { key: string; label: string; hint?: string; run: () => void };

/** Go anywhere, find your work, or add something new. */
export function CommandBar({
  initial = "",
  isAdmin,
  onToggleTheme,
  onClose,
}: {
  initial?: string;
  isAdmin: boolean;
  onToggleTheme: () => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState(initial);
  const [asked, setAsked] = useState(initial.trim());
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => setAsked(query.trim()), 180);
    return () => clearTimeout(timer);
  }, [query]);
  const hits = useResource<SearchHit[]>(
    () => (asked ? client.search(asked, { limit: 12 }) : Promise.resolve([])),
    [asked],
  );

  const choices = useMemo<Choice[]>(() => {
    const words = query.trim();
    const lower = words.toLowerCase();
    const found = (hits.data ?? []).map((hit) => ({
      key: `${hit.type}:${hit.id}`,
      label: hit.title || "Untitled",
      hint:
        hit.type === "doc" ? "Page" : hit.type === "task" ? "Task" : "Project",
      run: () => openHit(hit),
    }));
    const places = PLACES.filter(
      (place) =>
        (!place.adminOnly || isAdmin) &&
        place.label.toLowerCase().includes(lower),
    ).map((place) => ({
      key: place.path,
      label: place.label,
      hint: "Go to",
      run: () => navigate(place.path),
    }));
    const add: Choice[] = words
      ? [
          {
            key: "add",
            label: `Add "${words}"`,
            hint: "New item",
            run: () => tasks.create({ text: words }),
          },
        ]
      : [
          {
            key: "new",
            label: "New item",
            hint: "N",
            run: () => tasks.create({}),
          },
          {
            key: "settings",
            label: "Settings",
            run: () => navigate("/app/settings"),
          },
          { key: "theme", label: "Switch theme", run: onToggleTheme },
        ];
    return [...found, ...(words ? add : []), ...places, ...(words ? [] : add)];
  }, [hits.data, isAdmin, onToggleTheme, query]);

  useEffect(() => setActive(0), [choices.length, asked]);

  const choose = (choice: Choice | undefined) => {
    if (!choice) return;
    onClose();
    choice.run();
  };

  return (
    <Dialog title="Search" onClose={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          choose(choices[active]);
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
          placeholder="Search, go to, or add something"
          maxLength={200}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              onClose();
              return;
            }
            const step =
              event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
            if (!step || !choices.length) return;
            event.preventDefault();
            setActive((at) => (at + step + choices.length) % choices.length);
          }}
        />
      </form>
      {hits.error && (
        <ErrorNotice message={hits.error} onRetry={() => void hits.reload()} />
      )}
      {hits.loading && asked && !hits.data && <Loading label="Searching" />}
      <div
        className="rows"
        id="command-results"
        role="listbox"
        aria-label="Results"
      >
        {choices.map((choice, index) => (
          <button
            key={choice.key}
            id={`command-${index}`}
            role="option"
            aria-selected={index === active}
            className={`row${index === active ? " is-active" : ""}`}
            onMouseEnter={() => setActive(index)}
            onClick={() => choose(choice)}
          >
            {choice.key === "add" || choice.key === "new" ? (
              <Plus size={15} aria-hidden="true" />
            ) : null}
            {choice.key === "settings" ? (
              <Settings size={15} aria-hidden="true" />
            ) : null}
            {choice.key === "theme" ? (
              <Moon size={15} aria-hidden="true" />
            ) : null}
            <span className="row-main row-title" dir="auto">
              {choice.label}
            </span>
            {choice.hint && <span className="small muted">{choice.hint}</span>}
          </button>
        ))}
      </div>
    </Dialog>
  );
}
