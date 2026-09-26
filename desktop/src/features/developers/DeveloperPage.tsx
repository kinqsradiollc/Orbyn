import { useEffect, useState, type MouseEvent } from "react";
import {
  ArrowUpRight,
  BookOpen,
  Copy,
  KeyRound,
  Orbit,
  ShieldCheck,
} from "lucide-react";
import {
  AGENT_ACCESS_LABELS,
  AGENT_TOOLSET_LABELS,
  type McpCatalog,
} from "@orbyn/core";
import { client } from "../../lib/api";
import { copyText } from "../../lib/planning";
import { errorText } from "../../lib/errors";
import "../status/status.css";
import "./developers.css";

type Props = {
  signedIn: boolean;
  onNavigate: (path: string) => void;
  onHome?: () => void;
};

/** What a tool does, as a short tag. */
const KIND_TAG: Record<McpCatalog["tools"][number]["kind"], string> = {
  read: "Reads",
  write: "Changes",
  destructive: "Changes or removes",
};

/** Errors an agent can meet, with what they mean. */
const ERRORS: [string, string][] = [
  [
    "401",
    "No credential, or one that isn't valid here (with WWW-Authenticate).",
  ],
  ["403", "A paused connection, a blocked app, or a page not allowed to call."],
  ["429", "Past a limit (with Retry-After)."],
  ["503", "Outside agents are switched off for now (with Retry-After)."],
  ["NOT_FOUND", "Nothing with that id is reachable from this connection."],
  ["INVALID", "An argument is wrong; the message names it."],
  ["FORBIDDEN", "The connection can't do this here."],
  ["READ_ONLY", "Changes by agents are paused, or it may only read there."],
  ["VERSION_CONFLICT", "It changed since it was read; read it again."],
  ["STALE", "A plan no longer fits the calendar; preview it again."],
];

/**
 * orbyn.dev/developers/mcp: the public page for people connecting agents
 * to Orbyn: the address, signing in, limits, errors, every tool by
 * toolset, resources and prompts, how tools change, the changelog, status
 * and where to report a security problem. Read from the live catalog.
 */
export function DeveloperPage({ signedIn, onNavigate, onHome }: Props) {
  const [catalog, setCatalog] = useState<McpCatalog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    client.developerCatalog().then(setCatalog, (e) => setError(errorText(e)));
  }, []);

  const go = (path: string) => (e: MouseEvent) => {
    e.preventDefault();
    onNavigate(path);
  };
  const goHome = (e: MouseEvent) => {
    e.preventDefault();
    if (onHome) onHome();
    else onNavigate(signedIn ? "/app" : "/login");
  };

  const address = catalog?.server.address ?? "https://mcp.orbyn.dev/mcp";
  const tools = (catalog?.tools ?? []).filter((t) => !t.legacy_only);
  return (
    <div className="status-page developers-page">
      <header className="status-nav">
        <a
          href="/"
          className="brand"
          aria-label={onHome ? "Orbyn home" : "Orbyn"}
          onClick={goHome}
        >
          <Orbit />
          orbyn<span>•</span>
        </a>
        {signedIn ? (
          <a href="/app" className="primary" onClick={go("/app")}>
            Open your planner <ArrowUpRight size={15} />
          </a>
        ) : (
          <a href="/login" className="text-button" onClick={go("/login")}>
            Sign in <ArrowUpRight size={14} />
          </a>
        )}
      </header>

      <main className="status-main developers-main">
        <span className="eyebrow">FOR DEVELOPERS</span>
        <h1>Orbyn for AI agents</h1>
        <p className="developers-lede">
          Orbyn is a hosted planner. Agents such as Claude, ChatGPT, Claude
          Code, Codex and Cursor connect to it over the Model Context Protocol
          (MCP) and see only what their person can open, in the spaces the
          person chose. Each agent uses its own model: Orbyn runs no AI for it.
        </p>

        <section className="card developers-card" aria-labelledby="dev-address">
          <h2 id="dev-address">Address</h2>
          <div className="developers-address">
            <code>{address}</code>
            <button
              type="button"
              className="secondary"
              onClick={() => void copyText(address).then(setCopied)}
            >
              <Copy size={13} /> {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <p className="muted">
            Streamable HTTP, one JSON-RPC message per POST, stateless.
            {catalog &&
              ` Protocol revisions: ${catalog.server.protocol_versions.join(", ")}.`}
            {catalog &&
              !catalog.agents_enabled &&
              " Outside agents are switched off on this server right now."}
          </p>
        </section>

        <section className="card developers-card" aria-labelledby="dev-sign-in">
          <h2 id="dev-sign-in">
            <KeyRound size={16} aria-hidden="true" /> Signing in
          </h2>
          <ul className="developers-list">
            <li>
              <strong>Sign in with Orbyn (OAuth 2.1).</strong> Claude, ChatGPT
              and any client that supports OAuth: the person sees what the app
              asks for and chooses its access, spaces, toolsets and how long it
              lasts. Granting change access asks for their password or passkey
              again.
            </li>
            <li>
              <strong>Agent keys.</strong> For Claude Code, Codex, Cursor and
              scripts: made in Settings → Connected agents and sent as{" "}
              <code>Authorization: Bearer oak_…</code>.
            </li>
            <li>
              <strong>Access levels.</strong>{" "}
              {Object.values(AGENT_ACCESS_LABELS)
                .map((l) => `${l.name}: ${l.blurb}`)
                .join(" ")}
            </li>
          </ul>
        </section>

        {catalog && (
          <section
            className="card developers-card"
            aria-labelledby="dev-limits"
          >
            <h2 id="dev-limits">Limits</h2>
            <p className="muted">
              Per connection, never per address. Past a limit the answer is 429
              with Retry-After.
            </p>
            <dl className="developers-facts">
              <div>
                <dt>Calls a minute</dt>
                <dd>{catalog.limits.calls_per_minute}</dd>
              </div>
              <div>
                <dt>Searches a minute</dt>
                <dd>{catalog.limits.search_per_minute}</dd>
              </div>
              <div>
                <dt>Changes a minute</dt>
                <dd>{catalog.limits.writes_per_minute}</dd>
              </div>
              <div>
                <dt>Changes a day</dt>
                <dd>{catalog.limits.writes_per_day}</dd>
              </div>
              <div>
                <dt>Calls a day</dt>
                <dd>{catalog.limits.calls_per_day}</dd>
              </div>
              <div>
                <dt>At once</dt>
                <dd>{catalog.limits.concurrent}</dd>
              </div>
            </dl>
          </section>
        )}

        <section className="card developers-card" aria-labelledby="dev-errors">
          <h2 id="dev-errors">Errors</h2>
          <dl className="developers-errors">
            {ERRORS.map(([code, text]) => (
              <div key={code}>
                <dt>
                  <code>{code}</code>
                </dt>
                <dd>{text}</dd>
              </div>
            ))}
          </dl>
          <p className="muted">
            A tool that can't do what was asked answers with isError and one of
            these codes, followed by a fix, so the model can correct itself.
          </p>
        </section>

        {error && (
          <section className="card developers-card" role="alert">
            <p>The tool list couldn't load: {error}</p>
          </section>
        )}

        {catalog && (
          <section className="developers-tools" aria-labelledby="dev-tools">
            <h2 id="dev-tools">
              <BookOpen size={16} aria-hidden="true" /> {tools.length} tools
            </h2>
            <p className="muted">
              Every connection has the core tools; the others come in toolsets
              the person turns on.
            </p>
            {catalog.toolsets.map((set) => (
              <details
                key={set.name}
                className="card developers-toolset"
                open={set.name === "core"}
              >
                <summary>
                  <strong>{AGENT_TOOLSET_LABELS[set.name].name}</strong>
                  <span className="muted">
                    {" "}
                    · {set.tools.length} tools ·{" "}
                    {AGENT_TOOLSET_LABELS[set.name].blurb}
                  </span>
                </summary>
                <ul className="developers-tool-list">
                  {tools
                    .filter((t) => t.toolset === set.name)
                    .map((t) => (
                      <li key={t.name}>
                        <div className="developers-tool-head">
                          <code>{t.name}</code>
                          <span className="developers-kind">
                            {KIND_TAG[t.kind]}
                          </span>
                        </div>
                        <p>{t.description}</p>
                      </li>
                    ))}
                </ul>
              </details>
            ))}
          </section>
        )}

        {catalog && (
          <section
            className="card developers-card"
            aria-labelledby="dev-resources"
          >
            <h2 id="dev-resources">Resources and prompts</h2>
            <ul className="developers-list">
              {catalog.resources.map((r) => (
                <li key={r.uri}>
                  <code>{r.uri}</code> · {r.name}
                </li>
              ))}
              {catalog.resource_templates.map((r) => (
                <li key={r.uri_template}>
                  <code>{r.uri_template}</code> · {r.description}
                </li>
              ))}
            </ul>
            <ul className="developers-list">
              {catalog.prompts.map((p) => (
                <li key={p.name}>
                  <strong>{p.title}</strong> <code>{p.name}</code> ·{" "}
                  {p.description}
                </li>
              ))}
            </ul>
          </section>
        )}

        {catalog && (
          <section
            className="card developers-card"
            aria-labelledby="dev-versions"
          >
            <h2 id="dev-versions">How tools change</h2>
            <ul className="developers-list">
              {catalog.versioning.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            <p className="muted">Catalog version {catalog.version}.</p>
            <h3>Changelog</h3>
            {catalog.changelog.map((c) => (
              <div key={c.date} className="developers-change">
                <strong>{c.date}</strong>
                <ul className="developers-list">
                  {c.changes.map((x) => (
                    <li key={x}>{x}</li>
                  ))}
                </ul>
              </div>
            ))}
          </section>
        )}

        <section
          id="security"
          className="card developers-card"
          aria-labelledby="dev-security"
        >
          <h2 id="dev-security">
            <ShieldCheck size={16} aria-hidden="true" /> Status and security
          </h2>
          <ul className="developers-list">
            <li>
              Whether every part of Orbyn is up:{" "}
              <a href="/status" onClick={go("/status")}>
                the status page
              </a>
              .
            </li>
            <li>
              Found a security problem? The contact is in{" "}
              <a href="/.well-known/security.txt">security.txt</a>. Please don't
              test against other people's accounts or data.
            </li>
          </ul>
        </section>
      </main>

      <footer className="status-footer">
        <Orbit size={14} /> Orbyn is a hosted service.
      </footer>
    </div>
  );
}
