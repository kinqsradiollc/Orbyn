import { useResource } from "../../lib/resource";
import { useTitle } from "../../lib/router";
import { client } from "../../lib/session";
import { Button, ErrorNotice, Loading, Pill } from "../../ui/kit";
import { PublicFrame, go } from "./PublicFrame";
import { Setup } from "./developers/Setup";
import { Tools } from "./developers/Tools";
import { Limits, Resources, Versions } from "./developers/Reference";
import "./developers/developers.css";
const api = (import.meta.env.VITE_API_URL || "/api").replace(/\/$/, "");
const sections = [
  ["connect", "Connect"],
  ["tools", "Tools"],
  ["resources", "Resources"],
  ["limits", "Limits"],
  ["versions", "Changes"],
  ["security", "Security"],
] as const;
const safeHttp = (value: string): string | undefined => {
  try {
    const parsed = new URL(value, window.location.origin);
    return ["http:", "https:"].includes(parsed.protocol) &&
      !parsed.username &&
      !parsed.password
      ? parsed.href
      : undefined;
  } catch {
    return undefined;
  }
};

export default function Developers() {
  useTitle("MCP developer guide");
  // The typed endpoint explicitly sets anonymous:true; opening this guide never grants access.
  const report = useResource(() => client.developerCatalog(), []),
    catalog = report.data;
  const status = catalog ? safeHttp(catalog.status_url) : undefined;
  return (
    <PublicFrame>
      <main className="developers-main">
        <header className="developers-intro">
          <p className="eyebrow">Developers · MCP</p>
          <h1>Connect agents to your planner</h1>
          <p>
            Use Orbyn’s MCP server to work with tasks, calendar, projects and
            pages. Each connection has the spaces and permissions its person
            chooses.
          </p>
          <a href={`${api}/openapi.yaml`}>REST API · OpenAPI specification</a>
        </header>
        <nav className="developers-jump" aria-label="Developer guide sections">
          {sections
            .filter(([id]) => catalog || id === "security")
            .map(([id, label]) => (
              <a href={`#${id}`} key={id}>
                {label}
              </a>
            ))}
        </nav>
        <div className="developers-catalog-state">
          <span role="status">
            {report.loading
              ? catalog
                ? "Refreshing catalog…"
                : "Loading published catalog…"
              : catalog
                ? `Catalog ${catalog.version}`
                : "Catalog unavailable"}
          </span>
          <Button
            disabled={report.loading}
            onClick={() => void report.reload()}
          >
            Refresh catalog
          </Button>
        </div>
        {report.error && (
          <>
            <ErrorNotice
              message={report.error}
              onRetry={() => void report.reload()}
            />
            {catalog && (
              <p className="small">
                Showing the previously loaded catalog. Availability and limits
                may have changed.
              </p>
            )}
          </>
        )}
        {!catalog && report.loading && (
          <Loading label="Loading MCP reference" />
        )}
        {!catalog && !report.loading && (
          <p>
            The server address, setup examples and tool reference will appear
            when the public catalog is available. Refresh to try again.
          </p>
        )}
        {catalog && (
          <>
            <div className="developers-availability" role="status">
              <Pill
                tone={
                  report.error || report.loading
                    ? "amber"
                    : catalog.agents_enabled
                      ? "green"
                      : "amber"
                }
              >
                {report.error || report.loading
                  ? "Availability unconfirmed"
                  : catalog.agents_enabled
                    ? "Outside agents enabled"
                    : "Outside agents switched off"}
              </Pill>
              {!catalog.agents_enabled && !report.error && !report.loading && (
                <span>
                  The catalog remains readable; connections cannot currently use
                  this server.
                </span>
              )}
            </div>
            <Setup catalog={catalog} />
            <Tools catalog={catalog} />
            <Resources catalog={catalog} />
            <Limits catalog={catalog} />
            <Versions catalog={catalog} />
          </>
        )}
        <section id="security" aria-labelledby="developers-security">
          <h2 id="developers-security">Status and security</h2>
          {catalog?.security && <p dir="auto">{catalog.security}</p>}
          <div className="developers-links">
            <a
              href={status || "/status"}
              {...(!status ? { onClick: go("/status") } : {})}
            >
              Service status
            </a>
            <a href={`${api}/.well-known/security.txt`}>
              Security contact · security.txt
            </a>
            <a href="/security" onClick={go("/security")}>
              Security and data
            </a>
          </div>
        </section>
      </main>
    </PublicFrame>
  );
}
