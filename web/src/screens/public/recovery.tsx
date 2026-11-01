import { useEffect, useRef, useState, type FormEvent } from "react";
import { navigate, usePath, useSearch, useTitle } from "../../lib/router";
import { messageOf } from "../../lib/resource";
import { client, setToken } from "../../lib/session";
import { Button, Field, Input } from "../../ui/kit";
import { go } from "./PublicFrame";
import "./public.css";
import { useAccount } from "../../app/account";
import { currentAuthReturn, withAuthNext } from "../../lib/auth-return";
import { useAuthOwner } from "./auth-owner";

const token = () => new URLSearchParams(location.search).get("token") ?? "";

function Back() {
  const login = withAuthNext("/login");
  return (
    <a className="small" href={login} onClick={go(login)}>
      Back to sign in
    </a>
  );
}

function Forgot() {
  const owner = useAuthOwner();
  useTitle("Reset your password");
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!owner.acquire()) return;
    setBusy(true);
    setError("");
    try {
      await client.forgotPassword(email);
      if (owner.current()) setSent(true);
    } catch (failure) {
      if (owner.current())
        setError(messageOf(failure, "Couldn't send that. Try again."));
    } finally {
      owner.release();
      if (owner.current()) setBusy(false);
    }
  }
  if (sent)
    return (
      <>
        <h1>Check your inbox</h1>
        <p className="muted">
          If that account exists, we'll send a reset link valid for one hour.
        </p>
        <Back />
      </>
    );
  return (
    <form className="auth-form" onSubmit={submit}>
      <h1>Reset your password</h1>
      <Field label="Email" error={error}>
        <Input
          id="email"
          type="email"
          required
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </Field>
      <Button type="submit" variant="primary" busy={busy}>
        Send reset link
      </Button>
      <Back />
    </form>
  );
}

function Reset() {
  const owner = useAuthOwner();
  const destination = currentAuthReturn();
  const forgot = withAuthNext("/forgot-password", destination);
  useTitle("Set a new password");
  const link = token();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!link)
    return (
      <>
        <h1>This link is incomplete</h1>
        <p className="muted">
          Open the link from your email again, or ask for a new one.
        </p>
        <a className="small" href={forgot} onClick={go(forgot)}>
          Send a new link
        </a>
      </>
    );
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!owner.acquire()) return;
    setBusy(true);
    setError("");
    try {
      const result = await client.resetPassword(link, password);
      if (!owner.current()) return;
      if (typeof result.token !== "string" || !result.token)
        throw new Error("The reset receipt was incomplete. Try again.");
      setToken(result.token);
      navigate(destination, true);
    } catch (failure) {
      if (owner.current())
        setError(
          messageOf(failure, "This link has expired. Ask for a new one."),
        );
    } finally {
      owner.release();
      if (owner.current()) setBusy(false);
    }
  }
  return (
    <form className="auth-form" onSubmit={submit}>
      <h1>Set a new password</h1>
      <p className="muted">You'll be signed in after saving.</p>
      <Field label="New password" hint="At least 10 characters" error={error}>
        <Input
          id="password"
          type="password"
          required
          minLength={10}
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </Field>
      <Button type="submit" variant="primary" busy={busy}>
        Save password
      </Button>
      {error && (
        <a className="small" href={forgot} onClick={go(forgot)}>
          Send a new link
        </a>
      )}
    </form>
  );
}

function Verify() {
  const owner = useAuthOwner();
  const started = useRef(false);
  const destination = currentAuthReturn();
  useTitle("Verify your email");
  const link = token();
  const [state, setState] = useState<"verifying" | "done" | "error">(
    link ? "verifying" : "error",
  );
  useEffect(() => {
    if (!link || started.current) return;
    started.current = true;
    void client.verifyEmail(link).then(
      () => {
        if (owner.current()) setState("done");
      },
      () => {
        if (owner.current()) setState("error");
      },
    );
  }, [link]);

  return (
    <>
      <h1>
        {state === "verifying"
          ? "Verifying your email…"
          : state === "done"
            ? "Your email is verified"
            : "This link didn't work"}
      </h1>
      {state === "error" && (
        <p className="muted">
          It may have expired. Ask for a new one in Settings.
        </p>
      )}
      {state !== "verifying" && (
        <a
          className="btn btn-primary"
          href={destination}
          onClick={go(destination)}
        >
          Open Orbyn
        </a>
      )}
    </>
  );
}

export default function Recovery() {
  const path = usePath(),
    search = useSearch(),
    { version } = useAccount();
  return <RecoveryBody key={`${version}:${path}:${search}`} path={path} />;
}
function RecoveryBody({ path }: { path: string }) {
  return (
    <main className="auth">
      <div className="auth-form">
        {path === "/forgot-password" ? (
          <Forgot />
        ) : path === "/reset-password" ? (
          <Reset />
        ) : (
          <Verify />
        )}
      </div>
    </main>
  );
}
