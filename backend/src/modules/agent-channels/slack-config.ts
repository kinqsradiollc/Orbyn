import { env } from "../../config/env.js";
import {
  validateSlackOAuthConfig,
  type SlackOAuthConfig,
} from "./slack-oauth.js";

/** Configuration is administrator-owned; request headers and bodies cannot override it. */
export function configuredSlack(): SlackOAuthConfig | undefined {
  try {
    return validateSlackOAuthConfig({
      clientId: env.SLACK_CLIENT_ID,
      clientSecret: env.SLACK_CLIENT_SECRET,
      appId: env.SLACK_APP_ID,
      redirectUri: env.SLACK_REDIRECT_URI,
    });
  } catch {
    return undefined;
  }
}
