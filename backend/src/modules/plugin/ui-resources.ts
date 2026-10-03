import { z } from "zod";
import { cardResources, readCard, toolUiMeta } from "../mcp-server/apps.js";

/** Host addresses are exact resource identifiers, never URLs fetched by the backend. */
export const pluginResourceInput = z
  .object({ uri: z.string().min(1).max(256) })
  .strict();

/** List static cards only for tools allowed by this connection and the UI opt-in. */
export function pluginResources(toolNames: string[], enabled: boolean) {
  if (!enabled) return [];
  const allowed = new Set(
    toolNames.map((name) => {
      const ui = toolUiMeta(name)?.ui as { resourceUri?: string } | undefined;
      return ui?.resourceUri;
    }),
  );
  return cardResources().filter((resource) => allowed.has(resource.uri));
}

/** Recheck the current tool scope before returning a CSP-declared UI resource. */
export function readPluginResource(
  uri: string,
  toolNames: string[],
  enabled: boolean,
) {
  if (
    !pluginResources(toolNames, enabled).some(
      (resource) => resource.uri === uri,
    )
  )
    return null;
  return readCard(uri);
}
