import { z } from "zod";
import type { ToolResult } from "../../capabilities/execute.js";
import type { ToolDescription } from "../../capabilities/registry.js";
import { cardResources, readCard, toolUiMeta } from "../mcp-server/apps.js";

/** A sidebar launch returns no account content; a separate user click reads Today. */
export const PLUGIN_ENTRYPOINT = "open_orbyn";
export const pluginEntrypointTool: ToolDescription & {
  _meta: Record<string, unknown>;
} = {
  name: PLUGIN_ENTRYPOINT,
  title: "Orbyn",
  description:
    "Open Orbyn's Today card. Reading the day requires a user action.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  outputSchema: {
    type: "object",
    properties: { kind: { const: "plugin_home" } },
    required: ["kind"],
  },
  annotations: {
    title: "Orbyn",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  _meta: {
    ...toolUiMeta("get_today"),
    "openai/ui": { entrypoints: [{ type: "global" }] },
  },
};

export function pluginEntrypointResult(
  args: Record<string, unknown>,
): ToolResult {
  if (Object.keys(args).length)
    throw new Error("The plugin entrypoint takes no arguments.");
  return {
    content: [{ type: "text", text: "Orbyn is ready." }],
    structuredContent: { kind: "plugin_home" },
  };
}

/** Portable cards remain available without host-specific entrypoints. */
export function pluginToolUiMeta(tool: string): Record<string, unknown> | null {
  return tool === PLUGIN_ENTRYPOINT
    ? pluginEntrypointTool._meta
    : toolUiMeta(tool);
}

/** Host addresses are exact resource identifiers, never URLs fetched by the backend. */
export const pluginResourceInput = z
  .object({ uri: z.string().min(1).max(256) })
  .strict();

/** List static cards only for tools allowed by this connection and the UI opt-in. */
export function pluginResources(toolNames: string[], enabled: boolean) {
  if (!enabled) return [];
  const allowed = new Set(
    toolNames.map((name) => {
      const ui = pluginToolUiMeta(name)?.ui as
        { resourceUri?: string } | undefined;
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
