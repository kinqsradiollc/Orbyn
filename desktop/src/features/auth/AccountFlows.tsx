import { useEffect, useState } from "react";
import { ArrowRight, MailCheck, Orbit } from "lucide-react";
import type { AuthResponse } from "@orbyn/core";
import { client } from "../../lib/api";
import { errorText } from "../../lib/planning";

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
        <div className="auth-card fade-up motion-slow">
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
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  const submit = async (email: string) => {
    setBusy(true);
    setError("");
    try {
      await client.forgotPassword(email);
      setSent(true);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell onHome={onHome}>
      <span className="eyebrow">FORGOT YOUR PASSWORD?</span>
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
          <h2>Let's get you back in.</h2>
          <p>Enter your email and we'll send a link to reset your password.</p>
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
            Remembered it? Sign in
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

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

  const submit = async (password: string) => {
    setBusy(true);
    setError("");
    try {
      onAuthed(await client.resetPassword(token, password));
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };

  return (
    <AuthShell onHome={onHome}>
      <span className="eyebrow">CHOOSE A NEW PASSWORD</span>
      <h2>Almost there.</h2>
      <p>Pick a new password and you'll be signed straight in.</p>
      <form
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

  useEffect(() => {
    if (!token) return;
    let alive = true;
    client
      .verifyEmail(token)
      .then(() => {
        if (!alive) return;
        setState("done");
        // Already in the app in this browser: pick up the confirmed state.
        if (signedIn) onVerified();
      })
      .catch((e) => {
        if (!alive) return;
        setState("error");
        setError(errorText(e));
      });
    return () => {
      alive = false;
    };
  }, [token, signedIn, onVerified]);

  return (
    <AuthShell onHome={onHome}>
      <span className="eyebrow">EMAIL CONFIRMATION</span>
      {state === "verifying" && (
        <>
          <h2>Confirming your email…</h2>
          <p>One moment while we check your link.</p>
        </>
      )}
      {state === "done" && (
        <>
          <h2>You're all set.</h2>
          <p>
            Your email is confirmed.{" "}
            {signedIn
              ? "You can head back to Orbyn."
              : "Sign in to start using your account."}
          </p>
          <button
            className="primary wide"
            onClick={() => onNavigate(signedIn ? "/app" : "/login")}
          >
            {signedIn ? "Go to Orbyn" : "Sign in"}
            <ArrowRight size={17} />
          </button>
        </>
      )}
      {state === "error" && (
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
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  const resend = async () => {
    setBusy(true);
    setNote("");
    setError("");
    try {
      await client.resendVerification();
      setNote("Sent. Check your inbox for the new link.");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell>
      <span className="eyebrow">ONE LAST STEP</span>
      <h2>
        <MailCheck size={22} style={{ verticalAlign: "-3px" }} /> Confirm your
        email
      </h2>
      <p>
        We sent a confirmation link to <strong>{email}</strong>. Open it to
        start using Orbyn. Once you have, come back and continue.
      </p>
      {note && <p className="muted">{note}</p>}
      {error && (
        <div role="alert" className="error">
          {error}
        </div>
      )}
      <button className="primary wide" onClick={onContinue}>
        I've confirmed — continue
        <ArrowRight size={17} />
      </button>
      <button
        className="text-button"
        disabled={busy}
        onClick={() => void resend()}
      >
        {busy ? "Sending…" : "Resend the email"}
      </button>
      <button className="text-button" onClick={onLogout}>
        Sign out
      </button>
    </AuthShell>
  );
}
