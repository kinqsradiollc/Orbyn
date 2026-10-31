import { useState } from "react";
import { messageOf } from "../lib/resource";
import { client } from "../lib/session";
import { Button } from "../ui/kit";
import { useAccount } from "./account";
import "../screens/public/public.css";

/** Held before the app until the account's email is confirmed. */
export function VerifyGate() {
  const { user, refresh, signOut } = useAccount();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  async function resend() {
    setBusy(true);
    setNote("");
    setError("");
    try {
      await client.resendVerification();
      setNote("Sent. Check your inbox.");
    } catch (failure) {
      setError(messageOf(failure, "Couldn't send that. Try again."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth">
      <div className="auth-form">
        <h1>Confirm your email</h1>
        <p className="muted">
          We sent a link to <span dir="auto">{user?.email}</span>. Open it to
          continue.
        </p>
        {note && (
          <p role="status" className="small">
            {note}
          </p>
        )}
        {error && (
          <p role="alert" className="small auth-error">
            {error}
          </p>
        )}
        <Button variant="primary" onClick={() => void refresh()}>
          I've confirmed it
        </Button>
        <Button busy={busy} onClick={() => void resend()}>
          Send the link again
        </Button>
        <Button variant="ghost" onClick={signOut}>
          Sign out
        </Button>
      </div>
    </main>
  );
}
