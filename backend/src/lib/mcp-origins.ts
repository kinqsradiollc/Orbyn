import { env } from "../config/env.js";

/**
 * Web pages allowed to call the MCP address from a browser. Most agents
 * send no Origin at all (desktop apps, command-line tools, servers), and
 * that is always fine; a browser page may call only from these, so a page
 * elsewhere can't drive someone's local agent (DNS rebinding). The MCP
 * Inspector's local page is allowed only while Orbyn itself runs locally.
 */
export const MCP_ORIGINS = [
  "https://claude.ai",
  "https://chatgpt.com",
  "https://vscode.dev",
  "https://insiders.vscode.dev",
];

/** The MCP Inspector's page (npx @modelcontextprotocol/inspector). */
const INSPECTOR = ["http://localhost:6274", "http://127.0.0.1:6274"];

const origin = (url: string) => {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
};

const isLocal = () => {
  try {
    return ["localhost", "127.0.0.1", "[::1]"].includes(
      new URL(env.APP_URL).hostname,
    );
  } catch {
    return false;
  }
};

/** Whether a request with this Origin header may call /mcp. */
export function mcpOriginAllowed(value: string | undefined): boolean {
  if (!value) return true;
  const allowed = [
    ...MCP_ORIGINS,
    origin(env.APP_URL),
    ...(isLocal() ? INSPECTOR : []),
  ];
  return allowed.includes(value.replace(/\/+$/, ""));
}
