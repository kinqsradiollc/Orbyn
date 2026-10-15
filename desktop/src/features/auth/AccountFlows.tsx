import { useEffect, useRef, useState } from "react";
import { ArrowRight, MailCheck, Orbit } from "lucide-react";
import type { AuthResponse } from "@orbyn/core";
import { session } from "../../lib/session";
import { client } from "../../lib/api";
import { errorText } from "../../lib/planning";

/** Serialize an account form and keep its receipts with the initiating session/link. */
function useAccountRequest(scope = "") {
  const owner = session.get();
  const latest = useRef({ owner, scope });
  latest.current = { owner, scope };
  const mounted = useRef(true);
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    setError("");
    setBusy(false);
  }, [owner, scope]);
  const run = async (fn: (current: () => boolean) => Promise<void>) => {
    const current = () =>
      mounted.current &&
      session.get() === owner &&
      latest.current.owner === owner &&
      latest.current.scope === scope;
    if (pending.current || !current()) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      await fn(current);
    } catch (e) {
      if (current()) setError(errorText(e));
    } finally {
      pending.current = false;
      if (current()) setBusy(false);
    }
  };
  return { busy, error, run };
}

/** The plain single-card layout the account-flow pages share with sign-in. */
export function AuthShell({
  onHome,
  children,
}: {
  onHome?: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="auth-page">
      {onHome && (
        <button className="text-button auth-home-link" onClick={onHome}>
          ← Back to Orbyn
        </button>
      )}
      <main className="auth-form">
        <div className="auth-card">
          <div className="brand">
            <Orbit /> orbyn<span>•</span>
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}

/** Ask for a password-reset link. Always shows the same confirmation. */
export function ForgotPasswordPage({
  onNavigate,
  onHome,
}: {
  onNavigate: (path: string) => void;
  onHome?: () => void;
}) {
  const { busy, error, run } = useAccountRequest();
  const [sent, setSent] = useState(false);

  const submit = (email: string) =>
    run(async (current) => {
      await client.forgotPassword(email);
      if (current()) setSent(true);
    });

  return (
    <AuthShell onHome={onHome}>
      {sent ? (
        <>
          <h2>Check your inbox.</h2>
          <p>
            If that account exists, we'll send a reset link valid for one hour.
          </p>
          <button className="text-button" onClick={() => onNavigate("/login")}>
            Back to sign in
          </button>
        </>
      ) : (
        <>
          <h2>Reset your password</h2>
          <p>We'll email you a reset link.</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const email = new FormData(e.currentTarget).get(
                "email",
              ) as string;
              void submit(email);
            }}
          >
            <label>
              Email address
              <input
                disabled={busy}
                name="email"
                type="email"
                required
                autoComplete="email"
                placeholder="you@example.com"
              />
            </label>
            {error && (
              <div role="alert" className="error">
                {error}
              </div>
            )}
            <button className="primary wide" disabled={busy}>
              {busy ? "One moment…" : "Send the link"}
              <ArrowRight size={17} />
            </button>
          </form>
          <button className="text-button" onClick={() => onNavigate("/login")}>
            Back to sign in
          </button>
        </>
      )}
    </AuthShell>
  );
}

/** Set a new password from a reset link, then sign in. */
export function ResetPasswordPage({
  token,
  onAuthed,
  onNavigate,
  onHome,
}: {
  token: string;
  onAuthed: (result: AuthResponse) => void;
  onNavigate: (path: string) => void;
  onHome?: () => void;
}) {
  const { busy, error, run } = useAccountRequest(token);

  if (!token)
    return (
      <AuthShell onHome={onHome}>
        <span className="eyebrow">RESET PASSWORD</span>
        <h2>This link is incomplete.</h2>
        <p>Open the link from your email again, or ask for a new one.</p>
        <button
          className="text-button"
          onClick={() => onNavigate("/forgot-password")}
        >
          Send a new link
        </button>
      </AuthShell>
    );

  const submit = (password: string) =>
    run(async (current) => {
      const result = await client.resetPassword(token, password);
      if (current()) onAuthed(result);
    });

  return (
    <AuthShell onHome={onHome}>
      <h2>Set a new password</h2>
      <p>You'll be signed in after saving.</p>
      <form
        key={token}
        onSubmit={(e) => {
          e.preventDefault();
          const password = new FormData(e.currentTarget).get(
            "password",
          ) as string;
          void submit(password);
        }}
      >
        <label>
          New password
          <input
            disabled={busy}
            name="password"
            type="password"
            minLength={10}
            maxLength={128}
            required
            autoComplete="new-password"
            placeholder="At least 10 characters"
          />
        </label>
        {error && (
          <div role="alert" className="error">
            {error}
          </div>
        )}
        <button className="primary wide" disabled={busy}>
          {busy ? "One moment…" : "Set password and sign in"}
          <ArrowRight size={17} />
        </button>
      </form>
    </AuthShell>
  );
}

type VerifyState = "verifying" | "done" | "error";

/** Confirm an email address from a verification link. */
export function VerifyEmailPage({
  token,
  signedIn,
  onVerified,
  onNavigate,
  onHome,
}: {
  token: string;
  signedIn: boolean;
  onVerified: () => void;
  onNavigate: (path: string) => void;
  onHome?: () => void;
}) {
  const [state, setState] = useState<VerifyState>(
    token ? "verifying" : "error",
  );
  const [error, setError] = useState(token ? "" : "This link is incomplete.");
  const [checkedToken, setCheckedToken] = useState(token);
  const verified = useRef(onVerified);
  verified.current = onVerified;

  useEffect(() => {
    setCheckedToken(token);
    setState(token ? "verifying" : "error");
    setError(token ? "" : "This link is incomplete.");
    if (!token) return;
    let alive = true;
    client
      .verifyEmail(token)
      .then(() => {
        if (!alive) return;
        setState("done");
        // Already in the app in this browser: pick up the confirmed state.
        if (signedIn) verified.current();
      })
      .catch((e) => {
        if (!alive) return;
        setState("error");
        setError(errorText(e));
      });
    return () => {
      alive = false;
    };
  }, [token, signedIn]);

  return (
    <AuthShell onHome={onHome}>
      {(checkedToken !== token || state === "verifying") && (
        <>
          <h2>Confirming your email…</h2>
        </>
      )}
      {checkedToken === token && state === "done" && (
        <>
          <h2>Email confirmed</h2>
          <button
            className="primary wide"
            onClick={() => onNavigate(signedIn ? "/app" : "/login")}
          >
            {signedIn ? "Go to Orbyn" : "Sign in"}
            <ArrowRight size={17} />
          </button>
        </>
      )}
      {checkedToken === token && state === "error" && (
        <>
          <h2>This link didn't work.</h2>
          <p>
            {error} You can ask for a new confirmation email after signing in.
          </p>
          <button className="primary wide" onClick={() => onNavigate("/login")}>
            Sign in
            <ArrowRight size={17} />
          </button>
        </>
      )}
    </AuthShell>
  );
}

/** Shown to a signed-in user who hasn't confirmed their email yet. */
export function VerifyGate({
  email,
  onContinue,
  onLogout,
}: {
  email: string;
  onContinue: () => void;
  onLogout: () => void;
}) {
  const { busy, error, run } = useAccountRequest(email);
  const [note, setNote] = useState("");
  useEffect(() => {
    setNote("");
  }, [email]);

  const resend = () =>
    run(async (current) => {
      setNote("");
      await client.resendVerification();
      if (current()) setNote("Sent. Check your inbox.");
    });

  return (
    <AuthShell>
      <h2>
        <MailCheck size={22} style={{ verticalAlign: "-3px" }} /> Confirm your
        email
      </h2>
      <p>
        Open the link sent to <strong>{email}</strong>, then return here to
        continue.
      </p>
      {note && <p className="muted">{note}</p>}
      {error && (
        <div role="alert" className="error">
          {error}
        </div>
      )}
      <button className="primary wide" disabled={busy} onClick={onContinue}>
        Continue
        <ArrowRight size={17} />
      </button>
      <button
        className="text-button"
        disabled={busy}
        onClick={() => void resend()}
      >
        {busy ? "Sending…" : "Resend the email"}
      </button>
      <button className="text-button" disabled={busy} onClick={onLogout}>
        Sign out
      </button>
    </AuthShell>
  );
}
