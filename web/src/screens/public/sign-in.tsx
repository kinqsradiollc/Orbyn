import { startAuthentication } from "@simplewebauthn/browser";
import { MINIMUM_AGE, type LegalSummary } from "@orbyn/core";
import { ArrowRight, KeyRound, Orbit } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { navigate, usePath, useTitle } from "../../lib/router";
import { messageOf } from "../../lib/resource";
import { client, setToken } from "../../lib/session";
import { Button, Field, Input } from "../../ui/kit";
import "./public.css";

/** Only this app's own /app paths are followed after signing in. */
function nextPath() {
  const next = new URLSearchParams(location.search).get("next");
  return next && next.startsWith("/app") && !next.startsWith("//")
    ? next
    : "/app";
}

export default function SignIn() {
  const path = usePath();
  const register = path === "/signup";
  useTitle(register ? "Create your space" : "Sign in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [needsCode, setNeedsCode] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [legal, setLegal] = useState<LegalSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (register) void client.legal().then(setLegal, () => undefined);
  }, [register]);

  const finish = (token: string) => {
    setToken(token);
    navigate(nextPath(), true);
  };

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = register
        ? await client.register({
            name,
            email,
            password,
            accept_terms: legal?.terms_version,
          })
        : await client.login({ email, password, code: code || undefined });
      finish(result.token);
    } catch (failure) {
      if ((failure as Error).message === "totp_required") {
        setNeedsCode(true);
        setError("Enter the 6-digit code from your authenticator app.");
      } else setError(messageOf(failure, "Couldn't sign in. Try again."));
      setBusy(false);
    }
  }

  async function passkey() {
    setBusy(true);
    setError("");
    try {
      const { handle, options } = await client.passkeyLoginOptions(
        email || undefined,
      );
      const response = await startAuthentication({
        optionsJSON: options as Parameters<
          typeof startAuthentication
        >[0]["optionsJSON"],
      });
      finish((await client.passkeyLogin(handle, response)).token);
    } catch (failure) {
      setError(messageOf(failure, "Couldn't use that passkey."));
      setBusy(false);
    }
  }

  return (
    <main className="auth">
      <form className="auth-form" onSubmit={submit}>
        <a className="auth-brand" href="/" aria-label="Orbyn home">
          <Orbit aria-hidden="true" /> orbyn
        </a>
        <h1>{register ? "Create your space" : "Sign in"}</h1>
        {register && (
          <Field label="Name">
            <Input
              id="name"
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
        )}
        <Field label="Email">
          <Input
            id="email"
            type="email"
            required
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        <Field
          label="Password"
          hint={register ? "At least 10 characters" : undefined}
        >
          <Input
            id="password"
            type="password"
            required
            minLength={register ? 10 : undefined}
            autoComplete={register ? "new-password" : "current-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        {needsCode && (
          <Field label="Authenticator code">
            <Input
              id="code"
              autoComplete="one-time-code"
              placeholder="123456 or a recovery code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </Field>
        )}
        {register && (
          <label className="check">
            <input
              type="checkbox"
              required
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
            />
            <span>
              I'm {MINIMUM_AGE} or older and agree to the{" "}
              <a href="/terms">Terms of Service</a> and{" "}
              <a href="/privacy">Privacy Policy</a>
            </span>
          </label>
        )}
        {error && (
          <p role="alert" className="small auth-error">
            {error}
          </p>
        )}
        <Button type="submit" variant="primary" busy={busy}>
          {register ? "Create account" : "Sign in"} <ArrowRight />
        </Button>
        {!register && (
          <Button onClick={() => void passkey()} disabled={busy}>
            <KeyRound /> Sign in with a passkey
          </Button>
        )}
        <div className="auth-links small">
          <a href={register ? "/login" : "/signup"}>
            {register ? "I already have an account" : "Create an account"}
          </a>
          {!register && <a href="/forgot-password">Forgot your password?</a>}
        </div>
      </form>
    </main>
  );
}
