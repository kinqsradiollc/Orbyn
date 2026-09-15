import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
} from "react";
import {
  ArrowUpRight,
  CircleCheck,
  CircleDashed,
  CircleX,
  Orbit,
  RefreshCw,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import {
  formatUptime,
  serviceStateLabels,
  statusHeadlines,
  type ServiceState,
  type StatusComponent,
  type StatusReport,
} from "@orbyn/core";
import { client } from "../../lib/api";
import { stagger } from "../../lib/motion";
import "./status.css";

/** How often the page asks for fresh results (the server caches for 15s). */
const POLL_MS = 30_000;

const STATE_ICONS: Record<ServiceState, LucideIcon> = {
  operational: CircleCheck,
  degraded: TriangleAlert,
  outage: CircleX,
  unknown: CircleDashed,
};

const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"}`;

/** "2 hours 5 minutes", "45 seconds", "3 days 4 hours". */
export const humanizeDuration = (seconds: number) => {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return plural(Math.max(1, s), "second");
  const units: [number, string][] = [
    [86400, "day"],
    [3600, "hour"],
    [60, "minute"],
  ];
  const parts: string[] = [];
  let rest = s;
  for (const [size, unit] of units) {
    const n = Math.floor(rest / size);
    rest -= n * size;
    if (n) parts.push(plural(n, unit));
    else if (parts.length) break;
    if (parts.length === 2) break;
  }
  return parts.join(" ");
};

const updatedAgo = (seconds: number) =>
  seconds < 5
    ? "Updated just now"
    : seconds < 60
      ? `Updated ${plural(seconds, "second")} ago`
      : seconds < 3600
        ? `Updated ${plural(Math.floor(seconds / 60), "minute")} ago`
        : `Updated ${plural(Math.floor(seconds / 3600), "hour")} ago`;

/** History dates are UTC days ("2026-09-14"). */
const formatDay = (date: string) =>
  new Date(date + "T00:00:00Z").toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });

const formatTime = (iso: string) =>
  new Date(iso).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

const barLevel = (uptime: number | null) =>
  uptime === null
    ? "none"
    : uptime >= 0.999
      ? "great"
      : uptime >= 0.99
        ? "good"
        : uptime >= 0.95
          ? "warn"
          : "bad";

const dayLabel = (d: StatusComponent["history"][number]) =>
  `${formatDay(d.date)}: ${d.uptime === null ? "no data" : formatUptime(d.uptime) + " uptime"}`;

type Props = {
  signedIn: boolean;
  onNavigate: (path: string) => void;
  /** Absent in the native desktop app, which has no homepage. */
  onHome?: () => void;
};

/** Public service status: works signed in or out. */
export function StatusPage({ signedIn, onNavigate, onHome }: Props) {
  const [report, setReport] = useState<StatusReport | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  const seq = useRef(0);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    setLoading(true);
    try {
      const next = await client.getStatus();
      if (mine !== seq.current) return;
      setReport(next);
      setError("");
    } catch (e) {
      if (mine === seq.current)
        setError((e as Error).message || "The status service didn't respond.");
    } finally {
      if (mine === seq.current) {
        setLoading(false);
        setNow(Date.now());
      }
    }
  }, []);

  useEffect(() => {
    void load();
    const poll = setInterval(() => void load(), POLL_MS);
    const tick = setInterval(() => setNow(Date.now()), 5_000);
    return () => {
      seq.current++;
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [load]);

  const go = (path: string) => (e: MouseEvent) => {
    e.preventDefault();
    onNavigate(path);
  };
  const goHome = (e: MouseEvent) => {
    e.preventDefault();
    if (onHome) onHome();
    else onNavigate(signedIn ? "/app" : "/login");
  };

  const age = report
    ? Math.max(0, Math.round((now - Date.parse(report.updated_at)) / 1000))
    : 0;
  const state = report?.state ?? "unknown";
  const StateIcon = STATE_ICONS[state];

  return (
    <div className="status-page">
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

      <main className="status-main" aria-busy={loading && !report}>
        <span className="eyebrow">SERVICE STATUS</span>

        {report && (
          <section
            className={`status-banner is-${state} fade-up motion-slow`}
            aria-labelledby="status-headline"
          >
            <StateIcon size={26} aria-hidden="true" />
            <div>
              <h1 id="status-headline">{statusHeadlines[state]}</h1>
              <p>
                {updatedAgo(age)}
                {error && (
                  <span className="status-stale" role="status">
                    {" "}
                    · Couldn&apos;t refresh just now, showing the last results.
                  </span>
                )}
              </p>
            </div>
            <button
              className="icon-button"
              aria-label="Check again"
              title="Check again"
              disabled={loading}
              onClick={() => void load()}
            >
              <RefreshCw size={16} />
            </button>
          </section>
        )}

        {!report && !error && (
          <div className="status-loading" role="status">
            <div className="status-banner is-unknown">
              <CircleDashed size={26} aria-hidden="true" />
              <div>
                <h1>{statusHeadlines.unknown}</h1>
                <p>Loading the latest checks…</p>
              </div>
            </div>
            {[0, 1, 2].map((n) => (
              <div className="card status-skeleton" key={n} aria-hidden="true">
                <i />
                <i />
                <i />
              </div>
            ))}
          </div>
        )}

        {!report && error && (
          <section className="card status-error fade-up" role="alert">
            <CircleX size={24} aria-hidden="true" />
            <h1>We couldn&apos;t load the status right now.</h1>
            <p>
              {/[.!?]$/.test(error) ? error : error + "."} We&apos;ll keep
              trying every 30 seconds, or you can try again now.
            </p>
            <button
              className="primary"
              disabled={loading}
              onClick={() => void load()}
            >
              <RefreshCw size={14} /> {loading ? "Checking…" : "Try again"}
            </button>
          </section>
        )}

        {report && (
          <>
            <h2 className="sr-only">Components</h2>
            {report.components.map((c, n) => (
              <ComponentCard key={c.id} component={c} index={n} />
            ))}
            {!report.components.length && (
              <p className="muted status-none">
                No components are being checked yet.
              </p>
            )}

            <section className="card status-incidents fade-up">
              <div className="section-heading">
                <h2>Recent incidents</h2>
              </div>
              {report.incidents.length ? (
                <ul>
                  {report.incidents.map((i, n) => (
                    <li
                      key={i.component + i.started_at}
                      className="fade-up stagger"
                      style={stagger(n)}
                    >
                      <span
                        className={
                          "status-dot " +
                          (i.resolved_at ? "is-resolved" : "is-ongoing")
                        }
                        aria-hidden="true"
                      />
                      <div>
                        <strong>{i.name}</strong>
                        <small>
                          Started{" "}
                          <time dateTime={i.started_at}>
                            {formatTime(i.started_at)}
                          </time>
                        </small>
                      </div>
                      <span
                        className={
                          "incident-state " +
                          (i.resolved_at ? "is-resolved" : "is-ongoing")
                        }
                      >
                        {i.resolved_at
                          ? `Resolved after ${humanizeDuration(i.duration_s)}`
                          : `Ongoing · ${humanizeDuration(i.duration_s + age)}`}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="status-empty">
                  <CircleCheck size={18} aria-hidden="true" />
                  <p>No incidents recorded recently.</p>
                </div>
              )}
            </section>
          </>
        )}
      </main>

      <footer className="status-footer">
        <Orbit size={14} /> Checks run every 30 seconds.
      </footer>
    </div>
  );
}

function ComponentCard({
  component: c,
  index,
}: {
  component: StatusComponent;
  index: number;
}) {
  const uptime: [string, number | null][] = [
    ["24 hours", c.uptime.day],
    ["7 days", c.uptime.week],
    ["90 days", c.uptime.quarter],
  ];
  return (
    <article
      className="card status-component fade-up stagger"
      style={stagger(index + 1)}
      aria-labelledby={`status-${c.id}`}
    >
      <div className="status-component-head">
        <div>
          <h3 id={`status-${c.id}`}>{c.name}</h3>
          {c.description && <p>{c.description}</p>}
        </div>
        <span className={`state-pill is-${c.state}`}>
          {serviceStateLabels[c.state]}
        </span>
      </div>
      <dl className="status-uptime">
        {uptime.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{formatUptime(value)}</dd>
          </div>
        ))}
        {c.latency_ms !== null && (
          <div>
            <dt>Latency</dt>
            <dd>{c.latency_ms} ms</dd>
          </div>
        )}
      </dl>
      <History name={c.name} days={c.history} />
    </article>
  );
}

/** One bar per UTC day, oldest first. Narrow screens show the last 30 (CSS). */
function History({
  name,
  days,
}: {
  name: string;
  days: StatusComponent["history"];
}) {
  const [active, setActive] = useState<number | null>(null);
  const day = active === null ? null : days[active];
  if (!days.length) return null;
  return (
    <div className="status-history">
      <div
        className="status-bars"
        role="list"
        aria-label={`${name} daily uptime`}
        onMouseLeave={() => setActive(null)}
      >
        {days.map((d, i) => (
          <span
            key={d.date}
            role="listitem"
            aria-label={dayLabel(d)}
            title={dayLabel(d)}
            className={`bar is-${barLevel(d.uptime)}${active === i ? " is-active" : ""}`}
            onMouseEnter={() => setActive(i)}
            onClick={() => setActive(active === i ? null : i)}
          />
        ))}
      </div>
      <div className="status-axis" aria-hidden="true">
        {day ? (
          <span className="status-axis-day">{dayLabel(day)}</span>
        ) : (
          <>
            <span>
              <span className="long">{days.length} days ago</span>
              <span className="short">
                {Math.min(days.length, 30)} days ago
              </span>
            </span>
            <span>Today</span>
          </>
        )}
      </div>
    </div>
  );
}
