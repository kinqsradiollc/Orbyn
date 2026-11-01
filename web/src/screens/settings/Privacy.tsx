import { HttpError, type LegalDocument } from "@orbyn/core";
import { useRef, useState } from "react";
import { useAccount } from "../../app/account";
import { client, setToken } from "../../lib/session";
import { navigate } from "../../lib/router";
import { messageOf } from "../../lib/resource";
import {
  Button,
  Dialog,
  ErrorNotice,
  Field,
  Input,
  Loading,
  useConfirm,
} from "../../ui/kit";
import { PlainText } from "../public/PublicFrame";
import {
  SettingsSection,
  useSettingsExit,
  useSettingsOwner,
  useSettingsRead,
} from "./shared";

const unknownResult = (failure: unknown) =>
  !(failure instanceof HttpError) ||
  failure.statusCode >= 500 ||
  [408, 429].includes(failure.statusCode);
const date = (value: string) =>
  Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString() : value;

export function PrivacySettings() {
  const { user } = useAccount();
  const owned = useSettingsOwner();
  const confirm = useConfirm();
  const read = useSettingsRead(() => client.privacy());
  const [legal, setLegal] = useState<LegalDocument | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [feedbackAt, setFeedbackAt] = useState<
    "legal" | "analytics" | "data" | "delete"
  >("legal");
  const [uncertain, setUncertain] = useState<
    { kind: "analytics"; optOut: boolean } | { kind: "delete" } | null
  >(null);
  const [deleting, setDeleting] = useState(false);
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");
  const lock = useRef(false);
  const current = useRef({ uncertain, password, email });
  current.current = { uncertain, password, email };
  useSettingsExit({
    dirty: !!password || !!email,
    pending: busy || !!uncertain,
    message: uncertain
      ? "Check the earlier action's saved state before leaving."
      : undefined,
  });
  const inspectLegal = async (doc: "terms" | "privacy") => {
    if (!owned() || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    setFeedbackAt("legal");
    try {
      const saved = await client.legalDocument(doc);
      if (owned()) setLegal(saved);
    } catch (failure) {
      if (owned()) setError(messageOf(failure, "Couldn't load this document."));
    } finally {
      lock.current = false;
      if (owned()) setBusy(false);
    }
  };
  const analytics = async (enabled: boolean) => {
    if (!owned() || lock.current || current.current.uncertain || !read.fresh)
      return;
    lock.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    setFeedbackAt("analytics");
    read.invalidate();
    try {
      const saved = await client.setPrivacy({ analytics_opt_out: !enabled });
      if (!owned()) return;
      if (saved.analytics_opt_out !== !enabled)
        throw new Error(
          "The saved analytics choice doesn't match. Check saved state.",
        );
      read.commit(saved);
      setNotice(
        enabled
          ? "Usage analytics is on."
          : "Usage analytics is off. Previous usage counts were cleared.",
      );
    } catch (failure) {
      if (owned()) {
        if (unknownResult(failure))
          setUncertain({ kind: "analytics", optOut: !enabled });
        setError(messageOf(failure, "Couldn't save your analytics choice."));
      }
    } finally {
      lock.current = false;
      if (owned()) setBusy(false);
    }
  };
  const download = async () => {
    if (!owned() || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    setFeedbackAt("data");
    try {
      const { blob, name } = await client.exportArchive();
      if (!owned()) return;
      const url = URL.createObjectURL(blob);
      try {
        const link = document.createElement("a");
        link.href = url;
        link.download = name;
        document.body.append(link);
        try {
          link.click();
        } finally {
          link.remove();
        }
        setNotice("Download started.");
      } finally {
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    } catch (failure) {
      if (owned())
        setError(messageOf(failure, "Couldn't download your archive."));
    } finally {
      lock.current = false;
      if (owned()) setBusy(false);
    }
  };
  const closeDelete = async () => {
    if (!owned() || lock.current || current.current.uncertain) return;
    lock.current = true;
    setBusy(true);
    try {
      if (
        (password || email) &&
        !(await confirm({ title: "Close account deletion?", action: "Close" }))
      )
        return;
      if (owned()) {
        setDeleting(false);
        setPassword("");
        setEmail("");
        setError("");
      }
    } finally {
      lock.current = false;
      if (owned()) setBusy(false);
    }
  };
  const remove = async () => {
    if (
      !owned() ||
      lock.current ||
      current.current.uncertain ||
      (!password && email.trim().toLowerCase() !== user?.email.toLowerCase())
    )
      return;
    lock.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    setFeedbackAt("delete");
    try {
      await client.deleteAccount(
        password ? { password } : { confirm_email: email.trim() },
      );
      if (!owned()) return;
      setToken("");
      navigate("/login", true);
    } catch (failure) {
      if (owned()) {
        if (unknownResult(failure)) setUncertain({ kind: "delete" });
        setError(messageOf(failure, "Couldn't delete your account."));
      }
    } finally {
      lock.current = false;
      if (owned()) setBusy(false);
    }
  };
  const reconcile = async () => {
    const attempt = current.current.uncertain;
    if (!attempt || !owned() || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const saved = await client.privacy();
      if (!owned() || attempt !== current.current.uncertain) return;
      read.commit(saved);
      if (
        attempt.kind === "analytics" &&
        saved.analytics_opt_out === attempt.optOut
      ) {
        setUncertain(null);
        setNotice("Your analytics choice is saved.");
      } else
        setError(
          attempt.kind === "delete"
            ? "The account is still available. The earlier deletion may still finish. Check again before another action."
            : "The latest saved choice doesn't confirm the earlier action. Check again.",
        );
    } catch (failure) {
      if (!owned()) return;
      if (
        attempt.kind === "delete" &&
        failure instanceof HttpError &&
        [401, 403, 404].includes(failure.statusCode)
      )
        setError(
          "This session can no longer read the account. Sign in again to check its status; deletion has not been confirmed here.",
        );
      else setError(messageOf(failure, "Couldn't check saved state."));
    } finally {
      lock.current = false;
      if (owned()) setBusy(false);
    }
  };
  const feedback = (
    <>
      {error && (
        <ErrorNotice
          message={error}
          onRetry={!busy && !uncertain ? () => void read.reload() : undefined}
        />
      )}
      {notice && <p role="status">{notice}</p>}
      {uncertain && (
        <div className="settings-actions">
          <Button disabled={busy} onClick={() => void reconcile()}>
            Check saved state
          </Button>
          {uncertain.kind === "delete" && (
            <Button
              disabled={busy}
              onClick={() => {
                setToken("");
                navigate("/login", true);
              }}
            >
              Sign in again
            </Button>
          )}
        </div>
      )}
    </>
  );
  return (
    <>
      <SettingsSection title="What you agreed to">
        {read.error && (
          <ErrorNotice
            message={read.error}
            onRetry={busy || uncertain ? undefined : () => void read.reload()}
          />
        )}
        {!read.data && read.loading && (
          <Loading label="Loading privacy choices" />
        )}
        {read.data && (
          <p className="muted">
            {read.data.terms_accepted_at
              ? `Accepted version ${read.data.terms_version} on ${date(read.data.terms_accepted_at)}.`
              : "No accepted terms are recorded."}
            {read.data.terms_version !== read.data.current_terms_version
              ? " A newer version is available."
              : ""}
          </p>
        )}
        <div className="settings-actions">
          <Button disabled={busy} onClick={() => void inspectLegal("terms")}>
            Terms of Service
          </Button>
          <Button disabled={busy} onClick={() => void inspectLegal("privacy")}>
            Privacy Policy
          </Button>
        </div>
        {feedbackAt === "legal" && feedback}
      </SettingsSection>
      <SettingsSection
        title="Usage analytics"
        description="Counts feature use, never your content. Turning off clears previous usage counts; security logs remain for seven days."
      >
        <label className="settings-row">
          <span>Count my usage</span>
          <input
            type="checkbox"
            role="switch"
            checked={!!read.data && !read.data.analytics_opt_out}
            disabled={!read.fresh || busy || !!uncertain}
            onChange={(event) => void analytics(event.target.checked)}
          />
        </label>
        {feedbackAt === "analytics" && feedback}
      </SettingsSection>
      <SettingsSection
        title="Your data"
        description="Download pages, plans and consent history as a ZIP archive."
      >
        <Button disabled={busy || !!uncertain} onClick={() => void download()}>
          Download my data
        </Button>
        {!!read.data?.history.length && (
          <details>
            <summary>Consent history</summary>
            <ul>
              {read.data.history.map((entry, index) => (
                <li key={index}>
                  {entry.kind === "terms"
                    ? `Accepted terms ${entry.version}`
                    : entry.granted
                      ? "Enabled usage analytics"
                      : "Disabled usage analytics"}{" "}
                  · <time dateTime={entry.at}>{date(entry.at)}</time>
                </li>
              ))}
            </ul>
          </details>
        )}
        {feedbackAt === "data" && feedback}
      </SettingsSection>
      <SettingsSection
        title="Delete my account"
        description="Permanently deletes your account and private data. Owned teams pass to another member. Download a copy first."
      >
        <Button
          variant="danger"
          disabled={busy || !!uncertain}
          onClick={() => {
            setDeleting(true);
            setError("");
            setNotice("");
            setFeedbackAt("delete");
          }}
        >
          Delete my account…
        </Button>
        {!deleting && feedbackAt === "delete" && feedback}
      </SettingsSection>
      {legal && (
        <Dialog title={legal.title} wide onClose={() => setLegal(null)}>
          <p className="muted small">Version {legal.version}</p>
          <article className="prose">
            <PlainText body={legal.body} />
          </article>
        </Dialog>
      )}
      {deleting && (
        <Dialog
          title="Delete your account permanently?"
          onClose={() => void closeDelete()}
          actions={
            <>
              <Button
                disabled={busy || !!uncertain}
                onClick={() => void closeDelete()}
              >
                Cancel
              </Button>
              <Button
                variant="danger"
                disabled={
                  busy ||
                  !!uncertain ||
                  (!password &&
                    email.trim().toLowerCase() !== user?.email.toLowerCase())
                }
                onClick={() => void remove()}
              >
                Delete my account
              </Button>
            </>
          }
        >
          <p>Your private data will be removed. This cannot be undone.</p>
          <form
            className="settings-form"
            onSubmit={(event) => {
              event.preventDefault();
              void remove();
            }}
          >
            <Field label="Password">
              <Input
                type="password"
                autoComplete="current-password"
                maxLength={128}
                value={password}
                disabled={busy || !!uncertain}
                onChange={(event) => setPassword(event.target.value)}
              />
            </Field>
            <Field
              label="Email confirmation"
              hint="Use your email instead if this account has no password."
            >
              <Input
                type="email"
                autoComplete="email"
                value={email}
                disabled={busy || !!uncertain}
                onChange={(event) => setEmail(event.target.value)}
              />
            </Field>
            {feedback}
          </form>
        </Dialog>
      )}
    </>
  );
}
