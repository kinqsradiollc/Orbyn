import { validateTeamsBotConfig } from "./teams-transport.js";
import { env } from "../../config/env.js";
import {
  validateTeamsOAuthConfig,
  type TeamsOAuthConfig,
} from "./teams-oauth.js";
/** Administrator-owned public-cloud identity configuration; never derived from request data. */
export function configuredTeams(): TeamsOAuthConfig | undefined {
  try {
    return validateTeamsOAuthConfig({
      clientId: env.TEAMS_CLIENT_ID,
      clientSecret: env.TEAMS_CLIENT_SECRET,
      botAppId: env.TEAMS_BOT_APP_ID,
      redirectUri: env.TEAMS_REDIRECT_URI,
    });
  } catch {
    return undefined;
  }
}

/** Bot application credentials are independent of identity OAuth and never client-controlled. */
export function configuredTeamsBot():
  import("./teams-transport.js").TeamsBotConfig | undefined {
  try {
    return validateTeamsBotConfig({
      appId: env.TEAMS_BOT_APP_ID,
      tenantId: env.TEAMS_BOT_TENANT_ID,
      clientSecret: env.TEAMS_BOT_CLIENT_SECRET,
    });
  } catch {
    return undefined;
  }
}
