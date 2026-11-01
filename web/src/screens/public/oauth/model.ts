import {
  AGENT_ACCESS_RANK,
  AGENT_GRANT_DAY_CHOICES,
  AGENT_KEY_MAX_DAYS,
  AGENT_TOOLSETS,
  oauthRequest,
  oauthConsentInput,
  type AgentAccess,
  type AgentToolset,
  type OAuthCheck,
  type OAuthConsentInput,
  type OAuthRequest,
  type OAuthRedirect,
  type OAuthTeamChoice,
} from "@orbyn/core";
const PARAMS = [
  "response_type",
  "client_id",
  "redirect_uri",
  "code_challenge",
  "code_challenge_method",
  "state",
  "scope",
  "resource",
] as const;
export function requestFrom(search: string): {
  request?: OAuthRequest;
  error: string;
} {
  const values = new URLSearchParams(search),
    raw: Record<string, string> = {};
  for (const key of PARAMS) {
    if (values.getAll(key).length > 1)
      return {
        error:
          "This authorization link repeats a parameter. Start a fresh connection from the app.",
      };
    const value = values.get(key);
    if (value !== null) raw[key] = value;
  }
  const parsed = oauthRequest.safeParse(raw);
  if (!parsed.success)
    return {
      error:
        "This authorization link is incomplete or too long. Start again from the app.",
    };
  if (
    parsed.data.response_type !== "code" ||
    parsed.data.code_challenge_method !== "S256" ||
    !/^[A-Za-z0-9_-]{43}$/.test(parsed.data.code_challenge)
  )
    return {
      error:
        "This connection requires an authorization code protected with PKCE S256. Start again from an updated app.",
    };
  return { request: parsed.data, error: "" };
}
export type Account = NonNullable<OAuthCheck["account"]>;
export const optionalToolsets: AgentToolset[] = AGENT_TOOLSETS.filter(
  (t) => t !== "core" && t !== "booking",
);
export type Choices = {
  access: AgentAccess;
  personal: boolean;
  teams: string[];
  toolsets: AgentToolset[];
  bookings: boolean;
  notify: boolean;
  hideOutside: boolean;
  days: number;
  stayConnected: boolean;
};
export function expiryChoices(max: number) {
  return [
    ...new Set<number>([
      ...AGENT_GRANT_DAY_CHOICES.filter((d) => d <= max),
      max,
    ]),
  ]
    .filter((d) => Number.isInteger(d) && d >= 1 && d <= AGENT_KEY_MAX_DAYS)
    .sort((a, b) => a - b);
}
export function initialChoices(check: OAuthCheck, account: Account): Choices {
  const existing = account.existing,
    days = expiryChoices(account.max_grant_days),
    usable = new Set(
      account.teams.filter((t) => t.agent_access !== "off").map((t) => t.id),
    );
  return {
    access: check.requested_access,
    personal: existing?.personal ?? true,
    teams: existing?.team_ids?.filter((id) => usable.has(id)) ?? [],
    toolsets:
      existing?.toolsets.filter((t) => optionalToolsets.includes(t)) ?? [],
    bookings: check.requested_bookings,
    notify: false,
    hideOutside: existing?.hide_outside_content ?? false,
    days: days.includes(90) ? 90 : (days.at(-1) ?? 1),
    stayConnected:
      check.can_stay_connected === true &&
      check.requested_offline_access === true,
  };
}
export const wider = (selected: AgentAccess, requested: AgentAccess) =>
  AGENT_ACCESS_RANK[selected] > AGENT_ACCESS_RANK[requested];
export function teamNote(team: OAuthTeamChoice) {
  if (team.agent_access === "off")
    return "Outside agents are off in this team.";
  if (team.role === "viewer")
    return "Your viewer role limits this space to reading.";
  if (team.agent_access === "read") return "The team limits agents to reading.";
  if (team.agent_access === "suggest") return "Team changes require review.";
  return "Your membership role and the team’s policies still apply.";
}
export function validCheck(check: OAuthCheck, request: OAuthRequest) {
  return (
    check?.client?.id === request.client_id &&
    typeof check.client.name === "string" &&
    typeof check.client.host === "string" &&
    typeof check.client.redirect_host === "string" &&
    ["read", "suggest", "write"].includes(check.requested_access) &&
    (!check.account ||
      (Number.isInteger(check.account.max_grant_days) &&
        check.account.max_grant_days >= 1 &&
        check.account.max_grant_days <= AGENT_KEY_MAX_DAYS &&
        Array.isArray(check.account.teams)))
  );
}
export function toConsent(
  request: OAuthRequest,
  check: OAuthCheck,
  choice: Choices,
): OAuthConsentInput {
  const account = check.account;
  if (!account) throw Error("Sign in again before allowing this connection.");
  if (choice.days > account.max_grant_days)
    throw Error(`Choose an expiry of at most ${account.max_grant_days} days.`);
  if (
    choice.teams.some(
      (id) =>
        !account.teams.some((t) => t.id === id && t.agent_access !== "off"),
    )
  )
    throw Error(
      "A selected team is no longer available to agents. Review the selected spaces.",
    );
  if (choice.stayConnected && check.can_stay_connected !== true)
    throw Error(
      "Automatic renewal is no longer available. Review this choice.",
    );
  const parsed = oauthConsentInput.safeParse({
    request,
    access: choice.access,
    personal: choice.personal,
    team_ids: [...choice.teams],
    toolsets: [...choice.toolsets],
    bookings: choice.bookings,
    notify_teammates: choice.notify,
    hide_outside_content: choice.hideOutside,
    expires_in_days: choice.days,
    ...(check.can_stay_connected === true
      ? { stay_connected: choice.stayConnected }
      : {}),
  });
  if (!parsed.success)
    throw Error(
      parsed.error.issues[0]?.message ??
        "Review the selected access and spaces.",
    );
  return parsed.data;
}
/** Metadata requiring review before a write; never includes secrets. */
export function identity(check: OAuthCheck, teams: string[] = []) {
  return JSON.stringify([
    check.client,
    check.resource,
    check.requested_access,
    check.requested_bookings,
    check.requested_offline_access,
    check.can_stay_connected,
    check.account?.max_grant_days,
    check.account?.teams.filter((t) => teams.includes(t.id)),
    check.account?.existing
      ? {
          id: check.account.existing.id,
          access: check.account.existing.access,
          trust: check.account.existing.trust,
          spaces: check.account.existing.space_trust,
          acts: check.account.existing.acts_alone,
          personal: check.account.existing.personal,
          teams: check.account.existing.team_ids,
          toolsets: check.account.existing.toolsets,
          hideOutside: check.account.existing.hide_outside_content,
        }
      : null,
  ]);
}
/** Read the issuer from this API's discovery document, not the browser host. */
export function authorizationIssuer(metadata: unknown): string {
  const invalid = () =>
    Error("Could not verify the authorization server. Try again.");
  if (
    !metadata ||
    typeof metadata !== "object" ||
    Array.isArray(metadata) ||
    !("issuer" in metadata) ||
    typeof metadata.issuer !== "string"
  )
    throw invalid();
  const issuer = metadata.issuer;
  if (!issuer || /[\u0000-\u0020\u007f]/.test(issuer)) throw invalid();
  let parsed: URL;
  try {
    parsed = new URL(issuer);
  } catch {
    throw invalid();
  }
  if (
    !["http:", "https:"].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  )
    throw invalid();
  return issuer;
}
/** Bind the server receipt to its checked callback, retaining native app schemes. */
export function receiptTarget(
  receipt: OAuthRedirect,
  request: OAuthRequest,
  kind: "allow" | "deny",
  expectedIssuer: string,
): string {
  if (
    typeof receipt?.redirect_to !== "string" ||
    receipt.redirect_to.length > 16000
  )
    throw Error("The server did not return a valid authorization response.");
  const actual = new URL(receipt.redirect_to),
    expected = new URL(request.redirect_uri),
    issuer = actual.searchParams.get("iss");
  if (!issuer || actual.searchParams.getAll("iss").length !== 1)
    throw Error("The authorization response is missing its issuer.");
  if (issuer !== expectedIssuer)
    throw Error(
      "The authorization response did not match this server. Start a fresh connection from the app.",
    );
  if (kind === "allow") {
    const code = actual.searchParams.get("code");
    if (!code?.trim() || actual.searchParams.getAll("code").length !== 1)
      throw Error(
        "The authorization response did not contain one return code.",
      );
    expected.searchParams.set("code", code);
  } else {
    if (actual.searchParams.get("error") !== "access_denied")
      throw Error("The decline response did not match this request.");
    expected.searchParams.set("error", "access_denied");
    expected.searchParams.set("error_description", "The person declined.");
  }
  if (request.state !== undefined)
    expected.searchParams.set("state", request.state);
  expected.searchParams.set("iss", issuer);
  if (actual.toString() !== expected.toString())
    throw Error(
      "The authorization response did not match the original return address and state.",
    );
  return actual.toString();
}
