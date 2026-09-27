import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
} from "react";
import {
  ArrowUpRight,
  ChevronDown,
  CircleCheck,
  CircleDashed,
  CircleX,
  Clock,
  Orbit,
  RefreshCw,
  TriangleAlert,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import {
  clockSkewText,
  formatUptime,
  groupStatusComponents,
  groupSummary,
  incidentSeverity,
  incidentSeverityLabels,
  incidentUpdates,
  isProblemState,
  serviceStateLabels,
  splitIncidents,
  statusHeadlines,
  statusSummary,
  type IncidentSeverity,
  type ServiceState,
  type StatusComponent,
  type StatusGroup,
  type StatusIncident,
  type StatusReport,
} from "@orbyn/core";
import { client } from "../../lib/api";
import { formatDateTime } from "../../lib/format";
import { stagger } from "../../lib/motion";
import "./status.css";
import { errorText } from "../../lib/errors";

/** How often the page asks for fresh results (the server caches for 15s). */
const POLL_MS = 30_000;
/** Past incidents shown at first, and added by each "Show more". */
const INCIDENT_PAGE = 5;

/** Severity chips reuse the state pills' colours. */
const SEVERITY_TONE: Record<IncidentSeverity, ServiceState> = {
  major: "outage",
  minor: "degraded",
  brief: "unknown",
};

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

const formatClock = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

/** "Sep 24, 10:02 – 10:40", or both dates when it ran past midnight. */
const incidentSpan = (i: StatusIncident) => {
  if (!i.resolved_at) return `Since ${formatTime(i.started_at)}`;
  const sameDay =
    new Date(i.started_at).toDateString() ===
    new Date(i.resolved_at).toDateString();
  return `${formatTime(i.started_at)} – ${
    sameDay ? formatClock(i.resolved_at) : formatTime(i.resolved_at)
  }`;
};

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
      if (mine === seq.current) setError(errorText(e));
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

        {report?.maintenance && report.maintenance.enabled !== false && (
          <section
            className="status-maintenance fade-up"
            role="status"
            aria-labelledby="status-maintenance-title"
          >
            <Wrench size={22} aria-hidden="true" />
            <div>
              <h2 id="status-maintenance-title">Under maintenance</h2>
              {report.maintenance.message && (
                <p className="status-maintenance-message">
                  {report.maintenance.message}
                </p>
              )}
              <p>
                You can still sign in and view everything. Changes are paused
                until it&apos;s over.
              </p>
              {report.maintenance.until && (
                <p>
                  <strong>
                    Expected back{" "}
                    <time dateTime={report.maintenance.until}>
                      {formatDateTime(report.maintenance.until)}
                    </time>
                  </strong>
                </p>
              )}
            </div>
          </section>
        )}

        {report?.clock && (
          <section
            className="status-maintenance fade-up"
            role="status"
            aria-labelledby="status-clock-title"
          >
            <Clock size={22} aria-hidden="true" />
            <div>
              <h2 id="status-clock-title">Server clock is out</h2>
              <p className="status-maintenance-message">
                {clockSkewText(report.clock.skew_ms)}
              </p>
              <p>
                Found{" "}
                <time dateTime={report.clock.since}>
                  {formatDateTime(report.clock.since)}
                </time>
                , checked against outside time every ten minutes.
              </p>
            </div>
          </section>
        )}

        {report && (
          <section
            className={`status-banner is-${state} fade-up motion-slow`}
            aria-labelledby="status-headline"
          >
            <StateIcon size={26} aria-hidden="true" />
            <div>
              <h1 id="status-headline">{statusHeadlines[state]}</h1>
              <p className="status-summary">
                {statusSummary(report.components, report.incidents)}
              </p>
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
            <ActiveIncidents
              incidents={splitIncidents(report.incidents).active}
              age={age}
            />
            <section
              className="status-section"
              aria-labelledby="status-components-title"
            >
              <h2 id="status-components-title" className="status-section-title">
                Components
              </h2>
              {groupStatusComponents(report.components).map((g, n) => (
                <GroupCard key={g.id} group={g} index={n} />
              ))}
              {!report.components.length && (
                <p className="muted status-none">
                  No components are being checked yet.
                </p>
              )}
            </section>
            <PastIncidents
              incidents={splitIncidents(report.incidents).past}
              age={age}
            />
          </>
        )}
      </main>

      <footer className="status-footer">
        <Orbit size={14} /> Checks run every 30 seconds.
      </footer>
    </div>
  );
}

/** Incidents still going, open at the top of the page. */
function ActiveIncidents({
  incidents,
  age,
}: {
  incidents: StatusIncident[];
  age: number;
}) {
  if (!incidents.length) return null;
  return (
    <section
      className="card status-incidents is-active fade-up"
      aria-labelledby="status-active-title"
    >
      <div className="section-heading">
        <h2 id="status-active-title">Happening now</h2>
      </div>
      <ul>
        {incidents.map((i) => (
          <IncidentRow
            key={i.component + i.started_at}
            incident={i}
            age={age}
            open
          />
        ))}
      </ul>
    </section>
  );
}

/**
 * Past incidents as a compact list, a few at a time, each opening to its
 * updates.
 */
function PastIncidents({
  incidents,
  age,
}: {
  incidents: StatusIncident[];
  age: number;
}) {
  const [shown, setShown] = useState(INCIDENT_PAGE);
  const rest = incidents.length - shown;
  return (
    <section
      className="card status-incidents is-past fade-up"
      aria-labelledby="status-past-title"
    >
      <div className="section-heading">
        <h2 id="status-past-title">Past incidents</h2>
        <span className="status-count">Last 30 days</span>
      </div>
      {incidents.length ? (
        <>
          <ul>
            {incidents.slice(0, shown).map((i) => (
              <IncidentRow
                key={i.component + i.started_at}
                incident={i}
                age={age}
              />
            ))}
          </ul>
          {incidents.length > INCIDENT_PAGE && (
            <div className="status-more">
              <span>
                Showing {Math.min(shown, incidents.length)} of{" "}
                {incidents.length}
              </span>
              {rest > 0 && (
                <button
                  type="button"
                  className="text-button"
                  onClick={() => setShown((n) => n + INCIDENT_PAGE)}
                >
                  Show {Math.min(rest, INCIDENT_PAGE)} more
                </button>
              )}
            </div>
          )}
        </>
      ) : (
        <div className="status-empty">
          <CircleCheck size={18} aria-hidden="true" />
          <p>No incidents in the last 30 days.</p>
        </div>
      )}
    </section>
  );
}

/** One incident: a line that opens to its updates. */
function IncidentRow({
  incident: i,
  age,
  open: startOpen = false,
}: {
  incident: StatusIncident;
  age: number;
  open?: boolean;
}) {
  const [open, setOpen] = useState(startOpen);
  const ongoing = !i.resolved_at;
  const duration = humanizeDuration(i.duration_s + (ongoing ? age : 0));
  const severity = incidentSeverity({
    duration_s: i.duration_s + (ongoing ? age : 0),
  });
  const id = `incident-${i.component}-${Date.parse(i.started_at)}`;
  return (
    <li className={open ? "is-open" : undefined}>
      <button
        type="button"
        className="status-incident-toggle"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
      >
        <span
          className={`status-dot ${ongoing ? "is-ongoing" : "is-resolved"}`}
          aria-hidden="true"
        />
        <span className="status-incident-main">
          <strong>{i.name}</strong>
          <small>
            <time dateTime={i.started_at}>{incidentSpan(i)}</time> ·{" "}
            {ongoing ? `for ${duration}` : duration}
          </small>
        </span>
        <span
          className={`state-pill is-${ongoing ? "outage" : SEVERITY_TONE[severity]}`}
        >
          {ongoing ? "Ongoing" : incidentSeverityLabels[severity]}
        </span>
        <ChevronDown className="status-chevron" size={16} aria-hidden="true" />
      </button>
      <ol id={id} className="status-updates" hidden={!open}>
        {incidentUpdates(i).map((u) => (
          <li key={u.kind} className={`is-${u.kind}`}>
            <span className="status-update-time">
              {u.at ? <time dateTime={u.at}>{formatTime(u.at)}</time> : "Now"}
            </span>
            <span>{u.text}</span>
          </li>
        ))}
      </ol>
    </li>
  );
}

/**
 * A group of components: one line when all is well, open by itself when
 * something in it is slow or down.
 */
function GroupCard({ group: g, index }: { group: StatusGroup; index: number }) {
  const problem = isProblemState(g.state);
  const [open, setOpen] = useState(problem);
  // A group that runs into trouble opens itself, once.
  useEffect(() => {
    if (problem) setOpen(true);
  }, [problem]);
  const body = `status-group-${g.id}`;
  return (
    <article
      className={`card status-group fade-up stagger${open ? " is-open" : ""}`}
      style={stagger(index + 1)}
      aria-labelledby={`${body}-title`}
    >
      <h3 id={`${body}-title`} className="status-group-heading">
        <button
          type="button"
          className="status-group-toggle"
          aria-expanded={open}
          aria-controls={body}
          onClick={() => setOpen(!open)}
        >
          <span className="status-group-name">
            {g.name}
            <small>
              {groupSummary(g.components)}
              {g.uptime !== null && ` · ${formatUptime(g.uptime)} over 90 days`}
            </small>
          </span>
          <span className={`state-pill is-${g.state}`}>
            {serviceStateLabels[g.state]}
          </span>
          <ChevronDown
            className="status-chevron"
            size={18}
            aria-hidden="true"
          />
        </button>
      </h3>
      <div id={body} className="status-group-body" hidden={!open}>
        {g.components.map((c) => (
          <ComponentRow key={c.id} component={c} />
        ))}
      </div>
    </article>
  );
}

function ComponentRow({ component: c }: { component: StatusComponent }) {
  const figures = [
    `24 h ${formatUptime(c.uptime.day)}`,
    `7 days ${formatUptime(c.uptime.week)}`,
    `90 days ${formatUptime(c.uptime.quarter)}`,
    ...(c.latency_ms !== null ? [`${c.latency_ms} ms`] : []),
  ];
  return (
    <div className="status-component" aria-labelledby={`status-${c.id}`}>
      <div className="status-component-head">
        <div>
          <h4 id={`status-${c.id}`}>{c.name}</h4>
          {c.description && <p>{c.description}</p>}
        </div>
        <span className={`state-pill is-${c.state}`}>
          {serviceStateLabels[c.state]}
        </span>
      </div>
      <p className="status-figures">
        <span className="sr-only">Uptime: </span>
        {figures.join(" · ")}
      </p>
      <History name={c.name} days={c.history} />
    </div>
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
