import {
  type AccountPrefs,
  type AccountPrefsInput,
  type ActivitySummary,
  type AuthResponse,
  type CoverPicture,
  type Credentials,
  type FirstRunInput,
  type FirstRunResult,
  type HomeSummary,
  type ImportSummary,
  type InboxInfo,
  type NewApiKey,
  type NewWebhook,
  type NightShiftSettings,
  type PageMention,
  type PrivacyView,
  type Profile,
  type PublicProfile,
  type Reauthenticated,
  type ReauthInput,
  type TwoFactorEnabled,
  type TwoFactorSetup,
  type TwoFactorStatus,
  type User,
  type WebhookInput,
  type WebhookTestResult,
} from "@orbyn/core";
import { RequestOptions } from "../client-contracts.js";
import type { OrbynClient } from "../client.js";

/** Sends a test email with the saved SMTP settings (to the admin by default). */

export function callSendTestEmail(this: OrbynClient, to?: string) {
  return this.request<{ sent: true; to: string }>(
    "/admin/settings/test-email",
    { method: "POST", body: to ? { to } : {} },
  );
}

// ---- auth ----

export function callRegister(this: OrbynClient, input: Credentials) {
  return this.request<AuthResponse>("/auth/register", {
    method: "POST",
    body: input,
    anonymous: true,
  });
}

export function callLogin(
  this: OrbynClient,
  input: Pick<Credentials, "email" | "password"> & { code?: string },
) {
  return this.request<AuthResponse>("/auth/login", {
    method: "POST",
    body: input,
    anonymous: true,
  });
}

export function callLogout(this: OrbynClient) {
  return this.request<void>("/auth/logout", { method: "POST" });
}

/** Sign out one other device. */

export function callRevokeSession(this: OrbynClient, id: string) {
  return this.request<void>(`/me/sessions/${id}`, { method: "DELETE" });
}

/** Sign out everywhere except here. */

export function callRevokeOtherSessions(this: OrbynClient) {
  return this.request<{ signed_out: number }>("/me/sessions/revoke-others", {
    method: "POST",
  });
}

// ---- two-step verification ----

export function callGetTwoFactor(this: OrbynClient) {
  return this.request<TwoFactorStatus>("/me/2fa");
}

/** Begin setup: returns the secret and otpauth URI to add to an app. */

export function callSetupTwoFactor(this: OrbynClient) {
  return this.request<TwoFactorSetup>("/me/2fa/setup", { method: "POST" });
}

/** Confirm with a code; returns the one-time recovery codes. */

export function callEnableTwoFactor(this: OrbynClient, code: string) {
  return this.request<TwoFactorEnabled>("/me/2fa/enable", {
    method: "POST",
    body: { code },
  });
}

export function callDisableTwoFactor(this: OrbynClient, password: string) {
  return this.request<void>("/me/2fa/disable", {
    method: "POST",
    body: { password },
  });
}

export function callPasskeyRegisterOptions(this: OrbynClient) {
  return this.request<unknown>("/me/passkeys/options", { method: "POST" });
}

export function callRegisterPasskey(
  this: OrbynClient,
  response: unknown,
  name: string,
) {
  return this.request<{ ok: boolean }>("/me/passkeys", {
    method: "POST",
    body: { response, name },
  });
}

export function callDeletePasskey(this: OrbynClient, id: string) {
  return this.request<void>(`/me/passkeys/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

/** Sign-in step 1: options + an opaque handle to send back. */

export function callPasskeyLoginOptions(this: OrbynClient, email?: string) {
  return this.request<{ handle: string; options: unknown }>(
    "/auth/passkey/options",
    { method: "POST", body: { email }, anonymous: true },
  );
}

/** Sign-in step 2: the assertion, returns a session. */

export function callPasskeyLogin(
  this: OrbynClient,
  handle: string,
  response: unknown,
) {
  return this.request<AuthResponse>("/auth/passkey", {
    method: "POST",
    body: { handle, response },
    anonymous: true,
  });
}

// ---- import / export ----
/** Your planner data as a JSON archive to keep. */

export function callExportData(this: OrbynClient) {
  return this.request<unknown>("/me/export");
}

/**
 * Everything, pages included, as a .zip: every page as Markdown in its
 * folders, projects, folders, imports, consent history and the planner
 * file. Comes back as a blob with the name the server chose.
 */

export async function callExportArchive(this: OrbynClient) {
  const response = await this.raw("/me/export.zip");
  const disposition = response.headers.get("content-disposition") ?? "";
  const named = /filename="([^"]+)"/.exec(disposition)?.[1];
  return {
    blob: await response.blob(),
    name: named ?? "orbyn-export.zip",
  };
}

/** Bring items in from an Orbyn export or a CSV. Dry run by default. */

export function callImportData(
  this: OrbynClient,
  input: {
    format: "orbyn" | "csv" | "todoist" | "ticktick";
    data: string;
    dry_run?: boolean;
  },
) {
  return this.request<ImportSummary>("/me/import", {
    method: "POST",
    body: input,
  });
}

// ---- email to task ----

export function callGetInbox(this: OrbynClient) {
  return this.request<InboxInfo>("/me/inbox");
}

/** Turn on email-to-task, or roll to a fresh address. */

export function callRotateInbox(this: OrbynClient) {
  return this.request<InboxInfo>("/me/inbox/rotate", { method: "POST" });
}

export function callDisableInbox(this: OrbynClient) {
  return this.request<void>("/me/inbox", { method: "DELETE" });
}

/** Confirm an email address from a verification link (signed in or not). */

export function callVerifyEmail(this: OrbynClient, token: string) {
  return this.request<void>("/auth/verify-email", {
    method: "POST",
    body: { token },
    anonymous: true,
  });
}

/** Re-send the confirmation email to the signed-in, unconfirmed user. */

export function callResendVerification(this: OrbynClient) {
  return this.request<void>("/auth/resend-verification", { method: "POST" });
}

/** Ask for a password-reset link. Always succeeds, whoever the email is. */

export function callForgotPassword(this: OrbynClient, email: string) {
  return this.request<void>("/auth/forgot-password", {
    method: "POST",
    body: { email },
    anonymous: true,
  });
}

/** Set a new password from a reset link and sign in. */

export function callResetPassword(
  this: OrbynClient,
  token: string,
  password: string,
) {
  return this.request<AuthResponse>("/auth/reset-password", {
    method: "POST",
    body: { token, password },
    anonymous: true,
  });
}

// ---- profile ----

export function callMe(
  this: OrbynClient,
  options: Pick<RequestOptions, "fresh" | "signal"> = {},
) {
  return this.request<User>("/me", options);
}

/** People who can be named in a comment on this document. */
/** "Mentioned in": the pages that name you, newest first. */

export function callMentions(this: OrbynClient, limit = 50) {
  return this.request<PageMention[]>(`/me/mentions?limit=${limit}`);
}

// Choices that follow the account (NAV-08, NAV-09, SHR-08)

export function callGetPrefs(this: OrbynClient) {
  return this.request<AccountPrefs>("/me/prefs");
}

export function callSavePrefs(this: OrbynClient, input: AccountPrefsInput) {
  return this.request<AccountPrefs>("/me/prefs", {
    method: "PUT",
    body: input,
  });
}

export function callResetPrefs(this: OrbynClient) {
  return this.request<void>("/me/prefs", { method: "DELETE" });
}

// Home (W1)
/** Home's panels: active goals, next routine runs, today's brief and reflection. */

export function callGetHome(this: OrbynClient) {
  return this.request<HomeSummary>("/me/home");
}

/** Your pictures, newest first, to choose a cover from. */

export function callMyPictures(this: OrbynClient) {
  return this.request<CoverPicture[]>("/me/pictures");
}

/** Mark a session started (from its reminder, or while it's on). */

export function callStartSession(
  this: OrbynClient,
  id: string,
  from: "app" | "reminder" = "app",
) {
  return this.request<{ id: string; item_id: string; started_at: string }>(
    `/blocks/${id}/start`,
    { method: "POST", body: { from } },
  );
}

// ---- profile page ----

export function callGetProfile(this: OrbynClient) {
  return this.request<Profile>("/me/profile");
}

/** Public: someone's profile page and their booking pages. */

export function callGetPublicProfile(this: OrbynClient, handle: string) {
  return this.request<PublicProfile>(`/u/${encodeURIComponent(handle)}`, {
    anonymous: true,
  });
}

/** The returned `key` is shown once. */

export function callCreateApiKey(this: OrbynClient, name: string) {
  return this.request<NewApiKey>("/me/api-keys", {
    method: "POST",
    body: { name },
  });
}

export function callDeleteApiKey(this: OrbynClient, id: string) {
  return this.request<void>(`/me/api-keys/${id}`, { method: "DELETE" });
}

/** The person's optional night window and morning review preference. */

export function callNightShiftSettings(this: OrbynClient) {
  return this.request<NightShiftSettings>("/me/assistant/night-shift");
}

/** Passkey options for confirming it's you (without a new session). */

export function callReauthOptions(this: OrbynClient) {
  return this.request<{ handle: string; options: unknown }>(
    "/me/reauth/options",
    { method: "POST", body: {} },
  );
}

/** Confirm it's you: password (and two-step code) or a passkey. */

export function callReauth(this: OrbynClient, input: ReauthInput) {
  return this.request<Reauthenticated>("/me/reauth", {
    method: "POST",
    body: input,
  });
}

/** The returned `secret` signs deliveries and is shown once. */

export function callCreateWebhook(this: OrbynClient, input: WebhookInput) {
  return this.request<NewWebhook>("/me/webhooks", {
    method: "POST",
    body: input,
  });
}

export function callDeleteWebhook(this: OrbynClient, id: string) {
  return this.request<void>(`/me/webhooks/${id}`, { method: "DELETE" });
}

export function callTestWebhook(this: OrbynClient, id: string) {
  return this.request<WebhookTestResult>(`/me/webhooks/${id}/test`, {
    method: "POST",
  });
}

/** Accept the Terms and Privacy Policy at this version. */

export function callAcceptTerms(this: OrbynClient, termsVersion: string) {
  return this.request<{ terms_version: string }>("/me/consent", {
    method: "POST",
    body: { terms_version: termsVersion },
  });
}

export function callPrivacy(this: OrbynClient) {
  return this.request<PrivacyView>("/me/privacy");
}

export function callSetPrivacy(
  this: OrbynClient,
  input: { analytics_opt_out: boolean },
) {
  return this.request<PrivacyView>("/me/privacy", {
    method: "PUT",
    body: input,
  });
}

/** Delete your own account for good. */

export function callDeleteAccount(
  this: OrbynClient,
  input: { password?: string; confirm_email?: string },
) {
  return this.request<void>("/me", { method: "DELETE", body: input });
}

export function callActivitySummary(
  this: OrbynClient,
  days: 30 | 90 | 365 = 90,
) {
  return this.request<ActivitySummary>(`/me/activity-summary?days=${days}`);
}

/** Finish the first run (DSN-02): what Orbyn is for, and a starter. */

export function callFinishFirstRun(this: OrbynClient, input: FirstRunInput) {
  return this.request<FirstRunResult & { user: User }>("/me/first-run", {
    method: "POST",
    body: input,
  });
}

/** Not now: the first run isn't shown again. */

export function callSkipFirstRun(this: OrbynClient) {
  return this.request<User>("/me/first-run/skip", {
    method: "POST",
    body: {},
  });
}
