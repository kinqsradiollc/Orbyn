import { startAuthentication } from "@simplewebauthn/browser";
import { MINIMUM_AGE, type LegalSummary } from "@orbyn/core";
import { ArrowRight, KeyRound, Orbit } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { navigate, usePath, useSearch, useTitle } from "../../lib/router";
import { messageOf } from "../../lib/resource";
import { client, setToken } from "../../lib/session";
import { Button, ErrorNotice, Field, Input } from "../../ui/kit";
import "./public.css";
import { useAccount } from "../../app/account";
import { currentAuthReturn, withAuthNext } from "../../lib/auth-return";
import { useAuthOwner } from "./auth-owner";

export default function SignIn() {
  const path = usePath(),
    search = useSearch(),
    { version } = useAccount();
  return (
    <SignInForm
      key={`${version}:${path}:${search}`}
      register={path === "/signup"}
    />
  );
}

function SignInForm({ register }: { register: boolean }) {
  const owner = useAuthOwner();
  useTitle(register ? "Create your space" : "Sign in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [needsCode, setNeedsCode] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [legal, setLegal] = useState<LegalSummary | null>(null);
  const [legalAttempt, setLegalAttempt] = useState(0);
  const [legalLoading, setLegalLoading] = useState(register);
  const [legalError, setLegalError] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!register) return;
    let active = true;
    setLegal(null);
    setLegalLoading(true);
    setLegalError("");
    setAgreed(false);
    void client
      .legal()
      .then((value) => {
        if (!value?.terms_version) throw new Error("Missing terms version");
        if (active && owner.current()) setLegal(value);
      })
      .catch(() => {
        if (active && owner.current())
          setLegalError(
            "The terms could not be loaded. Your details are kept.",
          );
      })
      .finally(() => {
        if (active && owner.current()) setLegalLoading(false);
      });
    return () => {
      active = false;
    };
  }, [register, legalAttempt]);

  const finish = (token: string, destination: string) => {
    if (!owner.current()) return;
    if (typeof token !== "string" || !token)
      throw new Error("The sign-in receipt was incomplete. Try again.");
    setToken(token);
    navigate(destination, true);
  };

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!owner.current()) return;
    if (register && (!agreed || !legal)) {
      setError(
        "Read and agree to the loaded terms before creating an account.",
      );
      return;
    }
    if (!owner.acquire()) return;
    const destination = currentAuthReturn();
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
      finish(result.token, destination);
    } catch (failure) {
      if (!owner.current()) return;
      if (failure instanceof Error && failure.message === "totp_required") {
        setNeedsCode(true);
        setError("Enter the 6-digit code from your authenticator app.");
      } else setError(messageOf(failure, "Couldn't sign in. Try again."));
    } finally {
      owner.release();
      if (owner.current()) setBusy(false);
    }
  }

  async function passkey() {
    if (!owner.acquire()) return;
    const destination = currentAuthReturn();
    setBusy(true);
    setError("");
    try {
      const { handle, options } = await client.passkeyLoginOptions(
        email || undefined,
      );
      if (!owner.current()) return;
      const response = await startAuthentication({
        optionsJSON: options as Parameters<
          typeof startAuthentication
        >[0]["optionsJSON"],
      });
      if (!owner.current()) return;
      finish((await client.passkeyLogin(handle, response)).token, destination);
    } catch (failure) {
      if (owner.current())
        setError(messageOf(failure, "Couldn't use that passkey."));
    } finally {
      owner.release();
      if (owner.current()) setBusy(false);
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
              disabled={busy}
              id="name"
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
        )}
        <Field label="Email">
          <Input
            disabled={busy}
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
            disabled={busy}
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
              disabled={busy}
              id="code"
              autoComplete="one-time-code"
              placeholder="123456 or a recovery code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </Field>
        )}
        {register && legalLoading && (
          <p role="status" className="small">
            Loading terms…
          </p>
        )}
        {register && legalError && (
          <ErrorNotice
            message={legalError}
            onRetry={() => {
              if (!busy) setLegalAttempt((value) => value + 1);
            }}
          />
        )}
        {register && (
          <label className="check">
            <input
              type="checkbox"
              required
              disabled={busy || legalLoading || !legal}
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
            />
            <span>
              I'm {MINIMUM_AGE} or older and agree to the{" "}
              <a href={withAuthNext("/terms")}>Terms of Service</a> and{" "}
              <a href={withAuthNext("/privacy")}>Privacy Policy</a>
            </span>
          </label>
        )}
        {error && (
          <p role="alert" className="small auth-error">
            {error}
          </p>
        )}
        <Button
          type="submit"
          variant="primary"
          busy={busy}
          disabled={register && (legalLoading || !legal)}
        >
          {register ? "Create account" : "Sign in"} <ArrowRight />
        </Button>
        {!register && (
          <Button onClick={() => void passkey()} disabled={busy}>
            <KeyRound /> Sign in with a passkey
          </Button>
        )}
        <div className="auth-links small">
          <a href={withAuthNext(register ? "/login" : "/signup")}>
            {register ? "I already have an account" : "Create an account"}
          </a>
          {!register && (
            <a href={withAuthNext("/forgot-password")}>Forgot your password?</a>
          )}
        </div>
      </form>
    </main>
  );
}
