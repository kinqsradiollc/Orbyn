import { useConfirm } from "../../components/Confirm";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  CircleCheck,
  CircleX,
  ExternalLink,
  RefreshCw,
  RotateCcw,
  Save,
  Send,
  Trash2,
} from "lucide-react";
import type {
  HttpError,
  Maintenance,
  SystemSettingKey,
  SystemSettings,
  SystemSettingsUpdate,
  SystemSettingsView,
  UpdateInfo,
} from "@orbyn/core";
import { client } from "../../lib/api";
import { formatDateTime, fromLocalInput, toLocalInput } from "../../lib/format";
import type { TeamActions } from "../teams/TeamDetail";
import { humanizeDuration } from "../status/StatusPage";
import "./ai.css";
import "./system.css";
import { DateField } from "../../components/DateField";

type Report = TeamActions["report"];
type Source = SystemSettingsView["sources"][SystemSettingKey];
type Outcome = { ok: boolean; text: string } | null;

type Props = Pick<TeamActions, "user" | "report"> & {
  /** Lets the app update its maintenance banner right away. */
  onMaintenanceChange?: (m: Maintenance) => void;
};

const APPLY_NOTE =
  "Changes apply to every server within about 10 seconds. No restart needed.";

const errorText = (e: unknown) => {
  const err = e as Error;
  if (err?.name === "TypeError" || err?.name === "TimeoutError")
    return "Couldn't reach the server. Try again.";
  return err?.message || "Something went wrong. Try again.";
};

/**
 * Pending state plus an inline result for one card. A 401 still goes to the
 * planner (which signs out); other errors stay next to the button.
 */
function useAction(report: Report) {
  const [pending, setPending] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>(null);
  const reportRef = useRef(report);
  reportRef.current = report;
  const run = useCallback(async (fn: () => Promise<string | void>) => {
    setPending(true);
    setOutcome(null);
    try {
      const text = await fn();
      if (text) setOutcome({ ok: true, text });
    } catch (e) {
      if ((e as HttpError).status === 401) reportRef.current(e);
      else setOutcome({ ok: false, text: errorText(e) });
    } finally {
      setPending(false);
    }
  }, []);
  return { pending, outcome, setOutcome, run };
}

function OutcomeNote({ outcome }: { outcome: Outcome }) {
  if (!outcome) return null;
  return (
    <p
      className={"ai-test system-outcome " + (outcome.ok ? "ok" : "fail")}
      role={outcome.ok ? "status" : "alert"}
    >
      {outcome.ok ? <CircleCheck size={13} /> : <CircleX size={13} />}
      <span>{outcome.text}</span>
    </p>
  );
}

/** Admin "System" tab: live settings, maintenance mode, version and updates. */
export function AdminSystem({ user, report, onMaintenanceChange }: Props) {
  return (
    <>
      <SettingsCard user={user} report={report} />
      <MaintenanceCard report={report} onChange={onMaintenanceChange} />
      <VersionCard report={report} />
    </>
  );
}

// ---- Settings ----

type Draft = {
  origins: string;
  rateLimit: string;
  lanes: string;
  /** Seconds in the form; milliseconds on the server. */
  interval: string;
  host: string;
  port: string;
  user: string;
  password: string;
  removePassword: boolean;
  secure: boolean;
  from: string;
};

const draftFrom = (s: SystemSettings): Draft => ({
  origins: s.cors_origins.join("\n"),
  rateLimit: String(s.rate_limit_per_minute),
  lanes: String(s.notifier_concurrency),
  interval: String(s.status_interval_ms / 1000),
  host: s.smtp.host,
  port: String(s.smtp.port),
  user: s.smtp.user,
  password: "",
  removePassword: false,
  secure: s.smtp.secure,
  from: s.smtp.from,
});

/** Form fields that belong to each setting, for per-setting resets. */
const KEY_FIELDS: Record<SystemSettingKey, (keyof Draft)[]> = {
  cors_origins: ["origins"],
  rate_limit_per_minute: ["rateLimit"],
  notifier_concurrency: ["lanes"],
  status_interval_ms: ["interval"],
  smtp: [
    "host",
    "port",
    "user",
    "password",
    "removePassword",
    "secure",
    "from",
  ],
};

const LABELS: Record<SystemSettingKey, string> = {
  cors_origins: "Allowed web origins",
  rate_limit_per_minute: "Rate limit",
  notifier_concurrency: "Reminder delivery lanes",
  status_interval_ms: "Status check interval",
  smtp: "Email",
};

const parseOrigins = (text: string) =>
  text
    .split(/[\n,]/)
    .map((o) => o.trim())
    .filter(Boolean);

/**
 * Only what changed, so untouched settings keep following `.env`
 * instead of being saved here.
 */
function changes(d: Draft, s: SystemSettings): SystemSettingsUpdate {
  const body: SystemSettingsUpdate = {};
  const origins = parseOrigins(d.origins);
  if (origins.join("\n") !== s.cors_origins.join("\n"))
    body.cors_origins = origins;
  const rate = Number(d.rateLimit);
  if (rate !== s.rate_limit_per_minute) body.rate_limit_per_minute = rate;
  const lanes = Number(d.lanes);
  if (lanes !== s.notifier_concurrency) body.notifier_concurrency = lanes;
  const interval = Math.round(Number(d.interval) * 1000);
  if (interval !== s.status_interval_ms) body.status_interval_ms = interval;

  const smtp = {
    host: d.host.trim(),
    port: Number(d.port),
    user: d.user.trim(),
    secure: d.secure,
    from: d.from.trim(),
  };
  const password = d.removePassword ? "" : d.password || undefined;
  const smtpChanged =
    smtp.host !== s.smtp.host ||
    smtp.port !== s.smtp.port ||
    smtp.user !== s.smtp.user ||
    smtp.secure !== s.smtp.secure ||
    smtp.from !== s.smtp.from ||
    password !== undefined;
  if (smtpChanged)
    body.smtp = password === undefined ? smtp : { ...smtp, password };
  return body;
}

function SourceTag({ source }: { source: Source }) {
  return (
    <span className={"system-source is-" + source}>
      {source === "database" ? "saved here" : "from .env"}
    </span>
  );
}

/** A setting's label, where its value comes from, and "Reset to .env". */
function SettingHead({
  children,
  source,
  busy,
  onReset,
}: {
  children: ReactNode;
  source: Source;
  busy: boolean;
  onReset: () => void;
}) {
  return (
    <div className="system-field-head">
      {children}
      <SourceTag source={source} />
      {source === "database" && (
        <button
          type="button"
          className="link-button"
          disabled={busy}
          onClick={onReset}
        >
          <RotateCcw size={11} /> Reset to .env
        </button>
      )}
    </div>
  );
}

function NumberField(props: {
  id: string;
  label: string;
  hint: ReactNode;
  value: string;
  min: number;
  max: number;
  source: Source;
  busy: boolean;
  onChange: (value: string) => void;
  onReset: () => void;
}) {
  return (
    <div className="system-field">
      <SettingHead
        source={props.source}
        busy={props.busy}
        onReset={props.onReset}
      >
        <label htmlFor={props.id}>{props.label}</label>
      </SettingHead>
      <input
        id={props.id}
        type="number"
        inputMode="numeric"
        required
        min={props.min}
        max={props.max}
        step={1}
        value={props.value}
        aria-describedby={props.id + "-hint"}
        onChange={(e) => props.onChange(e.target.value)}
      />
      <small id={props.id + "-hint"} className="field-hint">
        {props.hint}
      </small>
    </div>
  );
}

function SettingsCard({ user, report }: Pick<Props, "user" | "report">) {
  const { ask } = useConfirm();
  const [view, setView] = useState<SystemSettingsView | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [testTo, setTestTo] = useState("");
  const save = useAction(report);
  const test = useAction(report);
  const { run } = save;

  const load = useCallback(
    () =>
      void run(async () => {
        const next = await client.getSystemSettings();
        setView(next);
        setDraft(draftFrom(next.settings));
      }),
    [run],
  );
  useEffect(load, [load]);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((d) => d && { ...d, [key]: value });
    save.setOutcome(null);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!draft || !view) return;
    const body = changes(draft, view.settings);
    if (body.cors_origins && !body.cors_origins.length) {
      save.setOutcome({ ok: false, text: "Add at least one web origin." });
      return;
    }
    if (!Object.keys(body).length) {
      save.setOutcome({ ok: true, text: "Nothing to save." });
      return;
    }
    const labels = Object.keys(body).map(
      (key) => LABELS[key as SystemSettingKey],
    );
    if (
      !(await ask({
        title: `Save ${labels.join(", ")} for the whole workspace?`,
        body: APPLY_NOTE,
        confirmLabel: "Save settings",
      }))
    )
      return;
    void save.run(async () => {
      const next = await client.updateSystemSettings(body);
      setView(next);
      setDraft(draftFrom(next.settings));
      return "Saved. " + APPLY_NOTE;
    });
  };

  /** Resets one setting and refreshes only its fields, keeping other edits. */
  const reset = async (key: SystemSettingKey) => {
    if (
      !(await ask({
        title: `Reset ${LABELS[key]} to its .env value for the whole workspace?`,
        confirmLabel: "Reset setting",
      }))
    )
      return;
    void save.run(async () => {
      const next = await client.updateSystemSettings({ reset: [key] });
      setView(next);
      const fresh = draftFrom(next.settings);
      const picked = Object.fromEntries(
        KEY_FIELDS[key].map((f) => [f, fresh[f]]),
      ) as Partial<Draft>;
      setDraft((d) => (d ? { ...d, ...picked } : fresh));
      return `${LABELS[key]} now uses the .env value. ${APPLY_NOTE}`;
    });
  };

  const sendTest = async (e: FormEvent) => {
    e.preventDefault();
    if (
      !(await ask({
        title: `Send a test email to ${testTo.trim() || user?.email || "the configured address"}?`,
        confirmLabel: "Send test",
      }))
    )
      return;
    void test.run(async () => {
      const result = await client.sendTestEmail(testTo.trim() || undefined);
      return `Test email sent to ${result.to}.`;
    });
  };

  const sources = view?.sources;
  const smtp = view?.settings.smtp;
  const busy = save.pending;

  return (
    <section className="card system-card fade-up">
      <div className="section-heading">
        <h2>Settings</h2>
        {view?.updated_at && (
          <small className="muted">
            Last saved {formatDateTime(view.updated_at)}
          </small>
        )}
      </div>
      <p className="muted system-lead">
        Values saved here override the server&apos;s .env. {APPLY_NOTE}
      </p>

      {!draft || !sources || !smtp ? (
        <div className="system-body">
          {busy ? (
            <p className="muted system-loading">Loading settings…</p>
          ) : (
            <>
              <OutcomeNote outcome={save.outcome} />
              <button className="secondary" onClick={load}>
                <RefreshCw size={14} /> Try again
              </button>
            </>
          )}
        </div>
      ) : (
        <>
          <form className="system-form" onSubmit={submit}>
            <div className="system-field system-wide">
              <SettingHead
                source={sources.cors_origins}
                busy={busy}
                onReset={() => reset("cors_origins")}
              >
                <label htmlFor="sys-origins">Allowed web origins</label>
              </SettingHead>
              <textarea
                id="sys-origins"
                rows={3}
                required
                spellCheck={false}
                autoCapitalize="off"
                placeholder="https://planner.example.com"
                value={draft.origins}
                aria-describedby="sys-origins-hint"
                onChange={(e) => set("origins", e.target.value)}
              />
              <small id="sys-origins-hint" className="field-hint">
                One per line. Browsers on other sites can&apos;t call the API.
              </small>
            </div>

            <NumberField
              id="sys-rate"
              label="Rate limit per minute"
              hint="Requests per client, on each server. 0 means the gateway handles it."
              value={draft.rateLimit}
              min={0}
              max={100000}
              source={sources.rate_limit_per_minute}
              busy={busy}
              onChange={(v) => set("rateLimit", v)}
              onReset={() => reset("rate_limit_per_minute")}
            />
            <NumberField
              id="sys-lanes"
              label="Reminder delivery lanes"
              hint="How many reminders each notifier sends at once (1–64)."
              value={draft.lanes}
              min={1}
              max={64}
              source={sources.notifier_concurrency}
              busy={busy}
              onChange={(v) => set("lanes", v)}
              onReset={() => reset("notifier_concurrency")}
            />
            <NumberField
              id="sys-interval"
              label="Status check interval (seconds)"
              hint="How often the status page checks each service (5–3600)."
              value={draft.interval}
              min={5}
              max={3600}
              source={sources.status_interval_ms}
              busy={busy}
              onChange={(v) => set("interval", v)}
              onReset={() => reset("status_interval_ms")}
            />

            <div
              className="system-field system-wide"
              role="group"
              aria-labelledby="sys-smtp-title"
            >
              <SettingHead
                source={sources.smtp}
                busy={busy}
                onReset={() => reset("smtp")}
              >
                <h3 id="sys-smtp-title">Email (SMTP)</h3>
              </SettingHead>
              <small className="field-hint">
                Used for reminders. Leave the host blank to turn email off.
              </small>
              <div className="system-smtp">
                <label>
                  Host
                  <input
                    autoComplete="off"
                    spellCheck={false}
                    maxLength={200}
                    placeholder="smtp.example.com"
                    value={draft.host}
                    onChange={(e) => set("host", e.target.value)}
                  />
                </label>
                <label>
                  Port
                  <input
                    type="number"
                    inputMode="numeric"
                    required
                    min={1}
                    max={65535}
                    value={draft.port}
                    onChange={(e) => set("port", e.target.value)}
                  />
                </label>
                <label>
                  User
                  <input
                    autoComplete="off"
                    spellCheck={false}
                    maxLength={200}
                    value={draft.user}
                    onChange={(e) => set("user", e.target.value)}
                  />
                </label>
                <label>
                  <span className="system-label-row">
                    Password
                    {smtp.has_password && !draft.removePassword && (
                      <span className="system-source is-database">Saved</span>
                    )}
                  </span>
                  <input
                    type="password"
                    autoComplete="new-password"
                    spellCheck={false}
                    maxLength={500}
                    disabled={draft.removePassword}
                    placeholder={
                      smtp.has_password
                        ? "Leave blank to keep the saved password"
                        : "Not set"
                    }
                    value={draft.password}
                    onChange={(e) => set("password", e.target.value)}
                  />
                </label>
                <label className="system-wide">
                  From address
                  <input
                    maxLength={200}
                    spellCheck={false}
                    placeholder="Orbyn <reminders@example.com>"
                    value={draft.from}
                    onChange={(e) => set("from", e.target.value)}
                  />
                </label>
                <label className="system-check system-wide">
                  <input
                    type="checkbox"
                    checked={draft.secure}
                    onChange={(e) => set("secure", e.target.checked)}
                  />
                  <span>
                    Use TLS
                    <small className="field-hint">
                      Usually on for port 465 and off for 587.
                    </small>
                  </span>
                </label>
              </div>
              {smtp.has_password &&
                (draft.removePassword ? (
                  <p className="field-hint field-warning system-remove">
                    The saved password will be removed when you save.{" "}
                    <button
                      type="button"
                      className="link-button"
                      onClick={() => {
                        set("removePassword", false);
                      }}
                    >
                      Keep it
                    </button>
                  </p>
                ) : (
                  <button
                    type="button"
                    className="danger system-remove"
                    disabled={busy}
                    onClick={() => {
                      set("password", "");
                      set("removePassword", true);
                    }}
                  >
                    <Trash2 size={13} /> Remove saved password
                  </button>
                ))}
            </div>

            <div className="system-footer system-wide">
              <button className="primary" disabled={busy}>
                <Save size={14} /> {busy ? "Saving…" : "Save changes"}
              </button>
              <OutcomeNote outcome={save.outcome} />
            </div>
          </form>

          <form className="system-test" onSubmit={sendTest}>
            <label htmlFor="sys-test-to">Send a test email</label>
            <div className="system-test-row">
              <input
                id="sys-test-to"
                type="email"
                autoComplete="off"
                maxLength={254}
                placeholder={user?.email ?? "you@example.com"}
                value={testTo}
                aria-describedby="sys-test-hint"
                onChange={(e) => setTestTo(e.target.value)}
              />
              <button className="secondary" disabled={test.pending}>
                <Send size={13} />{" "}
                {test.pending ? "Sending…" : "Send test email"}
              </button>
            </div>
            <small id="sys-test-hint" className="field-hint">
              Uses the saved settings. Leave blank to send it to yourself.
            </small>
            <OutcomeNote outcome={test.outcome} />
          </form>
        </>
      )}
    </section>
  );
}

// ---- Maintenance ----

function MaintenanceCard({
  report,
  onChange,
}: {
  report: Report;
  onChange?: (m: Maintenance) => void;
}) {
  const { ask, tell } = useConfirm();
  const [state, setState] = useState<Maintenance | null>(null);
  const [message, setMessage] = useState("");
  const [until, setUntil] = useState("");
  const action = useAction(report);
  const { run } = action;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const show = useCallback((m: Maintenance) => {
    setState(m);
    setMessage(m.message);
    setUntil(toLocalInput(m.until));
  }, []);

  const load = useCallback(
    () => void run(async () => show(await client.getMaintenance())),
    [run, show],
  );
  useEffect(load, [load]);

  const apply = async (enabled: boolean) => {
    if (
      !(await ask({
        title: enabled
          ? "Apply maintenance mode settings? Members will be unable to make changes while it is on."
          : "Turn off maintenance mode? Members will be able to make changes again.",
        confirmLabel: "Apply change",
      }))
    )
      return;
    void action.run(async () => {
      const next = await client.setMaintenance({
        enabled,
        message: message.trim(),
        until: fromLocalInput(until),
      });
      show(next);
      onChangeRef.current?.(next);
      if (!enabled) return "Maintenance mode is off.";
      return state?.enabled ? "Saved." : "Maintenance mode is on.";
    });
  };

  const toggle = (enabled: boolean) => void apply(enabled);

  const on = !!state?.enabled;

  return (
    <section className="card system-card fade-up">
      <div className="section-heading">
        <h2>Maintenance</h2>
        {state && (
          <span className={"system-pill " + (on ? "is-warn" : "is-off")}>
            {on ? "On" : "Off"}
          </span>
        )}
      </div>

      {!state ? (
        <div className="system-body">
          {action.pending ? (
            <p className="muted system-loading">Loading…</p>
          ) : (
            <>
              <OutcomeNote outcome={action.outcome} />
              <button className="secondary" onClick={load}>
                <RefreshCw size={14} /> Try again
              </button>
            </>
          )}
        </div>
      ) : (
        <>
          <div className="system-switch-row">
            <label htmlFor="sys-maintenance">
              <strong>Maintenance mode</strong>
              <small>
                Members can view everything but can&apos;t change anything.
                Admins can still work.
                {on && state.updated_at
                  ? ` On since ${formatDateTime(state.updated_at)}.`
                  : ""}
              </small>
            </label>
            <input
              id="sys-maintenance"
              type="checkbox"
              role="switch"
              className="ai-switch"
              checked={on}
              disabled={action.pending}
              onChange={(e) => toggle(e.target.checked)}
            />
          </div>
          <form
            className="system-form"
            onSubmit={(e) => {
              e.preventDefault();
              apply(on);
            }}
          >
            <label className="system-field system-wide system-label">
              Message
              <textarea
                rows={2}
                maxLength={500}
                placeholder="We're upgrading the database. Back soon."
                value={message}
                onChange={(e) => {
                  setMessage(e.target.value);
                  action.setOutcome(null);
                }}
              />
              <small className="field-hint">
                Shown in the apps and on the status page.
              </small>
            </label>
            <label className="system-field system-label">
              Expected back (optional)
              <DateField
                type="datetime-local"
                value={until}
                onChange={(e) => {
                  setUntil(e.target.value);
                  action.setOutcome(null);
                }}
              />
              {until && (
                <button
                  type="button"
                  className="link-button system-clear"
                  onClick={() => setUntil("")}
                >
                  Clear
                </button>
              )}
            </label>
            <div className="system-footer system-wide">
              {on ? (
                <button className="primary" disabled={action.pending}>
                  <Save size={14} /> Save message
                </button>
              ) : (
                <small className="field-hint">
                  The message and time are shown when you turn maintenance on.
                </small>
              )}
              <OutcomeNote outcome={action.outcome} />
            </div>
          </form>
        </>
      )}
    </section>
  );
}

// ---- Version and updates ----

const firstLine = (text: string) => text.split("\n")[0].trim();

function VersionCard({ report }: { report: Report }) {
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const action = useAction(report);
  const { run } = action;

  const check = useCallback(
    () =>
      void run(async () => {
        setInfo(await client.getUpdates());
      }),
    [run],
  );
  useEffect(check, [check]);

  const latest = info?.latest;

  return (
    <section className="card system-card fade-up">
      <div className="section-heading">
        <h2>Version and updates</h2>
        <button className="secondary" disabled={action.pending} onClick={check}>
          <RefreshCw size={14} /> {action.pending ? "Checking…" : "Check again"}
        </button>
      </div>

      {info && (
        <>
          <dl className="ai-facts">
            <div>
              <dt>Running version</dt>
              <dd>
                <code>{info.current.version}</code>
              </dd>
            </div>
            <div>
              <dt>Built</dt>
              <dd>
                {info.current.built_at
                  ? formatDateTime(info.current.built_at)
                  : "Unknown"}
              </dd>
            </div>
            <div>
              <dt>Running for</dt>
              <dd>{humanizeDuration(info.current.uptime_s)}</dd>
            </div>
          </dl>

          <div className="system-body">
            <h3 className="system-subtitle">Latest on GitHub</h3>
            {!info.checks_enabled ? (
              <p className="muted system-note">
                Update checks are off. Set <code>UPDATE_REPO</code> (like
                owner/repo) on the server to turn them on. Private repositories
                also need <code>GITHUB_TOKEN</code>.
              </p>
            ) : (
              <>
                {info.error && (
                  <p className="ai-test fail system-outcome" role="status">
                    <CircleX size={13} />
                    <span>Couldn&apos;t check GitHub: {info.error}</span>
                  </p>
                )}
                {latest ? (
                  <div className="system-commit">
                    <div className="system-commit-head">
                      <span
                        className={
                          "system-pill " +
                          (info.available ? "is-warn" : "is-ok")
                        }
                      >
                        {info.available ? "Update available" : "Up to date"}
                      </span>
                      <code>{latest.version}</code>
                    </div>
                    <p>{firstLine(latest.message) || "No commit message"}</p>
                    <small>
                      <time dateTime={latest.date}>
                        {formatDateTime(latest.date)}
                      </time>
                      <a
                        className="text-button"
                        href={latest.url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        View commit <ExternalLink size={12} />
                      </a>
                    </small>
                  </div>
                ) : (
                  !info.error && (
                    <p className="muted system-note">No commits found yet.</p>
                  )
                )}
              </>
            )}
            {info.deploy_url && (
              <a
                className="primary system-deploy"
                href={info.deploy_url}
                target="_blank"
                rel="noreferrer"
              >
                Deploy from GitHub Actions <ExternalLink size={13} />
              </a>
            )}
          </div>
        </>
      )}

      <div className="system-body">
        {!info && action.pending && (
          <p className="muted system-loading">Checking…</p>
        )}
        <OutcomeNote outcome={action.outcome} />
      </div>
    </section>
  );
}
