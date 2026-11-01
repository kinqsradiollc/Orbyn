import { useEffect, useRef, useState } from "react";
import type { AuditEntry, RequestLogRow } from "@orbyn/core";
import { client } from "../../lib/session";
import { messageOf } from "../../lib/resource";
import { Button, Field, Input, SelectBox, ErrorNotice } from "../../ui/kit";
import { Facts, ReadState, Section, useOwner, useRead } from "./shared";
export function Observe({ area }: { area: string }) {
  return area === "overview" ? (
    <Overview />
  ) : area === "audit" ? (
    <Audit />
  ) : area === "analytics" ? (
    <Analytics />
  ) : (
    <Requests />
  );
}
function Overview() {
  const counts = useRead(() => client.adminOverview()),
    audit = useRead(() => client.adminListAudit({ limit: 8 }));
  return (
    <Section title="Workspace overview">
      <ReadState read={counts}>
        <Facts value={counts.data} />
        <Button onClick={() => void counts.reload()}>Refresh overview</Button>
      </ReadState>
      <h3>Recent audit</h3>
      <ReadState read={audit}>
        <Facts value={audit.data?.rows} />
        <Button onClick={() => void audit.reload()}>
          Refresh recent audit
        </Button>
      </ReadState>
    </Section>
  );
}
function Audit() {
  const owned = useOwner("audit:read"),
    lock = useRef(false),
    [rows, setRows] = useState<AuditEntry[]>([]),
    [total, setTotal] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function load(reset = false) {
    if (lock.current || !owned()) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const page = await client.adminListAudit({
        limit: 50,
        offset: reset ? 0 : rows.length,
      });
      if (owned()) {
        setRows((old) =>
          reset
            ? page.rows
            : [
                ...old,
                ...page.rows.filter((r) => !old.some((o) => o.id === r.id)),
              ],
        );
        setTotal(page.total);
      }
    } catch (e) {
      if (owned()) setError(messageOf(e, "Could not load audit records."));
    } finally {
      lock.current = false;
      if (owned()) setBusy(false);
    }
  }
  useEffect(() => {
    void load(true);
  }, []);
  return (
    <Section title="Audit log">
      <p>Administrative evidence, newest first.</p>
      <Button disabled={busy} onClick={() => void load(true)}>
        Refresh audit
      </Button>
      {error && (
        <ErrorNotice
          message={error}
          onRetry={() => void load(rows.length === 0)}
        />
      )}
      <Facts value={rows} />
      <p>
        {rows.length} of {total}
      </p>
      <Button
        busy={busy}
        disabled={rows.length >= total}
        onClick={() => void load()}
      >
        Show older records
      </Button>
    </Section>
  );
}
function Analytics() {
  const [days, setDays] = useState(30),
    read = useRead(() => client.adminAnalytics(days), [days], "analytics:read");
  return (
    <Section title="Workspace usage">
      <Field label="Days">
        <Input
          type="number"
          min={7}
          max={365}
          value={days}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (v >= 7 && v <= 365) setDays(v);
          }}
        />
      </Field>
      <p>
        Request activity is sampled. It does not count every user action.
        Analytics omit people who opted out.
      </p>
      <ReadState read={read}>
        <Facts value={read.data} />
        <Button onClick={() => void read.reload()}>Refresh usage</Button>
      </ReadState>
    </Section>
  );
}
type Filter = {
  service: string;
  status: "" | "2xx" | "3xx" | "4xx" | "5xx";
  route: string;
  user: string;
  request_id: string;
  slow: boolean;
};
const EMPTY: Filter = {
  service: "",
  status: "",
  route: "",
  user: "",
  request_id: "",
  slow: false,
};
function Requests() {
  const owned = useOwner("requests:read"),
    [draft, setDraft] = useState(EMPTY),
    [filters, setFilters] = useState(EMPTY),
    [hours, setHours] = useState(24),
    [live, setLive] = useState(false),
    [rows, setRows] = useState<RequestLogRow[]>([]),
    [more, setMore] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    epoch = useRef(0),
    lock = useRef(false),
    queued = useRef(false),
    latest = useRef(filters);
  latest.current = filters;
  const summary = useRead(
    () => client.adminRequestSummary(hours),
    [hours],
    "requests:read",
  );
  useEffect(() => {
    const timer = setTimeout(() => setFilters(draft), 250);
    return () => clearTimeout(timer);
  }, [draft]);
  async function load(reset: boolean) {
    if (!owned()) return;
    if (lock.current) {
      if (reset) queued.current = true;
      return;
    }
    lock.current = true;
    setBusy(true);
    setError("");
    const mine = epoch.current;
    try {
      const page = await client.adminRequests({
        ...latest.current,
        status: latest.current.status || undefined,
        before: reset ? undefined : rows.at(-1)?.id,
        limit: 50,
      });
      if (owned() && mine === epoch.current) {
        setRows((old) =>
          reset
            ? page.rows
            : [
                ...old,
                ...page.rows.filter((r) => !old.some((o) => o.id === r.id)),
              ],
        );
        setMore(page.more);
      }
    } catch (e) {
      if (owned() && mine === epoch.current)
        setError(messageOf(e, "Could not read requests."));
    } finally {
      lock.current = false;
      if (owned()) {
        setBusy(false);
        if (queued.current) {
          queued.current = false;
          void load(true);
        }
      }
    }
  }
  useEffect(() => {
    epoch.current++;
    setRows([]);
    setMore(false);
    void load(true);
  }, [filters]);
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible" && !lock.current) {
        void load(true);
        void summary.reload();
      }
    }, 10000);
    return () => clearInterval(timer);
  }, [live, filters, hours]);
  const text = (
    key: "service" | "route" | "user" | "request_id",
    label: string,
  ) => (
    <Field label={label}>
      <Input
        value={draft[key]}
        maxLength={200}
        onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
      />
    </Field>
  );
  return (
    <Section title="Service requests">
      <div className="admin-form">
        {text("service", "Service")}
        {text("route", "Route")}
        {text("user", "Account ID or email")}
        {text("request_id", "Request ID")}
        <Field label="Status">
          <SelectBox
            value={draft.status}
            onChange={(e) =>
              setDraft({ ...draft, status: e.target.value as Filter["status"] })
            }
          >
            {["", "2xx", "3xx", "4xx", "5xx"].map((s) => (
              <option key={s} value={s}>
                {s || "All statuses"}
              </option>
            ))}
          </SelectBox>
        </Field>
        <Field label="Summary hours">
          <Input
            type="number"
            min={1}
            max={168}
            value={hours}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (v >= 1 && v <= 168) setHours(v);
            }}
          />
        </Field>
      </div>
      <label>
        <input
          type="checkbox"
          checked={draft.slow}
          onChange={(e) => setDraft({ ...draft, slow: e.target.checked })}
        />
        Only requests taking at least one second
      </label>
      <label>
        <input
          type="checkbox"
          checked={live}
          onChange={(e) => setLive(e.target.checked)}
        />
        Refresh visible view every ten seconds
      </label>
      <Button
        disabled={busy}
        onClick={() => {
          void load(true);
          void summary.reload();
        }}
      >
        Refresh requests
      </Button>
      <ReadState read={summary}>
        <Facts value={summary.data} />
      </ReadState>
      {error && (
        <ErrorNotice
          message={error}
          onRetry={() => void load(rows.length === 0)}
        />
      )}
      <div className="admin-collection">
        {rows.map((r) => (
          <details key={r.id}>
            <summary>
              {r.status} · {r.method} {r.route} · {r.duration_ms} ms
            </summary>
            <Facts value={r} />
          </details>
        ))}
      </div>
      <Button busy={busy} disabled={!more} onClick={() => void load(false)}>
        Show older requests
      </Button>
    </Section>
  );
}
