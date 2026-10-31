import type { ServiceState } from "@orbyn/core";
import { useEffect } from "react";
import { client } from "../../lib/session";
import { useResource } from "../../lib/resource";
import { useTitle } from "../../lib/router";
import { ErrorNotice, Loading, Pill } from "../../ui/kit";
import { PublicFrame } from "./PublicFrame";

const WORDS: Record<
  ServiceState,
  [string, "green" | "amber" | "red" | undefined]
> = {
  operational: ["Operational", "green"],
  degraded: ["Degraded", "amber"],
  outage: ["Outage", "red"],
  unknown: ["Unknown", undefined],
};
const percent = (share: number | null) =>
  share === null ? "No data" : `${(share * 100).toFixed(2)}%`;

export default function Status() {
  useTitle("Service status");
  const report = useResource(() => client.getStatus(), []);
  useEffect(() => {
    const poll = setInterval(() => void report.reload(), 30_000);
    return () => clearInterval(poll);
  }, [report.reload]);
  const data = report.data;
  const [word, tone] = WORDS[data?.state ?? "unknown"];
  return (
    <PublicFrame>
      <main className="reading">
        <div className="page-head">
          <h1>Service status</h1>
          <Pill tone={tone}>{word}</Pill>
        </div>
        {report.error && (
          <ErrorNotice
            message={report.error}
            onRetry={() => void report.reload()}
          />
        )}
        {!data && !report.error && <Loading />}
        {data?.maintenance?.enabled && (
          <div className="status-note" role="status">
            {data.maintenance.message || "Maintenance is under way."}
            {data.maintenance.until &&
              ` Expected to end ${new Date(data.maintenance.until).toLocaleString()}.`}
          </div>
        )}
        {data?.clock && (
          <div className="status-note" role="status">
            The server's clock is out by{" "}
            {Math.round(Math.abs(data.clock.skew_ms) / 1000)} seconds.
          </div>
        )}
        {data && (
          <>
            <p className="small muted">
              Updated {new Date(data.updated_at).toLocaleTimeString()}. Checks
              again every 30 seconds.
            </p>
            <div className="rows">
              {data.components.map((part) => (
                <div className="status-row" key={part.id}>
                  <div className="row-main">
                    <h3>{part.name}</h3>
                    <p className="small muted">{part.description}</p>
                  </div>
                  <div
                    className="status-bars"
                    role="img"
                    aria-label={`${part.name}: last 90 days, ${percent(part.uptime.quarter)} uptime`}
                  >
                    {part.history.map((day) => (
                      <i
                        key={day.date}
                        title={`${day.date}: ${percent(day.uptime)}`}
                        data-state={
                          day.uptime === null
                            ? "none"
                            : day.uptime >= 0.999
                              ? "good"
                              : day.uptime >= 0.95
                                ? "warn"
                                : "bad"
                        }
                      />
                    ))}
                  </div>
                  <span className="small muted status-figure">
                    {percent(part.uptime.day)} today
                    <br />
                    {part.latency_ms === null ? "" : `${part.latency_ms} ms`}
                  </span>
                  <Pill tone={WORDS[part.state][1]}>
                    {WORDS[part.state][0]}
                  </Pill>
                </div>
              ))}
            </div>
            <section>
              <h2>Recent incidents</h2>
              {data.incidents.length === 0 ? (
                <p className="muted">No recent incidents.</p>
              ) : (
                <div className="rows">
                  {data.incidents.map((incident) => (
                    <div
                      className="row"
                      key={`${incident.component}:${incident.started_at}`}
                    >
                      <span className="row-main">{incident.name}</span>
                      <span className="small muted">
                        {new Date(incident.started_at).toLocaleString()}
                        {incident.resolved_at
                          ? `, ${Math.ceil(incident.duration_s / 60)} min`
                          : ", ongoing"}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </main>
    </PublicFrame>
  );
}
