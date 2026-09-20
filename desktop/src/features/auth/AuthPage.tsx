import { ArrowRight, KeyRound, Orbit } from "lucide-react";
import type { AuthMode } from "../../hooks/usePlanner";

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
}: Props) {
  const register = initialMode === "register";
  return (
    <div className="auth-page">
      {onHome && (
        <button className="text-button auth-home-link" onClick={onHome}>
          ← Back to Orbyn
        </button>
      )}
      <div className="auth-story fade-in motion-slow">
        <div className="brand">
          <Orbit /> orbyn<span>•</span>
        </div>
        <div>
          <span className="eyebrow">
            A LITTLE CLARITY. A LOT MORE POSSIBILITY.
          </span>
          <h1>
            Your life.
            <br />
            In a better orbit.
          </h1>
          <p>
            Bring your tasks, plans, and big ideas together.
            <br />
            Make space for what matters.
          </p>
          <div className="orbit-art">
            <div />
            <div />
            <div />
            <span>✦</span>
          </div>
        </div>
        <small>Thoughtfully planned. Entirely yours.</small>
      </div>
      <main className="auth-form">
        <div className="auth-card fade-up motion-slow">
          <span className="eyebrow">WELCOME TO YOUR SPACE</span>
          <h2>
            {register ? "A fresh start awaits." : "Good to have you back."}
          </h2>
          <p>
            {register
              ? "Create your account and find your flow."
              : "Sign in to pick up where you left off."}
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
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
                onClick={() => onNavigate("/forgot-password")}
              >
                Forgot your password?
              </button>
            )}
            {error && (
              <div role="alert" className="error">
                {error}
              </div>
            )}
            <button className="primary wide" disabled={busy}>
              {busy
                ? "One moment…"
                : register
                  ? "Create your space"
                  : "Sign in"}
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
            onClick={() => {
              onNavigate(register ? "/login" : "/signup");
              onClearError();
            }}
          >
            {register
              ? "Already have an account? Sign in"
              : "New here? Create an account"}
          </button>
        </div>
      </main>
    </div>
  );
}
