import { useEffect, useState, type FormEvent } from "react";
import { navigate, usePath, useTitle } from "../../lib/router";
import { messageOf } from "../../lib/resource";
import { client, setToken } from "../../lib/session";
import { Button, Field, Input } from "../../ui/kit";
import { go } from "./PublicFrame";
import "./public.css";

const token = () => new URLSearchParams(location.search).get("token") ?? "";

function Back() {
  return (
    <a className="small" href="/login" onClick={go("/login")}>
      Back to sign in
    </a>
  );
}

function Forgot() {
  useTitle("Reset your password");
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await client.forgotPassword(email);
      setSent(true);
    } catch (failure) {
      setError(messageOf(failure, "Couldn't send that. Try again."));
    } finally {
      setBusy(false);
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
        <a
          className="small"
          href="/forgot-password"
          onClick={go("/forgot-password")}
        >
          Send a new link
        </a>
      </>
    );
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await client.resetPassword(link, password);
      setToken(result.token);
      navigate("/app", true);
    } catch (failure) {
      setError(messageOf(failure, "This link has expired. Ask for a new one."));
      setBusy(false);
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
        <a
          className="small"
          href="/forgot-password"
          onClick={go("/forgot-password")}
        >
          Send a new link
        </a>
      )}
    </form>
  );
}

function Verify() {
  useTitle("Verify your email");
  const link = token();
  const [state, setState] = useState<"verifying" | "done" | "error">(
    link ? "verifying" : "error",
  );
  useEffect(() => {
    if (!link) return;
    let live = true;
    void client.verifyEmail(link).then(
      () => live && setState("done"),
      () => live && setState("error"),
    );
    return () => {
      live = false;
    };
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
        <a className="btn btn-primary" href="/app" onClick={go("/app")}>
          Open Orbyn
        </a>
      )}
    </>
  );
}

export default function Recovery() {
  const path = usePath();
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
