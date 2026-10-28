import { useEffect, useState, type MouseEvent, type ReactNode } from "react";
import { ArrowRight, KeyRound, Orbit } from "lucide-react";
import { MINIMUM_AGE } from "@orbyn/core";
import { client } from "../../lib/api";
import type { AuthMode } from "../planner/usePlanner";

type Props = {
  initialMode?: AuthMode;
  onNavigate: (path: string) => void;
  onHome?: () => void;
  busy: boolean;
  error: string;
  onClearError: () => void;
  onSubmit: (mode: AuthMode, values: Record<string, string>) => void;
  twoFactorRequired?: boolean;
  onPasskey?: (email: string) => void;
  /** Shown above the form (an app asking to connect). */
  notice?: ReactNode;
  /** Switch between sign-in and sign-up in place (keeping the address). */
  onSwitchMode?: () => void;
};

export function AuthPage({
  initialMode = "register",
  onNavigate,
  onHome,
  busy,
  error,
  onClearError,
  onSubmit,
  twoFactorRequired,
  onPasskey,
  notice,
  onSwitchMode,
}: Props) {
  const register = initialMode === "register";
  /** The Terms version the checkbox agrees to; empty until it loads. */
  const [termsVersion, setTermsVersion] = useState("");
  useEffect(() => {
    if (!register) return;
    let alive = true;
    client
      .legal()
      .then((l) => alive && setTermsVersion(l.terms_version))
      .catch(() => {
        // Without it the account is still made; the app asks once signed in.
      });
    return () => {
      alive = false;
    };
  }, [register]);
  const open = (path: string) => (e: MouseEvent) => {
    e.preventDefault();
    if (busy) return;
    onNavigate(path);
  };
  const legalLinks = (
    <>
      <a href="/terms" onClick={open("/terms")}>
        Terms of Service
      </a>{" "}
      and{" "}
      <a href="/privacy" onClick={open("/privacy")}>
        Privacy Policy
      </a>
    </>
  );
  return (
    <div className="auth-page">
      <div className="auth-story">
        <div className="auth-story-top">
          {onHome && (
            <button className="text-button auth-home-link" onClick={onHome}>
              ← Back to Orbyn
            </button>
          )}
          <div className="brand">
            <Orbit />{" "}
            <span className="brand-name">
              orbyn
              <span className="brand-dot" aria-hidden="true">
                •
              </span>
            </span>
          </div>
        </div>
        <div>
          <h1>Make room for your work.</h1>
          <p>Tasks, calendar and documents in one place.</p>
        </div>
      </div>
      <main className="auth-form">
        <div className="auth-card">
          {onHome && (
            <button
              className="text-button auth-home-link auth-home-mobile"
              onClick={onHome}
            >
              ← Back to Orbyn
            </button>
          )}
          {notice}
          <h2>{register ? "Create account" : "Sign in"}</h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (busy) return;
              const values = Object.fromEntries(
                new FormData(e.currentTarget),
              ) as Record<string, string>;
              onSubmit(register ? "register" : "login", values);
            }}
          >
            {register && (
              <label>
                Your name
                <input
                  disabled={busy}
                  name="name"
                  required
                  maxLength={80}
                  autoComplete="name"
                  placeholder="Alex Morgan"
                />
              </label>
            )}
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
            <label>
              Password
              <input
                disabled={busy}
                name="password"
                type="password"
                minLength={10}
                maxLength={128}
                required
                autoComplete={register ? "new-password" : "current-password"}
                placeholder="At least 10 characters"
              />
            </label>
            {!register && twoFactorRequired && (
              <label>
                Authenticator code
                <input
                  disabled={busy}
                  name="code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  autoFocus
                  maxLength={20}
                  placeholder="123456 or a recovery code"
                />
              </label>
            )}
            {!register && !twoFactorRequired && (
              <button
                type="button"
                className="text-button auth-forgot"
                disabled={busy}
                onClick={() => onNavigate("/forgot-password")}
              >
                Forgot your password?
              </button>
            )}
            {register && (
              <div className="auth-consent">
                <label className="check-line">
                  <input
                    disabled={busy}
                    type="checkbox"
                    name="accept_terms"
                    value={termsVersion}
                    required
                  />
                  <span>
                    I&apos;m {MINIMUM_AGE} or older and I agree to the{" "}
                    {legalLinks}.
                  </span>
                </label>
                <p>
                  Feature usage only; never your content. Opt out in Settings →
                  Privacy.
                </p>
              </div>
            )}
            {error && (
              <div role="alert" className="error">
                {error}
              </div>
            )}
            <button className="primary wide" disabled={busy}>
              {busy ? "One moment…" : register ? "Create account" : "Sign in"}
              <ArrowRight size={17} />
            </button>
            {!register && onPasskey && (
              <button
                type="button"
                className="secondary wide"
                disabled={busy}
                onClick={(e) => {
                  const form = e.currentTarget.closest("form");
                  const email =
                    (form?.elements.namedItem("email") as HTMLInputElement)
                      ?.value ?? "";
                  onPasskey(email);
                }}
              >
                <KeyRound size={16} /> Sign in with a passkey
              </button>
            )}
          </form>
          <button
            className="text-button"
            disabled={busy}
            onClick={() => {
              if (onSwitchMode) onSwitchMode();
              else onNavigate(register ? "/login" : "/signup");
              onClearError();
            }}
          >
            {register
              ? "Already have an account? Sign in"
              : "New here? Create an account"}
          </button>
          {!register && (
            <p className="auth-legal">
              By signing in, you agree to the {legalLinks}.
            </p>
          )}
        </div>
      </main>
    </div>
  );
}
