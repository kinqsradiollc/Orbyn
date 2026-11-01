import { startAuthentication } from "@simplewebauthn/browser";
import {
  HttpError,
  reauthInput,
  type OAuthCheck,
  type OAuthRequest,
} from "@orbyn/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { client } from "../../../lib/session";
import { navigate, onBeforeNavigate } from "../../../lib/router";
import { messageOf } from "../../../lib/resource";
import { Button, ErrorNotice, Field, Input, useConfirm } from "../../../ui/kit";
import { Choices } from "./Choices";
import {
  authorizationIssuer,
  identity,
  initialChoices,
  receiptTarget,
  toConsent,
  validCheck,
  type Choices as Selection,
} from "./model";
import { useReauthClock } from "./lifecycle";
type Phase =
  | "idle"
  | "allow"
  | "deny"
  | "reauth"
  | "checking"
  | "unknown-allow"
  | "unknown-deny"
  | "unknown-reauth"
  | "redirect";
const uncertain = (e: unknown) =>
  !(e instanceof HttpError) ||
  e.statusCode >= 500 ||
  [408, 425, 429].includes(e.statusCode);
export function Consent({
  request,
  check,
  readFresh,
  onChecked,
  onSignIn,
  onSwitch,
  owned,
}: {
  request: OAuthRequest;
  check: OAuthCheck;
  readFresh: boolean;
  onChecked: (value: OAuthCheck) => void;
  onSignIn: (register?: boolean) => void;
  onSwitch: () => void;
  owned: () => boolean;
}) {
  const [choice, setChoice] = useState<Selection | null>(() =>
      check.account ? initialChoices(check, check.account) : null,
    ),
    [search, setSearch] = useState(""),
    [password, setPassword] = useState(""),
    [code, setCode] = useState(""),
    [needCode, setNeedCode] = useState(false),
    [until, setUntil] = useState(check.account?.reauth_until ?? null),
    [phase, setPhase] = useState<Phase>("idle"),
    [error, setError] = useState(""),
    [permissionsCurrent, setPermissionsCurrent] = useState(true);
  const lock = useRef(false),
    unknownKind = useRef<"allow" | "deny" | "reauth" | null>(null),
    redirect = useRef<string | null>(null),
    redirecting = useRef(false),
    bypass = useRef(false),
    initial = useRef(JSON.stringify(choice)),
    latest = useRef({ choice, password, code, phase, check }),
    confirm = useConfirm();
  latest.current = { choice, password, code, phase, check };
  const fresh = useReauthClock(until),
    needsReauth =
      !!choice && (choice.access === "write" || choice.bookings) && !fresh,
    unknown = phase.startsWith("unknown-"),
    busy =
      phase === "allow" ||
      phase === "deny" ||
      phase === "reauth" ||
      phase === "checking",
    blocked = busy || unknown || phase === "redirect";
  const current = () => owned() && !bypass.current;
  // Initialize only when an account first becomes available in this request lifetime.
  // Permission refreshes retain the person’s newer choices.
  useEffect(() => {
    if (check.account && !choice) {
      const next = initialChoices(check, check.account);
      initial.current = JSON.stringify(next);
      setChoice(next);
    }
  }, [!!check.account]);
  useEffect(() => {
    if (!check.account) {
      setPassword("");
      setCode("");
      setUntil(null);
    } else setUntil(check.account.reauth_until);
  }, [check.account?.reauth_until, !!check.account]);
  useEffect(
    () => () => {
      redirect.current = null;
      unknownKind.current = null;
    },
    [],
  );
  const leave = useCallback(async () => {
    if (!owned() || bypass.current || redirecting.current) return true;
    if (lock.current || unknownKind.current) {
      setError(
        "Finish the current request, or use Leave this request after reviewing an uncertain outcome.",
      );
      return false;
    }
    const snapshot = latest.current,
      dirty =
        JSON.stringify(snapshot.choice) !== initial.current ||
        !!snapshot.password ||
        !!snapshot.code;
    if (!dirty) return true;
    lock.current = true;
    try {
      if (
        !(await confirm({
          title: "Leave this connection request?",
          body: "Your consent choices and confirmation fields will be discarded. Nothing new is allowed by leaving.",
          action: "Leave request",
        })) ||
        !owned()
      )
        return false;
      if (
        JSON.stringify(latest.current.choice) !==
          JSON.stringify(snapshot.choice) ||
        latest.current.password !== snapshot.password ||
        latest.current.code !== snapshot.code
      )
        return false;
      return true;
    } finally {
      lock.current = false;
    }
  }, [confirm, owned]);
  useEffect(() => onBeforeNavigate(() => leave()), [leave]);
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (!owned() || bypass.current || redirecting.current) return;
      const s = latest.current;
      if (
        lock.current ||
        unknownKind.current ||
        JSON.stringify(s.choice) !== initial.current ||
        s.password ||
        s.code
      ) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [owned]);
  const update = (value: Selection) => {
    if (
      current() &&
      !lock.current &&
      !unknownKind.current &&
      phase !== "redirect"
    )
      setChoice(value);
  };
  const follow = (target: string) => {
    if (!current()) return;
    redirect.current = target;
    unknownKind.current = null;
    setPhase("redirect");
    setPassword("");
    setCode("");
    redirecting.current = true;
    try {
      window.location.assign(target);
    } catch {
      redirecting.current = false;
      setError(
        "The app could not be opened. Use Return to app, or start a fresh connection from the app.",
      );
    }
  };
  const classify = (
    e: unknown,
    sent: boolean,
    kind: "allow" | "deny" | "reauth",
  ) => {
    if (!current()) return;
    if (sent && uncertain(e)) {
      unknownKind.current = kind;
      setPhase(`unknown-${kind}`);
      setError(
        kind === "allow"
          ? "Orbyn may have allowed this app, but the return code was not confirmed. Do not allow again from this page."
          : kind === "reauth"
            ? "The confirmation outcome is uncertain. Check it before sending another password, code or passkey response."
            : "The decline response was not confirmed. You can retry this same decline without granting access.",
      );
    } else {
      unknownKind.current = null;
      setPhase("idle");
      if (e instanceof HttpError && e.message === "totp_required") {
        setNeedCode(true);
        setError("Enter your authenticator or recovery code too.");
      } else if (e instanceof HttpError && e.message === "reauth_required") {
        setUntil(null);
        setError("Confirm it is you again, then choose Allow.");
      } else
        setError(
          messageOf(
            e,
            "This request could not finish. Your choices are retained.",
          ),
        );
    }
  };
  const allow = async () => {
    if (
      !choice ||
      !check.account ||
      !current() ||
      lock.current ||
      unknownKind.current ||
      !readFresh ||
      phase === "redirect"
    )
      return;
    lock.current = true;
    setPhase("allow");
    setError("");
    const submitted = structuredClone(choice),
      opening = check;
    let sent = false;
    try {
      toConsent(request, opening, submitted);
      const freshCheck = await client.oauthCheck(request);
      if (!current()) return;
      if (!validCheck(freshCheck, request))
        throw Error("The refreshed request did not match this app.");
      if (
        freshCheck.account &&
        freshCheck.account.email !== opening.account?.email
      )
        throw Error(
          "The returned account did not match this request. Refresh before allowing.",
        );
      onChecked(freshCheck);
      setPermissionsCurrent(true);
      if (
        !freshCheck.account ||
        freshCheck.account.email !== opening.account?.email
      )
        throw Error(
          "The signed-in account changed. Review this request again.",
        );
      if (
        identity(freshCheck, submitted.teams) !==
        identity(opening, submitted.teams)
      )
        throw Error(
          "Connection details or team permissions changed. Review them before allowing again.",
        );
      const input = toConsent(request, freshCheck, submitted);
      if (
        (submitted.access === "write" || submitted.bookings) &&
        !(Date.parse(freshCheck.account.reauth_until ?? "") > Date.now())
      ) {
        setUntil(freshCheck.account.reauth_until);
        throw Error("Confirm it is you below, then choose Allow.");
      }
      const issuer = authorizationIssuer(
        await client.request<unknown>(
          "/.well-known/oauth-authorization-server",
          { fresh: true, anonymous: true },
        ),
      );
      if (!current()) return;
      sent = true;
      const receipt = await client.oauthAllow(input);
      if (!current()) return;
      const target = receiptTarget(receipt, request, "allow", issuer);
      follow(target);
    } catch (e) {
      classify(e, sent, "allow");
    } finally {
      lock.current = false;
      if (current()) setPhase((p) => (p === "allow" ? "idle" : p));
    }
  };
  const deny = async () => {
    if (
      !current() ||
      lock.current ||
      (unknownKind.current && unknownKind.current !== "deny") ||
      phase === "redirect"
    )
      return;
    lock.current = true;
    setPhase("deny");
    setError("");
    let sent = false;
    try {
      const issuer = authorizationIssuer(
        await client.request<unknown>(
          "/.well-known/oauth-authorization-server",
          { fresh: true, anonymous: true },
        ),
      );
      if (!current()) return;
      sent = true;
      const receipt = await client.oauthDeny(request);
      if (!current()) return;
      follow(receiptTarget(receipt, request, "deny", issuer));
    } catch (e) {
      classify(e, sent, "deny");
    } finally {
      lock.current = false;
      if (current()) setPhase((p) => (p === "deny" ? "idle" : p));
    }
  };
  const confirmed = (
    value: { reauth_until: string },
    sourceCheck = latest.current.check,
  ) => {
    const end = Date.parse(value?.reauth_until);
    if (!Number.isFinite(end) || end <= Date.now())
      throw Error("The confirmation was not current.");
    if (sourceCheck.account)
      onChecked({
        ...sourceCheck,
        account: { ...sourceCheck.account, reauth_until: value.reauth_until },
      });
    setUntil(value.reauth_until);
    setPassword("");
    setCode("");
    setNeedCode(false);
    unknownKind.current = null;
    setPhase("idle");
  };
  const reauth = async (passkey: boolean) => {
    if (
      !check.account ||
      !current() ||
      lock.current ||
      unknownKind.current ||
      phase === "redirect"
    )
      return;
    lock.current = true;
    setPhase("reauth");
    setError("");
    let sent = false;
    try {
      if (passkey) {
        const options = await client.reauthOptions();
        if (!current()) return;
        if (typeof options.handle !== "string" || !options.handle)
          throw Error("Could not start passkey confirmation.");
        const response = await startAuthentication({
          optionsJSON: options.options as Parameters<
            typeof startAuthentication
          >[0]["optionsJSON"],
        });
        if (!current()) return;
        const payload = reauthInput.parse({
          handle: options.handle,
          response: { ...response },
        });
        sent = true;
        const value = await client.reauth(payload);
        if (current()) confirmed(value);
      } else {
        const payload = reauthInput.parse({
          password,
          ...(code.trim() ? { code: code.trim() } : {}),
        });
        if (!current()) return;
        sent = true;
        const value = await client.reauth(payload);
        if (current()) confirmed(value);
      }
    } catch (e) {
      classify(e, sent, "reauth");
    } finally {
      lock.current = false;
      if (current()) setPhase((p) => (p === "reauth" ? "idle" : p));
    }
  };
  const checkOutcome = async () => {
    const kind = unknownKind.current;
    if (!kind || !current() || lock.current) return;
    lock.current = true;
    setPhase("checking");
    setError("");
    try {
      const observed = await client.oauthCheck(request);
      if (!current() || unknownKind.current !== kind) return;
      if (!validCheck(observed, request))
        throw Error("This request could not be checked.");
      if (
        check.account &&
        observed.account &&
        check.account.email !== observed.account.email
      )
        throw Error("The returned account did not match this request.");
      onChecked(observed);
      if (
        kind === "reauth" &&
        observed.account?.email === check.account?.email &&
        Date.parse(observed.account?.reauth_until ?? "") > Date.now()
      )
        confirmed({ reauth_until: observed.account!.reauth_until! }, observed);
      else {
        setPhase(`unknown-${kind}`);
        setError(
          kind === "allow"
            ? "The account state was refreshed. It cannot recover this request’s one-time return code or prove that an unconfirmed Allow failed. Review connections before explicitly leaving."
            : "The saved state does not confirm a current identity check. This request remains blocked.",
        );
      }
    } catch (e) {
      if (current()) {
        setPhase(`unknown-${kind}`);
        setError(
          messageOf(
            e,
            "Could not check the outcome. This request remains blocked.",
          ),
        );
      }
    } finally {
      lock.current = false;
    }
  };
  const abandon = async () => {
    if (!current() || lock.current || !unknownKind.current) return;
    lock.current = true;
    try {
      if (
        !(await confirm({
          title: "Leave an uncertain connection request?",
          body: "The app may already have been allowed. Its return code cannot be recovered here. Review Connections and disconnect it if needed; leaving does not revoke access.",
          action: "Review connections",
        })) ||
        !owned()
      )
        return;
      bypass.current = true;
      setPassword("");
      setCode("");
      redirect.current = null;
      navigate("/app/settings/connections");
    } finally {
      lock.current = false;
    }
  };
  const refreshPermissions = async () => {
    if (
      !current() ||
      lock.current ||
      unknownKind.current ||
      phase === "redirect"
    )
      return;
    lock.current = true;
    setPhase("checking");
    setError("");
    setPermissionsCurrent(false);
    try {
      const observed = await client.oauthCheck(request);
      if (!current()) return;
      if (!validCheck(observed, request))
        throw Error("The refreshed details did not match this request.");
      if (
        check.account &&
        observed.account &&
        check.account.email !== observed.account.email
      )
        throw Error("The returned account did not match this request.");
      onChecked(observed);
      setPermissionsCurrent(true);
    } catch (e) {
      if (current())
        setError(
          messageOf(
            e,
            "Could not refresh permissions. Refresh before allowing.",
          ),
        );
    } finally {
      lock.current = false;
      if (current()) setPhase((p) => (p === "checking" ? "idle" : p));
    }
  };
  const switchAccount = async () => {
    if (blocked || !current() || lock.current) return;
    if (!(await leave()) || !owned()) return;
    bypass.current = true;
    setPassword("");
    setCode("");
    onSwitch();
  };
  let validation = "";
  if (choice && check.account)
    try {
      toConsent(request, check, choice);
    } catch (e) {
      validation =
        e instanceof Error
          ? e.message
          : "Review the selected access and spaces.";
    }
  return (
    <>
      {check.account ? (
        <>
          <div className="connect-account">
            <p>
              Signed in as <strong dir="auto">{check.account.name}</strong>{" "}
              <span dir="auto">({check.account.email})</span>
            </p>
            <Button disabled={blocked} onClick={() => void switchAccount()}>
              Switch account
            </Button>
          </div>
          {choice && (
            <Choices
              check={check}
              value={choice}
              search={search}
              onSearch={setSearch}
              onChange={update}
              disabled={blocked || !readFresh || !permissionsCurrent}
            />
          )}
          {needsReauth && (
            <section
              className="connect-reauth"
              aria-labelledby="connect-reauth"
            >
              <h2 id="connect-reauth">Confirm it is you</h2>
              <p>
                Change access and bookings require a recent password or passkey
                confirmation. Confirming does not allow the app.
              </p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void reauth(false);
                }}
              >
                <Field label="Current password">
                  <Input
                    type="password"
                    autoComplete="current-password"
                    maxLength={128}
                    value={password}
                    disabled={blocked}
                    onChange={(e) => {
                      if (!lock.current) setPassword(e.target.value);
                    }}
                  />
                </Field>
                {(needCode || check.account.two_factor) && (
                  <Field label="Authenticator or recovery code">
                    <Input
                      autoComplete="one-time-code"
                      maxLength={20}
                      value={code}
                      disabled={blocked}
                      onChange={(e) => {
                        if (!lock.current) setCode(e.target.value);
                      }}
                    />
                  </Field>
                )}
                <div className="connect-actions">
                  <Button type="submit" disabled={blocked || !password}>
                    Confirm password
                  </Button>
                  {check.account.passkeys > 0 && (
                    <Button
                      disabled={blocked}
                      onClick={() => void reauth(true)}
                    >
                      Use a passkey
                    </Button>
                  )}
                </div>
              </form>
            </section>
          )}
          {validation && (
            <p role="alert" className="connect-problem">
              {validation}
            </p>
          )}
        </>
      ) : (
        <section className="connect-signin">
          <h2>Sign in to choose access</h2>
          <p>
            Your original connection request will return after sign-in. Signing
            in does not allow this app.
          </p>
          <div className="connect-actions">
            <Button
              variant="primary"
              disabled={blocked}
              onClick={() => onSignIn(false)}
            >
              Sign in
            </Button>
            <Button disabled={blocked} onClick={() => onSignIn(true)}>
              Create an account
            </Button>
          </div>
        </section>
      )}
      {error && <ErrorNotice message={error} />}
      {busy && (
        <p role="status">
          {phase === "allow"
            ? "Checking and allowing this request…"
            : phase === "deny"
              ? "Returning a decline…"
              : phase === "checking"
                ? "Checking saved state…"
                : "Confirming your identity…"}
        </p>
      )}
      {unknown && (
        <section
          className="connect-recovery"
          aria-labelledby="connect-recovery"
        >
          <h2 id="connect-recovery">Check the outcome</h2>
          <div className="connect-actions">
            {phase === "unknown-deny" ? (
              <Button onClick={() => void deny()}>Retry exact decline</Button>
            ) : (
              <Button onClick={() => void checkOutcome()}>
                Check saved state
              </Button>
            )}
            <a
              href="/app/settings/connections"
              target="_blank"
              rel="noopener noreferrer"
            >
              Review connections in another tab
            </a>
            <Button onClick={() => void abandon()}>Leave this request</Button>
          </div>
        </section>
      )}
      {phase === "redirect" ? (
        <section className="connect-recovery">
          <h2>Return to the app</h2>
          <p>
            The authorization response was received. Its return code is
            short-lived; if returning fails, start a fresh connection from the
            app.
          </p>
          <Button
            onClick={() => {
              if (redirect.current) follow(redirect.current);
            }}
          >
            Return to app
          </Button>
        </section>
      ) : (
        <div className="connect-actions">
          {check.account && (
            <Button
              variant="primary"
              disabled={
                !choice ||
                blocked ||
                !readFresh ||
                !permissionsCurrent ||
                needsReauth ||
                !!validation
              }
              onClick={() => void allow()}
            >
              Allow connection
            </Button>
          )}
          <Button disabled={blocked} onClick={() => void deny()}>
            Decline and return
          </Button>
        </div>
      )}
      <Button disabled={blocked} onClick={() => void refreshPermissions()}>
        Refresh connection details
      </Button>
      <p className="small">
        You can manage or disconnect this app in Settings → Connections. A
        security confirmation may be sent when access is added or raised.
      </p>
    </>
  );
}
