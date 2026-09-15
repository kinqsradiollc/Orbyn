import { useState } from "react";
import { ArrowRight, Orbit } from "lucide-react";
import type { AuthMode } from "../../hooks/usePlanner";

type Props = {
  busy: boolean;
  error: string;
  onClearError: () => void;
  onSubmit: (mode: AuthMode, values: Record<string, string>) => void;
};

export function AuthPage({ busy, error, onClearError, onSubmit }: Props) {
  const [register, setRegister] = useState(true);
  return (
    <div className="auth-page">
      <div className="auth-story">
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
        <div className="auth-card">
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
          </form>
          <button
            className="text-button"
            onClick={() => {
              setRegister(!register);
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
