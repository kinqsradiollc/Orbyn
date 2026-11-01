import type { AgentLimits, McpCatalog } from "@orbyn/core";

const LIMITS: readonly [keyof AgentLimits, string][] = [
  ["calls_per_minute", "Calls per minute"],
  ["search_per_minute", "Searches per minute"],
  ["writes_per_minute", "Changes per minute"],
  ["writes_per_day", "Changes per day"],
  ["calls_per_day", "Calls per day"],
  ["concurrent", "Concurrent calls"],
  ["user_per_minute", "Calls per minute across your connections"],
];
const ERRORS = [
  [
    "401",
    "The credential is absent or invalid. Check the WWW-Authenticate response.",
  ],
  [
    "403",
    "The connection, client or calling page is not allowed. Check its grant and server policy.",
  ],
  [
    "429",
    "A rate or concurrency limit was reached. Respect Retry-After before retrying.",
  ],
  ["503", "Outside agents are unavailable. Respect Retry-After."],
  [
    "NOT_FOUND",
    "This connection cannot reach that object. Check the ID and allowed spaces.",
  ],
  [
    "INVALID",
    "An argument failed validation. Correct the field named in the error.",
  ],
  ["FORBIDDEN", "The grant does not permit this operation."],
  ["READ_ONLY", "Changes are paused or this connection may only read."],
  [
    "VERSION_CONFLICT",
    "The object changed. Read it again before deciding what to change.",
  ],
  ["STALE", "The plan no longer matches the calendar. Preview a fresh plan."],
] as const;

export function Limits({ catalog }: { catalog: McpCatalog }) {
  return (
    <section id="limits" aria-labelledby="developers-limits">
      <h2 id="developers-limits">Limits and errors</h2>
      <p>
        Limits apply per connection; the combined limit applies across one
        person’s connections. Rate-limit responses include Retry-After.
      </p>
      <dl className="developers-limits">
        {LIMITS.map(([key, label]) => (
          <div key={key}>
            <dt>{label}</dt>
            <dd>{catalog.limits[key].toLocaleString()}</dd>
          </div>
        ))}
      </dl>
      <details>
        <summary>HTTP and tool errors</summary>
        <p>
          Tool failures return <code>isError</code> with a code and guidance. A
          failed response does not justify blindly repeating a change; check its
          outcome first.
        </p>
        <dl className="developers-definitions">
          {ERRORS.map(([code, meaning]) => (
            <div key={code}>
              <dt>
                <code>{code}</code>
              </dt>
              <dd>{meaning}</dd>
            </div>
          ))}
        </dl>
      </details>
    </section>
  );
}
export function Resources({ catalog }: { catalog: McpCatalog }) {
  return (
    <section id="resources" aria-labelledby="developers-resources">
      <h2 id="developers-resources">Resources and prompts</h2>
      <p>
        Read these through your MCP client. Resource addresses are identifiers,
        not website links.
      </p>
      <details>
        <summary>Resources · {catalog.resources.length}</summary>
        {!catalog.resources.length ? (
          <p>No resources published.</p>
        ) : (
          <ul className="developers-reference-list">
            {catalog.resources.map((r) => (
              <li key={r.uri}>
                <code dir="ltr">{r.uri}</code>
                <span dir="auto">{r.name}</span>
                {r.public && <span className="small">Public guide</span>}
              </li>
            ))}
          </ul>
        )}
      </details>
      <details>
        <summary>
          Resource templates · {catalog.resource_templates.length}
        </summary>
        {!catalog.resource_templates.length ? (
          <p>No resource templates published.</p>
        ) : (
          <ul className="developers-reference-list">
            {catalog.resource_templates.map((r) => (
              <li key={r.uri_template}>
                <code dir="ltr">{r.uri_template}</code>
                <strong dir="auto">{r.name}</strong>
                <span dir="auto">{r.description}</span>
              </li>
            ))}
          </ul>
        )}
      </details>
      <details>
        <summary>Prompts · {catalog.prompts.length}</summary>
        {!catalog.prompts.length ? (
          <p>No prompts published.</p>
        ) : (
          <ul className="developers-reference-list">
            {catalog.prompts.map((p) => (
              <li key={p.name}>
                <strong dir="auto">{p.title}</strong>
                <code dir="ltr">{p.name}</code>
                <span dir="auto">{p.description}</span>
                {p.arguments.length ? (
                  <dl className="developers-definitions">
                    {p.arguments.map((a) => (
                      <div key={a.name}>
                        <dt>
                          <code>{a.name}</code>
                        </dt>
                        <dd>{a.required ? "Required" : "Optional"}</dd>
                      </div>
                    ))}
                  </dl>
                ) : (
                  <span className="small">No arguments</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </details>
    </section>
  );
}
export function Versions({ catalog }: { catalog: McpCatalog }) {
  return (
    <section id="versions" aria-labelledby="developers-versions">
      <h2 id="developers-versions">Compatibility and changes</h2>
      <p>
        Catalog version <code>{catalog.version}</code>
      </p>
      <details>
        <summary>Version policy</summary>
        {catalog.versioning.length ? (
          <ul>
            {catalog.versioning.map((line, i) => (
              <li key={i} dir="auto">
                {line}
              </li>
            ))}
          </ul>
        ) : (
          <p>No version policy published.</p>
        )}
      </details>
      <details>
        <summary>Catalog changelog</summary>
        {catalog.changelog.length ? (
          catalog.changelog.map((entry, i) => (
            <div className="developers-change" key={`${entry.date}-${i}`}>
              <h3>
                <time>{entry.date}</time>
              </h3>
              <ul>
                {entry.changes.map((line, j) => (
                  <li key={j} dir="auto">
                    {line}
                  </li>
                ))}
              </ul>
            </div>
          ))
        ) : (
          <p>No changes published.</p>
        )}
      </details>
    </section>
  );
}
