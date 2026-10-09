import { useEffect, useMemo, useState, type ReactNode } from "react";
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
  type AgentAccess,
  type AgentToolset,
  type OAuthCheck,
  type OAuthRequest,
  type OAuthTeamChoice,
  type User,
} from "@orbyn/core";
import { client } from "../../lib/api";
import { errorText } from "../../lib/errors";
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
        <div className="oauth-card fade-up motion-slow">
          <div className="brand">
            <Orbit /> orbyn<span>•</span>
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
  const request = useMemo(() => oauthRequestFrom(location.search), []);
  const [check, setCheck] = useState<OAuthCheck | null>(null);
  const [problem, setProblem] = useState("");
  const isFramed = framed();

  useEffect(() => {
    if (isFramed) return;
    let alive = true;
    setProblem("");
    client.oauthCheck(request).then(
      (c) => alive && setCheck(c),
      (e) => alive && setProblem(errorText(e)),
    );
    return () => {
      alive = false;
    };
  }, [request, signedIn, user?.id, isFramed]);

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

  if (problem)
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

  if (!check)
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
  // What the app asked for (read when it named no scope), never more: a
  // wider choice is the person's to make.
  const [access, setAccess] = useState<AgentAccess>(
    existing?.access ?? check.requested_access,
  );
  const [personal, setPersonal] = useState(existing?.personal ?? true);
  const usable = account.teams.filter((t) => t.agent_access !== "off");
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

  const go = (to: string) => window.location.assign(to);

  const allow = async () => {
    if (!personal && !teamIds.length) {
      setError("Choose at least one space: Personal or a team.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const { redirect_to } = await client.oauthAllow({
        request,
        access,
        personal,
        team_ids: teamIds,
        toolsets,
        bookings,
        notify_teammates: notify,
        hide_outside_content: hideOutside,
        expires_in_days: days,
      });
      go(redirect_to);
    } catch (e) {
      if (e instanceof HttpError && e.message === "reauth_required")
        setError("Confirm it’s you first (below), then allow.");
      else setError(errorText(e));
      setBusy(false);
    }
  };

  const deny = async () => {
    setBusy(true);
    try {
      const { redirect_to } = await client.oauthDeny(request);
      go(redirect_to);
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };

  const confirmPassword = async () => {
    setBusy(true);
    setError("");
    try {
      const r = await client.reauth({
        password,
        ...(code.trim() ? { code: code.trim() } : {}),
      });
      setPassword("");
      setCode("");
      setNeedCode(false);
      onReauthed(r.reauth_until);
    } catch (e) {
      if (e instanceof HttpError && e.message === "totp_required") {
        setNeedCode(true);
        setError("Enter the code from your authenticator app too.");
      } else setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const confirmPasskey = async () => {
    setBusy(true);
    setError("");
    try {
      const { handle, options } = await client.reauthOptions();
      const response = await startAuthentication({
        optionsJSON: options as Parameters<
          typeof startAuthentication
        >[0]["optionsJSON"],
      });
      const r = await client.reauth({
        handle,
        response: response as unknown as Record<string, unknown>,
      });
      onReauthed(r.reauth_until);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const toggleTeam = (id: string, on: boolean) =>
    setTeamIds((ids) => (on ? [...ids, id] : ids.filter((x) => x !== id)));

  return (
    <Shell>
      <span className="eyebrow">CONNECT AN APP</span>
      <h2>{check.client.name} wants to use your Orbyn</h2>
      <WhoAsks check={check} />
      <p className="oauth-account muted">
        Signed in as <strong>{account.name}</strong> ({account.email}).{" "}
        <button type="button" className="link-button" onClick={onSwitchAccount}>
          Not you? Switch account
        </button>
      </p>
      {existing && (
        <p className="oauth-existing">
          You’ve connected {check.client.name} before. Allowing again replaces
          its choices with these.
        </p>
      )}

      <fieldset className="oauth-group">
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
                  ? "Full power: it works for you directly, deletes of your own things included (30 days to undo). It asks you first about a teammate’s work, inviting people, publishing and more than 50 changes at once. Change this any time in Settings → Connected agents."
                  : AGENT_ACCESS_LABELS[a].blurb}
              </small>
            </span>
          </label>
        ))}
      </fieldset>

      <fieldset className="oauth-group">
        <legend>In these spaces</legend>
        <label className="oauth-check">
          <input
            type="checkbox"
            checked={personal}
            onChange={(e) => setPersonal(e.target.checked)}
          />
          <span>Personal</span>
        </label>
        {account.teams.map((t) => {
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
      </fieldset>

      <fieldset className="oauth-group">
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

      <fieldset className="oauth-group">
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
        <div className="oauth-days" role="radiogroup" aria-label="Lasts">
          <span>Lasts</span>
          {dayChoices.map((d) => (
            <button
              key={d}
              type="button"
              role="radio"
              aria-checked={days === d}
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
        We'll email you about this connection. Manage it in Settings → Connected
        agents.
      </p>
    </Shell>
  );
}
