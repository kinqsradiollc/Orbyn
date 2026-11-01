import { useEffect, useRef, useState } from "react";
import {
  AGENT_ACCESS,
  AGENT_ACCESS_LABELS,
  AGENT_TOOLSET_LABELS,
  type AgentAccess,
  type AgentToolset,
  type McpCatalog,
} from "@orbyn/core";
import { Button, Field, Input, Pill, SelectBox } from "../../../ui/kit";
const KIND = {
  read: "Reads",
  write: "Changes",
  destructive: "Changes or removes",
} as const;
export const toolAnchor = (name: string) => `tool-${name}`;

export function Tools({ catalog }: { catalog: McpCatalog }) {
  const [query, setQuery] = useState(""),
    [group, setGroup] = useState<AgentToolset | "all">("all"),
    [access, setAccess] = useState<AgentAccess | "all">("all");
  const tools = catalog.tools.filter((t) => !t.legacy_only);
  const initialHashHandled = useRef(false);
  useEffect(() => {
    let frame = 0,
      current = true;
    const reveal = () => {
      let target: string;
      try {
        target = decodeURIComponent(window.location.hash.slice(1));
      } catch {
        return;
      }
      if (!tools.some((t) => toolAnchor(t.name) === target)) return;
      setQuery("");
      setGroup("all");
      setAccess("all");
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!current) return;
        const node = document.getElementById(target);
        if (node instanceof HTMLDetailsElement) {
          node.open = true;
          node.scrollIntoView({ block: "start" });
        }
      });
    };
    if (!initialHashHandled.current) {
      initialHashHandled.current = true;
      reveal();
    }
    window.addEventListener("hashchange", reveal);
    return () => {
      current = false;
      cancelAnimationFrame(frame);
      window.removeEventListener("hashchange", reveal);
    };
  }, [catalog]);
  const q = query.trim().toLocaleLowerCase();
  const matching = tools.filter(
    (t) =>
      (group === "all" || t.toolset === group) &&
      (access === "all" || t.access === access) &&
      (!q ||
        `${t.name} ${t.title} ${t.description} ${AGENT_TOOLSET_LABELS[t.toolset].name}`
          .toLocaleLowerCase()
          .includes(q)),
  );
  return (
    <section id="tools" aria-labelledby="developers-tools">
      <div className="developers-section-title">
        <h2 id="developers-tools">Tool reference</h2>
        <span className="small">{tools.length} published tools</span>
      </div>
      <p>
        Core tools are included with every connection. Other toolsets require
        the person’s permission. A tool’s access label is its minimum grant;
        ask-first policies still apply.
      </p>
      <div className="developers-filters">
        <Field label="Search tools">
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Name or description"
          />
        </Field>
        <Field label="Toolset">
          <SelectBox
            value={group}
            onChange={(e) => setGroup(e.target.value as AgentToolset | "all")}
          >
            <option value="all">All toolsets</option>
            {catalog.toolsets.map((set) => (
              <option key={set.name} value={set.name}>
                {AGENT_TOOLSET_LABELS[set.name].name}
              </option>
            ))}
          </SelectBox>
        </Field>
        <Field label="Minimum access">
          <SelectBox
            value={access}
            onChange={(e) => setAccess(e.target.value as AgentAccess | "all")}
          >
            <option value="all">All access levels</option>
            {AGENT_ACCESS.map((a) => (
              <option key={a} value={a}>
                {AGENT_ACCESS_LABELS[a].name}
              </option>
            ))}
          </SelectBox>
        </Field>
      </div>
      <p className="small" role="status">
        {matching.length} {matching.length === 1 ? "tool" : "tools"} shown
      </p>
      {!tools.length ? (
        <p>No tools are published in this catalog.</p>
      ) : !matching.length ? (
        <div>
          <p>No tools match these filters.</p>
          <Button
            onClick={() => {
              setQuery("");
              setGroup("all");
              setAccess("all");
            }}
          >
            Clear filters
          </Button>
        </div>
      ) : (
        catalog.toolsets.map((set) => {
          const rows = matching.filter((t) => t.toolset === set.name);
          if (!rows.length) return null;
          return (
            <div className="developers-toolset" key={set.name}>
              <h3>
                {AGENT_TOOLSET_LABELS[set.name].name}{" "}
                <span className="small">· {rows.length}</span>
              </h3>
              <p className="small">{AGENT_TOOLSET_LABELS[set.name].blurb}</p>
              {rows.map((t) => (
                <details
                  className="developers-tool"
                  id={toolAnchor(t.name)}
                  key={t.name}
                >
                  <summary>
                    <span className="developers-tool-name">
                      <code dir="ltr">{t.name}</code>
                      {t.title && t.title !== t.name && (
                        <span dir="auto">{t.title}</span>
                      )}
                    </span>
                    <span className="developers-tags">
                      <Pill
                        tone={t.kind === "destructive" ? "amber" : undefined}
                      >
                        {KIND[t.kind]}
                      </Pill>
                      <Pill>{AGENT_ACCESS_LABELS[t.access].name}</Pill>
                    </span>
                  </summary>
                  <div className="developers-tool-body">
                    <p dir="auto">{t.description}</p>
                    <a
                      href={`#${encodeURIComponent(toolAnchor(t.name))}`}
                      aria-label={`Permanent link to ${t.name}`}
                    >
                      Link to this tool
                    </a>
                  </div>
                </details>
              ))}
            </div>
          );
        })
      )}
    </section>
  );
}
