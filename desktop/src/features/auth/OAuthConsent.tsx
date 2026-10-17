import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Globe,
  KeyRound,
  Laptop,
  Orbit,
  ShieldCheck,
} from "lucide-react";
import { startAuthentication } from "@simplewebauthn/browser";
import {
  AGENT_ACCESS,
  AGENT_ACCESS_LABELS,
  AGENT_GRANT_DAY_CHOICES,
  AGENT_HIDE_OUTSIDE_TEXT,
  AGENT_TOOLSETS,
  AGENT_TOOLSET_LABELS,
  HttpError,
  durationText,
  type AgentAccess,
  type AgentToolset,
  type OAuthCheck,
  type OAuthRequest,
  type OAuthTeamChoice,
  type User,
} from "@orbyn/core";
import { client } from "../../lib/api";
import { errorText } from "../../lib/errors";
import { session } from "../../lib/session";
import "./oauth.css";

/**
 * The page an app sends you to when it signs in with Orbyn
 * (/oauth/authorize?client_id=…): who is asking, what it may do and where,
 * and for how long. Signed out, it shows who's asking and a sign-in (every
 * parameter stays in the address, through two-step and passkeys). Write
 * access and bookings need your password or passkey within ten minutes.
 * A request that doesn't check out is shown here and never sent anywhere.
 * The page refuses to work inside a frame.
 */

/** Optional toolsets offered on the page (core is always on; bookings is its own switch). */
const OPTIONAL_TOOLSETS = AGENT_TOOLSETS.filter(
  (t) => t !== "core" && t !== "booking",
) as AgentToolset[];

/** The request's parameters, from the address. */
export function oauthRequestFrom(search: string): OAuthRequest {
  const q = new URLSearchParams(search);
  const get = (k: string) => q.get(k) ?? undefined;
  return {
    response_type: get("response_type") ?? "",
    client_id: get("client_id") ?? "",
    redirect_uri: get("redirect_uri") ?? "",
    code_challenge: get("code_challenge"),
    code_challenge_method: get("code_challenge_method"),
    state: get("state"),
    scope: get("scope"),
    resource: get("resource"),
  };
}

const RETURN_KEY = "orbyn-oauth-return";

/** Remember this sign-in request for this tab (in case sign-in leaves the page). */
export function rememberOAuthReturn() {
  try {
    sessionStorage.setItem(RETURN_KEY, location.pathname + location.search);
  } catch {
    // Storage can be off; the address still carries every parameter.
  }
}

/** A sign-in request waiting since before signing in, once; null when none. */
export function takeOAuthReturn(): string | null {
  try {
    const kept = sessionStorage.getItem(RETURN_KEY);
    sessionStorage.removeItem(RETURN_KEY);
    return kept?.startsWith("/oauth/authorize?") ? kept : null;
  } catch {
    return null;
  }
}

/** Whether this page is shown inside another site's frame. */
const framed = () => {
  try {
    return window.top !== window.self;
  } catch {
    return true;
  }
};

/** The single card every state of the page uses. */
function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="auth-page oauth-page">
      <main className="auth-form">
        <div className="oauth-card">
          <div className="brand">
            <Orbit />{" "}
            <span className="brand-name">
              orbyn
              <span className="brand-dot" aria-hidden="true">
                •
              </span>
            </span>
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}

/** Who is asking: the app's name, the website it comes from, where it sends you back. */
function WhoAsks({ check }: { check: OAuthCheck }) {
  const c = check.client;
  return (
    <div className="oauth-app">
      <div className="oauth-app-line">
        <Globe size={16} aria-hidden="true" />
        <span>
          <strong>{c.name}</strong> <span className="muted">from {c.host}</span>
        </span>
      </div>
      {!c.verified && (
        <p className="oauth-warn">
          <AlertTriangle size={14} aria-hidden="true" /> This app registered
          itself. Orbyn can't verify who made it. Continue only if you trust the
          app and started this connection.
        </p>
      )}
      <div className="oauth-app-line muted">
        {c.redirect_local ? (
          <Laptop size={15} aria-hidden="true" />
        ) : (
          <ArrowRight size={15} aria-hidden="true" />
        )}
        <span>Sends you back to {c.redirect_host}</span>
      </div>
      {check.resource && (
        <div className="oauth-app-line muted">
          <span className="oauth-resource">
            {check.resource.kind === "plugin"
              ? "Plugin integration"
              : "Portable MCP connection"}
            {" · "}
            {check.resource.url}
          </span>
        </div>
      )}
      {c.redirect_local && (
        <p className="oauth-warn">
          <AlertTriangle size={14} aria-hidden="true" /> It returns you to an
          app on this device. Continue only if you just started connecting from
          that app.
        </p>
      )}
    </div>
  );
}

/** A team's note on the page: why it can't be chosen, or what caps it. */
function teamNote(t: OAuthTeamChoice): string | null {
  if (t.agent_access === "off") return "Its owners turned outside agents off";
  if (t.role === "viewer") return "Read only: you’re a viewer";
  if (t.agent_access === "read") return "Read only, set by its owners";
  if (t.agent_access === "suggest")
    return "Changes wait for review, set by its owners";
  return null;
}

type Props = {
  signedIn: boolean;
  user: User | null;
  /** Sign in (or create an account) with a note of who's asking above it. */
  signIn: (notice: ReactNode) => ReactNode;
  onSwitchAccount: () => void;
};

export function OAuthConsentPage({
  signedIn,
  user,
  signIn,
  onSwitchAccount,
}: Props) {
  const search = location.search;
  const request = useMemo(() => oauthRequestFrom(search), [search]);
  const readKey = JSON.stringify([search, signedIn, user?.id, session.get()]);
  const [checkedFor, setCheckedFor] = useState("");
  const [check, setCheck] = useState<OAuthCheck | null>(null);
  const [problem, setProblem] = useState("");
  const isFramed = framed();

  useEffect(() => {
    if (isFramed) return;
    let alive = true;
    setProblem("");
    setCheck(null);
    client.oauthCheck(request).then(
      (c) => {
        if (alive) {
          setCheck(c);
          setCheckedFor(readKey);
        }
      },
      (e) => {
        if (alive) {
          setProblem(errorText(e));
          setCheckedFor(readKey);
        }
      },
    );
    return () => {
      alive = false;
    };
  }, [request, readKey, isFramed]);

  useEffect(() => {
    // Signed out: kept for this tab, in case signing in leaves the page (a
    // reset link). Signed in: this is the page, so nothing is waiting.
    if (!signedIn) rememberOAuthReturn();
    else takeOAuthReturn();
  }, [signedIn]);

  if (isFramed)
    return (
      <Shell>
        <h2>Open this in its own window</h2>
        <p className="muted">
          For your safety, connecting an app to Orbyn can’t happen inside
          another website.
        </p>
      </Shell>
    );

  if (problem && checkedFor === readKey)
    return (
      <Shell>
        <span className="eyebrow">CONNECT AN APP</span>
        <h2>This sign-in can’t go ahead</h2>
        <p role="alert" className="oauth-problem">
          {problem}
        </p>
        <p className="muted">Close this page and start again from the app.</p>
      </Shell>
    );

  if (!check || checkedFor !== readKey)
    return (
      <Shell>
        <p className="muted">Checking the app…</p>
      </Shell>
    );

  if (!signedIn || !check.account)
    return (
      <>
        {signIn(
          <div className="oauth-signin-note">
            <span className="eyebrow">CONNECT AN APP</span>
            <p>
              <strong>{check.client.name}</strong> ({check.client.host}) wants
              to connect to your Orbyn. Sign in first, then choose what it may
              do.
            </p>
          </div>,
        )}
      </>
    );

  return (
    <Consent
      key={readKey}
      request={request}
      check={check}
      account={check.account}
      onSwitchAccount={onSwitchAccount}
      onReauthed={(until) =>
        setCheck((c) =>
          c && c.account
            ? { ...c, account: { ...c.account, reauth_until: until } }
            : c,
        )
      }
    />
  );
}

/** A short-lived authorization is a decision-relevant exception, not routine help. */
function ConnectionLifetime({
  check,
  renewable,
}: {
  check: OAuthCheck;
  renewable?: boolean;
}) {
  const seconds = check.access_token_lifetime_seconds;
  if (
    (renewable ?? check.requested_offline_access) !== false ||
    typeof seconds !== "number" ||
    !Number.isFinite(seconds) ||
    seconds <= 0
  )
    return null;
  return (
    <p className="oauth-hint muted" role="status">
      Sign-in lasts up to {durationText(Math.ceil(seconds / 60))}. Reconnect
      from the app when it expires.
    </p>
  );
}

function Consent({
  request,
  check,
  account,
  onSwitchAccount,
  onReauthed,
}: {
  request: OAuthRequest;
  check: OAuthCheck;
  account: NonNullable<OAuthCheck["account"]>;
  onSwitchAccount: () => void;
  onReauthed: (until: string) => void;
}) {
  const existing = account.existing;
  const [stayConnected, setStayConnected] = useState(
    check.can_stay_connected === true,
  );
  // What the app asked for (read when it named no scope), never more: a
  // wider choice is the person's to make.
  const [access, setAccess] = useState<AgentAccess>(
    existing?.access ?? check.requested_access,
  );
  const [personal, setPersonal] = useState(existing?.personal ?? true);
  const usable = account.teams.filter((t) => t.agent_access !== "off");
  const [teamSearch, setTeamSearch] = useState("");
  const matchingTeams = account.teams.filter((team) =>
    team.name
      .toLocaleLowerCase()
      .includes(teamSearch.trim().toLocaleLowerCase()),
  );
  const [teamIds, setTeamIds] = useState<string[]>(
    existing?.team_ids?.filter((id) => usable.some((t) => t.id === id)) ?? [],
  );
  const [toolsets, setToolsets] = useState<AgentToolset[]>(
    existing?.toolsets.filter((t) => OPTIONAL_TOOLSETS.includes(t)) ?? [],
  );
  const [bookings, setBookings] = useState(
    existing?.toolsets.includes("booking") ?? check.requested_bookings,
  );
  const [notify, setNotify] = useState(false);
  const [hideOutside, setHideOutside] = useState(
    existing?.hide_outside_content ?? false,
  );
  const dayChoices = AGENT_GRANT_DAY_CHOICES.filter(
    (d) => d <= account.max_grant_days,
  );
  const [days, setDays] = useState<number>(
    dayChoices.includes(90) ? 90 : (dayChoices.at(-1) ?? 30),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [needCode, setNeedCode] = useState(false);

  const fresh =
    !!account.reauth_until &&
    new Date(account.reauth_until).getTime() > Date.now();
  const needsReauth = (access === "write" || bookings) && !fresh;

  const owner = session.get();
  const mounted = useRef(true);
  const pending = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const current = () => mounted.current && session.get() === owner;
  const run = async (fn: () => Promise<void>) => {
    if (pending.current || !current()) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      if (!current()) return;
      if (e instanceof HttpError && e.message === "totp_required") {
        setNeedCode(true);
        setError("Enter your authenticator code too.");
      } else if (e instanceof HttpError && e.message === "reauth_required")
        setError("Confirm it’s you below, then allow.");
      else setError(errorText(e));
    } finally {
      pending.current = false;
      if (current()) setBusy(false);
    }
  };
  const allow = () =>
    run(async () => {
      if (!personal && !teamIds.length) {
        setError("Choose Personal or at least one team.");
        return;
      }
      const { redirect_to } = await client.oauthAllow({
        request,
        ...(check.can_stay_connected ? { stay_connected: stayConnected } : {}),
        access,
        personal,
        team_ids: teamIds,
        toolsets,
        bookings,
        notify_teammates: notify,
        hide_outside_content: hideOutside,
        expires_in_days: days,
      });
      if (current()) window.location.assign(redirect_to);
    });
  const deny = () =>
    run(async () => {
      const { redirect_to } = await client.oauthDeny(request);
      if (current()) window.location.assign(redirect_to);
    });
  const confirmPassword = () =>
    run(async () => {
      const r = await client.reauth({
        password,
        ...(code.trim() ? { code: code.trim() } : {}),
      });
      if (!current()) return;
      setPassword("");
      setCode("");
      setNeedCode(false);
      onReauthed(r.reauth_until);
    });
  const confirmPasskey = () =>
    run(async () => {
      const { handle, options } = await client.reauthOptions();
      if (!current()) return;
      const response = await startAuthentication({
        optionsJSON: options as Parameters<
          typeof startAuthentication
        >[0]["optionsJSON"],
      });
      if (!current()) return;
      const r = await client.reauth({
        handle,
        response: response as unknown as Record<string, unknown>,
      });
      if (current()) onReauthed(r.reauth_until);
    });

  const toggleTeam = (id: string, on: boolean) =>
    setTeamIds((ids) => (on ? [...ids, id] : ids.filter((x) => x !== id)));

  return (
    <Shell>
      <span className="eyebrow">CONNECT AN APP</span>
      <h2>Connect {check.client.name}</h2>
      <WhoAsks check={check} />
      <p className="oauth-account muted">
        Signed in as <strong>{account.name}</strong> ({account.email}).{" "}
        <button
          type="button"
          className="link-button"
          disabled={busy}
          onClick={onSwitchAccount}
        >
          Switch account
        </button>
      </p>
      {existing && (
        <p className="oauth-existing">
          This replaces the permissions for your existing {check.client.name}{" "}
          connection.
        </p>
      )}

      <ConnectionLifetime
        check={check}
        renewable={check.can_stay_connected ? stayConnected : undefined}
      />

      <fieldset className="oauth-group" disabled={busy}>
        <legend>What it may do</legend>
        <p className="oauth-hint muted">
          {check.client.name} asked to{" "}
          {check.requested_access === "write"
            ? "see and change your things"
            : check.requested_access === "suggest"
              ? "see your things and suggest changes"
              : "see your things"}
          .
        </p>
        {AGENT_ACCESS.map((a) => (
          <label
            key={a}
            className={"oauth-choice" + (access === a ? " is-on" : "")}
          >
            <input
              type="radio"
              name="oauth-access"
              value={a}
              checked={access === a}
              onChange={() => setAccess(a)}
            />
            <span>
              <strong>{AGENT_ACCESS_LABELS[a].name}</strong>
              <small>
                {a === "write"
                  ? "Can change and delete your items (30 days to undo). Teammates’ work, invitations, publishing and batches over 50 changes need your approval."
                  : AGENT_ACCESS_LABELS[a].blurb}
              </small>
            </span>
          </label>
        ))}
      </fieldset>

      <fieldset className="oauth-group" disabled={busy}>
        <legend>In these spaces</legend>
        <label className="oauth-check">
          <input
            type="checkbox"
            checked={personal}
            onChange={(e) => setPersonal(e.target.checked)}
          />
          <span>Personal</span>
        </label>
        {account.teams.length > 6 && (
          <label className="oauth-team-search">
            Find a team
            <input
              type="search"
              value={teamSearch}
              onChange={(e) => setTeamSearch(e.target.value)}
            />
          </label>
        )}
        {account.teams.length > 0 && (
          <p className="muted oauth-hint">{teamIds.length} teams selected</p>
        )}
        <div className="oauth-teams">
          {matchingTeams.map((t) => {
            const note = teamNote(t);
            const off = t.agent_access === "off";
            return (
              <label
                key={t.id}
                className={"oauth-check" + (off ? " is-off" : "")}
              >
                <input
                  type="checkbox"
                  disabled={off}
                  checked={!off && teamIds.includes(t.id)}
                  onChange={(e) => toggleTeam(t.id, e.target.checked)}
                />
                <span>
                  {t.name} <span className="muted">· {t.role}</span>
                  {note && <small>{note}</small>}
                </span>
              </label>
            );
          })}
          {account.teams.length > 0 && !matchingTeams.length && (
            <p className="muted">No matching teams. Change your search.</p>
          )}
        </div>
      </fieldset>

      <fieldset className="oauth-group" disabled={busy}>
        <legend>Also let it use</legend>
        <p className="muted oauth-hint">
          {AGENT_TOOLSET_LABELS.core.name} are always on.
        </p>
        {OPTIONAL_TOOLSETS.map((t) => (
          <label key={t} className="oauth-check">
            <input
              type="checkbox"
              checked={toolsets.includes(t)}
              onChange={(e) =>
                setToolsets((all) =>
                  e.target.checked ? [...all, t] : all.filter((x) => x !== t),
                )
              }
            />
            <span>
              {AGENT_TOOLSET_LABELS[t].name}
              <small>{AGENT_TOOLSET_LABELS[t].blurb}</small>
            </span>
          </label>
        ))}
        <label className="oauth-switch">
          <input
            type="checkbox"
            role="switch"
            className="ai-switch"
            checked={bookings}
            onChange={(e) => setBookings(e.target.checked)}
          />
          <span>
            {AGENT_TOOLSET_LABELS.booking.name}
            <small>{AGENT_TOOLSET_LABELS.booking.blurb}</small>
          </span>
        </label>
      </fieldset>

      <fieldset className="oauth-group" disabled={busy}>
        <legend>Choices</legend>
        <label className="oauth-switch">
          <input
            type="checkbox"
            role="switch"
            className="ai-switch"
            checked={notify}
            onChange={(e) => setNotify(e.target.checked)}
          />
          <span>
            Let it notify teammates
            <small>
              Off: anything that would tell teammates waits for your review.
            </small>
          </span>
        </label>
        <label className="oauth-switch">
          <input
            type="checkbox"
            role="switch"
            className="ai-switch"
            checked={hideOutside}
            onChange={(e) => setHideOutside(e.target.checked)}
          />
          <span>
            Hide outside content
            <small>{AGENT_HIDE_OUTSIDE_TEXT}</small>
          </span>
        </label>
        {check.can_stay_connected && (
          <label className="oauth-check">
            <input
              type="checkbox"
              checked={stayConnected}
              onChange={(event) => setStayConnected(event.target.checked)}
            />
            <span>
              Stay connected
              <small>
                Allow automatic renewal. Disconnect this app at any time in
                Settings.
              </small>
            </span>
          </label>
        )}
        <div
          className="oauth-days"
          role="radiogroup"
          aria-label="Lasts"
          onKeyDown={(event) => {
            if (
              ![
                "ArrowLeft",
                "ArrowRight",
                "ArrowUp",
                "ArrowDown",
                "Home",
                "End",
              ].includes(event.key)
            )
              return;
            const buttons = Array.from(
              event.currentTarget.querySelectorAll<HTMLButtonElement>(
                'button[role="radio"]:not(:disabled)',
              ),
            );
            if (!buttons.length) return;
            const index = buttons.indexOf(event.target as HTMLButtonElement);
            if (index < 0) return;
            event.preventDefault();
            const next =
              event.key === "Home"
                ? 0
                : event.key === "End"
                  ? buttons.length - 1
                  : (index +
                      (["ArrowLeft", "ArrowUp"].includes(event.key) ? -1 : 1) +
                      buttons.length) %
                    buttons.length;
            buttons[next].click();
            buttons[next].focus();
          }}
        >
          <span>Lasts</span>
          {dayChoices.map((d) => (
            <button
              key={d}
              type="button"
              role="radio"
              aria-checked={days === d}
              tabIndex={days === d ? 0 : -1}
              className={"oauth-chip" + (days === d ? " is-on" : "")}
              onClick={() => setDays(d)}
            >
              {d === 365 ? "A year" : `${d} days`}
            </button>
          ))}
        </div>
      </fieldset>

      {needsReauth && (
        <div className="oauth-reauth">
          <p>
            <ShieldCheck size={15} aria-hidden="true" />{" "}
            {access === "write"
              ? "Letting an app change things needs you to confirm it’s you."
              : "Sharing your guests’ details needs you to confirm it’s you."}
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void confirmPassword();
            }}
          >
            <input
              type="password"
              autoComplete="current-password"
              placeholder="Your password"
              aria-label="Your password"
              disabled={busy}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              maxLength={128}
            />
            {(needCode || account.two_factor) && (
              <input
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="Authenticator code"
                aria-label="Authenticator code"
                disabled={busy}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                maxLength={20}
              />
            )}
            <div className="oauth-reauth-acts">
              <button
                className="secondary"
                disabled={busy || !password}
                type="submit"
              >
                Confirm
              </button>
              {account.passkeys > 0 && (
                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  onClick={() => void confirmPasskey()}
                >
                  <KeyRound size={14} /> Use a passkey
                </button>
              )}
            </div>
          </form>
        </div>
      )}

      {error && (
        <div role="alert" className="error">
          {error}
        </div>
      )}
      <div className="oauth-acts">
        <button
          type="button"
          className="primary"
          disabled={busy || needsReauth}
          onClick={() => void allow()}
        >
          Allow <ArrowRight size={16} />
        </button>
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={() => void deny()}
        >
          Cancel
        </button>
      </div>
      <p className="muted oauth-foot">
        We'll email you a confirmation. Manage access in Settings → Connected
        agents.
      </p>
    </Shell>
  );
}
